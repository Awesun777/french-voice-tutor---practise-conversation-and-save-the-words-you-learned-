/**
 * GET /api/google/sync-stream
 *
 * Server-Sent Events endpoint that runs the full Google Drive sync and emits
 * step-by-step progress messages to the browser in real time.
 *
 * Flow:
 *   1. connecting        — auth + load settings
 *   2. reading_doc       — fetch Google Doc text + revisionId
 *   3. up_to_date        — (optional) emitted when revisionId matches lastRevisionId; sync skipped
 *   4. analysing N/M     — LLM extraction per batch
 *   5. needs_year        — (optional) emitted when dates lack a year; client must
 *                          re-request with ?year=YYYY to resume
 *   6. saving            — insert pending imports into DB
 *   7. done              — finished, includes found count
 *   8. error             — something went wrong
 *
 * POST /api/google/sync-confirm-year
 *   Body: { year: number }
 *   Re-runs the sync with a year override for ambiguous dates.
 *   Returns { found: number } on success.
 */
import type { Express, Request, Response } from "express";
import { sdk } from "./_core/sdk";
import * as db from "./db";
import {
  extractDocId,
  extractVocabGroups,
  fetchGoogleDocText,
  getValidAccessToken,
  parseDateKey,
  type ExtractionModel,
} from "./googleDrive";
import { getAllNonSkippedPendingImports } from "./db";

function send(res: Response, data: Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/** Send SSE keepalive comment every intervalMs to prevent connection timeout. */
function startKeepalive(res: Response, intervalMs = 15_000): ReturnType<typeof setInterval> {
  return setInterval(() => {
    try { res.write(": ping\n\n"); } catch { /* ignore if already closed */ }
  }, intervalMs);
}

async function runSync(
  userId: number,
  yearOverride: number | undefined,
  onEvent: (data: Record<string, unknown>) => void
): Promise<{ found: number }> {
  const settings = await db.getGoogleDriveSettings(userId);
  if (!settings?.sourceDocUrl) {
    throw new Error("No source document URL configured. Please set one in the Drive settings.");
  }

  const docId = extractDocId(settings.sourceDocUrl);
  if (!docId) {
    throw new Error("Invalid Google Doc URL. Please check the URL in Drive settings.");
  }

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(userId);
  } catch (e: any) {
    throw new Error(e.message ?? "Google account not connected.");
  }

  onEvent({ step: "reading_doc" });
  const { text: docText, revisionId } = await fetchGoogleDocText(docId, accessToken);

  if (!docText.trim()) {
    return { found: 0 };
  }

  // ── Incremental sync: skip LLM entirely if the document hasn't changed ────
  if (revisionId && settings.lastRevisionId && revisionId === settings.lastRevisionId) {
    onEvent({ step: "up_to_date", revisionId });
    return { found: 0 };
  }

  // Build deduplication set — include vocab_entries AND all non-skipped pending imports
  // (both 'pending' and 'accepted' statuses) so previously queued or accepted words
  // are never re-imported in a subsequent sync.
  const existingVocab = await db.getVocabByUser(userId);
  const normalize = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const existingTerms = new Set(existingVocab.map((v) => normalize(v.term)));
  const allPending = await getAllNonSkippedPendingImports(userId);
  for (const p of allPending) existingTerms.add(normalize(p.term));

  // Load user's preferred extraction model
  const model: ExtractionModel = (settings.extractionModel as ExtractionModel) ?? "deepseek-v4-flash";

  // Extract with smart grouping using the user's chosen model
  const { groups, ambiguousDates, numericDateFormat } = await extractVocabGroups(
    docText,
    existingTerms,
    (batch, total) => onEvent({ step: "analysing", chunk: batch, total }),
    model
  );

  // If there are ambiguous dates and no year override provided, pause and ask
  if (ambiguousDates.length > 0 && yearOverride === undefined) {
    onEvent({ step: "needs_year", dates: ambiguousDates });
    return { found: -1 }; // sentinel: paused, not an error
  }

  // Resolve dateKeys — apply yearOverride for ambiguous dates
  const today = new Date().toISOString().split("T")[0];
  const importItems: Array<{
    term: string;
    translation: string;
    kind: "word" | "phrase";
    dateKey: string;
    groupLabel: string | null;
  }> = [];

  for (const group of groups) {
    let dateKey: string;
    if (group.rawDate) {
      if (group.yearMissing && yearOverride !== undefined) {
        dateKey = parseDateKey(group.rawDate, yearOverride, numericDateFormat) ?? today;
      } else {
        dateKey = group.dateKey ?? today;
      }
    } else {
      dateKey = today;
    }

    for (const word of group.words) {
      importItems.push({
        term: word.term,
        translation: word.translation,
        kind: word.kind,
        dateKey,
        groupLabel: group.topicLabel ?? null,
      });
    }
  }

  onEvent({ step: "saving", count: importItems.length });

  if (importItems.length > 0) {
    await db.insertPendingImports(userId, importItems);
  }

  // Save lastSyncedAt, and the new revisionId for incremental sync — but only
  // when something was actually imported. Recording the revisionId on a
  // zero-import sync would make every retry short-circuit as "up to date",
  // hiding extraction failures permanently (the model picker would appear broken).
  await db.upsertGoogleDriveSettings(userId, {
    lastSyncedAt: Date.now(),
    ...(revisionId && importItems.length > 0 ? { lastRevisionId: revisionId } : {}),
  });

  return { found: importItems.length };
}

export function registerGoogleSyncStreamRoute(app: Express) {
  // ── SSE streaming sync ────────────────────────────────────────────────────
  app.get("/api/google/sync-stream", async (req: Request, res: Response) => {
    let user: { id: number; name: string | null; openId: string } | null = null;
    try {
      user = await sdk.authenticateRequest(req);
    } catch {
      user = null;
    }

    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const yearParam = req.query.year ? parseInt(req.query.year as string, 10) : undefined;

    const keepalive = startKeepalive(res);
    try {
      send(res, { step: "connecting" });

      const result = await runSync(user.id, yearParam, (data) => send(res, data));

      if (result.found === -1) {
        // Paused for year clarification — already emitted needs_year event
      } else {
        send(res, { step: "done", found: result.found });
      }
    } catch (err: any) {
      send(res, { step: "error", message: err?.message ?? "An unexpected error occurred." });
    } finally {
      clearInterval(keepalive);
      res.end();
    }
  });

  // ── Year-confirmation sync (SSE, so the UI gets progress) ────────────────
  // Called after user confirms the year for ambiguous dates.
  app.post("/api/google/sync-confirm-year", async (req: Request, res: Response) => {
    let user: { id: number; name: string | null; openId: string } | null = null;
    try {
      user = await sdk.authenticateRequest(req);
    } catch {
      user = null;
    }

    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const year = parseInt(req.body?.year, 10);
    if (!year || year < 2000 || year > 2100) {
      res.status(400).json({ error: "Invalid year" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const keepalive = startKeepalive(res);
    try {
      send(res, { step: "connecting" });

      const result = await runSync(user.id, year, (data) => send(res, data));
      send(res, { step: "done", found: result.found });
    } catch (err: any) {
      send(res, { step: "error", message: err?.message ?? "An unexpected error occurred." });
    } finally {
      clearInterval(keepalive);
      res.end();
    }
  });
}

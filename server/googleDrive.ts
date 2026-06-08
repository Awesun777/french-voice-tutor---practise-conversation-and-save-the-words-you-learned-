/**
 * Google Drive / Docs helpers
 *
 * - refreshGoogleAccessToken   : use refresh token to get a new access token
 * - getValidAccessToken        : returns a valid access token (refreshes if needed)
 * - fetchGoogleDocText         : export a Google Doc as plain text
 * - extractVocabGroups         : use LLM to extract French words grouped by date/topic
 * - exportLibraryToGoogleDoc   : create or update a Google Doc with the user's vocab library
 */
import * as db from "./db";
import { ENV } from "./_core/env";

/**
 * Call DeepSeek-V3 directly, bypassing the Manus built-in LLM quota.
 */
async function callDeepSeek(messages: { role: string; content: string }[], useJson?: boolean): Promise<string> {
  const body: Record<string, unknown> = {
    model: "deepseek-chat",
    messages,
    max_tokens: 4096,
  };
  if (useJson) {
    body.response_format = { type: "json_object" };
  }
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ENV.deepseekApiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DeepSeek API error ${res.status}: ${err}`);
  }
  const data = await res.json() as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message?.content ?? "{}";
}

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DOCS_EXPORT_URL = (docId: string) =>
  `https://docs.googleapis.com/v1/documents/${docId}`;
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";

// ── Token management ──────────────────────────────────────────────────────────

export async function refreshGoogleAccessToken(refreshToken: string): Promise<{
  access_token: string;
  expires_in: number;
}> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: ENV.googleClientId,
      client_secret: ENV.googleClientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to refresh Google token: ${err}`);
  }

  return res.json();
}

/**
 * Returns a valid access token for the given userId, refreshing if expired.
 * Throws if the user has no connected Google account.
 */
export async function getValidAccessToken(userId: number): Promise<string> {
  const account = await db.getGoogleAccountByUserId(userId);
  if (!account) throw new Error("No Google account connected");

  // Give a 60-second buffer before expiry
  if (account.expiresAt > Date.now() + 60_000) {
    return account.accessToken;
  }

  if (!account.refreshToken) {
    throw new Error("No refresh token available — user must reconnect Google");
  }

  const tokens = await refreshGoogleAccessToken(account.refreshToken);
  const newExpiresAt = Date.now() + tokens.expires_in * 1000;
  await db.updateGoogleTokens(userId, tokens.access_token, newExpiresAt);
  return tokens.access_token;
}

// ── Google Doc reading ────────────────────────────────────────────────────────

/**
 * Extract the Google Doc ID from a URL like:
 *   https://docs.google.com/document/d/DOC_ID/edit
 */
export function extractDocId(url: string): string | null {
  const match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

/**
 * Fetch a Google Doc and return its plain-text content.
 */
export async function fetchGoogleDocText(docId: string, accessToken: string): Promise<string> {
  const res = await fetch(`${DOCS_EXPORT_URL(docId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to fetch Google Doc: ${err}`);
  }

  const doc = await res.json() as {
    body?: {
      content?: Array<{
        paragraph?: {
          elements?: Array<{
            textRun?: { content?: string };
          }>;
        };
      }>;
    };
  };

  const lines: string[] = [];
  for (const block of doc.body?.content ?? []) {
    if (!block.paragraph) continue;
    const text = (block.paragraph.elements ?? [])
      .map((el) => el.textRun?.content ?? "")
      .join("");
    if (text.trim()) lines.push(text.trim());
  }

  return lines.join("\n");
}

// ── AI extraction with smart grouping ────────────────────────────────────────

export interface ExtractedWord {
  term: string;
  translation: string;
  kind: "word" | "phrase";
}

export interface ExtractedGroup {
  /** Raw date string as found in the document, e.g. "June 5", "2025-06-05", "5 juin" */
  rawDate: string | null;
  /** Whether the year component is missing and needs user clarification */
  yearMissing: boolean;
  /** Optional topic/theme sub-label, e.g. "At the restaurant", "Chapter 3" */
  topicLabel: string | null;
  words: ExtractedWord[];
}

const CHUNK_SIZE = 6000;   // characters per LLM call
const CHUNK_OVERLAP = 300; // overlap to avoid cutting mid-group header

/**
 * Split text into overlapping chunks so no vocabulary is missed due to token limits.
 * Tries to split on newlines to avoid cutting mid-line.
 */
function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + CHUNK_SIZE, text.length);
    // Try to break on a newline boundary
    if (end < text.length) {
      const lastNewline = text.lastIndexOf("\n", end);
      if (lastNewline > start + CHUNK_SIZE / 2) end = lastNewline + 1;
    }
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start = end - CHUNK_OVERLAP;
  }
  return chunks;
}

/**
 * Run the LLM on a single chunk and return structured groups.
 */
async function extractGroupsFromChunk(chunk: string): Promise<ExtractedGroup[]> {
  const currentYear = new Date().getFullYear();
  const systemPrompt = `You are a French vocabulary extractor that understands document structure.

Analyse the text and extract French vocabulary, preserving the document's own grouping structure:
1. Look for date headers (e.g. "June 5", "2025-06-05", "5 juin 2024", "Monday June 3rd")
2. Look for topic/theme headers (e.g. "At the restaurant", "Chapter 3", "Travel vocabulary")
3. Group words under the section they belong to

Return a JSON object with a "groups" array. Each group has:
- rawDate: the date string exactly as written in the doc (null if no date found for this group)
- yearMissing: true if a date is present but the year is not explicitly stated
- topicLabel: the topic/theme label if present (null if none)
- words: array of { term, translation, kind } for French vocabulary in this group

Rules:
- kind is "word" for single words or short expressions, "phrase" for full sentences
- Only extract items that are clearly French vocabulary a learner would save
- If the text has no grouping at all, return a single group with rawDate=null, topicLabel=null
- Do not invent dates or topics that are not in the text
- Current year is ${currentYear} — use this only as context, do not auto-fill missing years
- Always return valid JSON matching the schema exactly`;

  const raw = await callDeepSeek(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Extract French vocabulary groups from this text:\n\n${chunk}` },
    ],
    true
  );

  try {
    const parsed = JSON.parse(raw);
    return (parsed.groups ?? []) as ExtractedGroup[];
  } catch {
    return [];
  }
}

/**
 * Parse a raw date string + optional year override into a YYYY-MM-DD dateKey.
 * Returns null if the date cannot be parsed.
 */
export function parseDateKey(rawDate: string, yearOverride?: number): string | null {
  if (!rawDate) return null;
  const currentYear = yearOverride ?? new Date().getFullYear();

  // Already in YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) return rawDate;

  // Try native Date parsing with year injected if needed
  const withYear = /\d{4}/.test(rawDate) ? rawDate : `${rawDate} ${currentYear}`;
  const d = new Date(withYear);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split("T")[0];
  }

  // French month names
  const frMonths: Record<string, number> = {
    janvier: 1, février: 2, mars: 3, avril: 4, mai: 5, juin: 6,
    juillet: 7, août: 8, septembre: 9, octobre: 10, novembre: 11, décembre: 12,
  };
  const frMatch = rawDate.toLowerCase().match(/(\d{1,2})\s+(\w+)(?:\s+(\d{4}))?/);
  if (frMatch) {
    const day = parseInt(frMatch[1]);
    const monthName = frMatch[2];
    const year = frMatch[3] ? parseInt(frMatch[3]) : currentYear;
    const month = frMonths[monthName];
    if (month) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  return null;
}

/**
 * Extract French vocabulary from the full document text using smart grouping.
 * Chunks the document to handle arbitrarily large files.
 * Calls onProgress(chunk, total) after each chunk.
 * Returns groups with parsed dateKeys and deduplication applied.
 */
export async function extractVocabGroups(
  text: string,
  existingTerms: Set<string>,
  onProgress?: (chunk: number, total: number) => void
): Promise<{
  groups: Array<ExtractedGroup & { dateKey: string | null }>;
  ambiguousDates: string[];  // rawDate strings where yearMissing=true
}> {
  if (!text.trim()) return { groups: [], ambiguousDates: [] };

  const normalize = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  const chunks = chunkText(text);
  const rawGroups: ExtractedGroup[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunkGroups = await extractGroupsFromChunk(chunks[i]);
    rawGroups.push(...chunkGroups);
    onProgress?.(i + 1, chunks.length);
  }

  // Collect ambiguous dates (year missing)
  const ambiguousDates = Array.from(
    new Set(
      rawGroups
        .filter((g) => g.yearMissing && g.rawDate)
        .map((g) => g.rawDate as string)
    )
  );

  // Deduplicate words across all groups
  const seen = new Set<string>(existingTerms);
  const processedGroups: Array<ExtractedGroup & { dateKey: string | null }> = [];

  for (const group of rawGroups) {
    const uniqueWords = group.words.filter((w) => {
      if (!w.term) return false;
      const key = normalize(w.term);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (uniqueWords.length === 0) continue;

    const dateKey = group.rawDate ? parseDateKey(group.rawDate) : null;
    processedGroups.push({ ...group, words: uniqueWords, dateKey });
  }

  return { groups: processedGroups, ambiguousDates };
}

// Keep the old extractVocabFromText as a thin wrapper for backward compat (cron job)
export async function extractVocabFromText(
  text: string,
  existingTerms: Set<string>,
  onProgress?: (chunk: number, total: number) => void
): Promise<ExtractedWord[]> {
  const { groups } = await extractVocabGroups(text, existingTerms, onProgress);
  return groups.flatMap((g) => g.words);
}

// ── Google Doc export ─────────────────────────────────────────────────────────

interface VocabRow {
  term: string;
  translation: string;
  entryKind: string;
  dateKey: string;
  sm2Status: string;
  groupLabel?: string | null;
}

/**
 * Create or update a Google Doc in the user's Drive with their full vocab library.
 * If exportDocId is provided, updates that doc. Otherwise creates a new one.
 * Returns the doc ID.
 */
export async function exportLibraryToGoogleDoc(
  accessToken: string,
  vocab: VocabRow[],
  existingDocId?: string | null
): Promise<string> {
  const now = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const grouped: Record<string, VocabRow[]> = {};
  for (const v of vocab) {
    (grouped[v.dateKey] ??= []).push(v);
  }

  const lines: string[] = [
    `Le Dictionnaire — My French Vocabulary Library`,
    `Last updated: ${now}`,
    `Total words: ${vocab.length}`,
    ``,
  ];

  for (const [dateKey, words] of Object.entries(grouped).sort().reverse()) {
    lines.push(`── ${dateKey} ──`);
    // Sub-group by groupLabel within the date
    const byLabel: Record<string, VocabRow[]> = {};
    for (const w of words) {
      const label = w.groupLabel ?? "";
      (byLabel[label] ??= []).push(w);
    }
    for (const [label, labelWords] of Object.entries(byLabel)) {
      if (label) lines.push(`  [${label}]`);
      for (const w of labelWords) {
        const status = w.sm2Status !== "new" ? ` [${w.sm2Status}]` : "";
        lines.push(`  ${w.term}  →  ${w.translation}${status}`);
      }
    }
    lines.push("");
  }

  const docContent = lines.join("\n");

  if (existingDocId) {
    const getRes = await fetch(`${DOCS_EXPORT_URL(existingDocId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (getRes.ok) {
      const doc = await getRes.json() as { body?: { content?: Array<{ endIndex?: number }> } };
      const lastBlock = doc.body?.content?.slice(-1)[0];
      const endIndex = (lastBlock?.endIndex ?? 2) - 1;

      if (endIndex > 1) {
        await fetch(`https://docs.googleapis.com/v1/documents/${existingDocId}:batchUpdate`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            requests: [{ deleteContentRange: { range: { startIndex: 1, endIndex } } }],
          }),
        });
      }

      await fetch(`https://docs.googleapis.com/v1/documents/${existingDocId}:batchUpdate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requests: [{ insertText: { location: { index: 1 }, text: docContent } }],
        }),
      });

      return existingDocId;
    }
  }

  // Create a new Google Doc via Drive API (multipart upload)
  const metadata = {
    name: "Le Dictionnaire — French Vocabulary Library",
    mimeType: "application/vnd.google-apps.document",
  };

  const boundary = "-------314159265358979323846";
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    docContent,
    `--${boundary}--`,
  ].join("\r\n");

  const createRes = await fetch(`${DRIVE_UPLOAD_URL}?uploadType=multipart`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary="${boundary}"`,
    },
    body,
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Failed to create Google Doc: ${err}`);
  }

  const created = await createRes.json() as { id: string };
  return created.id;
}

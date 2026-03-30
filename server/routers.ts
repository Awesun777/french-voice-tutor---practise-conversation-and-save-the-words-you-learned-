import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { invokeLLM } from "./_core/llm";
import { transcribeAudio } from "./_core/voiceTranscription";
import { storagePut } from "./storage";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  addVocabEntries,
  addVocabEntry,
  clearTutorHistory,
  deleteVocabEntry,
  getQuizSessions,
  getTutorHistory,
  getVocabByUser,
  getVocabStats,
  saveQuizSession,
  saveTutorMessage,
  toggleVocabStar,
  updateVocabEntry,
  renameVocabGroup,
  deleteVocabGroup,
} from "./db";

// ─── Dictionary search cache (in-memory, server-side) ─────────────────────────
// Keyed by normalized term. Evicted after 24 hours to keep memory bounded.
const dictCache = new Map<string, { result: unknown; ts: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 h

function getCached(key: string): unknown | null {
  const entry = dictCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { dictCache.delete(key); return null; }
  return entry.result;
}
function setCache(key: string, result: unknown) {
  // Keep cache bounded to 500 entries (LRU-lite: just delete oldest on overflow)
  if (dictCache.size >= 500) {
    const firstKey = dictCache.keys().next().value;
    if (firstKey) dictCache.delete(firstKey);
  }
  dictCache.set(key, { result, ts: Date.now() });
}

// ─── AI import cache (per-chunk) ──────────────────────────────────────────────
const importCache = new Map<string, unknown[]>();

// ─── Helpers ──────────────────────────────────────────────────────────────────
function todayKey() { return new Date().toISOString().split("T")[0]; }

// ─── Routers ──────────────────────────────────────────────────────────────────
export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ─── Dictionary ─────────────────────────────────────────────────────────────
  dictionary: router({
    suggest: protectedProcedure
      .input(z.object({ term: z.string().min(1).max(200) }))
      .mutation(async ({ input }) => {
        const response = await invokeLLM({
          messages: [
            {
              role: "user",
              content: `The user searched for "${input.term}" in a French-English dictionary but it was not found or appears misspelled.
Suggest 1-2 real French words or phrases that the user most likely intended.
Return ONLY this JSON:
{"suggestions":[{"term":"correct French word/phrase WITH accents","translation":"English meaning","confidence":"high|medium"},{"term":"...","translation":"...","confidence":"..."}]}
If no plausible suggestion exists, return {"suggestions":[]}.`,
            },
          ],
          response_format: { type: "json_object" } as any,
        });
        const raw = response.choices[0].message.content ?? '{"suggestions":[]}';
        const str = typeof raw === 'string' ? raw : JSON.stringify(raw);
        try {
          const parsed = JSON.parse(str);
          return { suggestions: (parsed.suggestions ?? []).slice(0, 2) as { term: string; translation: string; confidence: string }[] };
        } catch {
          return { suggestions: [] };
        }
      }),
    search: protectedProcedure
      .input(z.object({ term: z.string().min(1).max(300) }))
      .mutation(async ({ input }) => {
        const key = input.term.toLowerCase().trim();
        const cached = getCached(key);
        if (cached) return cached;

        const type = detectInputType(input.term);

        // Build messages + structured response_format per input type
        let messages: { role: "system" | "user"; content: string }[];
        let responseFormat: unknown;

        if (type === "question") {
          messages = [
            { role: "system", content: "You are a helpful French-English language assistant. Return only valid JSON." },
            { role: "user", content: `Answer this French language question: "${input.term}". Return JSON with these exact keys: type (string, always "question"), question (string, restate the question clearly), answer (string, detailed helpful answer), options (array of 3 objects each with keys: french, english, summary).` },
          ];
          responseFormat = {
            type: "json_schema",
            json_schema: {
              name: "question_result",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  type: { type: "string" },
                  question: { type: "string" },
                  answer: { type: "string" },
                  options: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        french: { type: "string" },
                        english: { type: "string" },
                        summary: { type: "string" },
                      },
                      required: ["french", "english", "summary"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["type", "question", "answer", "options"],
                additionalProperties: false,
              },
            },
          };
        } else if (type === "phrase") {
          messages = [
            { role: "system", content: "You are a precise French-English dictionary. Return only valid JSON." },
            { role: "user", content: `Look up this French phrase: "${input.term}". The user may have omitted accents; return proper French WITH accents. Provide a complete dictionary entry.` },
          ];
          responseFormat = {
            type: "json_schema",
            json_schema: {
              name: "phrase_result",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  type: { type: "string" },
                  found: { type: "boolean" },
                  phrase: { type: "string" },
                  translation: { type: "string" },
                  pronunciation: { type: "string" },
                  literalTranslation: { type: "string" },
                  usage: { type: "string" },
                  examples: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: { fr: { type: "string" }, en: { type: "string" } },
                      required: ["fr", "en"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["type", "found", "phrase", "translation", "pronunciation", "literalTranslation", "usage", "examples"],
                additionalProperties: false,
              },
            },
          };
        } else {
          // Single word — use json_schema so special chars in conjugations never break JSON parsing
          messages = [
            { role: "system", content: "You are a precise French-English dictionary. Always set the \"type\" field to exactly the string \"word\". Return only valid JSON matching the schema exactly." },
            { role: "user", content: `Look up the French word: "${input.term}". The user may have omitted accents; return proper French WITH accents. IMPORTANT: set the "type" field to exactly "word" (not "dictionaryEntry" or anything else). Provide a complete dictionary entry including all conjugation tenses (present, imparfait, passeCompose, futurSimple, conditionnel, subjonctif) each as an array of exactly 6 conjugated forms (je/tu/il-elle/nous/vous/ils-elles). For reflexive verbs like se promener, include the reflexive pronoun in each conjugated form (e.g. "je me promène"). Provide 2 example sentences, 3-5 synonyms, and 1-2 confusing words. If the input is not a real French word, set found to false and leave other fields as empty strings or empty arrays.` },
          ];
          responseFormat = {
            type: "json_schema",
            json_schema: {
              name: "word_result",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["word"] },
                  found: { type: "boolean" },
                  word: { type: "string" },
                  isConjugated: { type: "boolean" },
                  conjugationInfo: { type: "string" },
                  baseForm: { type: "string" },
                  formExplanation: { type: "string" },
                  translation: { type: "string" },
                  pronunciation: { type: "string" },
                  wordType: { type: "string" },
                  isReflexive: { type: "boolean" },
                  reflexiveType: { type: "string" },
                  reflexiveExplanation: { type: "string" },
                  hasReflexiveForm: { type: "boolean" },
                  usesDePreposition: { type: "boolean" },
                  dePrepositionExplanation: { type: "string" },
                  reflexiveForm: { type: "string" },
                  nonReflexiveForm: { type: "string" },
                  grammar: { type: "string" },
                  examples: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: { fr: { type: "string" }, en: { type: "string" } },
                      required: ["fr", "en"],
                      additionalProperties: false,
                    },
                  },
                  conjugations: {
                    type: "object",
                    properties: {
                      present:      { type: "array", items: { type: "string" } },
                      imparfait:    { type: "array", items: { type: "string" } },
                      passeCompose: { type: "array", items: { type: "string" } },
                      futurSimple:  { type: "array", items: { type: "string" } },
                      conditionnel: { type: "array", items: { type: "string" } },
                      subjonctif:   { type: "array", items: { type: "string" } },
                    },
                    required: ["present", "imparfait", "passeCompose", "futurSimple", "conditionnel", "subjonctif"],
                    additionalProperties: false,
                  },
                  synonyms: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: { word: { type: "string" }, meaning: { type: "string" } },
                      required: ["word", "meaning"],
                      additionalProperties: false,
                    },
                  },
                  confusingWords: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: { word: { type: "string" }, meaning: { type: "string" }, difference: { type: "string" } },
                      required: ["word", "meaning", "difference"],
                      additionalProperties: false,
                    },
                  },
                },
                required: [
                  "type", "found", "word", "isConjugated", "conjugationInfo", "baseForm",
                  "formExplanation", "translation", "pronunciation", "wordType",
                  "isReflexive", "reflexiveType", "reflexiveExplanation", "hasReflexiveForm",
                  "usesDePreposition", "dePrepositionExplanation", "reflexiveForm", "nonReflexiveForm",
                  "grammar", "examples", "conjugations", "synonyms", "confusingWords",
                ],
                additionalProperties: false,
              },
            },
          };
        }

        const response = await invokeLLM({
          messages,
          response_format: responseFormat as any,
        });

        const rawContent = response.choices[0].message.content ?? "{}";
        const raw = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);
        let result: Record<string, unknown>;
        try {
          result = JSON.parse(raw);
        } catch {
          // Last-resort: strip markdown fences and retry
          try {
            result = JSON.parse(raw.trim().replace(/^```json\n?|```\n?$/g, ""));
          } catch {
            result = { type: "error", message: "Could not parse AI response. Please try again." };
          }
        }
        // Normalise the type field — the AI sometimes returns its own names
        // (e.g. "dictionaryEntry", "word_result") instead of the expected values.
        if (result.type !== "word" && result.type !== "phrase" && result.type !== "question" && result.type !== "error") {
          result.type = type; // fall back to the detected input type
        }
        setCache(key, result);
        return result;
      }),
  }),

  // ─── Vocabulary ──────────────────────────────────────────────────────────────
  vocab: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getVocabByUser(ctx.user.id);
    }),

    add: protectedProcedure
      .input(
        z.object({
          term: z.string().min(1).max(512),
          translation: z.string().min(1).max(512),
          entryKind: z.enum(["word", "phrase"]).default("word"),
          lessonSource: z.string().max(256).optional(),
          dateKey: z.string().max(100).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const id = await addVocabEntry(ctx.user.id, {
          ...input,
          dateKey: input.dateKey ?? todayKey(),
        });
        return { id };
      }),

    bulkAdd: protectedProcedure
      .input(
        z.array(
          z.object({
            term: z.string().min(1).max(512),
            translation: z.string().min(1).max(512),
            entryKind: z.enum(["word", "phrase"]).default("word"),
            lessonSource: z.string().max(256).optional(),
            dateKey: z.string().max(100).optional(),
          })
        )
      )
      .mutation(async ({ ctx, input }) => {
        await addVocabEntries(
          ctx.user.id,
          input.map((e) => ({ ...e, dateKey: e.dateKey ?? todayKey() }))
        );
        return { count: input.length };
      }),

    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          term: z.string().min(1).max(512).optional(),
          translation: z.string().min(1).max(512).optional(),
          entryKind: z.enum(["word", "phrase"]).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { id, ...patch } = input;
        await updateVocabEntry(ctx.user.id, id, patch);
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await deleteVocabEntry(ctx.user.id, input.id);
        return { success: true };
      }),

    toggleStar: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await toggleVocabStar(ctx.user.id, input.id);
        return { success: true };
      }),

    updateQuizProgress: protectedProcedure
      .input(
        z.array(
          z.object({
            id: z.number(),
            quizCount: z.number(),
            lastQuizzed: z.date(),
          })
        )
      )
      .mutation(async ({ ctx, input }) => {
        await Promise.all(
          input.map((item) =>
            updateVocabEntry(ctx.user.id, item.id, {
              quizCount: item.quizCount,
              lastQuizzed: item.lastQuizzed,
            })
          )
        );
        return { success: true };
      }),
    renameGroup: protectedProcedure
      .input(
        z.object({
          oldDateKey: z.string().max(100),
          newDateKey: z.string().min(1).max(100),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await renameVocabGroup(ctx.user.id, input.oldDateKey, input.newDateKey);
        return { success: true };
      }),
    deleteGroup: protectedProcedure
      .input(z.object({ dateKey: z.string().max(100) }))
      .mutation(async ({ ctx, input }) => {
        await deleteVocabGroup(ctx.user.id, input.dateKey);
        return { success: true };
      }),
  }),

  // ─── Quiz ────────────────────────────────────────────────────────────────────
  quiz: router({
    saveSession: protectedProcedure
      .input(
        z.object({
          score: z.number(),
          total: z.number(),
          direction: z.enum(["fr2en", "en2fr"]),
          bucketStart: z.string().max(100).optional(),
          bucketEnd: z.string().max(100).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await saveQuizSession({ userId: ctx.user.id, ...input });
        return { success: true };
      }),

    history: protectedProcedure.query(async ({ ctx }) => {
      return getQuizSessions(ctx.user.id);
    }),

    gradeAnswer: protectedProcedure
      .input(
        z.object({
          userAnswer: z.string(),
          correctAnswer: z.string(),
          term: z.string(),
        })
      )
      .mutation(async ({ input }) => {
        const prompt = `Grade this French language answer:
Correct answer: "${input.correctAnswer}"
User's answer: "${input.userAnswer}"
French term being tested: "${input.term}"

Is the user's answer correct? Consider:
- Accents are optional (e.g., "etudier" = "étudier" ✓)
- Minor spelling variations are OK if unambiguous
- Wrong word = incorrect

Return ONLY this JSON: {"correct": true/false, "note": "brief explanation if wrong, empty string if correct"}`;

        const response = await invokeLLM({
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" } as any,
        });
        const gradeRaw = response.choices[0].message.content ?? '{"correct":false,"note":""}';
        const gradeStr = typeof gradeRaw === 'string' ? gradeRaw : JSON.stringify(gradeRaw);
        return JSON.parse(gradeStr) as { correct: boolean; note: string };
      }),
  }),

  // ─── AI Import ───────────────────────────────────────────────────────────────
  import: router({
    extractFromText: protectedProcedure
      .input(
        z.object({
          text: z.string().min(1).max(20000),
          instructions: z.string().max(500).optional(),
        })
      )
      .mutation(async ({ input }) => {
        const cacheKey = input.text.slice(0, 200) + (input.instructions ?? "");
        if (importCache.has(cacheKey)) return { items: importCache.get(cacheKey)! };

        // Step 1: Correct typos
        let correctedText = input.text;
        let corrections: { original: string; fixed: string; note: string }[] = [];
        try {
          const corrResp = await invokeLLM({
            messages: [
              {
                role: "user",
                content: `You are a French language proofreader. Correct typos, wrong accents, and clear grammar mistakes in the French text below. Keep structure and non-French parts EXACTLY the same. Return ONLY this JSON:
{"corrected":"full corrected text","corrections":[{"original":"bonjure","fixed":"bonjour","note":"spelling"}]}

Text:
${input.text.slice(0, 20000)}`,
              },
            ],
            response_format: { type: "json_object" } as any,
          });
          const corrRaw = corrResp.choices[0].message.content ?? "{}";
          const corrStr = typeof corrRaw === 'string' ? corrRaw : JSON.stringify(corrRaw);
          const parsed = JSON.parse(corrStr);
          if (parsed.corrected) correctedText = parsed.corrected;
          if (Array.isArray(parsed.corrections)) corrections = parsed.corrections;
        } catch {
          // Non-fatal
        }

        // Step 2: Extract vocabulary
        const extraRules = input.instructions?.trim()
          ? `\nAdditional instructions: ${input.instructions.trim()}\n`
          : "";

        const extractPrompt = `You are a French language teacher's assistant. Extract all distinct French vocabulary words and phrases from the text below.
The text may contain date headers (e.g. "March 15", "2024-03-15", "Lesson 3 - Monday", "Week 2", "Jan 5th") that separate vocabulary sections. When you find such headers, tag all vocabulary that follows that header with the corresponding dateKey in YYYY-MM-DD format. If no date can be inferred, use "today" as the dateKey. Assume the current year if only month/day is given.
Ignore headings, titles, page numbers, and purely English metadata that are NOT vocabulary.
Focus only on French words, expressions, and sentences a student would want to learn.
${extraRules}
Rules:
- "term": French word or phrase WITH accents preserved
- "translation": English meaning, brief (1-6 words)
- "kind": "word" for single words or 2-word expressions; "phrase" for 3+ word expressions or full sentences
- "dateKey": YYYY-MM-DD string if a date header was found above this word, otherwise "today"
Return ONLY a JSON object with an "items" array. Example:
{"items":[{"term":"bonjour","translation":"hello","kind":"word","dateKey":"2024-03-15"},{"term":"Comment allez-vous ?","translation":"How are you?","kind":"phrase","dateKey":"today"}]}

Text:
${correctedText.slice(0, 20000)}`;

        const extractResp = await invokeLLM({
          messages: [{ role: "user", content: extractPrompt }],
          response_format: { type: "json_object" } as any,
        });

        let items: { term: string; translation: string; kind: string; dateKey?: string }[] = [];
        try {
          const extractRaw = extractResp.choices[0].message.content ?? '{}';
          const extractStr = typeof extractRaw === 'string' ? extractRaw : JSON.stringify(extractRaw);
          const parsed = JSON.parse(extractStr.trim().replace(/^```json\n?|```\n?$/g, ""));
          const arr = Array.isArray(parsed) ? parsed : (parsed.items ?? parsed.vocabulary ?? parsed.words ?? []);
          items = arr;
        } catch {
          items = [];
        }

        // Resolve "today" dateKeys to actual today string
        const todayStr = todayKey();
        items = items.map((item) => ({
          ...item,
          dateKey: (!item.dateKey || item.dateKey === "today") ? todayStr : item.dateKey,
        }));

        // Deduplicate
        const seen = new Set<string>();
        const deduped = items.filter((item) => {
          const k = (item.term ?? "").toLowerCase().trim();
          if (!k || seen.has(k)) return false;
          seen.add(k);
          return true;
        });

        importCache.set(cacheKey, deduped);
        return { items: deduped, corrections };
      }),

    extractFromGoogleDoc: protectedProcedure
      .input(
        z.object({
          url: z.string().url(),
          instructions: z.string().max(500).optional(),
        })
      )
      .mutation(async ({ input }) => {
        // Parse the Google Docs document ID from the URL
        const docIdMatch = input.url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
        if (!docIdMatch) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid Google Docs URL. Please share a link like: https://docs.google.com/document/d/..." });
        }
        const docId = docIdMatch[1];
        // Use the public export endpoint to get plain text
        const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;
        let docText: string;
        try {
          const resp = await fetch(exportUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; FrenchDictBot/1.0)" },
            redirect: "follow",
          });
          if (!resp.ok) {
            if (resp.status === 403 || resp.status === 401) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "Cannot access this document. Please make sure it is shared as 'Anyone with the link can view'.",
              });
            }
            throw new TRPCError({ code: "BAD_REQUEST", message: `Failed to fetch document (HTTP ${resp.status}). Make sure the document is publicly shared.` });
          }
          docText = await resp.text();
          if (!docText.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "The document appears to be empty." });
        } catch (err) {
          if (err instanceof TRPCError) throw err;
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to fetch the Google Doc. Check the URL and sharing settings." });
        }
        // Reuse the same extraction logic as extractFromText
        const cacheKey = "gdoc:" + docId + (input.instructions ?? "");
        if (importCache.has(cacheKey)) return { items: importCache.get(cacheKey)!, corrections: [], docPreview: docText.slice(0, 300) };
        // Typo correction
        let correctedText = docText;
        let corrections: { original: string; fixed: string; note: string }[] = [];
        try {
          const corrResp = await invokeLLM({
            messages: [{
              role: "user",
              content: `You are a French language proofreader. Correct typos, wrong accents, and clear grammar mistakes in the French text below. Keep structure and non-French parts EXACTLY the same. Return ONLY this JSON:
{"corrected":"full corrected text","corrections":[{"original":"bonjure","fixed":"bonjour","note":"spelling"}]}
Text:
${docText.slice(0, 20000)}`,
            }],
            response_format: { type: "json_object" } as any,
          });
          const corrRaw = corrResp.choices[0].message.content ?? "{}";
          const corrStr = typeof corrRaw === 'string' ? corrRaw : JSON.stringify(corrRaw);
          const parsed = JSON.parse(corrStr);
          if (parsed.corrected) correctedText = parsed.corrected;
          if (Array.isArray(parsed.corrections)) corrections = parsed.corrections;
        } catch { /* non-fatal */ }
        // Extract vocabulary
        const extraRules = input.instructions?.trim() ? `\nAdditional instructions: ${input.instructions.trim()}\n` : "";
        const extractPrompt = `You are a French language teacher's assistant. Extract all distinct French vocabulary words and phrases from the text below.
The text may contain date headers (e.g. "March 15", "2024-03-15", "Lesson 3 - Monday", "Week 2", "Jan 5th") that separate vocabulary sections. When you find such headers, tag all vocabulary that follows that header with the corresponding dateKey in YYYY-MM-DD format. If no date can be inferred, use "today" as the dateKey. Assume the current year if only month/day is given.
Ignore headings, titles, page numbers, and purely English metadata that are NOT vocabulary.
Focus only on French words, expressions, and sentences a student would want to learn.
${extraRules}
Rules:
- "term": French word or phrase WITH accents preserved
- "translation": English meaning, brief (1-6 words)
- "kind": "word" for single words or 2-word expressions; "phrase" for 3+ word expressions or full sentences
- "dateKey": YYYY-MM-DD string if a date header was found above this word, otherwise "today"
Return ONLY a JSON object with an "items" array. Example:
{"items":[{"term":"bonjour","translation":"hello","kind":"word","dateKey":"2024-03-15"}]}
Text:
${correctedText.slice(0, 20000)}`;
        const extractResp = await invokeLLM({
          messages: [{ role: "user", content: extractPrompt }],
          response_format: { type: "json_object" } as any,
        });
        let items: { term: string; translation: string; kind: string; dateKey?: string }[] = [];
        try {
          const extractRaw = extractResp.choices[0].message.content ?? '{}';
          const extractStr = typeof extractRaw === 'string' ? extractRaw : JSON.stringify(extractRaw);
          const parsed = JSON.parse(extractStr.trim().replace(/^```json\n?|```\n?$/g, ""));
          const arr = Array.isArray(parsed) ? parsed : (parsed.items ?? parsed.vocabulary ?? parsed.words ?? []);
          items = arr;
        } catch { items = []; }
        const todayStr = todayKey();
        items = items.map((item) => ({
          ...item,
          dateKey: (!item.dateKey || item.dateKey === "today") ? todayStr : item.dateKey,
        }));
        const seen = new Set<string>();
        const deduped = items.filter((item) => {
          const k = (item.term ?? "").toLowerCase().trim();
          if (!k || seen.has(k)) return false;
          seen.add(k); return true;
        });
        importCache.set(cacheKey, deduped);
        return { items: deduped, corrections, docPreview: docText.slice(0, 300) };
      }),
    quickTranslate: protectedProcedure
      .input(z.object({ term: z.string().min(1).max(200) }))
      .mutation(async ({ input }) => {
        const response = await invokeLLM({
          messages: [
            {
              role: "user",
              content: `Translate this French word or phrase to English. Return ONLY JSON: {"translation":"concise English meaning"}\nFrench: "${input.term}"`,
            },
          ],
          response_format: { type: "json_object" } as any,
        });
        const rawC = response.choices[0].message.content ?? '{"translation":""}';
        const rawStr = typeof rawC === 'string' ? rawC : JSON.stringify(rawC);
        const parsed = JSON.parse(rawStr);
        return { translation: parsed.translation ?? "" };
      }),
  }),

  // ─── Tutor ───────────────────────────────────────────────────────────────────
  tutor: router({
    history: protectedProcedure.query(async ({ ctx }) => {
      return getTutorHistory(ctx.user.id, 40);
    }),

    chat: protectedProcedure
      .input(z.object({ message: z.string().min(1).max(2000) }))
      .mutation(async ({ ctx, input }) => {
        // Save user message
        await saveTutorMessage(ctx.user.id, "user", input.message);

        // Get recent history for context
        const history = await getTutorHistory(ctx.user.id, 20);
        const messages = history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `You are an expert French language tutor. Help the user learn French through conversation, grammar explanations, sentence building, and vocabulary practice. 
- Always provide French examples WITH proper accents
- Correct mistakes gently and explain why
- Encourage the user
- Keep responses concise but helpful
- When showing French text, also provide the English translation`,
            },
            ...messages,
          ],
        });

        const replyRaw = response.choices[0].message.content ?? "Je suis désolé, je n'ai pas pu répondre.";
        const reply = typeof replyRaw === 'string' ? replyRaw : JSON.stringify(replyRaw);
        await saveTutorMessage(ctx.user.id, "assistant", reply);
        return { reply };
      }),

    clear: protectedProcedure.mutation(async ({ ctx }) => {
      await clearTutorHistory(ctx.user.id);
      return { success: true };
    }),
  }),

  // ─── Voice transcription ─────────────────────────────────────────────────────
  // ─── Storage ────────────────────────────────────────────────────────────────
  storage: router({
    uploadAudio: protectedProcedure
      .input(z.object({ base64: z.string(), mimeType: z.string().default("audio/webm") }))
      .mutation(async ({ ctx, input }) => {
        const buffer = Buffer.from(input.base64, "base64");
        const ext = input.mimeType.split("/")[1] ?? "webm";
        const key = `audio/${ctx.user.id}-${Date.now()}.${ext}`;
        const result = await storagePut(key, buffer, input.mimeType);
        return result;
      }),
  }),

  voice: router({
    transcribe: protectedProcedure
      .input(z.object({ audioUrl: z.string().url(), targetTerm: z.string() }))
      .mutation(async ({ input }) => {
        const result = await transcribeAudio({
          audioUrl: input.audioUrl,
          language: "fr",
          prompt: `French pronunciation of: ${input.targetTerm}`,
        });
        if ('error' in result) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: result.error });
        }
        return { transcription: result.text ?? "" };
      }),
  }),

  // ─── Progress / Stats ────────────────────────────────────────────────────────
  progress: router({
    stats: protectedProcedure.query(async ({ ctx }) => {
      const [vocabStats, quizHistory, allWords] = await Promise.all([
        getVocabStats(ctx.user.id),
        getQuizSessions(ctx.user.id),
        getVocabByUser(ctx.user.id),
      ]);

      // Streak calculation
      const days = Array.from(new Set(allWords.map((w) => w.dateKey))).sort().reverse();
      const today = todayKey();
      const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
      let currentStreak = 0;
      if (days.length > 0 && (days[0] === today || days[0] === yesterday)) {
        currentStreak = 1;
        for (let i = 1; i < days.length; i++) {
          const prev = new Date(days[i - 1] + "T12:00:00");
          const curr = new Date(days[i] + "T12:00:00");
          if (prev.getTime() - curr.getTime() <= 86400000 + 1000) currentStreak++;
          else break;
        }
      }
      let longestStreak = 1, run = 1;
      const asc = [...days].sort();
      for (let i = 1; i < asc.length; i++) {
        const prev = new Date(asc[i - 1] + "T12:00:00");
        const curr = new Date(asc[i] + "T12:00:00");
        if (curr.getTime() - prev.getTime() <= 86400000 + 1000) { run++; longestStreak = Math.max(longestStreak, run); }
        else run = 1;
      }
      longestStreak = Math.max(longestStreak, currentStreak);

      // Due for review count
      const dueCount = allWords.filter((w) => {
        if (w.starred) return true;
        const seen = w.quizCount ?? 0;
        if (seen === 0) return true;
        const lastQ = w.lastQuizzed ? new Date(w.lastQuizzed) : new Date(0);
        const daysSince = (Date.now() - lastQ.getTime()) / 86400000;
        if (seen === 1) return daysSince >= 1;
        return daysSince >= 3;
      }).length;

      return {
        totalWords: vocabStats.total,
        todayWords: vocabStats.today,
        byDay: vocabStats.byDay,
        currentStreak,
        longestStreak,
        totalDays: days.length,
        dueCount,
        recentQuizzes: quizHistory.slice(0, 5),
      };
    }),
  }),
});

export type AppRouter = typeof appRouter;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function detectInputType(input: string): "question" | "phrase" | "word" {
  const lower = input.toLowerCase().trim();
  if (
    lower.includes("how do") ||
    lower.includes("how to") ||
    lower.includes("what is") ||
    lower.startsWith("how") ||
    lower.startsWith("what") ||
    lower.endsWith("?")
  )
    return "question";
  if (input.trim().split(/\s+/).length > 1) return "phrase";
  return "word";
}

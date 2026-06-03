import { and, desc, eq, gte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  QuizSession,
  TutorMessage,
  VocabEntry,
  VoiceSession,
  quizSessions,
  tutorMessages,
  users,
  vocabEntries,
  voiceSessions,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── User helpers ──────────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  type TextField = (typeof textFields)[number];
  const assignNullable = (field: TextField) => {
    const value = user[field];
    if (value === undefined) return;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  };
  textFields.forEach(assignNullable);
  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Vocab helpers ─────────────────────────────────────────────────────────────

export async function getVocabByUser(userId: number): Promise<VocabEntry[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(vocabEntries)
    .where(eq(vocabEntries.userId, userId))
    .orderBy(desc(vocabEntries.createdAt));
}

export async function addVocabEntry(
  userId: number,
  entry: {
    term: string;
    translation: string;
    entryKind: "word" | "phrase";
    lessonSource?: string;
    dateKey: string;
  }
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(vocabEntries).values({
    userId,
    term: entry.term,
    translation: entry.translation,
    entryKind: entry.entryKind,
    lessonSource: entry.lessonSource ?? null,
    dateKey: entry.dateKey,
  });
  return (result as any)[0]?.insertId ?? 0;
}

export async function addVocabEntries(
  userId: number,
  entries: {
    term: string;
    translation: string;
    entryKind: "word" | "phrase";
    lessonSource?: string;
    dateKey: string;
  }[]
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  if (!entries.length) return;
  await db.insert(vocabEntries).values(
    entries.map((e) => ({
      userId,
      term: e.term,
      translation: e.translation,
      entryKind: e.entryKind,
      lessonSource: e.lessonSource ?? null,
      dateKey: e.dateKey,
    }))
  );
}

export async function updateVocabEntry(
  userId: number,
  id: number,
  patch: Partial<Pick<VocabEntry, "term" | "translation" | "entryKind" | "starred" | "quizCount" | "wrongCount" | "lastQuizzed">>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(vocabEntries)
    .set(patch as any)
    .where(and(eq(vocabEntries.id, id), eq(vocabEntries.userId, userId)));
}

export async function deleteVocabGroup(userId: number, dateKey: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(vocabEntries)
    .where(and(eq(vocabEntries.userId, userId), eq(vocabEntries.dateKey, dateKey)));
}
export async function renameVocabGroup(
  userId: number,
  oldDateKey: string,
  newDateKey: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(vocabEntries)
    .set({ dateKey: newDateKey })
    .where(and(eq(vocabEntries.userId, userId), eq(vocabEntries.dateKey, oldDateKey)));
}
export async function deleteVocabEntry(userId: number, id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(vocabEntries)
    .where(and(eq(vocabEntries.id, id), eq(vocabEntries.userId, userId)));
}

export async function toggleVocabStar(userId: number, id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(vocabEntries)
    .set({ starred: sql`NOT ${vocabEntries.starred}` })
    .where(and(eq(vocabEntries.id, id), eq(vocabEntries.userId, userId)));
}

// ─── Quiz helpers ──────────────────────────────────────────────────────────────

export async function saveQuizSession(session: {
  userId: number;
  score: number;
  total: number;
  direction: "fr2en" | "en2fr";
  bucketStart?: string;
  bucketEnd?: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(quizSessions).values(session);
}

export async function getQuizSessions(userId: number): Promise<QuizSession[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(quizSessions)
    .where(eq(quizSessions.userId, userId))
    .orderBy(desc(quizSessions.createdAt))
    .limit(50);
}

// ─── Tutor helpers ─────────────────────────────────────────────────────────────

export async function getTutorHistory(userId: number, limit = 30): Promise<TutorMessage[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(tutorMessages)
    .where(eq(tutorMessages.userId, userId))
    .orderBy(desc(tutorMessages.createdAt))
    .limit(limit);
  return rows.reverse();
}

export async function saveTutorMessage(
  userId: number,
  role: "user" | "assistant",
  content: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(tutorMessages).values({ userId, role, content });
}

export async function clearTutorHistory(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(tutorMessages).where(eq(tutorMessages.userId, userId));
}

// ─── Voice session helpers ─────────────────────────────────────────────────

export async function createVoiceSession(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(voiceSessions).values({
    userId,
    startedAt: Date.now(),
  });
  return (result as any)[0]?.insertId ?? 0;
}

export async function endVoiceSession(
  id: number,
  transcript: string,
  summary: string,
  savedWords: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(voiceSessions)
    .set({ transcript, summary, savedWords, endedAt: Date.now() })
    .where(eq(voiceSessions.id, id));
}

export async function getVoiceSessions(userId: number): Promise<VoiceSession[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(voiceSessions)
    .where(eq(voiceSessions.userId, userId))
    .orderBy(voiceSessions.startedAt);
}

// ─── User memory helpers ─────────────────────────────────────────────────────

export async function getUserMemory(userId: number): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select({ userMemory: users.userMemory }).from(users).where(eq(users.id, userId)).limit(1);
  return result.length > 0 ? (result[0].userMemory ?? null) : null;
}

export async function updateUserMemory(userId: number, memory: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ userMemory: memory }).where(eq(users.id, userId));
}

// ─── Stats helpers ─────────────────────────────────────────────────────────────

export async function getVocabStats(userId: number) {
  const db = await getDb();
  if (!db) return { total: 0, today: 0, byDay: [] };
  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];

  const [allEntries, recentEntries] = await Promise.all([
    db
      .select({ dateKey: vocabEntries.dateKey })
      .from(vocabEntries)
      .where(eq(vocabEntries.userId, userId)),
    db
      .select({ dateKey: vocabEntries.dateKey })
      .from(vocabEntries)
      .where(and(eq(vocabEntries.userId, userId), gte(vocabEntries.dateKey, thirtyDaysAgo))),
  ]);

  const total = allEntries.length;
  const todayCount = allEntries.filter((e) => e.dateKey === today).length;

  // Group by day for chart
  const byDayMap: Record<string, number> = {};
  for (const e of recentEntries) {
    byDayMap[e.dateKey] = (byDayMap[e.dateKey] ?? 0) + 1;
  }
  const byDay = Object.entries(byDayMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  return { total, today: todayCount, byDay };
}

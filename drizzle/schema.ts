import {
  bigint,
  boolean,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Vocabulary entries saved by each user.
 * entryKind: 'word' | 'phrase'
 */
export const vocabEntries = mysqlTable("vocab_entries", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  term: varchar("term", { length: 512 }).notNull(),
  translation: varchar("translation", { length: 512 }).notNull(),
  entryKind: mysqlEnum("entryKind", ["word", "phrase"]).default("word").notNull(),
  lessonSource: varchar("lessonSource", { length: 256 }),
  starred: boolean("starred").default(false).notNull(),
  // Spaced repetition fields
  quizCount: int("quizCount").default(0).notNull(),
  lastQuizzed: timestamp("lastQuizzed"),
  // Date key for grouping (YYYY-MM-DD or custom label up to 100 chars)
  dateKey: varchar("dateKey", { length: 100 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type VocabEntry = typeof vocabEntries.$inferSelect;
export type InsertVocabEntry = typeof vocabEntries.$inferInsert;

/**
 * Quiz sessions — one row per completed quiz.
 */
export const quizSessions = mysqlTable("quiz_sessions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  score: int("score").notNull(),
  total: int("total").notNull(),
  direction: mysqlEnum("direction", ["fr2en", "en2fr"]).notNull(),
  bucketStart: varchar("bucketStart", { length: 100 }),
  bucketEnd: varchar("bucketEnd", { length: 100 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type QuizSession = typeof quizSessions.$inferSelect;

/**
 * Tutor chat messages per user.
 */
export const tutorMessages = mysqlTable("tutor_messages", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  role: mysqlEnum("role", ["user", "assistant"]).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TutorMessage = typeof tutorMessages.$inferSelect;

# French Dictionary & Tutor - TODO

## Backend / Database
- [x] Database schema: users, vocab_entries, quiz_sessions, tutor_messages tables
- [x] tRPC router: vocab CRUD (add, edit, delete, star, list)
- [x] tRPC router: dictionary search (AI-powered, with server-side caching)
- [x] tRPC router: quiz (start session, submit answer, complete session)
- [x] tRPC router: import (paste text AI extraction + CSV)
- [x] tRPC router: tutor chat (conversational AI)
- [x] tRPC router: progress stats (streak, daily counts, growth chart)
- [x] tRPC router: voice transcription (flashcard pronunciation feedback)
- [x] Server-side LLM caching for dictionary lookups (in-memory Map)

## Frontend - Layout & Auth
- [x] Dark theme with French-inspired color palette (deep navy + gold accents)
- [x] DashboardLayout with sidebar tabs: Dictionary, Library, Quiz, Flashcards, Tutor, Progress
- [x] Auth gate: login prompt for unauthenticated users
- [x] Notification/toast system

## Frontend - Dictionary Tab
- [x] Search bar with instant lookup
- [x] Word result card: translation, pronunciation, word type, examples
- [x] Conjugation table (for verbs)
- [x] Synonyms and confusing words sections
- [x] Reflexive verb info display
- [x] "Add to Library" button on results
- [x] Search history display

## Frontend - Vocabulary Library Tab
- [x] Words grouped by date, with search/filter
- [x] Star toggle, delete with confirm
- [x] Lesson source label display
- [x] CSV export button
- [x] Import button (opens modal)
- [x] Due-for-review badge count

## Frontend - Import Modal
- [x] Paste text mode with AI extraction + typo correction
- [x] CSV upload mode
- [x] Review cards: keep / skip / edit / go back
- [x] Lesson name input
- [x] Corrections bar (shows typos fixed)
- [x] Progress indicator during AI processing

## Frontend - Quiz Tab
- [x] Bucket selector (date ranges)
- [x] Direction toggle: FR→EN (multiple choice) and EN→FR (fill-in-the-blank)
- [x] Quiz question card with progress bar
- [x] Multiple choice answer buttons
- [x] Fill-in-the-blank with AI grading
- [x] Score display and wrong answers review
- [x] Spaced repetition: update quizCount + lastQuizzed after quiz

## Frontend - Flashcard Tab
- [x] Flip card animation (French front / English back)
- [x] Shuffle and starred-only modes
- [x] Audio pronunciation button (Web Speech API)
- [x] Voice recording for pronunciation attempts
- [x] AI transcription feedback comparing user vs correct pronunciation
- [x] Navigation: prev / next

## Frontend - Tutor Chat Tab
- [x] Chat interface with message history
- [x] Sentence builder / grammar questions
- [x] Streaming AI responses
- [x] Markdown rendering

## Frontend - Progress Tab
- [x] Current streak, longest streak, total days
- [x] Words learned today / this week / total
- [x] Daily vocabulary growth chart (recharts)
- [x] Due-for-review count

## Testing
- [x] Vitest: vocab CRUD procedures
- [x] Vitest: quiz session procedures
- [x] Vitest: auth logout (already exists)
- [x] Vitest: storage upload procedure
- [x] Vitest: progress stats procedure

## Improvements (Round 2)
- [x] Move tutor quick-search bar into Dictionary tab (below main search)
- [x] Spelling suggestions: when word not found / misspelled, suggest 1-2 likely words with "Did you mean?" UI
- [x] Backend: spelling suggestion procedure (AI-powered)
- [x] Import modal: add Google Docs URL import mode (fetch doc content via Google Docs export URL)
- [x] Import modal: after extraction, offer "Save all at once" vs "Confirm one by one" flow
- [x] Import modal: confirmation flow shows each word card with keep/skip/edit before saving

## Bug Fixes
- [x] Fix "Could not parse AI response" error on dictionary search for reflexive/irregular verbs like "promener"
- [x] Fix: "promener" search returns result from API but nothing renders on screen
- [x] Clearly highlight reflexive verb info on dictionary result card (reflexive form, type, explanation badge)

## Improvements (Round 3)
- [x] Import: detect date headers in Google Docs/text and group imported vocab by those dates
- [x] Library: one-click delete (no confirmation dialog, just immediate delete on icon click)
- [x] Flashcards: date-group filter so user can choose which lesson date to review
- [x] Quiz: date-group filter so user can choose which lesson date to quiz on

## Improvements (Round 4)
- [x] Raise import text slice limit from 8000 to 20000 characters (both text and Google Docs paths)
- [x] Sort date filters newest-first in Quiz and Flashcards dropdowns
- [x] Quiz date picker: fixed-height scrollable window so Start Quiz button is always visible
- [x] Quiz: add "I don't know" button that reveals the answer without penalizing
- [x] Persist quiz state across tab navigation (return to same question when switching back)

## Improvements (Round 5)
- [x] Library: collapsible date groups (click header to expand/collapse)
- [x] Library: editable group name — rename a date group label, reflected in quiz/flashcard filters
- [x] Backend: vocab.renameGroup procedure to bulk-update dateKey for all words in a group

## Bug Fixes (Round 2)
- [x] Fix group rename: dateKey varchar(10) too short for custom labels — relax to varchar(100) in schema + migration + router + frontend

## Bug Fixes (Round 3)
- [x] Library group sort: always sort newest-first by actual date value (not string comparison of display labels)
- [x] Library group sort: "Yesterday" label must resolve to its real date (3/28/2026) for sorting
- [x] Library group sort: re-sort immediately after a rename so order updates without page refresh

## Improvements (Round 6)
- [x] Library: delete entire group (all words in a date group) with one button on the group header

## Improvements (Round 7)
- [x] Quiz: add delete-word button on the active quiz card so user can remove incorrect imports mid-quiz
- [x] Flashcards: add delete-word button on each flashcard so user can remove incorrect imports during study

## Improvements (Round 8)
- [x] Import: when a date header has no year, default it to 2026 in the AI extraction prompt

## Improvements (Round 9)
- [x] Quiz: upgrade gradeAnswer AI prompt to give grammar-aware feedback (e.g. "you forgot the past participle agreement", "missing reflexive pronoun", "wrong gender")
- [x] Quiz: update feedback UI to display the grammar explanation prominently below the correct answer

## Improvements (Round 10)
- [x] Dictionary: auto-add searched word to library on search result, with a toggle button to de-add
- [x] Dictionary: always show the base/infinitive form (canonicalForm) when user searches a conjugated/gendered form
- [x] Backend: add canonicalForm field to word search schema so AI always returns the base form

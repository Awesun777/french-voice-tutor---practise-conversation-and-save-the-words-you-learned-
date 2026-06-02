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

## Improvements (Round 11)
- [x] Dictionary: auto-add phrases and sentences (type="phrase") to library on search result, same as words
- [x] Dictionary: right-side context chat panel — user can select a result card and ask follow-up questions; the AI receives the full card content as context
- [x] Dictionary: selected card is highlighted; chat panel shows which card is in context
- [x] Backend: new tutor.contextChat procedure that accepts a vocabContext object (word, translation, examples, etc.) alongside the user message

## Bug Fixes (Round 4)
- [x] Dictionary: fix focus-stealing bug — typing in search bar causes cursor to jump to context chat input

## Bug Fixes (Round 5)
- [x] Quiz: star/favorite button not working
- [x] Flashcard: star/favorite button not working

## Improvements (Round 12)
- [x] Quiz: prioritize words by: never tested → previously wrong → starred → previously correct
- [x] Flashcard: prioritize deck order by: never tested → starred → previously wrong → previously correct
- [x] Backend: expose quizCount, lastQuizzed, and a "wrongCount" or similar field to support priority sorting

## Bug Fixes (Round 6)
- [x] Library: delete button not visible on mobile

## Bug Fixes (Round 7)
- [x] Audio/pronunciation: Chrome shows speaker icon but no sound plays intermittently — fix reliability

## Improvements (Round 13)
- [x] Pronunciation buttons: show spinner while voice engine loads, different icon while speaking

## Voice Chat Feature (Round 14)
- [x] DB schema: voice_sessions table (id, userId, startedAt, endedAt, transcript JSON, summary, savedWords JSON)
- [x] Backend: POST /api/voice/session — create ephemeral OpenAI Realtime token
- [x] Backend: trpc.voice.saveFromSession — save a word/phrase discovered during voice chat
- [x] Backend: trpc.voice.endSession — persist transcript + generate AI summary
- [x] Backend: trpc.voice.sessions — list past voice sessions for the user
- [x] Frontend: VoiceChat tab in sidebar
- [x] Frontend: WebRTC connection to OpenAI Realtime API using ephemeral token
- [x] Frontend: Waveform visualizer (user speaking vs AI speaking)
- [x] Frontend: Live scrolling transcript panel
- [x] Frontend: "Save to Dictionary" manual button + voice trigger ("save that")
- [x] Frontend: "End Session" button → summary generation + display
- [x] Frontend: Past sessions list with transcript + summary viewer

## Voice Chat Improvements (Round 15)
- [x] Voice Chat: add Pause/Resume button alongside End button, centered on screen
- [x] Voice Chat: show real-time streaming transcript of AI speech (delta events)
- [x] Voice Chat: increase VAD silence threshold so slow French speakers are not interrupted
- [x] Voice Chat: rename tutor from Amélie to Romain

## Voice Chat Context Optimization (Round 16)
- [x] Add voice.summarizeContext tRPC procedure: accepts array of transcript turns, returns compact summary string using invokeLLM
- [x] Track conversation turns in VoiceChatTab (array of {role, text} objects built from transcript events)
- [x] Every 10 turns, call voice.summarizeContext with the oldest turns (all but last 10)
- [x] Inject summary as a system message via data channel conversation.item.create
- [x] Delete the old raw turns from Realtime context via conversation.item.delete events
- [x] Show a subtle "Context summarized" indicator in the UI when summarization runs

## Bug Fix & Import UX (Round 17)
- [x] Fix: call audioRef.current.pause() before setting srcObject=null in cleanupWebRTC so buffered AI audio stops immediately on End
- [x] My Library import: add "Name group by date" button that opens a shadcn Calendar popover pre-selected to today; chosen date becomes the import group name (e.g. "June 1, 2026")

## Romain Prompt & Web Search Tool (Round 18)
- [x] Update VOICE_SYSTEM_PROMPT with new personality, voice/tone, and response style sections
- [x] Add web_search tool definition to VOICE_TOOLS in server/_core/index.ts
- [x] Add voice.webSearch tRPC procedure in server/routers.ts (uses LLM to answer factual queries, returns concise plain-text result suitable for TTS)
- [x] Handle web_search tool call in VoiceChatTab: call voice.webSearch mutation, send function_call_output back over data channel

## Anna — ElevenLabs Voice Agent (Round 19)
- [x] Store ELEVENLABS_API_KEY as project secret
- [x] Create Anna agent via ElevenLabs API (voice ID: nVPCtAFzgyMX3FZKNzH0, same system prompt as Romain) and store agent ID as ELEVENLABS_ANNA_AGENT_ID secret
- [x] Add voice.annaSignedUrl tRPC protectedProcedure that calls ElevenLabs get-signed-url endpoint and returns the signed WebSocket URL
- [x] Build AnnaVoiceTab component: ElevenLabs @elevenlabs/client SDK, real-time transcript via onMessage callback, waveform indicators, save_vocab support, pause/end controls, session summary
- [x] Add agent selector card UI to Voice Chat page (Romain card vs Anna card) — selecting one shows the corresponding session tab
- [x] Update VoiceChat page routing so both agents share the same page with a toggle at the top

## Anna Gap Fixes (Round 19b)
- [x] AnnaVoiceTab: implement ElevenLabs client tool handler for save_vocab (call saveWordMutation, update savedWords state, show toast)
- [x] Voice Chat page: replace one-time chooser with persistent top-level agent toggle so user can switch between Romain and Anna without re-selecting from scratch

## Anna Fixes (Round 20)
- [x] Anna pause: use conversation.setMicMuted(true/false) + setVolume(0/1) for reliable pause/resume
- [x] Anna transcript: only show Anna's speech in the live transcript (filter out user lines during active session)
- [x] Register save_vocab tool schema on Anna's ElevenLabs agent via API (PATCH /v1/convai/agents/{agent_id} prompt.tools)

## OpenAI TTS & Dict Cache (Round 21)
- [x] Add dict_cache table to drizzle/schema.ts (term PK, entry JSON, createdAt)
- [x] Run migration and apply SQL via webdev_execute_sql
- [x] Update dictionary.lookup procedure to check dict_cache first, write to cache on LLM hit
- [x] Add voice.tts tRPC protectedProcedure: accepts text string, calls OpenAI tts-1 (nova voice, 0.9x speed), returns base64 MP3
- [x] Replace Web Speech API in client/src/lib/pronounce.ts with tRPC call + client-side Map cache (term → blob URL)
- [x] Verify PronounceButton works on Dictionary, Flashcards, My Library, and Quiz pages (same hook API, no component changes needed)

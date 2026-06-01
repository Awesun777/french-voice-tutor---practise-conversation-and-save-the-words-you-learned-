# Le Dictionnaire — French Dictionary & Tutor

A personal French learning app built around a tight loop: **speak with your AI tutor, save what you learn, then drill it until it sticks.** It combines a real-time voice conversation agent, an intelligent vocabulary library, a French dictionary, and an adaptive quiz and flashcard system — all in one place.

---

## The Core Learning Loop

Most language apps treat speaking practice, vocabulary storage, and review as separate activities. This app treats them as one continuous workflow.

```
Voice Chat with Romain  →  Save words to Library  →  Quiz & Flashcards
        ↑                                                      |
        └──────────────── Review weak words ──────────────────┘
```

### 1. Talk with Romain (Voice Agent)

Romain is your AI French conversation partner, powered by OpenAI's Realtime API. The conversation happens over a live WebRTC audio connection — no push-to-talk, no typing, just natural back-and-forth speech.

Romain adapts to your level. He corrects your grammar and pronunciation inline, explains why something is wrong, and keeps the conversation moving. Topics can be anything: ordering food, describing your weekend, discussing a film, or drilling a specific grammar point you are struggling with.

**Context summarization** keeps long sessions efficient. Every 10 turns, the oldest part of the conversation is automatically compressed into a compact memory note (~150 tokens) and the raw turns are cleared. Romain retains the full context of the session — including things you struggled with early on — without the latency cost of an ever-growing context window.

### 2. Save Words to Your Library

During or after a conversation, any word or phrase Romain uses can be saved to your personal vocabulary library. Words are organized into named groups. The most natural grouping is by date — the import modal has a built-in calendar picker so you can name a group "June 1, 2026" in one click, matching the date of your French class or tutoring session.

You can also import vocabulary from:
- **Paste** — paste raw lesson notes, a vocabulary list, or any French text; AI extracts, corrects typos, and translates everything automatically
- **Google Docs** — paste a sharing link to your lesson notes doc; the app fetches and processes it directly
- **CSV** — upload a spreadsheet with French and English columns

The AI import corrects common errors (missing accents, misspellings) and flags what it changed, so you always know what went into your library.

### 3. Quiz and Flashcards

Once words are in your library, you can drill them two ways:

**Quiz mode** presents words from your library as multiple-choice or typed-answer questions. The quiz engine tracks which words you get wrong and surfaces them more frequently. After finishing a quiz, you get a breakdown of your score by group, so you can see exactly which lesson's vocabulary needs more work.

**Flashcard mode** shows the French word on one side and the translation on the other. Flip, mark as known or needs review, and move through your deck. Cards you mark for review come back in the next session.

---

## Other Features

**French Dictionary** — look up any French word or phrase. Returns the canonical base form (infinitive for verbs, masculine singular for adjectives), full conjugation tables across six tenses, example sentences, synonyms, and common confusable words. Handles accent-less input — type `etudier` and get `étudier`. Results are cached server-side so repeated lookups are instant.

**AI Tutor Chat** — a text-based tutor for when you want to ask a grammar question, get a word explained in context, or work through a translation without starting a full voice session.

**Progress Tracking** — a dashboard showing vocabulary growth over time, quiz accuracy trends, and which word groups have the lowest mastery scores.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Tailwind CSS 4, shadcn/ui |
| API layer | tRPC 11 (end-to-end typed, no REST boilerplate) |
| Backend | Express 4, Node.js |
| Database | MySQL via Drizzle ORM |
| Voice | OpenAI Realtime API (WebRTC, SDP relay) |
| LLM | OpenAI (dictionary, import AI, tutor, summarization) |
| Auth | Manus OAuth (platform-hosted deployment) |
| Storage | S3-compatible (via Manus storage proxy) |
| Tests | Vitest |

---

## Project Structure

```
client/src/
  components/
    VoiceChatTab.tsx      ← Live voice session with Romain + context summarization
    LibraryTab.tsx        ← Vocabulary library organized by group/date
    ImportModal.tsx       ← AI-powered import (paste / Google Docs / CSV)
    DictionaryTab.tsx     ← Full dictionary lookup with conjugation tables
    QuizTab.tsx           ← Adaptive quiz engine
    FlashcardTab.tsx      ← Flashcard review
    TutorTab.tsx          ← Text-based AI tutor chat
    ProgressTab.tsx       ← Learning progress dashboard
server/
  routers.ts             ← All tRPC procedures
  db.ts                  ← Database query helpers
  _core/
    index.ts             ← Express server + SDP relay for voice
    llm.ts               ← LLM invocation helper
drizzle/
  schema.ts              ← Database schema (users, vocab, quizzes, sessions)
  *.sql                  ← Migration files
```

---

## Environment Variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | MySQL connection string |
| `JWT_SECRET` | Session cookie signing secret |
| `OPENAI_API_KEY` | Required for voice chat, dictionary, tutor, and import AI |
| `VITE_APP_ID` | Manus OAuth application ID |
| `OAUTH_SERVER_URL` | Manus OAuth backend URL |
| `VITE_OAUTH_PORTAL_URL` | Manus login portal URL |
| `BUILT_IN_FORGE_API_URL` | Manus LLM proxy URL (falls back to direct OpenAI if unset) |
| `BUILT_IN_FORGE_API_KEY` | Manus LLM proxy key |
| `OWNER_OPEN_ID` | Manus owner identifier |

---

## Running Locally

```bash
# Install dependencies
pnpm install

# Copy and fill in environment variables
cp .env.example .env

# Run database migrations
pnpm db:push

# Start development server
pnpm dev
```

The app runs on `http://localhost:3000`. The voice agent requires a valid `OPENAI_API_KEY` with access to the Realtime API (`gpt-realtime-2` model).

---

## Notes on Self-Hosting

This project is currently designed to run on the [Manus](https://manus.im) platform, which provides OAuth authentication, LLM proxying, and file storage as managed services. To self-host independently, the main change required is replacing Manus OAuth with a portable auth system (email/password or Google/GitHub OAuth). The dictionary, voice chat, quiz, and library features work with a standard OpenAI API key and any MySQL-compatible database.

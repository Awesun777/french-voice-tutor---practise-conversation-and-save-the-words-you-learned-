import { useState, useRef, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { VocabEntry } from "@/types";
import { Star, Mic, MicOff, ChevronLeft, ChevronRight, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { usePronounce } from "@/lib/pronounce";
import { PronounceButton } from "@/components/PronounceButton";
import ReviewLaunch, { ReviewLaunchChoice } from "@/components/ReviewLaunch";

const SM2_STATUS_LABELS: Record<string, string> = { new: "New", learning: "Learning", review: "Review", mastered: "Mastered" };
const SM2_STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-500/20 text-blue-300",
  learning: "bg-amber-500/20 text-amber-300",
  review: "bg-violet-500/20 text-violet-300",
  mastered: "bg-emerald-500/20 text-emerald-300",
};

// 3-button self-rating → SM-2 grade. Again=1, Good=3, Easy=5.
const GRADES = [
  { grade: 1 as const, key: "again" as const, label: "Again", color: "bg-red-500/20 hover:bg-red-500/40 text-red-300 border-red-500/30" },
  { grade: 3 as const, key: "good" as const, label: "Good", color: "bg-blue-500/20 hover:bg-blue-500/40 text-blue-300 border-blue-500/30" },
  { grade: 5 as const, key: "easy" as const, label: "Easy", color: "bg-emerald-500/20 hover:bg-emerald-500/40 text-emerald-300 border-emerald-500/30" },
];

interface SessionResult { total: number; again: number; good: number; easy: number; }
const ZERO: SessionResult = { total: 0, again: 0, good: 0, easy: 0 };

// In-progress flashcard session, kept at module scope so it survives tab
// switches (the tab unmounts when another tab is active).
interface SavedFlashcardSession {
  choice: ReviewLaunchChoice;
  deck: VocabEntry[];
  idx: number;
  flipped: boolean;
  sessionResult: SessionResult;
  sessionDone: boolean;
}
let savedFlashcardSession: SavedFlashcardSession | null = null;

export default function FlashcardTab({ reviewTarget }: { reviewTarget?: { dateKey: string } | null }) {
  const utils = trpc.useUtils();
  const { speak, state: pronounceState, activeText } = usePronounce();

  // Restore an in-progress session on remount — unless we arrived via a
  // "Review these" CTA (reviewTarget), which always starts fresh for that date.
  const restore = !reviewTarget ? savedFlashcardSession : null;

  // null = show the launch screen; set = an active session.
  const [choice, setChoice] = useState<ReviewLaunchChoice | null>(restore?.choice ?? null);
  const [deck, setDeck] = useState<VocabEntry[]>(restore?.deck ?? []);
  const [idx, setIdx] = useState(restore?.idx ?? 0);
  const [flipped, setFlipped] = useState(restore?.flipped ?? false);
  const [starting, setStarting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcription, setTranscription] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [sessionDone, setSessionDone] = useState(restore?.sessionDone ?? false);
  const [sessionResult, setSessionResult] = useState<SessionResult>(restore?.sessionResult ?? ZERO);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Persist the live session so switching tabs and back resumes where you left off.
  useEffect(() => {
    if (choice && deck.length > 0 && !sessionDone) {
      savedFlashcardSession = { choice, deck, idx, flipped, sessionResult, sessionDone };
    } else if (!choice || sessionDone) {
      savedFlashcardSession = null;
    }
  }, [choice, deck, idx, flipped, sessionResult, sessionDone]);

  // Launch a session: fetch the chosen queue, then build the deck. Fetching
  // imperatively (vs a reactive query) keeps a restored deck from being clobbered.
  const startSession = async (c: ReviewLaunchChoice) => {
    setStarting(true);
    try {
      const words = (await utils.review.getQueue.fetch(c)) as VocabEntry[];
      setChoice(c);
      setDeck([...words]);
      setIdx(0);
      setFlipped(false);
      setSessionDone(false);
      setSessionResult(ZERO);
      setTranscription(null);
    } catch {
      toast.error("Couldn't load words to review");
    } finally {
      setStarting(false);
    }
  };

  const submitReviewMutation = trpc.review.submitReview.useMutation({
    onSuccess: () => {
      utils.review.getStats.invalidate();
      utils.review.getDates.invalidate();
      utils.vocab.list.invalidate();
    },
  });

  const deleteMutation = trpc.vocab.delete.useMutation({
    onSuccess: () => {
      setDeck((d) => {
        const next = d.filter((w) => w.id !== confirmDeleteId);
        setIdx((i) => Math.min(i, Math.max(0, next.length - 1)));
        return next;
      });
      setFlipped(false);
      setTranscription(null);
      toast.success("Word removed from library");
    },
    onError: () => toast.error("Failed to delete"),
    onSettled: () => { utils.vocab.list.invalidate(); utils.review.getDates.invalidate(); },
  });

  const starMutation = trpc.vocab.toggleStar.useMutation({
    onMutate: ({ id }) => setDeck((d) => d.map((w) => (w.id === id ? { ...w, starred: !w.starred } : w))),
    onSettled: () => utils.vocab.list.invalidate(),
  });

  const transcribeMutation = trpc.voice.transcribe.useMutation({
    onSuccess: (data) => { setTranscription(data.transcription); setTranscribing(false); },
    onError: () => { toast.error("Transcription failed"); setTranscribing(false); },
  });
  const storagePutMutation = trpc.storage.uploadAudio.useMutation();

  const currentWord = deck[idx];

  const advance = useCallback(() => {
    setTranscription(null);
    setConfirmDeleteId(null);
    if (idx < deck.length - 1) {
      setIdx((i) => i + 1);
      setFlipped(false);
    } else {
      setSessionDone(true);
    }
  }, [idx, deck.length]);

  const handleGrade = useCallback((grade: 1 | 3 | 5) => {
    if (!currentWord) return;
    submitReviewMutation.mutate({ vocabId: currentWord.id, grade });
    const key = grade === 1 ? "again" : grade === 3 ? "good" : "easy";
    setSessionResult((prev) => ({ ...prev, total: prev.total + 1, [key]: (prev[key as keyof SessionResult] as number) + 1 }));

    // "Again" → requeue to the end of the deck for another pass this session.
    if (grade === 1) {
      setDeck((d) => {
        const next = [...d];
        const card = next.splice(idx, 1)[0];
        next.push(card);
        return next;
      });
      setFlipped(false);
      setTranscription(null);
      setConfirmDeleteId(null);
      return;
    }
    advance();
  }, [currentWord, idx, submitReviewMutation, advance]);

  const handlePrev = () => { setIdx((i) => Math.max(0, i - 1)); setFlipped(false); setTranscription(null); setConfirmDeleteId(null); };
  const handleNext = () => { if (idx < deck.length - 1) { setIdx((i) => i + 1); setFlipped(false); setTranscription(null); setConfirmDeleteId(null); } };

  const handleDeleteCurrent = () => {
    if (!currentWord) return;
    if (confirmDeleteId === currentWord.id) { deleteMutation.mutate({ id: currentWord.id }); setConfirmDeleteId(null); }
    else setConfirmDeleteId(currentWord.id);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        await uploadAndTranscribe(new Blob(chunksRef.current, { type: "audio/webm" }));
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true);
    } catch { toast.error("Microphone access denied"); }
  };
  const stopRecording = () => { mediaRecorderRef.current?.stop(); setRecording(false); };
  const uploadAndTranscribe = async (blob: Blob) => {
    if (!deck[idx]) return;
    setTranscribing(true);
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const base64 = btoa(Array.from(new Uint8Array(arrayBuffer)).map((b) => String.fromCharCode(b)).join(""));
      const result = await storagePutMutation.mutateAsync({ base64, mimeType: "audio/webm" });
      transcribeMutation.mutate({ audioUrl: result.url, targetTerm: deck[idx].term });
    } catch { toast.error("Upload failed"); setTranscribing(false); }
  };

  // ── Launch screen ──────────────────────────────────────────────────────────
  if (!choice) {
    return (
      <div className="flex flex-col h-full">
        {starting ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
          </div>
        ) : (
          <ReviewLaunch
            key={reviewTarget?.dateKey ?? "none"}
            kind="flashcards"
            initialDateKey={reviewTarget?.dateKey}
            onStart={startSession}
          />
        )}
      </div>
    );
  }

  // ── Session complete ─────────────────────────────────────────────────────
  if (sessionDone) {
    const pct = sessionResult.total > 0 ? Math.round(((sessionResult.good + sessionResult.easy) / sessionResult.total) * 100) : 0;
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8 gap-4">
        <p className="text-5xl">{pct >= 80 ? "🏆" : pct >= 50 ? "👍" : "💪"}</p>
        <p className="text-2xl font-bold text-foreground">Session Complete!</p>
        <p className="text-sm text-muted-foreground">{sessionResult.total} cards reviewed</p>
        <div className="grid grid-cols-3 gap-2 mt-2">
          {GRADES.map(({ label, key, color }) => (
            <div key={key} className={cn("px-4 py-2 rounded-xl text-xs font-semibold text-center", color)}>
              <div className="text-lg font-bold">{sessionResult[key as keyof SessionResult]}</div>
              <div>{label}</div>
            </div>
          ))}
        </div>
        <button
          onClick={() => { setChoice(null); }}
          className="mt-2 px-5 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-semibold transition-colors"
        >
          New session
        </button>
      </div>
    );
  }

  if (!currentWord) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8 gap-3">
        <p className="text-5xl">🎉</p>
        <p className="text-xl font-semibold text-foreground">Nothing to review here.</p>
        <button onClick={() => setChoice(null)} className="px-5 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-semibold">
          Pick something else
        </button>
      </div>
    );
  }

  const matchScore = transcription
    ? (() => {
        const t = transcription.toLowerCase().trim();
        const target = currentWord.term.toLowerCase().trim();
        if (t === target) return 1;
        if (t.includes(target) || target.includes(t)) return 0.8;
        const tWords = t.split(/\s+/);
        const targetWords = target.split(/\s+/);
        return targetWords.filter((w) => tWords.some((tw) => tw.includes(w) || w.includes(tw))).length / targetWords.length;
      })()
    : null;

  const sm2Status = (currentWord as any).sm2Status as string | undefined;

  return (
    <div className="flex flex-col h-full">
      {/* Top bar: change session + progress */}
      <div className="flex-shrink-0 border-b border-border bg-background/80 backdrop-blur-sm px-4 py-3 flex items-center gap-2">
        <button onClick={() => setChoice(null)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="w-3.5 h-3.5" /> Change
        </button>
        <span className="ml-auto text-xs text-muted-foreground font-medium">{idx + 1} / {deck.length}</span>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-6 overflow-y-auto">
        <div className="w-full max-w-md space-y-4">
          {/* Progress bar */}
          <div className="h-1 bg-muted rounded-full">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${((idx + 1) / deck.length) * 100}%` }} />
          </div>

          {/* Card-top controls: star, pronounce, mic, delete */}
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => starMutation.mutate({ id: currentWord.id })}
              className={cn("p-2.5 rounded-xl border transition-colors", currentWord.starred ? "bg-accent/20 border-accent/50 text-accent" : "bg-card border-border text-muted-foreground hover:text-accent hover:border-accent/50")}
              title="Star this word"
            >
              <Star className={cn("w-4.5 h-4.5", currentWord.starred && "fill-current")} />
            </button>
            <PronounceButton
              text={currentWord.term}
              speak={speak}
              state={pronounceState}
              activeText={activeText}
              className="p-2.5 rounded-xl border border-border bg-card text-muted-foreground hover:text-primary hover:border-primary/50"
              iconSize="w-4.5 h-4.5"
            />
            <button
              onMouseDown={startRecording}
              onMouseUp={stopRecording}
              onTouchStart={startRecording}
              onTouchEnd={stopRecording}
              className={cn("p-2.5 rounded-xl border transition-all", recording ? "bg-red-500/20 border-red-500 text-red-400 scale-110 animate-pulse" : "bg-card border-border text-muted-foreground hover:text-primary hover:border-primary/50")}
              title="Hold to record your pronunciation"
            >
              {recording ? <MicOff className="w-4.5 h-4.5" /> : <Mic className="w-4.5 h-4.5" />}
            </button>
            {confirmDeleteId === currentWord.id ? (
              <div className="flex items-center gap-1">
                <button onClick={handleDeleteCurrent} className="px-3 py-2 rounded-xl bg-destructive text-destructive-foreground text-xs font-bold hover:bg-destructive/80 transition-colors">Delete</button>
                <button onClick={() => setConfirmDeleteId(null)} className="px-3 py-2 rounded-xl bg-muted text-muted-foreground text-xs font-bold hover:bg-muted/80 transition-colors">Cancel</button>
              </div>
            ) : (
              <button onClick={handleDeleteCurrent} className="p-2.5 rounded-xl border border-border bg-card text-muted-foreground hover:text-destructive hover:border-destructive/50 hover:bg-destructive/10 transition-colors" title="Delete this word">
                <Trash2 className="w-4.5 h-4.5" />
              </button>
            )}
          </div>

          {/* Flip card */}
          <div className="flip-card w-full" style={{ height: "220px" }} onClick={() => setFlipped((f) => !f)}>
            <div className={cn("flip-card-inner w-full h-full", flipped && "flipped")}>
              <div className="flip-card-front absolute inset-0 bg-gradient-to-br from-card to-muted/30 border border-border rounded-2xl flex flex-col items-center justify-center p-6 cursor-pointer shadow-lg">
                {sm2Status && (
                  <span className={cn("absolute top-3 right-3 text-[10px] px-1.5 py-0.5 rounded-full font-semibold", SM2_STATUS_COLORS[sm2Status] ?? "bg-muted text-muted-foreground")}>
                    {SM2_STATUS_LABELS[sm2Status] ?? sm2Status}
                  </span>
                )}
                <p className="text-2xl font-bold text-foreground text-center">{currentWord.term}</p>
                <p className="text-xs text-muted-foreground mt-2">Tap to reveal</p>
              </div>
              <div className="flip-card-back absolute inset-0 bg-gradient-to-br from-primary/10 to-card border border-primary/30 rounded-2xl flex flex-col items-center justify-center p-6 cursor-pointer shadow-lg">
                <p className="text-2xl font-bold text-foreground text-center">{currentWord.translation}</p>
                <p className="text-xs text-muted-foreground mt-2">Tap to flip back</p>
              </div>
            </div>
          </div>

          {/* Nav arrows flanking the 3 grade buttons */}
          <div className="flex items-center gap-2">
            <button onClick={handlePrev} disabled={idx === 0} className="p-3 rounded-xl bg-card border border-border hover:bg-muted/50 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors">
              <ChevronLeft className="w-5 h-5" />
            </button>

            {/* 3 grade buttons — always visible, rate from recall before or after flip */}
            <div className="flex-1 flex gap-1.5">
              {GRADES.map(({ grade, label, color }) => (
                <button key={grade} onClick={() => handleGrade(grade)} className={cn("flex-1 py-2.5 rounded-xl text-xs font-semibold border transition-colors", color)}>
                  {label}
                </button>
              ))}
            </div>

            <button onClick={handleNext} disabled={idx === deck.length - 1} className="p-3 rounded-xl bg-card border border-border hover:bg-muted/50 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          {/* Pronunciation feedback */}
          {recording && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-center">
              <p className="text-sm text-red-300 font-semibold animate-pulse">🎙 Recording… release to stop</p>
            </div>
          )}
          {transcribing && (
            <div className="bg-primary/10 border border-primary/30 rounded-xl p-3 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <p className="text-sm text-primary">Transcribing your pronunciation…</p>
            </div>
          )}
          {transcription && !transcribing && (
            <div className={cn("rounded-xl p-4 border", matchScore !== null && matchScore >= 0.8 ? "bg-emerald-500/10 border-emerald-700" : "bg-amber-500/10 border-amber-700")}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">You said:</p>
                  <p className="text-sm font-semibold text-foreground">"{transcription}"</p>
                </div>
                {matchScore !== null && (
                  <span className={cn("text-xs px-2 py-1 rounded-full font-bold flex-shrink-0", matchScore >= 0.8 ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300")}>
                    {matchScore >= 0.8 ? "✓ Good!" : "Try again"}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

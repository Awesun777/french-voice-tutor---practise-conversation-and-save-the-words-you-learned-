import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { VocabEntry } from "@/types";
import { Volume2, Shuffle, Star, Mic, MicOff, ChevronLeft, ChevronRight, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

function pronounce(text: string) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "fr-FR"; u.rate = 0.85;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

function shuffle<T>(arr: T[]): T[] { return [...arr].sort(() => Math.random() - 0.5); }

function todayKey() { return new Date().toISOString().split("T")[0]; }
function yesterdayKey() { return new Date(Date.now() - 86400000).toISOString().split("T")[0]; }
function fmtDateLabel(dk: string) {
  if (dk === todayKey()) return "Today";
  if (dk === yesterdayKey()) return "Yesterday";
  return new Date(dk + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function FlashcardTab() {
  const { data: allWords = [] } = trpc.vocab.list.useQuery();
  const [filterStarred, setFilterStarred] = useState(false);
  const [filterDate, setFilterDate] = useState<string | "all">("all");
  const [deck, setDeck] = useState<VocabEntry[]>([]);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [transcription, setTranscription] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const utils = trpc.useUtils();

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const deleteMutation = trpc.vocab.delete.useMutation({
    onMutate: async ({ id }) => {
      await utils.vocab.list.cancel();
      const prev = utils.vocab.list.getData();
      utils.vocab.list.setData(undefined, (old) => old?.filter((w) => w.id !== id));
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) utils.vocab.list.setData(undefined, ctx.prev);
      toast.error("Failed to delete");
    },
    onSuccess: () => {
      // Advance to next card (deck shrinks automatically via allWords)
      setDeck((d) => {
        const next = d.filter((w) => w.id !== confirmDeleteId);
        setIdx((i) => Math.min(i, Math.max(0, next.length - 1)));
        return next;
      });
      setFlipped(false);
      setAudioBlob(null);
      setTranscription(null);
      toast.success("Word removed from library");
    },
    onSettled: () => utils.vocab.list.invalidate(),
  });

  const handleDeleteCurrent = () => {
    if (!currentWord) return;
    if (confirmDeleteId === currentWord.id) {
      deleteMutation.mutate({ id: currentWord.id });
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(currentWord.id);
    }
  };

  const starMutation = trpc.vocab.toggleStar.useMutation({
    onMutate: async ({ id }) => {
      await utils.vocab.list.cancel();
      const prev = utils.vocab.list.getData();
      utils.vocab.list.setData(undefined, (old) =>
        old?.map((w) => (w.id === id ? { ...w, starred: !w.starred } : w))
      );
      // Also update the deck snapshot so the star icon reflects immediately
      setDeck((d) => d.map((w) => (w.id === id ? { ...w, starred: !w.starred } : w)));
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) utils.vocab.list.setData(undefined, ctx.prev);
      // Rollback deck snapshot too
      setDeck((d) => d.map((w) => (w.id === _vars.id ? { ...w, starred: !w.starred } : w)));
    },
    onSettled: () => utils.vocab.list.invalidate(),
  });

  const transcribeMutation = trpc.voice.transcribe.useMutation({
    onSuccess: (data) => { setTranscription(data.transcription); setTranscribing(false); },
    onError: () => { toast.error("Transcription failed"); setTranscribing(false); },
  });

  const storagePutMutation = trpc.storage.uploadAudio.useMutation();

  // Get unique date keys for the dropdown
  const dateKeys = Array.from(new Set(allWords.map((w) => w.dateKey))).sort().reverse();

  const words = allWords.filter((w) => {
    if (filterStarred && !w.starred) return false;
    if (filterDate !== "all" && w.dateKey !== filterDate) return false;
    return true;
  });

  useEffect(() => {
    if (words.length > 0 && deck.length === 0) {
      setDeck(words);
      setIdx(0);
    }
  }, [words.length]);

  // Reset deck when filters change
  useEffect(() => {
    setDeck(words);
    setIdx(0);
    setFlipped(false);
    setAudioBlob(null);
    setTranscription(null);
  }, [filterStarred, filterDate]);

  const handleShuffle = () => {
    setDeck(shuffle(words));
    setIdx(0);
    setFlipped(false);
    setAudioBlob(null);
    setTranscription(null);
  };

  const handlePrev = () => {
    setIdx((i) => Math.max(0, i - 1));
    setFlipped(false);
    setAudioBlob(null);
    setTranscription(null);
    setConfirmDeleteId(null);
  };

  const handleNext = () => {
    setIdx((i) => Math.min(deck.length - 1, i + 1));
    setFlipped(false);
    setAudioBlob(null);
    setTranscription(null);
    setConfirmDeleteId(null);
  };

  const handleFlip = () => setFlipped((f) => !f);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setAudioBlob(blob);
        setTranscription(null);
        await uploadAndTranscribe(blob);
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true);
    } catch {
      toast.error("Microphone access denied");
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  const uploadAndTranscribe = async (blob: Blob) => {
    if (!deck[idx]) return;
    setTranscribing(true);
    try {
      // Convert blob to base64 for server upload
      const arrayBuffer = await blob.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      const base64 = btoa(Array.from(uint8).map((b) => String.fromCharCode(b)).join(""));
      const result = await storagePutMutation.mutateAsync({ base64, mimeType: "audio/webm" });
      transcribeMutation.mutate({ audioUrl: result.url, targetTerm: deck[idx].term });
    } catch {
      toast.error("Upload failed");
      setTranscribing(false);
    }
  };

  const currentWord = deck[idx];

  if (!words.length) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
        <p className="text-5xl mb-4">🃏</p>
        <p className="text-xl font-semibold text-foreground mb-2">No cards yet!</p>
        <p className="text-sm text-muted-foreground">Add words to your library to study with flashcards.</p>
      </div>
    );
  }

  if (!currentWord) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
        <p className="text-4xl mb-4">⭐</p>
        <p className="text-lg font-semibold text-foreground mb-2">No starred words</p>
        <p className="text-sm text-muted-foreground mb-4">Star some words in your library first.</p>
        <button onClick={() => setFilterStarred(false)} className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-semibold transition-colors">
          Show all cards
        </button>
      </div>
    );
  }

  const matchScore = transcription && currentWord
    ? (() => {
        const t = transcription.toLowerCase().trim();
        const target = currentWord.term.toLowerCase().trim();
        if (t === target) return 1;
        if (t.includes(target) || target.includes(t)) return 0.8;
        const tWords = t.split(/\s+/);
        const targetWords = target.split(/\s+/);
        const matches = targetWords.filter((w) => tWords.some((tw) => tw.includes(w) || w.includes(tw)));
        return matches.length / targetWords.length;
      })()
    : null;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex-shrink-0 border-b border-border bg-background/80 backdrop-blur-sm px-4 py-3 flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setFilterStarred(!filterStarred)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors",
            filterStarred ? "bg-accent/20 text-accent" : "bg-card border border-border text-muted-foreground hover:text-foreground"
          )}
        >
          <Star className={cn("w-3.5 h-3.5", filterStarred && "fill-current")} />
          Starred
        </button>
        {/* Date group filter */}
        {dateKeys.length > 1 && (
          <select
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="px-3 py-2 bg-card border border-border rounded-xl text-xs font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 cursor-pointer"
          >
            <option value="all">All dates ({allWords.length})</option>
            {dateKeys.map((dk) => (
              <option key={dk} value={dk}>
                {fmtDateLabel(dk)} ({allWords.filter((w) => w.dateKey === dk).length})
              </option>
            ))}
          </select>
        )}
        <button
          onClick={handleShuffle}
          className="flex items-center gap-1.5 px-3 py-2 bg-card border border-border hover:bg-muted/50 text-muted-foreground hover:text-foreground rounded-xl text-xs font-semibold transition-colors"
        >
          <Shuffle className="w-3.5 h-3.5" /> Shuffle
        </button>
        <span className="ml-auto text-xs text-muted-foreground font-mono">{deck.length > 0 ? `${idx + 1} / ${deck.length}` : "0 / 0"}</span>
      </div>

      {/* Card area */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 overflow-y-auto">
        <div className="w-full max-w-md space-y-4">
          {/* Progress bar */}
          <div className="h-1 bg-muted rounded-full">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${((idx + 1) / deck.length) * 100}%` }} />
          </div>

          {/* Flip card */}
          <div className="flip-card w-full" style={{ height: "220px" }}>
            <div className={cn("flip-card-inner w-full h-full", flipped && "flipped")}>
              {/* Front - French */}
              <div
                className="flip-card-front absolute inset-0 bg-gradient-to-br from-card to-muted/30 border border-border rounded-2xl flex flex-col items-center justify-center p-6 cursor-pointer shadow-lg"
                onClick={handleFlip}
              >
                <span className="text-xs font-bold text-primary uppercase tracking-widest mb-4">French</span>
                <p className="text-3xl font-bold text-foreground text-center mb-3">{currentWord.term}</p>
                <button
                  onClick={(e) => { e.stopPropagation(); pronounce(currentWord.term); }}
                  className="p-2 bg-primary/15 hover:bg-primary/25 rounded-full text-primary transition-colors"
                >
                  <Volume2 className="w-5 h-5" />
                </button>
                <p className="text-xs text-muted-foreground mt-4">Tap to reveal</p>
              </div>
              {/* Back - English */}
              <div
                className="flip-card-back absolute inset-0 bg-gradient-to-br from-primary/10 to-card border border-primary/30 rounded-2xl flex flex-col items-center justify-center p-6 cursor-pointer shadow-lg"
                onClick={handleFlip}
              >
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-4">English</span>
                <p className="text-2xl font-bold text-foreground text-center mb-2">{currentWord.translation}</p>
                <p className="text-xs text-muted-foreground mt-2">Tap to flip back</p>
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-between">
            <button
              onClick={handlePrev}
              disabled={idx === 0}
              className="p-3 rounded-xl bg-card border border-border hover:bg-muted/50 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={() => starMutation.mutate({ id: currentWord.id })}
                className={cn(
                  "p-3 rounded-xl border transition-colors",
                  currentWord.starred ? "bg-accent/20 border-accent/50 text-accent" : "bg-card border-border text-muted-foreground hover:text-accent hover:border-accent/50"
                )}
                title="Star this word"
              >
                <Star className={cn("w-5 h-5", currentWord.starred && "fill-current")} />
              </button>
              <button
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onTouchStart={startRecording}
                onTouchEnd={stopRecording}
                className={cn(
                  "p-3 rounded-xl border transition-all",
                  recording ? "bg-red-500/20 border-red-500 text-red-400 scale-110 animate-pulse" : "bg-card border-border text-muted-foreground hover:text-primary hover:border-primary/50"
                )}
                title="Hold to record your pronunciation"
              >
                {recording ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>
              {/* Delete current word */}
              {confirmDeleteId === currentWord.id ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleDeleteCurrent}
                    className="px-3 py-2 rounded-xl bg-destructive text-destructive-foreground text-xs font-bold hover:bg-destructive/80 transition-colors"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(null)}
                    className="px-3 py-2 rounded-xl bg-muted text-muted-foreground text-xs font-bold hover:bg-muted/80 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleDeleteCurrent}
                  className="p-3 rounded-xl border border-border bg-card text-muted-foreground hover:text-destructive hover:border-destructive/50 hover:bg-destructive/10 transition-colors"
                  title="Delete this word from library"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              )}
            </div>

            <button
              onClick={handleNext}
              disabled={idx === deck.length - 1}
              className="p-3 rounded-xl bg-card border border-border hover:bg-muted/50 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          {/* Recording feedback */}
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
            <div className={cn(
              "rounded-xl p-4 border",
              matchScore !== null && matchScore >= 0.8 ? "bg-emerald-500/10 border-emerald-700" : "bg-amber-500/10 border-amber-700"
            )}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">You said:</p>
                  <p className="text-sm font-semibold text-foreground">"{transcription}"</p>
                </div>
                {matchScore !== null && (
                  <span className={cn(
                    "text-xs px-2 py-1 rounded-full font-bold flex-shrink-0",
                    matchScore >= 0.8 ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300"
                  )}>
                    {matchScore >= 0.8 ? "✓ Good!" : "Try again"}
                  </span>
                )}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <p className="text-xs text-muted-foreground">Target:</p>
                <p className="text-xs font-semibold text-foreground">{currentWord.term}</p>
                <button onClick={() => pronounce(currentWord.term)} className="p-0.5 rounded hover:bg-primary/15 text-muted-foreground hover:text-primary transition-colors">
                  <Volume2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}

          {/* Keyboard hint */}
          <p className="text-center text-xs text-muted-foreground">Hold mic button to record your pronunciation</p>
        </div>
      </div>
    </div>
  );
}

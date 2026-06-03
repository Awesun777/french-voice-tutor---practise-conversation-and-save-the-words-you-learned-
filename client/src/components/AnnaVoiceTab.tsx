/**
 * AnnaVoiceTab — Real-time voice conversation with Anna, a French tutor AI.
 *
 * Architecture:
 *  1. User clicks "Start Session" → server issues an ElevenLabs signed WebSocket URL
 *  2. Browser connects via @elevenlabs/client Conversation SDK (WebSocket-based)
 *  3. Audio streams in both directions; the SDK handles mic capture and playback
 *  4. Transcript events arrive via onMessage callbacks
 *  5. "End Session" persists the transcript + triggers an AI summary
 *
 * Anna uses ElevenLabs voice nVPCtAFzgyMX3FZKNzH0 with the same system prompt as Romain.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { Conversation, type VoiceConversation } from "@elevenlabs/client";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Mic,
  MicOff,
  PhoneOff,
  BookmarkPlus,
  Loader2,
  Volume2,
  MessageSquare,
  Clock,
  Pause,
  Play,
  Sparkles,
} from "lucide-react";

// ─── Constants ─────────────────────────────────────────────────────────────────
/** Summarize every N completed Anna turns and inject via sendContextualUpdate */
const ANNA_SUMMARIZE_EVERY = 10;
/** Always keep at least this many recent raw turns in local tracking */
const ANNA_KEEP_RECENT = 10;

// ─── Types ─────────────────────────────────────────────────────────────────────
interface TranscriptLine {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  id?: string;
}

interface SavedWord {
  term: string;
  translation: string;
  kind: string;
}

type SessionState = "idle" | "connecting" | "active" | "paused" | "ending" | "ended";

// ─── Waveform visualizer ───────────────────────────────────────────────────────
function Waveform({ active, color }: { active: boolean; color: string }) {
  const bars = 20;
  return (
    <div className="flex items-center justify-center gap-0.5 h-8">
      <style>{`
        @keyframes anna-wave {
          from { height: 20%; }
          to { height: 90%; }
        }
      `}</style>
      {Array.from({ length: bars }).map((_, i) => {
        const duration = `${0.5 + (i % 5) * 0.1}s`;
        const delay = `${i * 0.05}s`;
        return (
          <div
            key={i}
            className="w-1 rounded-full"
            style={{
              backgroundColor: color,
              height: "20%",
              opacity: active ? 0.8 : 0.3,
              transition: "opacity 0.15s",
              animationName: active ? "anna-wave" : "none",
              animationDuration: duration,
              animationTimingFunction: "ease-in-out",
              animationIterationCount: "infinite",
              animationDirection: "alternate",
              animationDelay: delay,
            }}
          />
        );
      })}
    </div>
  );
}

// ─── Past session card ─────────────────────────────────────────────────────────
function PastSessionCard({ session }: { session: any }) {
  const [expanded, setExpanded] = useState(false);
  const lines: TranscriptLine[] = session.transcript ?? [];
  return (
    <div className="bg-card border border-border rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-foreground">
            {new Date(session.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </p>
          {session.summary && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{session.summary}</p>
          )}
        </div>
        <button
          onClick={() => setExpanded((s) => !s)}
          className="text-xs text-primary hover:underline ml-2 flex-shrink-0"
        >
          {expanded ? "Hide" : "View"}
        </button>
      </div>
      {expanded && lines.length > 0 && (
        <div className="space-y-1 max-h-40 overflow-y-auto border-t border-border pt-2">
          {lines.map((line, i) => (
            <p key={i} className={cn("text-xs", line.role === "user" ? "text-foreground" : "text-primary")}>
              <span className="font-semibold">{line.role === "user" ? "You" : "Anna"}: </span>
              {line.text}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export function AnnaVoiceTab() {
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [savedWords, setSavedWords] = useState<SavedWord[]>([]);
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [endedSummary, setEndedSummary] = useState<string | null>(null);
  const [showPastSessions, setShowPastSessions] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  // True while reconnecting after a pause (so transcript stays visible)
  const [isResuming, setIsResuming] = useState(false);

  const conversationRef = useRef<VoiceConversation | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  // Track the current in-progress user and assistant streaming lines
  const userStreamIdRef = useRef<string | null>(null);
  const aiStreamIdRef = useRef<string | null>(null);

  // ── Summarization state ────────────────────────────────────────────────────
  const [summarizing, setSummarizing] = useState(false);
  const [summarizeCount, setSummarizeCount] = useState(0);
  const completedTurnsRef = useRef<Array<{ role: "user" | "assistant"; text: string }>>([]);
  const annaTurnCountRef = useRef(0);
  const isSummarizingRef = useRef(false);
  // Ref mirror of aiSpeaking to avoid stale closure in onModeChange callback
  const aiSpeakingRef = useRef(false);
  // Set to true while we deliberately end the session for pause, so onDisconnect
  // doesn't trigger the "ending" state transition and save the session to DB.
  const isPausingRef = useRef(false);

  const utils = trpc.useUtils();
  const createSessionMutation = trpc.voiceSession.create.useMutation();
  const saveWordMutation = trpc.voiceSession.saveWord.useMutation();
  const endSessionMutation = trpc.voiceSession.end.useMutation();
  const annaSignedUrlMutation = trpc.voice.annaSignedUrl.useMutation();
  const webSearchMutation = trpc.voice.webSearch.useMutation();
  const summarizeContextMutation = trpc.voiceSession.summarizeContext.useMutation();
  const { data: userMemoryData } = trpc.voiceSession.getUserMemory.useQuery();
  // Stable ref so closures inside startSession always see the latest memory value
  const userMemoryRef = useRef<string | null>(null);
  useEffect(() => {
    userMemoryRef.current = userMemoryData?.memory ?? null;
  }, [userMemoryData]);
  const { data: pastSessions = [], refetch: refetchSessions } = trpc.voiceSession.list.useQuery(
    undefined,
    { enabled: showPastSessions }
  );

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  // ── Periodic summarization (every ANNA_SUMMARIZE_EVERY Anna turns) ───────────────
  const maybeSummarize = useCallback(async () => {
    annaTurnCountRef.current += 1;
    if (
      annaTurnCountRef.current % ANNA_SUMMARIZE_EVERY !== 0 ||
      isSummarizingRef.current ||
      !conversationRef.current
    ) return;

    const allTurns = completedTurnsRef.current;
    if (allTurns.length <= ANNA_KEEP_RECENT) return;

    const turnsToSummarize = allTurns.slice(0, allTurns.length - ANNA_KEEP_RECENT);
    if (turnsToSummarize.length === 0) return;

    isSummarizingRef.current = true;
    setSummarizing(true);
    try {
      const { summary } = await summarizeContextMutation.mutateAsync({
        turns: turnsToSummarize,
      });
      // Inject the summary into Anna's context via sendContextualUpdate
      const conv = conversationRef.current;
      if (conv) {
        await (conv as any).sendContextualUpdate(
          `[Earlier conversation summary — ${turnsToSummarize.length} turns]: ${summary}`
        );
      }
      // Keep only the recent turns in local tracking
      completedTurnsRef.current = allTurns.slice(allTurns.length - ANNA_KEEP_RECENT);
      setSummarizeCount((c) => c + 1);
      // Show a subtle divider in the transcript
      setTranscript((prev) => [
        ...prev,
        {
          role: "assistant" as const,
          text: `❖ Context summarized (${turnsToSummarize.length} earlier turns compressed)`,
          timestamp: Date.now(),
          id: `summary-note-${Date.now()}`,
        },
      ]);
      console.log(`[Anna] Summarized ${turnsToSummarize.length} turns, kept ${ANNA_KEEP_RECENT} recent`);
    } catch (err) {
      console.warn("[Anna] Summarization failed, skipping:", err);
    } finally {
      isSummarizingRef.current = false;
      setSummarizing(false);
    }
  }, [summarizeContextMutation]);

  const cleanup = useCallback(() => {
    if (conversationRef.current) {
      conversationRef.current.endSession().catch(() => {});
      conversationRef.current = null;
    }
  }, []);

  const startSession = async () => {
    try {
      setSessionState("connecting");
      setTranscript([]);
      setSavedWords([]);
      setEndedSummary(null);
      setIsPaused(false);
      setSummarizing(false);
      setSummarizeCount(0);
      userStreamIdRef.current = null;
      aiStreamIdRef.current = null;
      completedTurnsRef.current = [];
      annaTurnCountRef.current = 0;
      isSummarizingRef.current = false;
      aiSpeakingRef.current = false;
      isPausingRef.current = false;
      setIsResuming(false);

      // 1. Create session record in DB
      const { id } = await createSessionMutation.mutateAsync();
      setSessionId(id);

      // 2. Get signed URL from server
      const { signedUrl } = await annaSignedUrlMutation.mutateAsync();

      // 3. Start ElevenLabs conversation
      const conversation = await Conversation.startSession({
        signedUrl,

        onConnect: () => {
          setSessionState("active");
          // Inject persistent user memory so Anna remembers past conversations.
          // Use the ref (not the closure-captured query data) so we always get
          // the latest value even if the query resolved after the component rendered.
          const memory = userMemoryRef.current;
          if (memory && memory.trim()) {
            setTimeout(() => {
              conversationRef.current?.sendContextualUpdate(
                `[What you know about this student from past conversations: ${memory.trim()} — Use this naturally, bring it up when relevant, but don't recite it all at once.]`
              );
            }, 1200);
          }
        },

        onDisconnect: () => {
          // Don't transition to "ending" if we deliberately disconnected for pause
          if (isPausingRef.current) return;
          setSessionState((prev) => (prev === "active" || prev === "paused") ? "ending" : prev);
        },

        onError: (error) => {
          console.error("[Anna] ElevenLabs error:", error);
          toast.error("Connection error with Anna");
        },

        onModeChange: ({ mode }) => {
          const wasAiSpeaking = aiSpeakingRef.current;
          aiSpeakingRef.current = mode === "speaking";
          setAiSpeaking(mode === "speaking");
          setUserSpeaking(mode === "listening");

          // When Anna finishes speaking (speaking → listening), finalize her turn
          if (wasAiSpeaking && mode === "listening") {
            // Signal that the current AI stream is complete
            aiStreamIdRef.current = null;
            // Trigger summarization check — a full Anna turn just completed
            maybeSummarize();
          }
        },

        onMessage: ({ message, source }) => {
          const text = (message ?? "").trim();
          if (!text) return;

          if (source === "ai") {
            // AI messages may arrive incrementally — update last AI line or append
            const lineId = aiStreamIdRef.current ?? `ai-${Date.now()}`;
            aiStreamIdRef.current = lineId;
            setTranscript((prev) => {
              const existing = prev.find((l) => l.id === lineId);
              if (existing) {
                // Update the streaming line with the latest (longer) text
                return prev.map((l) => l.id === lineId ? { ...l, text } : l);
              }
              // New AI line started
              return [...prev, { role: "assistant", text, timestamp: Date.now(), id: lineId }];
            });
            // Track the latest AI text for summarization (overwrite same-turn entry)
            completedTurnsRef.current = [
              ...completedTurnsRef.current.filter((t) => t !== completedTurnsRef.current[completedTurnsRef.current.length - 1] || t.role !== "assistant"),
              { role: "assistant", text },
            ];
          } else {
            // User turn — each onMessage for user source is a finalized utterance
            completedTurnsRef.current = [
              ...completedTurnsRef.current,
              { role: "user", text },
            ];
          }
        },

        // ElevenLabs client tool calls (save_vocab, web_search)
        // The SDK calls these when the agent invokes a client-side tool.
        clientTools: {
          save_vocab: async ({ term, translation, kind }: { term: string; translation: string; kind: string }): Promise<string> => {
            if (!term) return "error: missing term";
            const word: SavedWord = { term, translation: translation ?? "", kind: kind ?? "word" };
            setSavedWords((prev) => [...prev, word]);
            try {
              await saveWordMutation.mutateAsync(
                { term: word.term, translation: word.translation, kind: word.kind as "word" | "phrase" }
              );
              toast.success(`Saved "${word.term}" to your library`);
              utils.vocab.list.invalidate();
            } catch {
              toast.error(`Failed to save "${word.term}"`);
            }
            return `saved:${term}`;
          },
          web_search: async ({ query }: { query: string }): Promise<string> => {
            try {
              const data = await webSearchMutation.mutateAsync({ query });
              return data.result ?? "";
            } catch {
              return "Je n'ai pas pu trouver une réponse à cette question.";
            }
          },
        },
      });

      conversationRef.current = conversation as VoiceConversation;
    } catch (e: any) {
      toast.error(e.message ?? "Failed to start session with Anna");
      setSessionState("idle");
      cleanup();
    }
  };

  const endSession = async () => {
    if (!sessionId) return;
    setSessionState("ending");
    cleanup();
    try {
      const persistableTranscript = transcript.map((l) => ({ role: l.role, text: l.text, timestamp: l.timestamp }));
      const { summary } = await endSessionMutation.mutateAsync({
        sessionId,
        transcript: persistableTranscript,
        savedWords,
        agentName: "Anna",
      });
      setEndedSummary(summary);
      setSessionState("ended");
      refetchSessions();
    } catch {
      toast.error("Failed to save session");
      setSessionState("ended");
    }
  };

  /**
   * True pause: end the ElevenLabs WebSocket session so the server stops
   * generating and the mic is fully released. Resume re-connects with a
   * fresh signed URL while preserving the local transcript / saved words.
   *
   * Background: the SDK has no pause primitive. setMicMuted(true) still
   * sends zeroed audio frames to the server, so VAD keeps firing and Anna
   * continues generating. The only reliable stop is endSession().
   */
  const togglePause = async () => {
    if (!isPaused) {
      // ── PAUSE: disconnect from ElevenLabs ──────────────────────────────
      const conv = conversationRef.current;
      if (conv) {
        isPausingRef.current = true; // prevent onDisconnect from triggering endSession
        try { await conv.endSession(); } catch { /* ignore */ }
        conversationRef.current = null;
        isPausingRef.current = false;
      }
      setIsPaused(true);
      setSessionState("paused");
      setAiSpeaking(false);
      setUserSpeaking(false);
      aiSpeakingRef.current = false;
    } else {
      // ── RESUME: reconnect with a new signed URL ─────────────────────────
      setSessionState("connecting");
      setIsResuming(true);
      setIsPaused(false);
      try {
        const { signedUrl } = await annaSignedUrlMutation.mutateAsync();

        // Build a brief context note so Anna knows this is a resumed session
        const contextNote = completedTurnsRef.current.length > 0
          ? `[Session resumed after a brief pause. Earlier conversation summary: ${completedTurnsRef.current.slice(-6).map(t => `${t.role === "assistant" ? "Anna" : "User"}: ${t.text}`).join(" | ")}]`
          : "[Session resumed after a brief pause.]"

        const conversation = await Conversation.startSession({
          signedUrl,

          onConnect: () => {
            setSessionState("active");
            setIsResuming(false);
            // Inject resume context note (recent turns)
            setTimeout(() => {
              conversationRef.current?.sendContextualUpdate(contextNote);
            }, 800);
            // Also inject persistent user memory after the resume context note
            const memory = userMemoryRef.current;
            if (memory && memory.trim()) {
              setTimeout(() => {
                conversationRef.current?.sendContextualUpdate(
                  `[What you know about this student from past conversations: ${memory.trim()} — Use this naturally when relevant.]`
                );
              }, 1400);
            }
          },

          onDisconnect: () => {
            if (isPausingRef.current) return;
            setSessionState((prev) =>
              prev === "active" || prev === "paused" ? "ending" : prev
            );
          },

          onError: (error) => {
            console.error("[Anna] ElevenLabs error:", error);
            toast.error("Connection error with Anna");
          },

          onModeChange: ({ mode }) => {
            const wasAiSpeaking = aiSpeakingRef.current;
            aiSpeakingRef.current = mode === "speaking";
            setAiSpeaking(mode === "speaking");
            setUserSpeaking(mode === "listening");
            if (wasAiSpeaking && mode === "listening") {
              aiStreamIdRef.current = null;
              maybeSummarize();
            }
          },

          onMessage: ({ message, source }) => {
            const text = (message ?? "").trim();
            if (!text) return;
            if (source === "ai") {
              const lineId = aiStreamIdRef.current ?? `ai-${Date.now()}`;
              aiStreamIdRef.current = lineId;
              setTranscript((prev) => {
                const existing = prev.find((l) => l.id === lineId);
                if (existing) return prev.map((l) => l.id === lineId ? { ...l, text } : l);
                return [...prev, { role: "assistant", text, timestamp: Date.now(), id: lineId }];
              });
              completedTurnsRef.current = [
                ...completedTurnsRef.current.filter(
                  (t) => t !== completedTurnsRef.current[completedTurnsRef.current.length - 1] || t.role !== "assistant"
                ),
                { role: "assistant", text },
              ];
            } else {
              completedTurnsRef.current = [...completedTurnsRef.current, { role: "user", text }];
            }
          },

          clientTools: {
            save_vocab: async ({ term, translation, kind }: { term: string; translation: string; kind: string }): Promise<string> => {
              if (!term) return "error: missing term";
              const word: SavedWord = { term, translation: translation ?? "", kind: kind ?? "word" };
              setSavedWords((prev) => [...prev, word]);
              try {
                await saveWordMutation.mutateAsync(
                  { term: word.term, translation: word.translation, kind: word.kind as "word" | "phrase" }
                );
                toast.success(`Saved "${word.term}" to your library`);
                utils.vocab.list.invalidate();
              } catch {
                toast.error(`Failed to save "${word.term}"`);
              }
              return `saved:${term}`;
            },
            web_search: async ({ query }: { query: string }): Promise<string> => {
              try {
                const data = await webSearchMutation.mutateAsync({ query });
                return data.result ?? "";
              } catch {
                return "Je n'ai pas pu trouver une réponse à cette question.";
              }
            },
          },
        });

        conversationRef.current = conversation as VoiceConversation;
      } catch (e: any) {
        toast.error(e.message ?? "Failed to resume session with Anna");
        setSessionState("active"); // fall back to showing controls
        setIsResuming(false);
        setIsPaused(false);
      }
    }
  };

  const manualSave = () => {
    toast(`To save a word, say "save that" or "ajoute ça" during the conversation.`);
  };

  // Handle session state transition to "ending" triggered by onDisconnect
  useEffect(() => {
    if (sessionState === "ending" && sessionId) {
      endSession();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionState]);

  // Also treat connecting-while-resuming as "live" so transcript stays visible
  const isSessionLive = sessionState === "active" || sessionState === "paused" || (sessionState === "connecting" && isResuming);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-border bg-background/80 backdrop-blur-sm px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mic className="w-4 h-4 text-pink-400" />
          <span className="font-semibold text-sm text-foreground">Voice Chat with Anna</span>
          {sessionState === "active" && (
            <span className="flex items-center gap-1 text-xs text-emerald-400 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live
            </span>
          )}
          {sessionState === "paused" && (
            <span className="flex items-center gap-1 text-xs text-amber-400 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              Paused
            </span>
          )}
          {summarizing && (
            <span className="flex items-center gap-1 text-xs text-violet-400 font-medium animate-pulse">
              <Loader2 className="w-3 h-3 animate-spin" />
              Compressing…
            </span>
          )}
          {!summarizing && summarizeCount > 0 && isSessionLive && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground" title={`Context summarized ${summarizeCount} time${summarizeCount > 1 ? "s" : ""}`}>
              <Sparkles className="w-3 h-3 text-violet-400" />
              <span className="text-violet-400">{summarizeCount}×</span>
            </span>
          )}
          <span className="text-xs text-muted-foreground bg-pink-500/10 text-pink-400 border border-pink-500/20 rounded-full px-2 py-0.5">
            ElevenLabs
          </span>
        </div>
        <button
          onClick={() => setShowPastSessions((s) => !s)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Clock className="w-3.5 h-3.5" />
          Past sessions
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Past sessions panel */}
        {showPastSessions && (
          <div className="border-b border-border bg-muted/20 p-4 space-y-2">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Past Sessions</p>
            {pastSessions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No past sessions yet.</p>
            ) : (
              [...pastSessions].reverse().map((s: any) => (
                <PastSessionCard key={s.id} session={s} />
              ))
            )}
          </div>
        )}

        {/* Idle state */}
        {sessionState === "idle" && (
          <div className="flex flex-col items-center justify-center h-full min-h-[400px] p-8 text-center gap-6">
            <div className="w-20 h-20 rounded-full bg-pink-500/10 border-2 border-pink-500/30 flex items-center justify-center">
              <Mic className="w-8 h-8 text-pink-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground mb-2">Talk to Anna</h2>
              <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
                Your French tutor with a natural ElevenLabs voice. Have a conversation in French and say{" "}
                <span className="text-pink-400 font-medium">"save that"</span> to add words to your library.
              </p>
            </div>
            <div className="bg-card border border-border rounded-xl p-4 text-left max-w-sm w-full space-y-2">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Tips</p>
              <p className="text-xs text-muted-foreground">• Speak naturally — Anna will match your B1 level</p>
              <p className="text-xs text-muted-foreground">• Take your time — Anna won't interrupt you</p>
              <p className="text-xs text-muted-foreground">• Say <span className="text-pink-400">"save that"</span> or <span className="text-pink-400">"ajoute ça"</span> to save a word</p>
              <p className="text-xs text-muted-foreground">• Ask for explanations in English anytime</p>
              <p className="text-xs text-muted-foreground">• Powered by ElevenLabs — natural, expressive voice</p>
            </div>
            <button
              onClick={startSession}
              className="px-8 py-3 bg-pink-500 hover:bg-pink-600 text-white rounded-2xl font-semibold text-base transition-all shadow-lg shadow-pink-500/20 hover:shadow-pink-500/30"
            >
              Start Conversation
            </button>
          </div>
        )}

        {/* Connecting state (initial only — resume shows transcript instead) */}
        {sessionState === "connecting" && !isResuming && (
          <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-4">
            <Loader2 className="w-10 h-10 text-pink-400 animate-spin" />
            <p className="text-sm text-muted-foreground">Connecting to Anna…</p>
          </div>
        )}

        {/* Active / Paused session */}
        {isSessionLive && (
          <div className="flex flex-col h-full">
            {/* Waveform area */}
            <div className="flex-shrink-0 px-4 py-4 space-y-3">
              {isResuming ? (
                <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 text-pink-400 animate-spin" />
                  Reconnecting to Anna…
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div className={cn("bg-card border rounded-xl p-3 transition-colors", userSpeaking && sessionState === "active" ? "border-pink-500/60 bg-pink-500/5" : "border-border")}>
                    <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
                      {sessionState === "paused" ? <MicOff className="w-3 h-3 text-amber-400" /> : <Mic className="w-3 h-3" />}
                      You {sessionState === "paused" && <span className="text-amber-400">(paused)</span>}
                    </p>
                    <Waveform active={userSpeaking && sessionState === "active"} color="#f472b6" />
                  </div>
                  <div className={cn("bg-card border rounded-xl p-3 transition-colors", aiSpeaking ? "border-pink-500/60 bg-pink-500/5" : "border-border")}>
                    <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
                      <Volume2 className="w-3 h-3" />
                      Anna {aiSpeaking && <span className="text-pink-400 animate-pulse">speaking…</span>}
                    </p>
                    <Waveform active={aiSpeaking} color="#f472b6" />
                  </div>
                </div>
              )}

              {/* Saved words this session */}
              {savedWords.length > 0 && (
                <div className="bg-pink-500/5 border border-pink-500/20 rounded-xl px-3 py-2">
                  <p className="text-xs font-bold text-pink-400 mb-1.5">Saved this session:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {savedWords.map((w, i) => (
                      <span key={i} className="px-2 py-0.5 bg-pink-500/15 text-pink-400 rounded-full text-xs font-medium">
                        {w.term}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Live transcript */}
            <div className="flex-1 overflow-y-auto px-4 pb-2 space-y-2 min-h-0">
              {transcript.length === 0 && (
                <p className="text-center text-xs text-muted-foreground py-4">Conversation will appear here…</p>
              )}
              {transcript.map((line, i) => (
                <div
                  key={line.id ?? i}
                  className={cn(
                    "flex gap-2 items-start",
                    line.role === "user" ? "flex-row-reverse" : "flex-row"
                  )}
                >
                  <div className={cn(
                    "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold mt-0.5",
                    line.role === "user" ? "bg-secondary text-foreground" : "bg-pink-500/20 text-pink-400"
                  )}>
                    {line.role === "user" ? "Me" : "A"}
                  </div>
                  <div className={cn(
                    "max-w-[75%] px-3 py-2 rounded-2xl text-sm leading-relaxed",
                    line.role === "user"
                      ? "bg-secondary text-foreground rounded-tr-sm"
                      : "bg-card border border-border text-foreground rounded-tl-sm"
                  )}>
                    {line.text}
                  </div>
                </div>
              ))}
              <div ref={transcriptEndRef} />
            </div>

            {/* Controls */}
            <div className="flex-shrink-0 border-t border-border px-4 py-4">
              <div className="flex justify-center mb-3">
                <button
                  onClick={manualSave}
                  className="flex items-center gap-2 px-4 py-2 bg-card border border-border hover:bg-muted/50 text-muted-foreground hover:text-foreground rounded-xl text-xs font-medium transition-colors"
                >
                  <BookmarkPlus className="w-3.5 h-3.5" />
                  Say "save that" to save a word
                </button>
              </div>
              <div className="flex items-center justify-center gap-4">
                <button
                  onClick={togglePause}
                  disabled={isResuming}
                  className={cn(
                    "flex flex-col items-center gap-1.5 px-6 py-3 rounded-2xl border font-semibold text-sm transition-all",
                    isResuming
                      ? "opacity-50 cursor-not-allowed bg-card border-border text-muted-foreground"
                      : isPaused
                        ? "bg-amber-500/20 border-amber-500/50 text-amber-400 hover:bg-amber-500/30"
                        : "bg-card border-border text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  {isResuming ? <Loader2 className="w-5 h-5 animate-spin" /> : isPaused ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
                  <span className="text-xs">{isResuming ? "Connecting…" : isPaused ? "Resume" : "Pause"}</span>
                </button>
                <button
                  onClick={endSession}
                  className="flex flex-col items-center gap-1.5 px-6 py-3 bg-destructive/10 hover:bg-destructive/20 border border-destructive/40 text-destructive rounded-2xl font-semibold text-sm transition-all"
                >
                  <PhoneOff className="w-5 h-5" />
                  <span className="text-xs">End</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Ending state */}
        {sessionState === "ending" && (
          <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-4">
            <Loader2 className="w-10 h-10 text-pink-400 animate-spin" />
            <p className="text-sm text-muted-foreground">Saving session and generating summary…</p>
          </div>
        )}

        {/* Ended state */}
        {sessionState === "ended" && (
          <div className="flex flex-col items-center p-6 gap-5 max-w-lg mx-auto w-full">
            <div className="w-14 h-14 rounded-full bg-pink-500/10 border-2 border-pink-500/30 flex items-center justify-center">
              <MessageSquare className="w-6 h-6 text-pink-400" />
            </div>
            <h2 className="text-lg font-bold text-foreground">Session Complete</h2>

            {endedSummary && (
              <div className="w-full bg-card border border-border rounded-xl p-4">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Session Summary</p>
                <p className="text-sm text-foreground leading-relaxed">{endedSummary}</p>
              </div>
            )}

            {savedWords.length > 0 && (
              <div className="w-full bg-pink-500/5 border border-pink-500/20 rounded-xl p-4">
                <p className="text-xs font-bold text-pink-400 uppercase tracking-wider mb-2">Words Saved ({savedWords.length})</p>
                <div className="flex flex-wrap gap-2">
                  {savedWords.map((w, i) => (
                    <span key={i} className="px-2.5 py-1 bg-pink-500/15 text-pink-400 rounded-full text-xs font-medium">
                      {w.term} — {w.translation}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {transcript.length > 0 && (
              <div className="w-full bg-card border border-border rounded-xl p-4">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Transcript ({transcript.length} lines)</p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {transcript.map((line, i) => (
                    <p key={i} className={cn("text-xs", line.role === "user" ? "text-foreground" : "text-pink-400")}>
                      <span className="font-semibold">{line.role === "user" ? "You" : "Anna"}: </span>
                      {line.text}
                    </p>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={() => {
                setSessionState("idle");
                setTranscript([]);
                setSavedWords([]);
                setEndedSummary(null);
                setSessionId(null);
                setIsPaused(false);
                userStreamIdRef.current = null;
                aiStreamIdRef.current = null;
              }}
              className="px-8 py-3 bg-pink-500 hover:bg-pink-600 text-white rounded-2xl font-semibold transition-all"
            >
              New Conversation
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

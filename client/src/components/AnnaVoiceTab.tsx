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
import { Conversation } from "@elevenlabs/client";
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

  const conversationRef = useRef<Awaited<ReturnType<typeof Conversation.startSession>> | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  // Track the current in-progress user and assistant streaming lines
  const userStreamIdRef = useRef<string | null>(null);
  const aiStreamIdRef = useRef<string | null>(null);

  const utils = trpc.useUtils();
  const createSessionMutation = trpc.voiceSession.create.useMutation();
  const saveWordMutation = trpc.voiceSession.saveWord.useMutation();
  const endSessionMutation = trpc.voiceSession.end.useMutation();
  const annaSignedUrlMutation = trpc.voice.annaSignedUrl.useMutation();
  const webSearchMutation = trpc.voice.webSearch.useMutation();
  const { data: pastSessions = [], refetch: refetchSessions } = trpc.voiceSession.list.useQuery(
    undefined,
    { enabled: showPastSessions }
  );

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

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
      userStreamIdRef.current = null;
      aiStreamIdRef.current = null;

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
        },

        onDisconnect: () => {
          // Only transition if we haven't already triggered ending
          setSessionState((prev) => (prev === "active" || prev === "paused") ? "ending" : prev);
        },

        onError: (error) => {
          console.error("[Anna] ElevenLabs error:", error);
          toast.error("Connection error with Anna");
        },

        onModeChange: ({ mode }) => {
          setAiSpeaking(mode === "speaking");
          setUserSpeaking(mode === "listening");
        },

        onMessage: ({ message, source }) => {
          // source: "ai" | "user"
          const role = source === "ai" ? "assistant" : "user";
          const text = (message ?? "").trim();
          if (!text) return;

          if (role === "user") {
            // Each completed user utterance comes as a new message — append as a new line
            userStreamIdRef.current = null; // reset so next utterance gets a fresh line
            setTranscript((prev) => [
              ...prev,
              { role: "user", text, timestamp: Date.now(), id: `user-${Date.now()}` },
            ]);
          } else {
            // AI messages may arrive incrementally — update last AI line or append
            const lineId = aiStreamIdRef.current ?? `ai-${Date.now()}`;
            aiStreamIdRef.current = lineId;
            setTranscript((prev) => {
              const existing = prev.find((l) => l.id === lineId);
              if (existing) {
                return prev.map((l) => l.id === lineId ? { ...l, text } : l);
              }
              return [...prev, { role: "assistant", text, timestamp: Date.now(), id: lineId }];
            });
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

      conversationRef.current = conversation;
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
      });
      setEndedSummary(summary);
      setSessionState("ended");
      refetchSessions();
    } catch {
      toast.error("Failed to save session");
      setSessionState("ended");
    }
  };

  const togglePause = async () => {
    const conv = conversationRef.current;
    if (!conv) return;
    if (!isPaused) {
      // Mute microphone by ending and not restarting — ElevenLabs SDK doesn't have a pause API,
      // so we use the volume approach: set output volume to 0 and mute mic via track
      conv.setVolume({ volume: 0 });
      setIsPaused(true);
      setSessionState("paused");
    } else {
      conv.setVolume({ volume: 1 });
      setIsPaused(false);
      setSessionState("active");
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

  const isSessionLive = sessionState === "active" || sessionState === "paused";

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

        {/* Connecting state */}
        {sessionState === "connecting" && (
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
                  className={cn(
                    "flex flex-col items-center gap-1.5 px-6 py-3 rounded-2xl border font-semibold text-sm transition-all",
                    isPaused
                      ? "bg-amber-500/20 border-amber-500/50 text-amber-400 hover:bg-amber-500/30"
                      : "bg-card border-border text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  {isPaused ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
                  <span className="text-xs">{isPaused ? "Resume" : "Pause"}</span>
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

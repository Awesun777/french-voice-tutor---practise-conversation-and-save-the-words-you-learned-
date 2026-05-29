/**
 * VoiceChatTab — Real-time voice conversation with Romain, a French tutor AI.
 *
 * Architecture:
 *  1. User clicks "Start Session" → server issues an OpenAI Realtime ephemeral token
 *  2. Browser opens a WebRTC PeerConnection directly to OpenAI Realtime API
 *  3. Audio streams in both directions; the AI speaks back via a hidden <audio> element
 *  4. A DataChannel carries JSON events: transcripts, tool calls (save_vocab), etc.
 *  5. "End Session" persists the transcript + triggers an AI summary
 *
 * Changes in this version:
 *  - Renamed tutor to Romain
 *  - Added Pause/Resume button (mutes mic + pauses AI audio)
 *  - End + Pause buttons centered at bottom of screen
 *  - Real-time streaming transcript: AI text appears word-by-word as it speaks
 *  - Increased VAD silence threshold via session update event after connection
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Mic,
  MicOff,
  PhoneOff,
  BookmarkPlus,
  ChevronDown,
  ChevronUp,
  Loader2,
  Volume2,
  MessageSquare,
  Clock,
  Pause,
  Play,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────────
interface TranscriptLine {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  /** id used to update in-progress streaming lines */
  id?: string;
}

interface SavedWord {
  term: string;
  translation: string;
  kind: string;
}

type SessionState = "idle" | "connecting" | "active" | "paused" | "ending" | "ended";

// ─── Waveform visualizer ───────────────────────────────────────────────────────
function Waveform({ analyser, active, color }: { analyser: AnalyserNode | null; active: boolean; color: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyser || !active) {
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) { ctx.clearRect(0, 0, canvas.width, canvas.height); }
      }
      return;
    }
    const ctx = canvas.getContext("2d")!;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(dataArray);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.beginPath();
      const sliceWidth = canvas.width / bufferLength;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * canvas.height) / 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        x += sliceWidth;
      }
      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
    };
    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [analyser, active, color]);

  return (
    <canvas
      ref={canvasRef}
      width={200}
      height={48}
      className="w-full h-12 rounded-lg"
    />
  );
}

// ─── Past session card ─────────────────────────────────────────────────────────
function PastSessionCard({ session }: { session: any }) {
  const [expanded, setExpanded] = useState(false);
  const date = new Date(session.startedAt).toLocaleString();
  const duration = session.endedAt
    ? Math.round((session.endedAt - session.startedAt) / 60000)
    : null;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <MessageSquare className="w-4 h-4 text-primary flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-foreground">{date}</p>
            <p className="text-xs text-muted-foreground">
              {duration !== null ? `${duration} min` : ""}
              {session.savedWords?.length > 0 && ` · ${session.savedWords.length} word${session.savedWords.length > 1 ? "s" : ""} saved`}
            </p>
          </div>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border">
          {session.summary && (
            <div className="mt-3">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">Summary</p>
              <p className="text-sm text-foreground leading-relaxed">{session.summary}</p>
            </div>
          )}
          {session.savedWords?.length > 0 && (
            <div>
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Words Saved</p>
              <div className="flex flex-wrap gap-1.5">
                {session.savedWords.map((w: SavedWord, i: number) => (
                  <span key={i} className="px-2 py-0.5 bg-primary/10 text-primary rounded-full text-xs font-medium">
                    {w.term} — {w.translation}
                  </span>
                ))}
              </div>
            </div>
          )}
          {session.transcript?.length > 0 && (
            <div>
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Transcript</p>
              <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                {session.transcript.map((line: TranscriptLine, i: number) => (
                  <div key={i} className={cn("text-xs", line.role === "user" ? "text-foreground" : "text-primary")}>
                    <span className="font-semibold">{line.role === "user" ? "You" : "Romain"}: </span>
                    {line.text}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function VoiceChatTab() {
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [savedWords, setSavedWords] = useState<SavedWord[]>([]);
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [endedSummary, setEndedSummary] = useState<string | null>(null);
  const [showPastSessions, setShowPastSessions] = useState(false);

  // Track the in-progress AI streaming line (delta accumulation)
  const streamingLineIdRef = useRef<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const userAnalyserRef = useRef<AnalyserNode | null>(null);
  const aiAnalyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  const utils = trpc.useUtils();
  const createSessionMutation = trpc.voiceSession.create.useMutation();
  const saveWordMutation = trpc.voiceSession.saveWord.useMutation();
  const endSessionMutation = trpc.voiceSession.end.useMutation();
  const { data: pastSessions = [], refetch: refetchSessions } = trpc.voiceSession.list.useQuery(
    undefined,
    { enabled: showPastSessions }
  );

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  // Handle DataChannel events from OpenAI Realtime
  const handleDataChannelMessage = useCallback((event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data);

      // Debug: log ALL events so we can see what the GA API actually sends
      console.log("[Realtime event]", msg.type, msg);

      // ── User speech transcript ──────────────────────────────────────────────
      // GA API: conversation.item.input_audio_transcription.completed
      // Also handle delta for live user transcript streaming
      if (
        msg.type === "conversation.item.input_audio_transcription.completed" ||
        msg.type === "conversation.item.input_audio_transcription.done"
      ) {
        const text = (msg.transcript ?? msg.text ?? "").trim();
        if (text) {
          setTranscript((prev) => {
            // Replace any partial user line or append new one
            const lastUser = [...prev].reverse().find((l) => l.role === "user" && l.id?.startsWith("user-stream"));
            if (lastUser) {
              return prev.map((l) => l.id === lastUser.id ? { ...l, text, id: undefined } : l);
            }
            return [...prev, { role: "user", text, timestamp: Date.now() }];
          });
          setUserSpeaking(false);
        }
      }

      // Live user transcript delta (if enabled)
      if (msg.type === "conversation.item.input_audio_transcription.delta") {
        const delta = msg.delta ?? "";
        if (delta) {
          setTranscript((prev) => {
            const lastUser = [...prev].reverse().find((l) => l.role === "user" && l.id?.startsWith("user-stream"));
            if (lastUser) {
              return prev.map((l) => l.id === lastUser.id ? { ...l, text: l.text + delta } : l);
            }
            const lineId = `user-stream-${Date.now()}`;
            return [...prev, { role: "user", text: delta, timestamp: Date.now(), id: lineId }];
          });
        }
      }

      if (msg.type === "input_audio_buffer.speech_started") setUserSpeaking(true);
      if (msg.type === "input_audio_buffer.speech_stopped") setUserSpeaking(false);

      // ── AI audio state ──────────────────────────────────────────────────────
      // GA API uses response.output_audio.delta / .done
      // Beta API used response.audio.delta / .done
      // Handle both for compatibility
      if (
        msg.type === "response.output_audio.delta" ||
        msg.type === "response.audio.delta"
      ) setAiSpeaking(true);
      if (
        msg.type === "response.output_audio.done" ||
        msg.type === "response.audio.done" ||
        msg.type === "response.done"
      ) setAiSpeaking(false);

      // ── Real-time AI transcript streaming ──────────────────────────────────
      // GA API: response.output_audio_transcript.delta (fires word-by-word as AI speaks)
      // Beta API used: response.audio_transcript.delta
      // Handle both for compatibility
      const isAiTranscriptDelta =
        msg.type === "response.output_audio_transcript.delta" ||
        msg.type === "response.audio_transcript.delta";
      const isAiTranscriptDone =
        msg.type === "response.output_audio_transcript.done" ||
        msg.type === "response.audio_transcript.done";

      if (isAiTranscriptDelta) {
        const delta = msg.delta ?? "";
        if (!delta) return;

        if (!streamingLineIdRef.current) {
          // Start a new streaming line
          const lineId = `stream-${Date.now()}`;
          streamingLineIdRef.current = lineId;
          setTranscript((prev) => [
            ...prev,
            { role: "assistant", text: delta, timestamp: Date.now(), id: lineId },
          ]);
        } else {
          // Append delta to the existing streaming line
          const lineId = streamingLineIdRef.current;
          setTranscript((prev) =>
            prev.map((line) =>
              line.id === lineId ? { ...line, text: line.text + delta } : line
            )
          );
        }
      }

      // Finalize the streaming line
      if (isAiTranscriptDone) {
        streamingLineIdRef.current = null;
      }

      // Fallback: if no delta events, capture full text from response.output_item.done
      if (msg.type === "response.output_item.done") {
        const item = msg.item;
        if (item?.role === "assistant" && item?.content) {
          for (const c of item.content) {
            const text = c.transcript ?? c.text ?? "";
            if (text && !streamingLineIdRef.current) {
              // Only add if we didn't already stream it via deltas
              setTranscript((prev) => {
                const lastAI = [...prev].reverse().find((l) => l.role === "assistant");
                if (lastAI && lastAI.text === text) return prev; // already there
                return [...prev, { role: "assistant", text, timestamp: Date.now() }];
              });
            }
          }
        }
      }

      // ── Tool call: save_vocab ───────────────────────────────────────────────
      if (msg.type === "response.function_call_arguments.done" && msg.name === "save_vocab") {
        try {
          const args = JSON.parse(msg.arguments);
          const word: SavedWord = {
            term: args.term ?? "",
            translation: args.translation ?? "",
            kind: args.kind ?? "word",
          };
          if (word.term) {
            setSavedWords((prev) => [...prev, word]);
            saveWordMutation.mutate(
              { term: word.term, translation: word.translation, kind: word.kind as "word" | "phrase" },
              {
                onSuccess: () => {
                  toast.success(`Saved "${word.term}" to your library`);
                  utils.vocab.list.invalidate();
                },
                onError: () => toast.error(`Failed to save "${word.term}"`),
              }
            );
            // Send tool result back to the AI so it can confirm
            if (dcRef.current?.readyState === "open") {
              dcRef.current.send(JSON.stringify({
                type: "conversation.item.create",
                item: {
                  type: "function_call_output",
                  call_id: msg.call_id,
                  output: JSON.stringify({ success: true, term: word.term }),
                },
              }));
              dcRef.current.send(JSON.stringify({ type: "response.create" }));
            }
          }
        } catch {
          // ignore parse errors
        }
      }
    } catch {
      // ignore non-JSON messages
    }
  }, [saveWordMutation, utils]);

  const startSession = async () => {
    try {
      setSessionState("connecting");
      setTranscript([]);
      setSavedWords([]);
      setEndedSummary(null);
      streamingLineIdRef.current = null;

      // 1. Create a session record in our DB
      const { id } = await createSessionMutation.mutateAsync();
      setSessionId(id);

      // 2. Set up WebRTC
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // Hidden audio element to play AI voice
      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      audioRef.current = audioEl;

      // Set up AudioContext for waveform visualizers
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;

      // AI audio analyser
      pc.ontrack = (e) => {
        const stream = e.streams[0];
        audioEl.srcObject = stream;
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        aiAnalyserRef.current = analyser;
      };

      // Capture microphone
      const localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = localStream;
      localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

      // User audio analyser
      const userSource = audioCtx.createMediaStreamSource(localStream);
      const userAnalyser = audioCtx.createAnalyser();
      userAnalyser.fftSize = 256;
      userSource.connect(userAnalyser);
      userAnalyserRef.current = userAnalyser;

      // Data channel for events
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.addEventListener("message", handleDataChannelMessage);
      dc.addEventListener("open", () => {
        // Configure transcription and VAD via session.update (must be done over data channel,
        // not at session creation time for the GA API).
        dc.send(JSON.stringify({
          type: "session.update",
          session: {
            // Enable Whisper transcription for user speech → gives us transcript events
            input_audio_transcription: { model: "whisper-1" },
            // Slow VAD: wait 1.5s of silence before treating turn as done
            // This prevents interrupting the student while they form French sentences
            turn_detection: {
              type: "server_vad",
              threshold: 0.4,
              prefix_padding_ms: 500,
              silence_duration_ms: 1500,
            },
          },
        }));

        // Trigger the initial greeting
        dc.send(JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Bonjour !" }],
          },
        }));
        dc.send(JSON.stringify({ type: "response.create" }));
      });

      // Create SDP offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Send offer to our server which relays to OpenAI Realtime unified interface
      // (server-relay SDP: our server POSTs multipart FormData to OpenAI /v1/realtime/calls)
      const sdpResp = await fetch("/api/voice/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sdp: offer.sdp }),
      });
      if (!sdpResp.ok) {
        const errData = await sdpResp.json().catch(() => ({}));
        throw new Error(errData.error ?? "WebRTC SDP exchange failed");
      }
      const answerSdp = await sdpResp.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      setSessionState("active");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to start voice session");
      setSessionState("idle");
      cleanupWebRTC();
    }
  };

  const cleanupWebRTC = () => {
    dcRef.current?.close();
    pcRef.current?.close();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close();
    pcRef.current = null;
    dcRef.current = null;
    localStreamRef.current = null;
    userAnalyserRef.current = null;
    aiAnalyserRef.current = null;
    audioCtxRef.current = null;
    if (audioRef.current) { audioRef.current.srcObject = null; }
  };

  const endSession = async () => {
    if (!sessionId) return;
    setSessionState("ending");
    cleanupWebRTC();
    try {
      const { summary } = await endSessionMutation.mutateAsync({
        sessionId,
        transcript,
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

  const togglePause = () => {
    if (sessionState === "active") {
      // Pause: mute mic tracks + pause AI audio playback
      localStreamRef.current?.getTracks().forEach((t) => { t.enabled = false; });
      if (audioRef.current) audioRef.current.pause();
      setSessionState("paused");
    } else if (sessionState === "paused") {
      // Resume: unmute mic + resume AI audio
      localStreamRef.current?.getTracks().forEach((t) => { t.enabled = true; });
      if (audioRef.current) audioRef.current.play().catch(() => {});
      setSessionState("active");
    }
  };

  const manualSave = () => {
    toast(`To save a word, say "save that" or "ajoute ça" during the conversation.`);
  };

  const isSessionLive = sessionState === "active" || sessionState === "paused";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-border bg-background/80 backdrop-blur-sm px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mic className="w-4 h-4 text-primary" />
          <span className="font-semibold text-sm text-foreground">Voice Chat with Romain</span>
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
            <div className="w-20 h-20 rounded-full bg-primary/10 border-2 border-primary/30 flex items-center justify-center">
              <Mic className="w-8 h-8 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground mb-2">Talk to Romain</h2>
              <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
                Your personal French tutor. Have a natural conversation in French, ask questions, and say <span className="text-primary font-medium">"save that"</span> to add any word or phrase to your library.
              </p>
            </div>
            <div className="bg-card border border-border rounded-xl p-4 text-left max-w-sm w-full space-y-2">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Tips</p>
              <p className="text-xs text-muted-foreground">• Speak naturally — Romain will match your B1 level</p>
              <p className="text-xs text-muted-foreground">• Take your time — Romain won't interrupt you</p>
              <p className="text-xs text-muted-foreground">• Say <span className="text-primary">"save that"</span> or <span className="text-primary">"ajoute ça"</span> to save a word</p>
              <p className="text-xs text-muted-foreground">• Ask for explanations in English anytime</p>
              <p className="text-xs text-muted-foreground">• End the session to get an AI summary</p>
            </div>
            <button
              onClick={startSession}
              className="px-8 py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-2xl font-semibold text-base transition-all shadow-lg shadow-primary/20 hover:shadow-primary/30"
            >
              Start Conversation
            </button>
          </div>
        )}

        {/* Connecting state */}
        {sessionState === "connecting" && (
          <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-4">
            <Loader2 className="w-10 h-10 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">Connecting to Romain…</p>
          </div>
        )}

        {/* Active / Paused session */}
        {isSessionLive && (
          <div className="flex flex-col h-full">
            {/* Waveform area */}
            <div className="flex-shrink-0 px-4 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className={cn("bg-card border rounded-xl p-3 transition-colors", userSpeaking && sessionState === "active" ? "border-primary/60 bg-primary/5" : "border-border")}>
                  <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
                    {sessionState === "paused" ? <MicOff className="w-3 h-3 text-amber-400" /> : <Mic className="w-3 h-3" />}
                    You {sessionState === "paused" && <span className="text-amber-400">(paused)</span>}
                  </p>
                  <Waveform analyser={userAnalyserRef.current} active={userSpeaking && sessionState === "active"} color="#a78bfa" />
                </div>
                <div className={cn("bg-card border rounded-xl p-3 transition-colors", aiSpeaking ? "border-emerald-500/60 bg-emerald-500/5" : "border-border")}>
                  <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
                    <Volume2 className="w-3 h-3" />
                    Romain {aiSpeaking && <span className="text-emerald-400 animate-pulse">speaking…</span>}
                  </p>
                  <Waveform analyser={aiAnalyserRef.current} active={aiSpeaking} color="#34d399" />
                </div>
              </div>

              {/* Saved words this session */}
              {savedWords.length > 0 && (
                <div className="bg-primary/5 border border-primary/20 rounded-xl px-3 py-2">
                  <p className="text-xs font-bold text-primary mb-1.5">Saved this session:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {savedWords.map((w, i) => (
                      <span key={i} className="px-2 py-0.5 bg-primary/15 text-primary rounded-full text-xs font-medium">
                        {w.term}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Live transcript — scrollable, takes remaining space */}
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
                    line.role === "user" ? "bg-secondary text-foreground" : "bg-primary/20 text-primary"
                  )}>
                    {line.role === "user" ? "Me" : "R"}
                  </div>
                  <div className={cn(
                    "max-w-[75%] px-3 py-2 rounded-2xl text-sm leading-relaxed",
                    line.role === "user"
                      ? "bg-secondary text-foreground rounded-tr-sm"
                      : "bg-card border border-border text-foreground rounded-tl-sm"
                  )}>
                    {line.text}
                    {/* Blinking cursor for the in-progress streaming line */}
                    {line.id && streamingLineIdRef.current === line.id && (
                      <span className="inline-block w-0.5 h-4 bg-primary ml-0.5 animate-pulse align-middle" />
                    )}
                  </div>
                </div>
              ))}
              <div ref={transcriptEndRef} />
            </div>

            {/* ── Controls — centered End + Pause, mute + save on sides ── */}
            <div className="flex-shrink-0 border-t border-border px-4 py-4">
              {/* Save word hint row */}
              <div className="flex justify-center mb-3">
                <button
                  onClick={manualSave}
                  className="flex items-center gap-2 px-4 py-2 bg-card border border-border hover:bg-muted/50 text-muted-foreground hover:text-foreground rounded-xl text-xs font-medium transition-colors"
                  title="Save last word to dictionary"
                >
                  <BookmarkPlus className="w-3.5 h-3.5" />
                  Say "save that" to save a word
                </button>
              </div>

              {/* Main controls row — centered */}
              <div className="flex items-center justify-center gap-4">
                {/* Pause / Resume */}
                <button
                  onClick={togglePause}
                  className={cn(
                    "flex flex-col items-center gap-1.5 px-6 py-3 rounded-2xl border font-semibold text-sm transition-all",
                    sessionState === "paused"
                      ? "bg-amber-500/20 border-amber-500/50 text-amber-400 hover:bg-amber-500/30"
                      : "bg-card border-border text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                  title={sessionState === "paused" ? "Resume" : "Pause"}
                >
                  {sessionState === "paused"
                    ? <Play className="w-5 h-5" />
                    : <Pause className="w-5 h-5" />
                  }
                  <span className="text-xs">{sessionState === "paused" ? "Resume" : "Pause"}</span>
                </button>

                {/* End session */}
                <button
                  onClick={endSession}
                  className="flex flex-col items-center gap-1.5 px-6 py-3 bg-destructive/10 hover:bg-destructive/20 border border-destructive/40 text-destructive rounded-2xl font-semibold text-sm transition-all"
                  title="End session"
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
            <Loader2 className="w-10 h-10 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">Saving session and generating summary…</p>
          </div>
        )}

        {/* Ended state — show summary */}
        {sessionState === "ended" && (
          <div className="flex flex-col items-center p-6 gap-5 max-w-lg mx-auto w-full">
            <div className="w-14 h-14 rounded-full bg-emerald-500/10 border-2 border-emerald-500/30 flex items-center justify-center">
              <MessageSquare className="w-6 h-6 text-emerald-400" />
            </div>
            <h2 className="text-lg font-bold text-foreground">Session Complete</h2>

            {endedSummary && (
              <div className="w-full bg-card border border-border rounded-xl p-4">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Session Summary</p>
                <p className="text-sm text-foreground leading-relaxed">{endedSummary}</p>
              </div>
            )}

            {savedWords.length > 0 && (
              <div className="w-full bg-primary/5 border border-primary/20 rounded-xl p-4">
                <p className="text-xs font-bold text-primary uppercase tracking-wider mb-2">Words Saved ({savedWords.length})</p>
                <div className="flex flex-wrap gap-2">
                  {savedWords.map((w, i) => (
                    <span key={i} className="px-2.5 py-1 bg-primary/15 text-primary rounded-full text-xs font-medium">
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
                    <p key={i} className={cn("text-xs", line.role === "user" ? "text-foreground" : "text-primary")}>
                      <span className="font-semibold">{line.role === "user" ? "You" : "Romain"}: </span>
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
                streamingLineIdRef.current = null;
              }}
              className="px-8 py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-2xl font-semibold transition-all"
            >
              New Conversation
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

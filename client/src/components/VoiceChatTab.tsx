/**
 * VoiceChatTab — Real-time voice conversation with a French tutor AI.
 *
 * Architecture:
 *  1. User clicks "Start Session" → server issues an OpenAI Realtime ephemeral token
 *  2. Browser opens a WebRTC PeerConnection directly to OpenAI Realtime API
 *  3. Audio streams in both directions; the AI speaks back via a hidden <audio> element
 *  4. A DataChannel carries JSON events: transcripts, tool calls (save_vocab), etc.
 *  5. "End Session" persists the transcript + triggers an AI summary
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
  VolumeX,
  MessageSquare,
  Clock,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────────
interface TranscriptLine {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
}

interface SavedWord {
  term: string;
  translation: string;
  kind: string;
}

type SessionState = "idle" | "connecting" | "active" | "ending" | "ended";

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
                    <span className="font-semibold">{line.role === "user" ? "You" : "Amélie"}: </span>
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
  const [isMuted, setIsMuted] = useState(false);
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [endedSummary, setEndedSummary] = useState<string | null>(null);
  const [showPastSessions, setShowPastSessions] = useState(false);

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

      // Transcript delta from user (speech-to-text)
      if (msg.type === "conversation.item.input_audio_transcription.completed") {
        const text = msg.transcript?.trim();
        if (text) {
          setTranscript((prev) => [...prev, { role: "user", text, timestamp: Date.now() }]);
          setUserSpeaking(false);
        }
      }

      // User started speaking
      if (msg.type === "input_audio_buffer.speech_started") {
        setUserSpeaking(true);
      }
      if (msg.type === "input_audio_buffer.speech_stopped") {
        setUserSpeaking(false);
      }

      // AI response audio started/stopped
      if (msg.type === "response.audio.delta") {
        setAiSpeaking(true);
      }
      if (msg.type === "response.audio.done") {
        setAiSpeaking(false);
      }

      // AI transcript (text of what Amélie said)
      if (msg.type === "response.audio_transcript.done") {
        const text = msg.transcript?.trim();
        if (text) {
          setTranscript((prev) => [...prev, { role: "assistant", text, timestamp: Date.now() }]);
        }
      }

      // Tool call: save_vocab
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

      // 1. Create a session record in our DB
      const { id } = await createSessionMutation.mutateAsync();
      setSessionId(id);

      // 2. Get ephemeral token from our server
      const tokenResp = await fetch("/api/voice/session", { method: "POST" });
      if (!tokenResp.ok) {
        const err = await tokenResp.json();
        throw new Error(err.error ?? "Failed to get session token");
      }
      const tokenData = await tokenResp.json();
      const ephemeralKey = tokenData.value;
      if (!ephemeralKey) throw new Error("No ephemeral key in response");

      // 3. Set up WebRTC
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
        // Send initial greeting trigger
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

      // Send offer to OpenAI Realtime (GA API)
      const sdpResp = await fetch(
        "https://api.openai.com/v1/realtime/calls",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ephemeralKey}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp,
        }
      );
      if (!sdpResp.ok) throw new Error("WebRTC SDP exchange failed");
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

  const toggleMute = () => {
    localStreamRef.current?.getTracks().forEach((t) => {
      t.enabled = isMuted;
    });
    setIsMuted((m) => !m);
  };

  const manualSave = () => {
    if (transcript.length === 0) {
      toast("No conversation yet to save from");
      return;
    }
    // Find the last assistant message and extract the first French-looking phrase
    const lastAi = [...transcript].reverse().find((t) => t.role === "assistant");
    if (!lastAi) { toast("No AI message to save from"); return; }
    // Simple heuristic: take the first word/phrase in backticks or the whole message
    const match = lastAi.text.match(/[«»""]([^«»""]+)[«»""]/);
    const term = match ? match[1] : lastAi.text.split(/[.,!?]/)[0].trim().slice(0, 60);
    toast(`To save a word, say "save that" or "ajoute ça" during the conversation.`);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-border bg-background/80 backdrop-blur-sm px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mic className="w-4 h-4 text-primary" />
          <span className="font-semibold text-sm text-foreground">Voice Chat with Amélie</span>
          {sessionState === "active" && (
            <span className="flex items-center gap-1 text-xs text-emerald-400 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live
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
              <h2 className="text-xl font-bold text-foreground mb-2">Talk to Amélie</h2>
              <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
                Your personal French tutor. Have a natural conversation in French, ask questions, and say <span className="text-primary font-medium">"save that"</span> to add any word or phrase to your library.
              </p>
            </div>
            <div className="bg-card border border-border rounded-xl p-4 text-left max-w-sm w-full space-y-2">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Tips</p>
              <p className="text-xs text-muted-foreground">• Speak naturally — Amélie will match your B1 level</p>
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
            <p className="text-sm text-muted-foreground">Connecting to Amélie…</p>
          </div>
        )}

        {/* Active session */}
        {sessionState === "active" && (
          <div className="flex flex-col h-full">
            {/* Waveform area */}
            <div className="flex-shrink-0 px-4 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className={cn("bg-card border rounded-xl p-3 transition-colors", userSpeaking ? "border-primary/60 bg-primary/5" : "border-border")}>
                  <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
                    {isMuted ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
                    You {isMuted && <span className="text-destructive">(muted)</span>}
                  </p>
                  <Waveform analyser={userAnalyserRef.current} active={userSpeaking && !isMuted} color="#a78bfa" />
                </div>
                <div className={cn("bg-card border rounded-xl p-3 transition-colors", aiSpeaking ? "border-emerald-500/60 bg-emerald-500/5" : "border-border")}>
                  <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
                    <Volume2 className="w-3 h-3" />
                    Amélie {aiSpeaking && <span className="text-emerald-400 animate-pulse">speaking…</span>}
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

            {/* Live transcript */}
            <div className="flex-1 overflow-y-auto px-4 pb-2 space-y-2">
              {transcript.length === 0 && (
                <p className="text-center text-xs text-muted-foreground py-4">Conversation will appear here…</p>
              )}
              {transcript.map((line, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex gap-2 items-start",
                    line.role === "user" ? "flex-row-reverse" : "flex-row"
                  )}
                >
                  <div className={cn(
                    "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold mt-0.5",
                    line.role === "user" ? "bg-secondary text-foreground" : "bg-primary/20 text-primary"
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
            <div className="flex-shrink-0 border-t border-border px-4 py-3 flex items-center justify-between gap-3">
              <button
                onClick={toggleMute}
                className={cn(
                  "p-3 rounded-xl border transition-colors",
                  isMuted
                    ? "bg-destructive/20 border-destructive/50 text-destructive"
                    : "bg-card border-border text-muted-foreground hover:text-foreground"
                )}
                title={isMuted ? "Unmute" : "Mute"}
              >
                {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>

              <button
                onClick={manualSave}
                className="flex items-center gap-2 px-4 py-2.5 bg-card border border-border hover:bg-muted/50 text-muted-foreground hover:text-foreground rounded-xl text-sm font-medium transition-colors"
                title="Save last word to dictionary"
              >
                <BookmarkPlus className="w-4 h-4" />
                Save word
              </button>

              <button
                onClick={endSession}
                className="flex items-center gap-2 px-4 py-2.5 bg-destructive/10 hover:bg-destructive/20 border border-destructive/30 text-destructive rounded-xl text-sm font-semibold transition-colors"
              >
                <PhoneOff className="w-4 h-4" />
                End
              </button>
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
                      <span className="font-semibold">{line.role === "user" ? "You" : "Amélie"}: </span>
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

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
 * Context optimization (Round 16):
 *  - Tracks conversation turns (completed user + assistant exchanges)
 *  - Every SUMMARIZE_EVERY turns, calls voiceSession.summarizeContext on the server
 *  - Injects the summary as a system message into the Realtime context via data channel
 *  - Deletes the old raw turns from the Realtime context to cap token growth
 *  - Shows a subtle "Context summarized" badge in the UI when pruning runs
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
  Sparkles,
} from "lucide-react";

// ─── Constants ─────────────────────────────────────────────────────────────────
/** Summarize and prune after this many completed turns (user + assistant = 1 turn) */
const SUMMARIZE_EVERY = 10;
/** Keep this many recent raw turns after pruning */
const KEEP_RECENT = 10;

// ─── Types ─────────────────────────────────────────────────────────────────────
interface TranscriptLine {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  /** id used to update in-progress streaming lines */
  id?: string;
  /** Realtime conversation item ID — needed to delete from Realtime context */
  itemId?: string;
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
  const [summarizing, setSummarizing] = useState(false);
  const [summarizeCount, setSummarizeCount] = useState(0);

  // Track the in-progress AI streaming line (delta accumulation)
  const streamingLineIdRef = useRef<string | null>(null);

  // ── Context pruning state ────────────────────────────────────────────────────
  // completedTurns: array of finalized (non-streaming) transcript lines with itemIds
  // turnsSinceLastSummarize: count of completed turns since last summarization
  // itemIdMap: maps our local line id → OpenAI Realtime conversation item id
  const completedTurnsRef = useRef<TranscriptLine[]>([]);
  const turnsSinceLastSummarizeRef = useRef(0);
  const isSummarizingRef = useRef(false); // prevent concurrent summarization

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
  const summarizeContextMutation = trpc.voiceSession.summarizeContext.useMutation();
  const { data: pastSessions = [], refetch: refetchSessions } = trpc.voiceSession.list.useQuery(
    undefined,
    { enabled: showPastSessions }
  );

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  // ── Periodic summarization ───────────────────────────────────────────────────
  /**
   * Called after each completed turn (user speech done OR assistant response done).
   * When turnsSinceLastSummarize reaches SUMMARIZE_EVERY:
   *  1. Calls the server to summarize the oldest turns (all except the last KEEP_RECENT)
   *  2. Injects the summary as a system message into the Realtime context
   *  3. Deletes the old raw turns from the Realtime context via conversation.item.delete
   *  4. Resets the counter
   */
  const maybeSummarize = useCallback(async () => {
    turnsSinceLastSummarizeRef.current += 1;

    if (
      turnsSinceLastSummarizeRef.current < SUMMARIZE_EVERY ||
      isSummarizingRef.current ||
      !dcRef.current ||
      dcRef.current.readyState !== "open"
    ) {
      return;
    }

    const allTurns = completedTurnsRef.current;
    if (allTurns.length <= KEEP_RECENT) return; // not enough turns yet

    const turnsToSummarize = allTurns.slice(0, allTurns.length - KEEP_RECENT);
    if (turnsToSummarize.length === 0) return;

    isSummarizingRef.current = true;
    setSummarizing(true);

    try {
      // 1. Ask server to summarize the old turns
      const { summary } = await summarizeContextMutation.mutateAsync({
        turns: turnsToSummarize.map((t) => ({ role: t.role, text: t.text })),
      });

      const dc = dcRef.current;
      if (!dc || dc.readyState !== "open") return;

      // 2. Inject summary as a system message into the Realtime context
      dc.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "system",
          content: [
            {
              type: "input_text",
              text: `[Earlier conversation summary — ${turnsToSummarize.length} turns]: ${summary}`,
            },
          ],
        },
      }));

      // 3. Delete the old raw turns from the Realtime context
      // We delete by itemId if available; skip any without itemId (they were never in Realtime context)
      for (const turn of turnsToSummarize) {
        if (turn.itemId) {
          dc.send(JSON.stringify({
            type: "conversation.item.delete",
            item_id: turn.itemId,
          }));
        }
      }

      // 4. Update local state: remove summarized turns from completedTurnsRef
      completedTurnsRef.current = allTurns.slice(allTurns.length - KEEP_RECENT);
      turnsSinceLastSummarizeRef.current = 0;

      // Show a subtle indicator in the transcript
      setTranscript((prev) => [
        ...prev,
        {
          role: "assistant" as const,
          text: `✦ Context summarized (${turnsToSummarize.length} earlier turns compressed)`,
          timestamp: Date.now(),
          id: `summary-note-${Date.now()}`,
        },
      ]);

      setSummarizeCount((c) => c + 1);
      console.log(`[Context] Summarized ${turnsToSummarize.length} turns, kept ${KEEP_RECENT} recent`);
    } catch (err) {
      console.warn("[Context] Summarization failed, skipping prune:", err);
    } finally {
      isSummarizingRef.current = false;
      setSummarizing(false);
    }
  }, [summarizeContextMutation]);

  // Handle DataChannel events from OpenAI Realtime
  const handleDataChannelMessage = useCallback((event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data);

      // Debug: log ALL events so we can see what the GA API actually sends
      console.log("[Realtime event]", msg.type, msg);

      // ── User speech transcript ──────────────────────────────────────────────
      if (
        msg.type === "conversation.item.input_audio_transcription.completed" ||
        msg.type === "conversation.item.input_audio_transcription.done"
      ) {
        const text = (msg.transcript ?? msg.text ?? "").trim();
        if (text) {
          const itemId: string | undefined = msg.item_id;
          const newLine: TranscriptLine = { role: "user", text, timestamp: Date.now(), itemId };
          setTranscript((prev) => {
            // Replace any partial user line or append new one
            const lastUser = [...prev].reverse().find((l) => l.role === "user" && l.id?.startsWith("user-stream"));
            if (lastUser) {
              return prev.map((l) => l.id === lastUser.id ? { ...l, text, id: undefined, itemId } : l);
            }
            return [...prev, newLine];
          });
          // Track completed user turn for summarization
          completedTurnsRef.current = [...completedTurnsRef.current, newLine];
          setUserSpeaking(false);
          // Check if we should summarize after user turn completes
          maybeSummarize();
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
          const lineId = `stream-${Date.now()}`;
          streamingLineIdRef.current = lineId;
          setTranscript((prev) => [
            ...prev,
            { role: "assistant", text: delta, timestamp: Date.now(), id: lineId },
          ]);
        } else {
          const lineId = streamingLineIdRef.current;
          setTranscript((prev) =>
            prev.map((line) =>
              line.id === lineId ? { ...line, text: line.text + delta } : line
            )
          );
        }
      }

      // Finalize the streaming line and track it as a completed turn
      if (isAiTranscriptDone) {
        const finalText = msg.transcript ?? "";
        const itemId: string | undefined = msg.item_id;
        const lineId = streamingLineIdRef.current;
        streamingLineIdRef.current = null;

        if (lineId) {
          // Attach itemId to the finalized line so we can delete it later
          setTranscript((prev) =>
            prev.map((line) =>
              line.id === lineId ? { ...line, id: undefined, itemId } : line
            )
          );
          // Track completed assistant turn
          const text = finalText || (transcript.find((l) => l.id === lineId)?.text ?? "");
          if (text) {
            const completedLine: TranscriptLine = { role: "assistant", text, timestamp: Date.now(), itemId };
            completedTurnsRef.current = [...completedTurnsRef.current, completedLine];
            // Check if we should summarize after assistant turn completes
            maybeSummarize();
          }
        }
      }

      // Fallback: if no delta events, capture full text from response.output_item.done
      if (msg.type === "response.output_item.done") {
        const item = msg.item;
        if (item?.role === "assistant" && item?.content) {
          for (const c of item.content) {
            const text = c.transcript ?? c.text ?? "";
            if (text && !streamingLineIdRef.current) {
              const itemId: string | undefined = item.id;
              setTranscript((prev) => {
                const lastAI = [...prev].reverse().find((l) => l.role === "assistant");
                if (lastAI && lastAI.text === text) return prev; // already there
                return [...prev, { role: "assistant", text, timestamp: Date.now(), itemId }];
              });
              // Track as completed turn
              const completedLine: TranscriptLine = { role: "assistant", text, timestamp: Date.now(), itemId };
              completedTurnsRef.current = [...completedTurnsRef.current, completedLine];
              maybeSummarize();
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
  }, [saveWordMutation, utils, maybeSummarize, transcript]);

  const startSession = async () => {
    try {
      setSessionState("connecting");
      setTranscript([]);
      setSavedWords([]);
      setEndedSummary(null);
      setSummarizeCount(0);
      streamingLineIdRef.current = null;
      completedTurnsRef.current = [];
      turnsSinceLastSummarizeRef.current = 0;
      isSummarizingRef.current = false;

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
            // Set voice (must be done over data channel for unified interface)
            voice: "marin",
            // Enable Whisper transcription for user speech → gives us transcript events
            input_audio_transcription: { model: "whisper-1" },
            // Noise-resistant VAD: higher threshold + longer silence window
            // Reduces false triggers from coughs, background noise, breathing
            turn_detection: {
              type: "server_vad",
              threshold: 0.6,
              prefix_padding_ms: 800,
              silence_duration_ms: 2000,
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
      // Filter out internal context-summary UI notes before persisting
      const persistableTranscript = transcript.filter(
        (l) => !l.id?.startsWith("summary-note-")
      );
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

  const togglePause = () => {
    if (sessionState === "active") {
      localStreamRef.current?.getTracks().forEach((t) => { t.enabled = false; });
      if (audioRef.current) audioRef.current.pause();
      setSessionState("paused");
    } else if (sessionState === "paused") {
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
          {summarizing && (
            <span className="flex items-center gap-1 text-xs text-violet-400 font-medium animate-pulse">
              <Sparkles className="w-3 h-3" />
              Compressing…
            </span>
          )}
          {!summarizing && summarizeCount > 0 && isSessionLive && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground" title={`Context has been summarized ${summarizeCount} time${summarizeCount > 1 ? "s" : ""} to keep responses fast`}>
              <Sparkles className="w-3 h-3 text-violet-400" />
              <span className="text-violet-400">{summarizeCount}×</span>
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
              {transcript.map((line, i) => {
                // Summary note line — render as a centered system note
                if (line.id?.startsWith("summary-note-")) {
                  return (
                    <div key={line.id ?? i} className="flex items-center gap-2 py-1">
                      <div className="flex-1 h-px bg-border" />
                      <span className="flex items-center gap-1 text-[10px] text-violet-400 font-medium whitespace-nowrap">
                        <Sparkles className="w-3 h-3" />
                        {line.text.replace("✦ ", "")}
                      </span>
                      <div className="flex-1 h-px bg-border" />
                    </div>
                  );
                }
                return (
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
                );
              })}
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
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Transcript ({transcript.filter(l => !l.id?.startsWith("summary-note-")).length} lines)</p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {transcript
                    .filter((line) => !line.id?.startsWith("summary-note-"))
                    .map((line, i) => (
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
                setSummarizeCount(0);
                streamingLineIdRef.current = null;
                completedTurnsRef.current = [];
                turnsSinceLastSummarizeRef.current = 0;
                isSummarizingRef.current = false;
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

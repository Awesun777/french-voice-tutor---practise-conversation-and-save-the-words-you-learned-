/**
 * French pronunciation using OpenAI TTS (tts-1) via a server-side tRPC call.
 *
 * Architecture:
 *   - First call for a given text: calls voice.tts mutation → receives base64 MP3
 *     → decodes to a Blob URL → plays via HTMLAudioElement.
 *   - Subsequent calls for the same text: plays instantly from the in-memory
 *     blob URL cache (Map<text, blobUrl>).
 *   - Falls back to Web Speech API if the tRPC call fails (network error, etc.).
 *
 * Exports:
 *   - usePronounce()  — React hook that tracks loading/speaking state per utterance
 */

import { useState, useCallback, useRef } from "react";
import { trpc } from "./trpc";

// Client-side blob URL cache — persists for the lifetime of the browser tab.
// Version suffix ensures stale blobs from previous voice/model changes are not reused.
const CACHE_VERSION = 'v2-marin';
const audioCache = new Map<string, string>(); // `${CACHE_VERSION}:${text}` → blob URL

let _currentAudio: HTMLAudioElement | null = null;

function stopCurrent() {
  if (_currentAudio) {
    _currentAudio.pause();
    _currentAudio.src = "";
    _currentAudio = null;
  }
}

export type PronounceState = "idle" | "loading" | "speaking";

/**
 * React hook that tracks pronunciation state per active utterance.
 *
 * Usage:
 *   const { speak, state, activeText } = usePronounce();
 *   // state: "idle" | "loading" | "speaking"
 *   // activeText: the text currently being spoken (or null)
 */
export function usePronounce() {
  const [state, setState] = useState<PronounceState>("idle");
  const [activeText, setActiveText] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);

  const ttsMutation = trpc.voice.tts.useMutation();

  // Fetch + cache the audio for `text` WITHOUT playing it, so a later speak()
  // is instant. Used to warm the next flashcard while the current one shows.
  const preload = useCallback(
    async (text: string) => {
      if (!text) return;
      const cacheKey = `${CACHE_VERSION}:${text}`;
      if (audioCache.has(cacheKey)) return;
      try {
        const result = await ttsMutation.mutateAsync({ text });
        const binary = atob(result.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: result.mimeType });
        if (!audioCache.has(cacheKey)) audioCache.set(cacheKey, URL.createObjectURL(blob));
      } catch {
        // Preload is best-effort — ignore failures (speak() will retry / fall back).
      }
    },
    [ttsMutation]
  );

  const speak = useCallback(
    async (text: string) => {
      // Toggle off if already speaking this text
      if (activeText === text && state !== "idle") {
        stopCurrent();
        setState("idle");
        setActiveText(null);
        pendingRef.current = null;
        return;
      }

      pendingRef.current = text;
      setState("loading");
      setActiveText(text);

      // --- Try cache first (versioned key prevents stale blobs from old voice/model) ---
      const cacheKey = `${CACHE_VERSION}:${text}`;
      let blobUrl = audioCache.get(cacheKey);

      if (!blobUrl) {
        try {
          const result = await ttsMutation.mutateAsync({ text });
          // Decode base64 → Blob → Blob URL
          const binary = atob(result.base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const blob = new Blob([bytes], { type: result.mimeType });
          blobUrl = URL.createObjectURL(blob);
          audioCache.set(cacheKey, blobUrl);
        } catch {
          // Fallback to Web Speech API
          if (pendingRef.current === text) {
            setState("speaking");
            const u = new SpeechSynthesisUtterance(text);
            u.lang = "fr-FR";
            u.rate = 0.9;
            u.onend = () => {
              if (pendingRef.current === text) {
                setState("idle");
                setActiveText(null);
                pendingRef.current = null;
              }
            };
            u.onerror = () => {
              if (pendingRef.current === text) {
                setState("idle");
                setActiveText(null);
                pendingRef.current = null;
              }
            };
            window.speechSynthesis?.speak(u);
          }
          return;
        }
      }

      // Guard: user may have cancelled while we were fetching
      if (pendingRef.current !== text) return;

      stopCurrent();
      const audio = new Audio(blobUrl);
      _currentAudio = audio;

      setState("speaking");

      audio.onended = () => {
        if (pendingRef.current === text) {
          setState("idle");
          setActiveText(null);
          pendingRef.current = null;
        }
        _currentAudio = null;
      };
      audio.onerror = () => {
        if (pendingRef.current === text) {
          setState("idle");
          setActiveText(null);
          pendingRef.current = null;
        }
        _currentAudio = null;
      };

      audio.play().catch(() => {
        if (pendingRef.current === text) {
          setState("idle");
          setActiveText(null);
          pendingRef.current = null;
        }
        _currentAudio = null;
      });
    },
    [activeText, state, ttsMutation]
  );

  return { speak, preload, state, activeText };
}

/** Fire-and-forget convenience wrapper (no state tracking) */
export function pronounce(text: string): void {
  const cached = audioCache.get(`${CACHE_VERSION}:${text}`);
  if (cached) {
    stopCurrent();
    const audio = new Audio(cached);
    _currentAudio = audio;
    audio.onended = () => { _currentAudio = null; };
    audio.play().catch(() => { _currentAudio = null; });
    return;
  }
  // No cache — fall back to Web Speech API for fire-and-forget
  if (window.speechSynthesis) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "fr-FR";
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
  }
}

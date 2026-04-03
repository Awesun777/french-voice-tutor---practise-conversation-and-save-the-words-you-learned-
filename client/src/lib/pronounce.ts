/**
 * Robust French pronunciation using the Web Speech API.
 *
 * Fixes the well-known Chrome SpeechSynthesis freeze bug:
 *   - Chrome's synthesis engine silently stops after ~15 minutes of page activity.
 *   - The tab shows the speaker icon but no audio plays.
 *   - Fix: cancel → pause → resume → setTimeout → speak, which resets Chrome's engine.
 *
 * Also selects the best available French voice (fr-FR preferred, fr-* fallback).
 *
 * Exports:
 *   - pronounce(text)          — fire-and-forget, no state tracking
 *   - usePronounce()           — React hook that tracks loading/speaking state per utterance
 */

import { useState, useCallback, useRef } from "react";

let _frenchVoice: SpeechSynthesisVoice | null = null;
let _voicesLoaded = false;

function loadFrenchVoice(): SpeechSynthesisVoice | null {
  if (_voicesLoaded) return _frenchVoice;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null; // not ready yet

  _frenchVoice =
    voices.find((v) => v.lang === "fr-FR") ??
    voices.find((v) => v.lang.startsWith("fr")) ??
    null;
  _voicesLoaded = true;
  return _frenchVoice;
}

// Pre-load voices as soon as they become available
if (typeof window !== "undefined" && window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => {
    _voicesLoaded = false;
    loadFrenchVoice();
  };
}

function _speak(
  text: string,
  onStart?: () => void,
  onEnd?: () => void,
  onError?: () => void
): void {
  if (!window.speechSynthesis) {
    onError?.();
    return;
  }

  window.speechSynthesis.cancel();
  window.speechSynthesis.pause();
  window.speechSynthesis.resume();

  setTimeout(() => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "fr-FR";
    u.rate = 0.9;

    const voice = loadFrenchVoice();
    if (voice) u.voice = voice;

    const keepAlive = setInterval(() => {
      if (!window.speechSynthesis.speaking) {
        clearInterval(keepAlive);
        return;
      }
      window.speechSynthesis.pause();
      window.speechSynthesis.resume();
    }, 10000);

    u.onstart = () => onStart?.();
    u.onend = () => { clearInterval(keepAlive); onEnd?.(); };
    u.onerror = () => { clearInterval(keepAlive); onError?.(); };

    window.speechSynthesis.speak(u);
  }, 50);
}

/** Fire-and-forget — no state tracking */
export function pronounce(text: string): void {
  _speak(text);
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

  const speak = useCallback((text: string) => {
    // If already speaking this exact text, cancel (toggle off)
    if (activeText === text && state !== "idle") {
      window.speechSynthesis?.cancel();
      setState("idle");
      setActiveText(null);
      pendingRef.current = null;
      return;
    }

    pendingRef.current = text;
    setState("loading");
    setActiveText(text);

    _speak(
      text,
      () => {
        // onstart — only update if this is still the pending utterance
        if (pendingRef.current === text) setState("speaking");
      },
      () => {
        if (pendingRef.current === text) {
          setState("idle");
          setActiveText(null);
          pendingRef.current = null;
        }
      },
      () => {
        if (pendingRef.current === text) {
          setState("idle");
          setActiveText(null);
          pendingRef.current = null;
        }
      }
    );
  }, [activeText, state]);

  return { speak, state, activeText };
}

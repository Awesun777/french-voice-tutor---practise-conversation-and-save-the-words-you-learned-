/**
 * Robust French pronunciation using the Web Speech API.
 *
 * Fixes the well-known Chrome SpeechSynthesis freeze bug:
 *   - Chrome's synthesis engine silently stops after ~15 minutes of page activity.
 *   - The tab shows the speaker icon but no audio plays.
 *   - Fix: cancel → pause → resume → setTimeout → speak, which resets Chrome's engine.
 *
 * Also selects the best available French voice (fr-FR preferred, fr-* fallback).
 */

let _frenchVoice: SpeechSynthesisVoice | null = null;
let _voicesLoaded = false;

function loadFrenchVoice(): SpeechSynthesisVoice | null {
  if (_voicesLoaded) return _frenchVoice;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null; // not ready yet

  // Prefer fr-FR, then any fr-* voice
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
    _voicesLoaded = false; // reset so next call re-picks
    loadFrenchVoice();
  };
}

export function pronounce(text: string): void {
  if (!window.speechSynthesis) return;

  // Step 1: Hard-cancel any ongoing speech
  window.speechSynthesis.cancel();

  // Step 2: Chrome freeze fix — pause + resume resets the internal engine
  window.speechSynthesis.pause();
  window.speechSynthesis.resume();

  // Step 3: Defer speak() by one tick so Chrome's engine has time to reset
  setTimeout(() => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "fr-FR";
    u.rate = 0.9; // slightly slower for clarity

    const voice = loadFrenchVoice();
    if (voice) u.voice = voice;

    // Step 4: Chrome keepalive — Chrome silently stops utterances longer than ~15s.
    // Calling resume() periodically prevents the engine from going idle mid-utterance.
    const keepAlive = setInterval(() => {
      if (!window.speechSynthesis.speaking) {
        clearInterval(keepAlive);
        return;
      }
      window.speechSynthesis.pause();
      window.speechSynthesis.resume();
    }, 10000);

    u.onend = () => clearInterval(keepAlive);
    u.onerror = () => clearInterval(keepAlive);

    window.speechSynthesis.speak(u);
  }, 50);
}

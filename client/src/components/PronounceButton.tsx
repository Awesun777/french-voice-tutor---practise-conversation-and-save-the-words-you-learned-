/**
 * PronounceButton — a reusable button that shows:
 *   idle    → Volume2 icon (speaker)
 *   loading → Loader2 spinner (voice engine initialising)
 *   speaking → Volume2 with animated pulse ring + active colour
 *
 * Accepts the same usePronounce() hook result so a parent can share one
 * hook instance across many buttons (only one plays at a time).
 */

import { Volume2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PronounceState } from "@/lib/pronounce";

interface PronounceButtonProps {
  text: string;
  speak: (text: string) => void;
  state: PronounceState;
  activeText: string | null;
  /** Extra classes for the outer <button> */
  className?: string;
  /** Icon size class, e.g. "w-4 h-4". Defaults to "w-4 h-4" */
  iconSize?: string;
}

export function PronounceButton({
  text,
  speak,
  state,
  activeText,
  className,
  iconSize = "w-4 h-4",
}: PronounceButtonProps) {
  const isActive = activeText === text;
  const isLoading = isActive && state === "loading";
  const isSpeaking = isActive && state === "speaking";

  return (
    <button
      onClick={(e) => { e.stopPropagation(); speak(text); }}
      title={isLoading ? "Loading voice…" : isSpeaking ? "Speaking… (click to stop)" : "Pronounce"}
      className={cn(
        "relative flex items-center justify-center rounded-full transition-all duration-200",
        isLoading && "opacity-70 cursor-wait",
        isSpeaking && "text-primary",
        className
      )}
    >
      {/* Pulse ring while speaking */}
      {isSpeaking && (
        <span className="absolute inset-0 rounded-full animate-ping bg-primary/30 pointer-events-none" />
      )}

      {isLoading ? (
        <Loader2 className={cn(iconSize, "animate-spin text-muted-foreground")} />
      ) : (
        <Volume2
          className={cn(
            iconSize,
            isSpeaking ? "text-primary" : "text-current"
          )}
        />
      )}
    </button>
  );
}

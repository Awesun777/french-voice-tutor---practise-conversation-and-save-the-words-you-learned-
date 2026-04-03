import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Volume2, Send, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Streamdown } from "streamdown";

import { pronounce } from "@/lib/pronounce";

function extractFrenchPhrases(text: string): string[] {
  // Extract text between backticks or bold markers that look French
  const matches: string[] = [];
  const backtick = text.match(/`([^`]+)`/g) ?? [];
  backtick.forEach((m) => matches.push(m.replace(/`/g, "")));
  return matches.filter((m) => /[àâäéèêëîïôùûüç]/i.test(m) || /\b(le|la|les|un|une|des|je|tu|il|elle|nous|vous|ils|elles)\b/i.test(m));
}

const QUICK_PROMPTS = [
  "How do I conjugate être in present tense?",
  "Explain the difference between passé composé and imparfait",
  "What's the difference between savoir and connaître?",
  "How do I use the subjunctive?",
  "Explain French gender rules",
  "How do I form questions in French?",
];

export default function TutorTab() {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const utils = trpc.useUtils();

  const { data: messages = [], isLoading } = trpc.tutor.history.useQuery();

  const chatMutation = trpc.tutor.chat.useMutation({
    onSuccess: () => {
      utils.tutor.history.invalidate();
      setSending(false);
    },
    onError: (err) => {
      toast.error(err.message);
      setSending(false);
    },
  });

  const clearMutation = trpc.tutor.clear.useMutation({
    onSuccess: () => utils.tutor.history.invalidate(),
    onError: () => toast.error("Failed to clear"),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    const msg = input.trim();
    if (!msg || sending) return;
    setInput("");
    setSending(true);
    chatMutation.mutate({ message: msg });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-border bg-background/80 backdrop-blur-sm px-4 py-3 flex items-center justify-between">
        <div>
          <p className="font-bold text-foreground">French Tutor</p>
          <p className="text-xs text-muted-foreground">Ask anything about French grammar, vocabulary, or usage</p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={() => clearMutation.mutate()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-card border border-border hover:bg-destructive/10 hover:border-destructive/50 text-muted-foreground hover:text-destructive rounded-xl text-xs font-semibold transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" /> Clear
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="max-w-xl mx-auto">
            <div className="text-center py-8">
              <p className="text-4xl mb-3">💬</p>
              <p className="text-lg font-semibold text-foreground mb-1">Your French Tutor</p>
              <p className="text-sm text-muted-foreground mb-6">Ask about grammar, vocabulary, pronunciation, or practice conversations</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {QUICK_PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => { setInput(p); inputRef.current?.focus(); }}
                  className="text-left px-3 py-2.5 bg-card border border-border hover:bg-muted/50 hover:border-primary/50 rounded-xl text-xs text-muted-foreground hover:text-foreground transition-all"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn("flex gap-3", msg.role === "user" ? "justify-end" : "justify-start")}
              >
                {msg.role === "assistant" && (
                  <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-sm">🇫🇷</span>
                  </div>
                )}
                <div
                  className={cn(
                    "max-w-[80%] rounded-2xl px-4 py-3 text-sm",
                    msg.role === "user"
                      ? "bg-primary/20 text-foreground rounded-tr-sm"
                      : "bg-card border border-border text-foreground rounded-tl-sm"
                  )}
                >
                  {msg.role === "assistant" ? (
                    <div className="prose prose-sm prose-invert max-w-none">
                      <Streamdown>{msg.content}</Streamdown>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  )}
                  {msg.role === "assistant" && (
                    <div className="flex gap-1.5 mt-2 flex-wrap">
                      {extractFrenchPhrases(msg.content).slice(0, 3).map((phrase, i) => (
                        <button
                          key={i}
                          onClick={() => pronounce(phrase)}
                          className="flex items-center gap-1 px-2 py-0.5 bg-primary/10 hover:bg-primary/20 text-primary rounded-full text-xs transition-colors"
                        >
                          <Volume2 className="w-3 h-3" />
                          {phrase}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {msg.role === "user" && (
                  <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-xs font-bold text-foreground">Me</span>
                  </div>
                )}
              </div>
            ))}
            {sending && (
              <div className="flex gap-3 justify-start">
                <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm">🇫🇷</span>
                </div>
                <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex-shrink-0 border-t border-border bg-background/80 backdrop-blur-sm px-4 py-3">
        <div className="max-w-2xl mx-auto flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask your tutor anything… (Enter to send, Shift+Enter for new line)"
            rows={1}
            style={{ resize: "none", minHeight: "42px", maxHeight: "120px" }}
            className="flex-1 px-4 py-2.5 bg-card border border-border rounded-xl text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 120) + "px";
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="p-2.5 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded-xl transition-colors flex-shrink-0"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

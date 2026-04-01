import { useState, useRef, useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { DictResult, DictWordResult, DictPhraseResult, DictQuestionResult } from "@/types";
import {
  Volume2, Plus, Loader2, Search, ChevronDown, ChevronUp,
  MessageCircle, Send, Sparkles, RefreshCw, ArrowLeftRight,
  BookmarkCheck, BookmarkX, MousePointerClick, X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Streamdown } from "streamdown";

function pronounce(text: string) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "fr-FR";
  u.rate = 0.85;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

function classifyKind(term: string): "word" | "phrase" {
  return term.trim().split(/\s+/).length >= 3 ? "phrase" : "word";
}

// ─── Vocab context shape passed to the chat panel ────────────────────────────
export interface VocabContext {
  term: string;
  translation: string;
  wordType?: string;
  pronunciation?: string;
  grammar?: string;
  examples?: { fr: string; en: string }[];
  conjugationInfo?: string;
  synonyms?: string[];
  reflexiveInfo?: string;
}

// ─── Word Result Card ─────────────────────────────────────────────────────────
function WordResult({
  result,
  onAdd,
  isAdded,
  onRemove,
  isSelected,
  onSelect,
}: {
  result: DictWordResult;
  onAdd: (term: string, translation: string, kind: "word" | "phrase") => void;
  isAdded?: boolean;
  onRemove?: () => void;
  isSelected?: boolean;
  onSelect?: () => void;
}) {
  const [showConjugations, setShowConjugations] = useState(false);
  const [showSynonyms, setShowSynonyms] = useState(false);
  const [showConfusing, setShowConfusing] = useState(false);

  if (!result.found) return null;

  const TENSE_LABELS: Record<string, string> = {
    present: "Présent",
    imparfait: "Imparfait",
    passeCompose: "Passé Composé",
    futurSimple: "Futur Simple",
    conditionnel: "Conditionnel",
    subjonctif: "Subjonctif",
  };

  return (
    <div
      className={cn(
        "space-y-3 rounded-2xl transition-all cursor-pointer",
        isSelected
          ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
          : "hover:ring-1 hover:ring-primary/40 hover:ring-offset-1 hover:ring-offset-background"
      )}
      onClick={onSelect}
    >
      {/* Main card */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-2xl font-bold text-foreground">{result.word}</h2>
              <button
                onClick={(e) => { e.stopPropagation(); pronounce(result.word); }}
                className="p-1.5 rounded-full bg-primary/15 hover:bg-primary/25 text-primary transition-colors"
              >
                <Volume2 className="w-4 h-4" />
              </button>
            </div>
            {result.pronunciation && (
              <p className="text-sm text-muted-foreground font-mono">[{result.pronunciation}]</p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {result.wordType && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-primary/15 text-primary font-semibold capitalize">
                {result.wordType}
              </span>
            )}
            {(result.isReflexive || result.hasReflexiveForm) && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 font-semibold flex items-center gap-1">
                <RefreshCw className="w-3 h-3" />
                {result.isReflexive ? "reflexive" : "has reflexive"}
              </span>
            )}
            {isAdded ? (
              <button
                onClick={(e) => { e.stopPropagation(); onRemove?.(); }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/15 hover:bg-red-500/20 text-emerald-400 hover:text-red-400 rounded-lg text-xs font-semibold transition-colors group"
                title="Remove from library"
              >
                <BookmarkCheck className="w-3.5 h-3.5 group-hover:hidden" />
                <BookmarkX className="w-3.5 h-3.5 hidden group-hover:block" />
                <span className="group-hover:hidden">Saved</span>
                <span className="hidden group-hover:inline">Remove</span>
              </button>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); onAdd(result.word, result.translation, classifyKind(result.word)); }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/15 hover:bg-primary/25 text-primary rounded-lg text-xs font-semibold transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            )}
          </div>
        </div>

        {isSelected && (
          <div className="mb-3 flex items-center gap-1.5 text-xs text-primary font-medium">
            <MousePointerClick className="w-3.5 h-3.5" />
            <span>Selected — ask about this word in the chat →</span>
          </div>
        )}

        <p className="text-lg text-foreground font-medium mb-3">{result.translation}</p>

        {result.isConjugated && result.baseForm && (
          <div className="bg-muted/50 rounded-xl p-3 mb-3 text-sm">
            <span className="text-muted-foreground">Conjugated form of </span>
            <button
              onClick={(e) => { e.stopPropagation(); pronounce(result.baseForm); }}
              className="text-primary font-semibold hover:underline"
            >
              {result.baseForm}
            </button>
            {result.formExplanation && (
              <span className="text-muted-foreground"> — {result.formExplanation}</span>
            )}
          </div>
        )}

        {/* Reflexive verb banner */}
        {(result.isReflexive || result.hasReflexiveForm) && (
          <div className="border border-amber-500/40 bg-amber-500/10 rounded-xl p-4 mb-3 space-y-2">
            <div className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span className="text-sm font-bold text-amber-300 uppercase tracking-wide">
                {result.isReflexive ? "Reflexive Verb (verbe pronominal)" : "Has Reflexive Form"}
              </span>
              {result.reflexiveType && (
                <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-semibold capitalize">
                  {result.reflexiveType}
                </span>
              )}
            </div>
            {(result.reflexiveForm || result.nonReflexiveForm) && (
              <div className="flex items-center gap-3 text-sm">
                {result.nonReflexiveForm && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground text-xs">Base:</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); pronounce(result.nonReflexiveForm!); }}
                      className="font-semibold text-foreground hover:text-primary transition-colors"
                    >
                      {result.nonReflexiveForm}
                    </button>
                    <Volume2 className="w-3 h-3 text-muted-foreground" />
                  </div>
                )}
                {result.reflexiveForm && result.nonReflexiveForm && (
                  <ArrowLeftRight className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                )}
                {result.reflexiveForm && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground text-xs">Reflexive:</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); pronounce(result.reflexiveForm!); }}
                      className="font-bold text-amber-300 hover:text-amber-200 transition-colors"
                    >
                      {result.reflexiveForm}
                    </button>
                    <Volume2 className="w-3 h-3 text-muted-foreground" />
                  </div>
                )}
              </div>
            )}
            {result.reflexiveExplanation && (
              <p className="text-sm text-amber-100/80 leading-relaxed">{result.reflexiveExplanation}</p>
            )}
            {result.isReflexive && result.reflexiveForm && result.nonReflexiveForm && (
              <p className="text-xs text-amber-300/70 italic">
                Note: <span className="font-medium">{result.nonReflexiveForm}</span> (transitive) vs{" "}
                <span className="font-medium">{result.reflexiveForm}</span> (intransitive/reflexive) — these often have different meanings.
              </p>
            )}
          </div>
        )}

        {result.grammar && (
          <p className="text-sm text-muted-foreground italic mb-3">{result.grammar}</p>
        )}

        {result.examples?.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Examples</p>
            {result.examples.map((ex, i) => (
              <div key={i} className="bg-muted/40 rounded-xl p-3">
                <div className="flex items-start gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); pronounce(ex.fr); }}
                    className="mt-0.5 p-1 rounded-full hover:bg-primary/15 text-muted-foreground hover:text-primary transition-colors flex-shrink-0"
                  >
                    <Volume2 className="w-3 h-3" />
                  </button>
                  <div>
                    <p className="text-sm font-medium text-foreground">{ex.fr}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{ex.en}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Conjugations */}
      {result.conjugations && result.wordType?.toLowerCase().includes("verb") && (
        <div className="bg-card border border-border rounded-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setShowConjugations(!showConjugations)}
            className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-muted/30 transition-colors"
          >
            <span className="text-sm font-semibold text-foreground">Conjugations</span>
            {showConjugations ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </button>
          {showConjugations && (
            <div className="px-5 pb-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {Object.entries(result.conjugations).map(([tense, forms]) => (
                <div key={tense}>
                  <p className="text-xs font-bold text-primary uppercase tracking-wider mb-2">{TENSE_LABELS[tense] ?? tense}</p>
                  <div className="space-y-1">
                    {(forms as string[]).map((f, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <button
                          onClick={() => pronounce(f)}
                          className="p-0.5 rounded hover:bg-primary/15 text-muted-foreground hover:text-primary transition-colors"
                        >
                          <Volume2 className="w-3 h-3" />
                        </button>
                        <span className="text-foreground">{f}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Synonyms & Confusing words */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" onClick={(e) => e.stopPropagation()}>
        {result.synonyms?.length > 0 && (
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <button
              onClick={() => setShowSynonyms(!showSynonyms)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
            >
              <span className="text-sm font-semibold text-foreground">Synonyms</span>
              {showSynonyms ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>
            {showSynonyms && (
              <div className="px-4 pb-4 space-y-2">
                {result.synonyms.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <button onClick={() => pronounce(s.word)} className="p-0.5 rounded hover:bg-primary/15 text-muted-foreground hover:text-primary transition-colors">
                      <Volume2 className="w-3 h-3" />
                    </button>
                    <span className="text-sm font-medium text-foreground">{s.word}</span>
                    <span className="text-xs text-muted-foreground">— {s.meaning}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {result.confusingWords?.length > 0 && (
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <button
              onClick={() => setShowConfusing(!showConfusing)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
            >
              <span className="text-sm font-semibold text-foreground">Don't confuse with</span>
              {showConfusing ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>
            {showConfusing && (
              <div className="px-4 pb-4 space-y-2.5">
                {result.confusingWords.map((c, i) => (
                  <div key={i}>
                    <div className="flex items-center gap-2">
                      <button onClick={() => pronounce(c.word)} className="p-0.5 rounded hover:bg-primary/15 text-muted-foreground hover:text-primary transition-colors">
                        <Volume2 className="w-3 h-3" />
                      </button>
                      <span className="text-sm font-medium text-foreground">{c.word}</span>
                      <span className="text-xs text-muted-foreground">— {c.meaning}</span>
                    </div>
                    {c.difference && <p className="text-xs text-muted-foreground mt-0.5 ml-6 italic">{c.difference}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Phrase Result Card ───────────────────────────────────────────────────────
function PhraseResult({
  result,
  onAdd,
  isAdded,
  onRemove,
  isSelected,
  onSelect,
}: {
  result: DictPhraseResult;
  onAdd: (term: string, translation: string, kind: "word" | "phrase") => void;
  isAdded?: boolean;
  onRemove?: () => void;
  isSelected?: boolean;
  onSelect?: () => void;
}) {
  return (
    <div
      className={cn(
        "bg-card border border-border rounded-2xl p-5 space-y-4 cursor-pointer transition-all",
        isSelected
          ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
          : "hover:ring-1 hover:ring-primary/40 hover:ring-offset-1 hover:ring-offset-background"
      )}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-xl font-bold text-foreground">{result.phrase}</h2>
            <button
              onClick={(e) => { e.stopPropagation(); pronounce(result.phrase); }}
              className="p-1.5 rounded-full bg-primary/15 hover:bg-primary/25 text-primary transition-colors"
            >
              <Volume2 className="w-4 h-4" />
            </button>
          </div>
          {result.pronunciation && (
            <p className="text-sm text-muted-foreground font-mono">[{result.pronunciation}]</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isAdded ? (
            <button
              onClick={(e) => { e.stopPropagation(); onRemove?.(); }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/15 hover:bg-red-500/20 text-emerald-400 hover:text-red-400 rounded-lg text-xs font-semibold transition-colors group"
              title="Remove from library"
            >
              <BookmarkCheck className="w-3.5 h-3.5 group-hover:hidden" />
              <BookmarkX className="w-3.5 h-3.5 hidden group-hover:block" />
              <span className="group-hover:hidden">Saved</span>
              <span className="hidden group-hover:inline">Remove</span>
            </button>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); onAdd(result.phrase, result.translation, "phrase"); }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/15 hover:bg-primary/25 text-primary rounded-lg text-xs font-semibold transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          )}
        </div>
      </div>

      {isSelected && (
        <div className="flex items-center gap-1.5 text-xs text-primary font-medium">
          <MousePointerClick className="w-3.5 h-3.5" />
          <span>Selected — ask about this phrase in the chat →</span>
        </div>
      )}

      <p className="text-lg font-medium text-foreground">{result.translation}</p>
      {result.literalTranslation && (
        <p className="text-sm text-muted-foreground italic">Literal: "{result.literalTranslation}"</p>
      )}
      {result.usage && <p className="text-sm text-muted-foreground">{result.usage}</p>}
      {result.examples?.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Examples</p>
          {result.examples.map((ex, i) => (
            <div key={i} className="bg-muted/40 rounded-xl p-3">
              <div className="flex items-start gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); pronounce(ex.fr); }}
                  className="mt-0.5 p-1 rounded-full hover:bg-primary/15 text-muted-foreground hover:text-primary transition-colors flex-shrink-0"
                >
                  <Volume2 className="w-3 h-3" />
                </button>
                <div>
                  <p className="text-sm font-medium text-foreground">{ex.fr}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{ex.en}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Question Result Card ─────────────────────────────────────────────────────
function QuestionResult({
  result,
  isSelected,
  onSelect,
}: {
  result: DictQuestionResult;
  isSelected?: boolean;
  onSelect?: () => void;
}) {
  return (
    <div
      className={cn(
        "bg-card border border-border rounded-2xl p-5 space-y-4 cursor-pointer transition-all",
        isSelected
          ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
          : "hover:ring-1 hover:ring-primary/40 hover:ring-offset-1 hover:ring-offset-background"
      )}
      onClick={onSelect}
    >
      <div>
        <p className="text-xs font-bold text-primary uppercase tracking-wider mb-1">Question</p>
        <p className="text-lg font-semibold text-foreground">{result.question}</p>
      </div>
      {isSelected && (
        <div className="flex items-center gap-1.5 text-xs text-primary font-medium">
          <MousePointerClick className="w-3.5 h-3.5" />
          <span>Selected — ask a follow-up in the chat →</span>
        </div>
      )}
      <div className="bg-muted/40 rounded-xl p-4">
        <p className="text-sm text-foreground leading-relaxed">{result.answer}</p>
      </div>
      {result.options?.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Related expressions</p>
          {result.options.map((opt, i) => (
            <div key={i} className="flex items-start gap-3 bg-muted/30 rounded-xl p-3">
              <button
                onClick={(e) => { e.stopPropagation(); pronounce(opt.french); }}
                className="mt-0.5 p-1 rounded-full hover:bg-primary/15 text-muted-foreground hover:text-primary transition-colors flex-shrink-0"
              >
                <Volume2 className="w-3 h-3" />
              </button>
              <div>
                <p className="text-sm font-semibold text-foreground">{opt.french}</p>
                <p className="text-xs text-muted-foreground">{opt.english}</p>
                {opt.summary && <p className="text-xs text-muted-foreground italic mt-0.5">{opt.summary}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Context Chat Panel ───────────────────────────────────────────────────────
function ContextChatPanel({
  vocabContext,
  onClearContext,
}: {
  vocabContext: VocabContext | null;
  onClearContext: () => void;
}) {
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const contextChatMutation = trpc.tutor.contextChat.useMutation({
    onSuccess: (data) => {
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
    },
    onError: (err) => toast.error(err.message),
  });

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);


  const handleSend = () => {
    const msg = input.trim();
    if (!msg || contextChatMutation.isPending) return;
    setMessages((prev) => [...prev, { role: "user", content: msg }]);
    setInput("");
    contextChatMutation.mutate({
      message: msg,
      vocabContext: vocabContext ?? undefined,
    });
  };

  const QUICK_PROMPTS = vocabContext
    ? [
        `How do I use "${vocabContext.term}" in a sentence?`,
        `What are common mistakes with "${vocabContext.term}"?`,
        `Give me more examples of "${vocabContext.term}"`,
        `What's the difference between "${vocabContext.term}" and similar words?`,
      ]
    : [
        "How do I conjugate avoir?",
        "What's the difference between savoir and connaître?",
        "When do I use passé composé vs imparfait?",
      ];

  return (
    <div className="flex flex-col h-full bg-card border border-border rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-border bg-muted/20">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-primary/15">
            <MessageCircle className="w-3.5 h-3.5 text-primary" />
          </div>
          <span className="text-sm font-semibold text-foreground flex-1">Ask your tutor</span>
        </div>
        {/* Context indicator */}
        {vocabContext ? (
          <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-primary/10 border border-primary/20 rounded-xl">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-primary font-semibold truncate">
                Context: <span className="font-bold">{vocabContext.term}</span>
              </p>
              <p className="text-xs text-muted-foreground truncate">{vocabContext.translation}</p>
            </div>
            <button
              onClick={onClearContext}
              className="p-1 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
              title="Clear context"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <p className="mt-1.5 text-xs text-muted-foreground">
            Click any result card to set it as context, then ask questions about it.
          </p>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {messages.length === 0 && (
          <div className="space-y-2 pt-2">
            <p className="text-xs text-muted-foreground font-medium">Quick questions:</p>
            {QUICK_PROMPTS.map((p) => (
              <button
                key={p}
                onClick={() => setInput(p)}
                className="w-full text-left text-xs px-3 py-2 bg-muted/40 hover:bg-primary/10 hover:text-primary text-muted-foreground rounded-xl transition-colors leading-relaxed"
              >
                {p}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={cn(
              "rounded-xl px-3 py-2.5 text-sm",
              m.role === "user"
                ? "bg-primary/15 text-foreground ml-4"
                : "bg-muted/40 text-foreground mr-4"
            )}
          >
            {m.role === "assistant" ? (
              <div className="prose prose-sm prose-invert max-w-none">
                <Streamdown>{m.content}</Streamdown>
              </div>
            ) : (
              <p>{m.content}</p>
            )}
          </div>
        ))}
        {contextChatMutation.isPending && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground mr-4 px-3 py-2 bg-muted/40 rounded-xl">
            <Sparkles className="w-3.5 h-3.5 animate-pulse text-primary" />
            <span>Thinking…</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 px-3 py-3 border-t border-border">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder={
              vocabContext
                ? `Ask about "${vocabContext.term}"…`
                : "Ask anything about French…"
            }
            className="flex-1 px-3 py-2 bg-background border border-border rounded-xl text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || contextChatMutation.isPending}
            className="p-2.5 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded-xl transition-colors flex-shrink-0"
          >
            {contextChatMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Spelling Suggestions Banner ──────────────────────────────────────────────
function SuggestionsBanner({
  term,
  suggestions,
  onSearch,
}: {
  term: string;
  suggestions: { term: string; translation: string; confidence: string }[];
  onSearch: (t: string) => void;
}) {
  if (!suggestions.length) return null;
  return (
    <div className="bg-amber-950/40 border border-amber-700/40 rounded-2xl p-4">
      <div className="flex items-start gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
        <p className="text-sm font-semibold text-amber-300">
          "{term}" wasn't found — did you mean:
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((s) => (
          <button
            key={s.term}
            onClick={() => onSearch(s.term)}
            className="flex items-center gap-2 px-3 py-2 bg-amber-900/40 hover:bg-amber-800/50 border border-amber-700/40 rounded-xl transition-colors group"
          >
            <div className="text-left">
              <p className="text-sm font-bold text-amber-200 group-hover:text-amber-100">{s.term}</p>
              <p className="text-xs text-amber-400/80">{s.translation}</p>
            </div>
            <div
              className={cn(
                "text-xs px-1.5 py-0.5 rounded-full font-semibold ml-1",
                s.confidence === "high"
                  ? "bg-emerald-900/60 text-emerald-400"
                  : "bg-amber-900/60 text-amber-400"
              )}
            >
              {s.confidence}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Main DictionaryTab ───────────────────────────────────────────────────────
export default function DictionaryTab() {
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState<DictResult[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<{ term: string; translation: string; confidence: string }[]>([]);
  const [lastNotFoundTerm, setLastNotFoundTerm] = useState("");
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  const suggestMutation = trpc.dictionary.suggest.useMutation({
    onSuccess: (data) => setSuggestions(data.suggestions),
  });

  const searchMutation = trpc.dictionary.search.useMutation({
    onSuccess: (data) => {
      const result = data as DictResult;
      if (result.type === "word" && !(result as DictWordResult).found) {
        setSuggestions([]);
        suggestMutation.mutate({ term: searchTerm.trim() });
        setLastNotFoundTerm(searchTerm.trim());
      } else {
        setSuggestions([]);
        setLastNotFoundTerm("");
      }
      setResults((prev) => [result, ...prev.slice(0, 9)]);
    },
    onError: (err) => toast.error(err.message),
  });

  // Map: result index → { id, term } for entries that have been added to the library
  const [addedMap, setAddedMap] = useState<Record<number, { id: number; term: string }>>({});

  const addMutation = trpc.vocab.add.useMutation({
    onSuccess: () => utils.vocab.list.invalidate(),
    onError: () => toast.error("Failed to add to library"),
  });

  const deleteMutation = trpc.vocab.delete.useMutation({
    onSuccess: () => {
      toast.success("Removed from library");
      utils.vocab.list.invalidate();
    },
    onError: () => toast.error("Failed to remove"),
  });

  // Auto-add word OR phrase to library when a new found result arrives
  useEffect(() => {
    if (results.length === 0) return;
    const latest = results[0];

    if (latest.type === "word" && (latest as DictWordResult).found) {
      const wr = latest as DictWordResult;
      if (addedMap[0] && addedMap[0].term === wr.word) return;
      addMutation.mutate(
        { term: wr.word, translation: wr.translation, entryKind: classifyKind(wr.word) },
        {
          onSuccess: (data) => {
            setAddedMap((prev) => ({ ...prev, [0]: { id: data.id, term: wr.word } }));
          },
        }
      );
    } else if (latest.type === "phrase" && (latest as DictPhraseResult).found !== false) {
      const pr = latest as DictPhraseResult;
      const term = pr.phrase;
      if (!term) return;
      if (addedMap[0] && addedMap[0].term === term) return;
      addMutation.mutate(
        { term, translation: pr.translation, entryKind: "phrase" },
        {
          onSuccess: (data) => {
            setAddedMap((prev) => ({ ...prev, [0]: { id: data.id, term } }));
          },
        }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results]);

  const handleSearch = useCallback(
    (overrideTerm?: string) => {
      const term = (overrideTerm ?? searchTerm).trim();
      if (!term) return;
      if (overrideTerm) setSearchTerm(overrideTerm);
      setSuggestions([]);
      setLastNotFoundTerm("");
      setSelectedIdx(null);
      setAddedMap({});
      if (!history.includes(term)) setHistory((prev) => [term, ...prev.slice(0, 19)]);
      searchMutation.mutate({ term });
    },
    [searchTerm, history, searchMutation]
  );

  const handleAdd = (term: string, translation: string, kind: "word" | "phrase", resultIdx?: number) => {
    addMutation.mutate(
      { term, translation, entryKind: kind },
      {
        onSuccess: (data) => {
          if (resultIdx !== undefined) {
            setAddedMap((prev) => ({ ...prev, [resultIdx]: { id: data.id, term } }));
          }
          toast.success("Added to library!");
          utils.vocab.list.invalidate();
        },
      }
    );
  };

  const handleRemove = (resultIdx: number) => {
    const entry = addedMap[resultIdx];
    if (!entry) return;
    deleteMutation.mutate({ id: entry.id });
    setAddedMap((prev) => {
      const next = { ...prev };
      delete next[resultIdx];
      return next;
    });
  };

  // Build vocab context for the selected result
  const selectedVocabContext: VocabContext | null = (() => {
    if (selectedIdx === null || !results[selectedIdx]) return null;
    const r = results[selectedIdx];
    if (r.type === "word") {
      const wr = r as DictWordResult;
      if (!wr.found) return null;
      return {
        term: wr.word,
        translation: wr.translation,
        wordType: wr.wordType,
        pronunciation: wr.pronunciation,
        grammar: wr.grammar,
        examples: wr.examples,
        conjugationInfo: wr.isConjugated && wr.baseForm
          ? `Conjugated form of ${wr.baseForm}${wr.formExplanation ? ` — ${wr.formExplanation}` : ""}`
          : undefined,
        synonyms: wr.synonyms?.map((s: any) => s.word),
        reflexiveInfo: wr.reflexiveExplanation ?? undefined,
      };
    }
    if (r.type === "phrase") {
      const pr = r as DictPhraseResult;
      return {
        term: pr.phrase,
        translation: pr.translation,
        pronunciation: pr.pronunciation,
        examples: pr.examples,
        grammar: pr.usage,
      };
    }
    if (r.type === "question") {
      const qr = r as DictQuestionResult;
      return {
        term: qr.question,
        translation: qr.answer,
      };
    }
    return null;
  })();

  const hasResults = results.length > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Search header */}
      <div className="flex-shrink-0 border-b border-border bg-background/80 backdrop-blur-sm px-4 py-3">
        <div className="max-w-full">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <input
                ref={inputRef}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="Search French words, phrases, or ask a question…"
                className="w-full pl-9 pr-4 py-2.5 bg-card border border-border rounded-xl text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
              />
            </div>
            <button
              onClick={() => handleSearch()}
              disabled={searchMutation.isPending || !searchTerm.trim()}
              className="px-4 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded-xl text-sm font-semibold transition-colors flex items-center gap-2"
            >
              {searchMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Search"}
            </button>
          </div>
          {/* History pills */}
          {history.length > 0 && (
            <div className="flex gap-2 mt-2 overflow-x-auto pb-1 scrollbar-none">
              {history.slice(0, 8).map((h) => (
                <button
                  key={h}
                  onClick={() => handleSearch(h)}
                  className="flex-shrink-0 px-2.5 py-1 bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground rounded-full text-xs transition-colors"
                >
                  {h}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Body: two-column layout when results exist */}
      <div className="flex-1 overflow-hidden flex gap-0">
        {/* Left: Results column */}
        <div
          className={cn(
            "overflow-y-auto px-4 py-4 transition-all",
            hasResults ? "flex-1 min-w-0" : "w-full"
          )}
        >
          <div className="max-w-2xl mx-auto space-y-4">
            {/* Empty state */}
            {!hasResults && !searchMutation.isPending && (
              <div className="text-center py-12">
                <p className="text-5xl mb-4">🔍</p>
                <p className="text-lg font-semibold text-foreground mb-2">Search the French dictionary</p>
                <p className="text-sm text-muted-foreground">
                  Type a word, phrase, or question like "how do I say hello?"
                </p>
              </div>
            )}

            {/* Loading */}
            {searchMutation.isPending && (
              <div className="flex items-center justify-center py-16">
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">Looking up…</p>
                </div>
              </div>
            )}

            {/* Not found + spelling suggestions */}
            {lastNotFoundTerm && (
              <div className="space-y-3">
                <div className="bg-card border border-border rounded-2xl p-5 text-center">
                  <p className="text-3xl mb-2">🤷</p>
                  <p className="text-foreground font-semibold">"{lastNotFoundTerm}" wasn't found</p>
                  <p className="text-muted-foreground text-sm mt-1">
                    This doesn't appear to be a French word or phrase.
                  </p>
                </div>
                {suggestMutation.isPending ? (
                  <div className="flex items-center gap-2 px-4 py-3 bg-muted/30 rounded-xl text-sm text-muted-foreground">
                    <Sparkles className="w-4 h-4 animate-pulse text-primary" />
                    <span>Looking for similar words…</span>
                  </div>
                ) : (
                  <SuggestionsBanner
                    term={lastNotFoundTerm}
                    suggestions={suggestions}
                    onSearch={handleSearch}
                  />
                )}
              </div>
            )}

            {/* Results list */}
            {results.map((result, i) => (
              <div key={i}>
                {result.type === "word" && (result as DictWordResult).found && (
                  <WordResult
                    result={result as DictWordResult}
                    onAdd={(term, translation, kind) => handleAdd(term, translation, kind, i)}
                    isAdded={!!addedMap[i]}
                    onRemove={() => handleRemove(i)}
                    isSelected={selectedIdx === i}
                    onSelect={() => setSelectedIdx(selectedIdx === i ? null : i)}
                  />
                )}
                {result.type === "phrase" && (
                  <PhraseResult
                    result={result as DictPhraseResult}
                    onAdd={(term, translation, kind) => handleAdd(term, translation, kind, i)}
                    isAdded={!!addedMap[i]}
                    onRemove={() => handleRemove(i)}
                    isSelected={selectedIdx === i}
                    onSelect={() => setSelectedIdx(selectedIdx === i ? null : i)}
                  />
                )}
                {result.type === "question" && (
                  <QuestionResult
                    result={result as DictQuestionResult}
                    isSelected={selectedIdx === i}
                    onSelect={() => setSelectedIdx(selectedIdx === i ? null : i)}
                  />
                )}
                {result.type === "error" && (
                  <div className="bg-destructive/10 border border-destructive/30 rounded-2xl p-4 text-sm text-destructive">
                    {(result as any).message}
                  </div>
                )}
              </div>
            ))}

            {/* Hint to use chat when results exist but none selected */}
            {hasResults && !searchMutation.isPending && selectedIdx === null && (
              <div className="flex items-center gap-2 px-4 py-3 bg-muted/20 border border-border/50 rounded-xl text-xs text-muted-foreground">
                <MousePointerClick className="w-3.5 h-3.5 flex-shrink-0" />
                <span>Click any card to select it, then ask follow-up questions in the chat panel →</span>
              </div>
            )}
          </div>
        </div>

        {/* Right: Context chat panel — shown when there are results */}
        {hasResults && (
          <div className="w-80 flex-shrink-0 border-l border-border p-3 flex flex-col min-h-0">
            <ContextChatPanel
              vocabContext={selectedVocabContext}
              onClearContext={() => setSelectedIdx(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

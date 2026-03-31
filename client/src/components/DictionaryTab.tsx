import { useState, useRef, useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { DictResult, DictWordResult, DictPhraseResult, DictQuestionResult } from "@/types";
import { Volume2, Plus, Loader2, Search, ChevronDown, ChevronUp, MessageCircle, Send, Sparkles, RefreshCw, ArrowLeftRight, BookmarkCheck, BookmarkX } from "lucide-react";
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

function WordResult({ result, onAdd, isAdded, onRemove }: {
  result: DictWordResult;
  onAdd: (term: string, translation: string, kind: "word" | "phrase") => void;
  isAdded?: boolean;
  onRemove?: () => void;
}) {
  const [showConjugations, setShowConjugations] = useState(false);
  const [showSynonyms, setShowSynonyms] = useState(false);
  const [showConfusing, setShowConfusing] = useState(false);

  if (!result.found) {
    return null; // Handled by parent with suggestions UI
  }

  const TENSE_LABELS: Record<string, string> = {
    present: "Présent",
    imparfait: "Imparfait",
    passeCompose: "Passé Composé",
    futurSimple: "Futur Simple",
    conditionnel: "Conditionnel",
    subjonctif: "Subjonctif",
  };

  return (
    <div className="space-y-3">
      {/* Main card */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-2xl font-bold text-foreground">{result.word}</h2>
              <button onClick={() => pronounce(result.word)} className="p-1.5 rounded-full bg-primary/15 hover:bg-primary/25 text-primary transition-colors">
                <Volume2 className="w-4 h-4" />
              </button>
            </div>
            {result.pronunciation && <p className="text-sm text-muted-foreground font-mono">[{result.pronunciation}]</p>}
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
                onClick={onRemove}
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
                onClick={() => onAdd(result.word, result.translation, classifyKind(result.word))}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/15 hover:bg-primary/25 text-primary rounded-lg text-xs font-semibold transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            )}
          </div>
        </div>

        <p className="text-lg text-foreground font-medium mb-3">{result.translation}</p>

        {result.isConjugated && result.baseForm && (
          <div className="bg-muted/50 rounded-xl p-3 mb-3 text-sm">
            <span className="text-muted-foreground">Conjugated form of </span>
            <button onClick={() => pronounce(result.baseForm)} className="text-primary font-semibold hover:underline">{result.baseForm}</button>
            {result.formExplanation && <span className="text-muted-foreground"> — {result.formExplanation}</span>}
          </div>
        )}

        {/* ── Reflexive verb banner ── */}
        {(result.isReflexive || result.hasReflexiveForm) && (
          <div className="border border-amber-500/40 bg-amber-500/10 rounded-xl p-4 mb-3 space-y-2">
            {/* Header row */}
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

            {/* Reflexive ↔ non-reflexive form comparison */}
            {(result.reflexiveForm || result.nonReflexiveForm) && (
              <div className="flex items-center gap-3 text-sm">
                {result.nonReflexiveForm && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground text-xs">Base:</span>
                    <button
                      onClick={() => pronounce(result.nonReflexiveForm!)}
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
                      onClick={() => pronounce(result.reflexiveForm!)}
                      className="font-bold text-amber-300 hover:text-amber-200 transition-colors"
                    >
                      {result.reflexiveForm}
                    </button>
                    <Volume2 className="w-3 h-3 text-muted-foreground" />
                  </div>
                )}
              </div>
            )}

            {/* Explanation */}
            {result.reflexiveExplanation && (
              <p className="text-sm text-amber-100/80 leading-relaxed">{result.reflexiveExplanation}</p>
            )}

            {/* Meaning difference note */}
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

        {/* Examples */}
        {result.examples?.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Examples</p>
            {result.examples.map((ex, i) => (
              <div key={i} className="bg-muted/40 rounded-xl p-3">
                <div className="flex items-start gap-2">
                  <button onClick={() => pronounce(ex.fr)} className="mt-0.5 p-1 rounded-full hover:bg-primary/15 text-muted-foreground hover:text-primary transition-colors flex-shrink-0">
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
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
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
                        <button onClick={() => pronounce(f)} className="p-0.5 rounded hover:bg-primary/15 text-muted-foreground hover:text-primary transition-colors">
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

function PhraseResult({ result, onAdd }: { result: DictPhraseResult; onAdd: (term: string, translation: string, kind: "word" | "phrase") => void }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-xl font-bold text-foreground">{result.phrase}</h2>
            <button onClick={() => pronounce(result.phrase)} className="p-1.5 rounded-full bg-primary/15 hover:bg-primary/25 text-primary transition-colors">
              <Volume2 className="w-4 h-4" />
            </button>
          </div>
          {result.pronunciation && <p className="text-sm text-muted-foreground font-mono">[{result.pronunciation}]</p>}
        </div>
        <button
          onClick={() => onAdd(result.phrase, result.translation, "phrase")}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/15 hover:bg-primary/25 text-primary rounded-lg text-xs font-semibold transition-colors flex-shrink-0"
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>
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
                <button onClick={() => pronounce(ex.fr)} className="mt-0.5 p-1 rounded-full hover:bg-primary/15 text-muted-foreground hover:text-primary transition-colors flex-shrink-0">
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

function QuestionResult({ result }: { result: DictQuestionResult }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
      <div>
        <p className="text-xs font-bold text-primary uppercase tracking-wider mb-1">Question</p>
        <p className="text-lg font-semibold text-foreground">{result.question}</p>
      </div>
      <div className="bg-muted/40 rounded-xl p-4">
        <p className="text-sm text-foreground leading-relaxed">{result.answer}</p>
      </div>
      {result.options?.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Related expressions</p>
          {result.options.map((opt, i) => (
            <div key={i} className="flex items-start gap-3 bg-muted/30 rounded-xl p-3">
              <button onClick={() => pronounce(opt.french)} className="mt-0.5 p-1 rounded-full hover:bg-primary/15 text-muted-foreground hover:text-primary transition-colors flex-shrink-0">
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

// ─── Tutor Quick-Ask ──────────────────────────────────────────────────────────
function TutorQuickAsk() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const utils = trpc.useUtils();

  const chatMutation = trpc.tutor.chat.useMutation({
    onSuccess: (data) => {
      setAnswer(data.reply);
      setQuestion("");
      utils.tutor.history.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleAsk = () => {
    const q = question.trim();
    if (!q) return;
    setAnswer(null);
    chatMutation.mutate({ message: q });
  };

  const QUICK_PROMPTS = [
    "How do I conjugate avoir?",
    "What's the difference between savoir and connaître?",
    "When do I use passé composé vs imparfait?",
    "How do I form the subjunctive?",
  ];

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-muted/30 transition-colors"
      >
        <div className="p-1.5 rounded-lg bg-primary/15">
          <MessageCircle className="w-3.5 h-3.5 text-primary" />
        </div>
        <span className="text-sm font-semibold text-foreground flex-1 text-left">Ask your French tutor</span>
        <span className="text-xs text-muted-foreground mr-1">Quick question</span>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-3">
          {/* Quick prompt chips */}
          <div className="flex flex-wrap gap-1.5">
            {QUICK_PROMPTS.map((p) => (
              <button
                key={p}
                onClick={() => { setQuestion(p); }}
                className="text-xs px-2.5 py-1 bg-muted/60 hover:bg-primary/15 hover:text-primary text-muted-foreground rounded-full transition-colors"
              >
                {p}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAsk()}
              placeholder="Ask anything about French grammar, vocabulary, or usage…"
              className="flex-1 px-3 py-2 bg-background border border-border rounded-xl text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
            />
            <button
              onClick={handleAsk}
              disabled={!question.trim() || chatMutation.isPending}
              className="p-2.5 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded-xl transition-colors flex-shrink-0"
            >
              {chatMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
          {chatMutation.isPending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Sparkles className="w-3.5 h-3.5 animate-pulse text-primary" />
              <span>Thinking…</span>
            </div>
          )}
          {answer && (
            <div className="bg-muted/30 border border-border/50 rounded-xl p-4 text-sm prose prose-sm prose-invert max-w-none">
              <Streamdown>{answer}</Streamdown>
            </div>
          )}
        </div>
      )}
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
        <div>
          <p className="text-sm font-semibold text-amber-300">
            "{term}" wasn't found — did you mean:
          </p>
        </div>
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
            <div className={cn(
              "text-xs px-1.5 py-0.5 rounded-full font-semibold ml-1",
              s.confidence === "high" ? "bg-emerald-900/60 text-emerald-400" : "bg-amber-900/60 text-amber-400"
            )}>
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
  const inputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  const suggestMutation = trpc.dictionary.suggest.useMutation({
    onSuccess: (data) => setSuggestions(data.suggestions),
  });

  const searchMutation = trpc.dictionary.search.useMutation({
    onSuccess: (data) => {
      const result = data as DictResult;
      // If word not found, trigger suggestions in parallel
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

  // Map: result index → { id, term } for words that have been added to the library
  const [addedMap, setAddedMap] = useState<Record<number, { id: number; term: string }>>({});

  const addMutation = trpc.vocab.add.useMutation({
    onSuccess: (data, variables, context) => {
      utils.vocab.list.invalidate();
    },
    onError: () => toast.error("Failed to add word"),
  });

  const deleteMutation = trpc.vocab.delete.useMutation({
    onSuccess: () => {
      toast.success("Removed from library");
      utils.vocab.list.invalidate();
    },
    onError: () => toast.error("Failed to remove word"),
  });

  // Auto-add word to library when a new found result arrives
  useEffect(() => {
    if (results.length === 0) return;
    const latest = results[0];
    if (latest.type === "word" && (latest as DictWordResult).found) {
      const wr = latest as DictWordResult;
      // Only auto-add if not already tracked
      if (addedMap[0] && addedMap[0].term === wr.word) return;
      addMutation.mutate(
        { term: wr.word, translation: wr.translation, entryKind: classifyKind(wr.word) },
        {
          onSuccess: (data) => {
            setAddedMap((prev) => ({ ...prev, [0]: { id: data.id, term: wr.word } }));
          },
        }
      );
    } else if (latest.type === "phrase" && (latest as DictPhraseResult).found) {
      const pr = latest as DictPhraseResult;
      if (addedMap[0] && addedMap[0].term === pr.phrase) return;
      addMutation.mutate(
        { term: pr.phrase, translation: pr.translation, entryKind: "phrase" },
        {
          onSuccess: (data) => {
            setAddedMap((prev) => ({ ...prev, [0]: { id: data.id, term: pr.phrase } }));
          },
        }
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results]);

  const handleSearch = useCallback((overrideTerm?: string) => {
    const term = (overrideTerm ?? searchTerm).trim();
    if (!term) return;
    if (overrideTerm) setSearchTerm(overrideTerm);
    setSuggestions([]);
    setLastNotFoundTerm("");
    if (!history.includes(term)) setHistory((prev) => [term, ...prev.slice(0, 19)]);
    searchMutation.mutate({ term });
  }, [searchTerm, history, searchMutation]);

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

  return (
    <div className="flex flex-col h-full">
      {/* Search header */}
      <div className="flex-shrink-0 border-b border-border bg-background/80 backdrop-blur-sm px-4 py-3">
        <div className="max-w-2xl mx-auto">
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

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="max-w-2xl mx-auto space-y-4">

          {/* Empty state */}
          {results.length === 0 && !searchMutation.isPending && (
            <>
              <div className="text-center py-12">
                <p className="text-5xl mb-4">🔍</p>
                <p className="text-lg font-semibold text-foreground mb-2">Search the French dictionary</p>
                <p className="text-sm text-muted-foreground">Type a word, phrase, or question like "how do I say hello?"</p>
              </div>
              {/* Tutor quick-ask shown prominently on empty state */}
              <TutorQuickAsk />
            </>
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

          {/* Spelling suggestions banner — shown when word not found */}
          {lastNotFoundTerm && (
            <div className="space-y-3">
              {/* Not found card */}
              <div className="bg-card border border-border rounded-2xl p-5 text-center">
                <p className="text-3xl mb-2">🤷</p>
                <p className="text-foreground font-semibold">"{lastNotFoundTerm}" wasn't found</p>
                <p className="text-muted-foreground text-sm mt-1">This doesn't appear to be a French word or phrase.</p>
              </div>
              {/* Suggestions */}
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
                />
              )}
              {result.type === "phrase" && <PhraseResult result={result as DictPhraseResult} onAdd={(term, translation, kind) => handleAdd(term, translation, kind, i)} />}
              {result.type === "question" && <QuestionResult result={result as DictQuestionResult} />}
              {result.type === "error" && (
                <div className="bg-destructive/10 border border-destructive/30 rounded-2xl p-4 text-sm text-destructive">
                  {(result as any).message}
                </div>
              )}
            </div>
          ))}

          {/* Tutor quick-ask at bottom when results exist */}
          {results.length > 0 && !searchMutation.isPending && (
            <TutorQuickAsk />
          )}
        </div>
      </div>
    </div>
  );
}

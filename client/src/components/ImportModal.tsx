import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { ImportItem } from "@/types";
import { X, ChevronDown, ChevronUp, Upload, ArrowLeft, FileText, Link2, ClipboardPaste, CheckCircle2, SkipForward, Layers, ListChecks, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ImportModalProps {
  onClose: () => void;
  onImport: (items: ImportItem[], lessonName: string) => void;
}

function parseCSV(text: string): ImportItem[] {
  const lines = text.split("\n").filter((l) => l.trim());
  const header = lines[0]?.toLowerCase() ?? "";
  if (!header.includes("french") && !header.includes("english")) return [];
  const items: ImportItem[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].match(/("([^"]*(?:""[^"]*)*)"|[^,]*),?/g)
      ?.map((p) => p.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"')) ?? [];
    if (parts.length >= 2 && parts[0].trim()) {
      const term = parts[0].trim();
      items.push({
        term,
        translation: (parts[1] ?? "").trim(),
        kind: term.split(/\s+/).length >= 3 ? "phrase" : "word",
      });
    }
  }
  return items;
}

type Phase = "pick" | "loading" | "save-choice" | "review" | "done";
type InputMode = "paste" | "gdoc" | "csv";

export default function ImportModal({ onClose, onImport }: ImportModalProps) {
  const [phase, setPhase] = useState<Phase>("pick");
  const [inputMode, setInputMode] = useState<InputMode>("paste");
  const [pasteText, setPasteText] = useState("");
  const [gdocUrl, setGdocUrl] = useState("");
  const [gdocPreview, setGdocPreview] = useState("");
  const [lessonName, setLessonName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [showInstructions, setShowInstructions] = useState(false);
  const [items, setItems] = useState<ImportItem[]>([]);
  const [reviewIdx, setReviewIdx] = useState(0);
  const [kept, setKept] = useState<ImportItem[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [corrections, setCorrections] = useState<{ original: string; fixed: string; note: string }[]>([]);
  const [showCorrections, setShowCorrections] = useState(false);
  const [history, setHistory] = useState<{ idx: number; keptSnap: ImportItem[] }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const afterExtract = (
    rawItems: { term: string; translation: string; kind: string }[],
    rawCorrections: { original: string; fixed: string; note: string }[],
    preview?: string,
  ) => {
    const tagged: ImportItem[] = rawItems.map((item) => ({
      term: item.term,
      translation: item.translation,
      kind: (item.kind === "phrase" ? "phrase" : "word") as "word" | "phrase",
    }));
    if (!tagged.length) {
      setError("No French vocabulary found. Try a different source.");
      setPhase("pick");
      return;
    }
    setItems(tagged);
    setCorrections(rawCorrections ?? []);
    setGdocPreview(preview ?? "");
    setReviewIdx(0);
    setKept([]);
    setSkipped(0);
    setPhase("save-choice");
  };

  const extractMutation = trpc.import.extractFromText.useMutation({
    onSuccess: (data) => afterExtract(data.items as any, data.corrections ?? []),
    onError: (err) => { setError(err.message); setPhase("pick"); },
  });

  const gdocMutation = trpc.import.extractFromGoogleDoc.useMutation({
    onSuccess: (data) => afterExtract(data.items as any, data.corrections ?? [], data.docPreview),
    onError: (err) => { setError(err.message); setPhase("pick"); },
  });

  const handlePaste = () => {
    if (!pasteText.trim()) return;
    setError(null);
    setPhase("loading");
    extractMutation.mutate({ text: pasteText, instructions: instructions || undefined });
  };

  const handleGdoc = () => {
    const url = gdocUrl.trim();
    if (!url) return;
    if (!url.includes("docs.google.com/document")) {
      setError("Please enter a valid Google Docs URL (e.g. https://docs.google.com/document/d/...)");
      return;
    }
    setError(null);
    setPhase("loading");
    gdocMutation.mutate({ url, instructions: instructions || undefined });
  };

  const handleCSV = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseCSV(text);
      if (!parsed.length) { setError("No valid words found in CSV. Ensure columns are French and English."); return; }
      afterExtract(parsed as any, []);
    };
    reader.readAsText(file);
  };

  // Save all at once
  const handleSaveAll = () => {
    onImport(items, lessonName.trim());
    onClose();
    toast.success(`${items.length} words added to your library!`);
  };

  // Start one-by-one confirmation
  const handleConfirmOneByOne = () => {
    setKept([]);
    setSkipped(0);
    setHistory([]);
    setReviewIdx(0);
    setPhase("review");
  };

  const advance = () => {
    if (reviewIdx + 1 >= items.length) setPhase("done");
    else setReviewIdx((i) => i + 1);
  };

  const handleKeep = () => {
    setHistory((h) => [...h, { idx: reviewIdx, keptSnap: kept }]);
    setKept((prev) => [...prev, items[reviewIdx]]);
    advance();
  };

  const handleSkip = () => {
    setHistory((h) => [...h, { idx: reviewIdx, keptSnap: kept }]);
    setSkipped((s) => s + 1);
    advance();
  };

  const handleBack = () => {
    if (!history.length) return;
    const last = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setReviewIdx(last.idx);
    setKept(last.keptSnap);
  };

  const handleFinish = () => {
    onImport(kept, lessonName.trim());
    onClose();
  };

  const currentItem = items[reviewIdx];

  const MODES: { id: InputMode; label: string; icon: React.ReactNode }[] = [
    { id: "paste", label: "Paste Text", icon: <ClipboardPaste className="w-4 h-4" /> },
    { id: "gdoc", label: "Google Docs", icon: <Link2 className="w-4 h-4" /> },
    { id: "csv", label: "CSV File", icon: <FileText className="w-4 h-4" /> },
  ];

  const CorrectionsBar = () => corrections.length > 0 ? (
    <div className="border-b border-amber-800/40 bg-amber-950/30 flex-shrink-0">
      <button
        onClick={() => setShowCorrections(!showCorrections)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-amber-950/50 transition-colors"
      >
        <span className="text-xs font-semibold text-amber-300">✏️ {corrections.length} correction{corrections.length !== 1 ? "s" : ""} applied</span>
        <span className="text-amber-500 text-xs">{showCorrections ? "▲" : "▼"}</span>
      </button>
      {showCorrections && (
        <div className="px-4 pb-3 space-y-1">
          {corrections.map((c, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="text-red-400 line-through font-mono">{c.original}</span>
              <span className="text-muted-foreground">→</span>
              <span className="text-emerald-400 font-mono font-semibold">{c.fixed}</span>
              {c.note && <span className="text-muted-foreground italic">({c.note})</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  ) : null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-background border border-border rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-foreground">Import Vocabulary</h2>
            {(phase === "save-choice" || phase === "review" || phase === "done") && (
              <p className="text-xs text-muted-foreground mt-0.5">{items.length} words extracted</p>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── PICK PHASE ── */}
        {phase === "pick" && (
          <div className="p-5 flex-1 overflow-y-auto space-y-4">
            {error && (
              <div className="bg-destructive/10 border border-destructive/30 rounded-xl px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}

            {/* Mode selector */}
            <div className="grid grid-cols-3 gap-2">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  onClick={() => { setInputMode(m.id); setError(null); }}
                  className={cn(
                    "flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl border text-xs font-semibold transition-all",
                    inputMode === m.id
                      ? "bg-primary/15 border-primary/50 text-primary"
                      : "bg-muted/30 border-border text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  {m.icon}
                  {m.label}
                </button>
              ))}
            </div>

            {/* Lesson name */}
            <input
              value={lessonName}
              onChange={(e) => setLessonName(e.target.value)}
              placeholder="Lesson name (optional)"
              className="w-full px-3 py-2 bg-card border border-border rounded-xl text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
            />

            {/* ── Paste mode ── */}
            {inputMode === "paste" && (
              <div className="space-y-3">
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder={"Paste your lesson notes, vocabulary list, or any French text here…\n\nAI will extract all French words and phrases, correct typos, and suggest translations."}
                  rows={7}
                  className="w-full px-3 py-2.5 bg-card border border-border rounded-xl text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all resize-none"
                />
                <button
                  onClick={() => setShowInstructions(!showInstructions)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showInstructions ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  Custom instructions (optional)
                </button>
                {showInstructions && (
                  <textarea
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    placeholder="e.g. Focus on verbs only. Skip words I already know like bonjour."
                    rows={2}
                    className="w-full px-3 py-2 bg-card border border-border rounded-xl text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all resize-none"
                  />
                )}
                <button
                  onClick={handlePaste}
                  disabled={!pasteText.trim()}
                  className="w-full py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded-xl text-sm font-semibold transition-colors"
                >
                  Extract Vocabulary with AI
                </button>
              </div>
            )}

            {/* ── Google Docs mode ── */}
            {inputMode === "gdoc" && (
              <div className="space-y-3">
                <div className="bg-blue-950/30 border border-blue-800/40 rounded-xl p-3 text-xs text-blue-300 space-y-1">
                  <p className="font-semibold text-blue-200">How to share your Google Doc:</p>
                  <ol className="list-decimal list-inside space-y-0.5 text-blue-300/80">
                    <li>Open your Google Doc</li>
                    <li>Click <strong>Share</strong> → <strong>Change to anyone with the link</strong></li>
                    <li>Set permission to <strong>Viewer</strong></li>
                    <li>Copy and paste the link below</li>
                  </ol>
                </div>
                <input
                  value={gdocUrl}
                  onChange={(e) => setGdocUrl(e.target.value)}
                  placeholder="https://docs.google.com/document/d/..."
                  className="w-full px-3 py-2.5 bg-card border border-border rounded-xl text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all font-mono"
                />
                <button
                  onClick={() => setShowInstructions(!showInstructions)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showInstructions ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  Custom instructions (optional)
                </button>
                {showInstructions && (
                  <textarea
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    placeholder="e.g. Focus on verbs only. Skip words I already know like bonjour."
                    rows={2}
                    className="w-full px-3 py-2 bg-card border border-border rounded-xl text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all resize-none"
                  />
                )}
                <button
                  onClick={handleGdoc}
                  disabled={!gdocUrl.trim()}
                  className="w-full py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  <Link2 className="w-4 h-4" />
                  Import from Google Docs
                </button>
              </div>
            )}

            {/* ── CSV mode ── */}
            {inputMode === "csv" && (
              <div className="space-y-3">
                <div className="bg-muted/30 rounded-xl p-3 text-xs text-muted-foreground space-y-1">
                  <p className="font-semibold text-foreground">CSV format:</p>
                  <p>First row must be headers with columns <code className="bg-muted px-1 rounded">French</code> and <code className="bg-muted px-1 rounded">English</code></p>
                  <pre className="font-mono text-xs mt-1 text-muted-foreground">French,English{"\n"}bonjour,hello{"\n"}merci,thank you</pre>
                </div>
                <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCSV(f); }} />
                <button
                  onClick={() => fileRef.current?.click()}
                  className="w-full py-8 border-2 border-dashed border-border hover:border-primary/50 rounded-xl flex flex-col items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Upload className="w-6 h-6" />
                  <span className="text-sm font-semibold">Click to upload CSV</span>
                  <span className="text-xs">or drag and drop</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── LOADING PHASE ── */}
        {phase === "loading" && (
          <div className="flex-1 flex flex-col items-center justify-center p-8 gap-4">
            <div className="w-16 h-16 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
            <div className="text-center">
              <p className="text-base font-semibold text-foreground">
                {inputMode === "gdoc" ? "Fetching your Google Doc…" : "Extracting vocabulary…"}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {inputMode === "gdoc"
                  ? "Reading document, correcting typos, and extracting French vocabulary"
                  : "AI is correcting typos and identifying French words and phrases"}
              </p>
            </div>
          </div>
        )}

        {/* ── SAVE CHOICE PHASE ── */}
        {phase === "save-choice" && (
          <div className="flex-1 overflow-y-auto flex flex-col">
            <CorrectionsBar />
            <div className="p-5 space-y-4 flex-1">
              {/* Doc preview for Google Docs */}
              {gdocPreview && (
                <div className="bg-muted/30 border border-border rounded-xl p-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Document preview</p>
                  <p className="text-xs text-muted-foreground font-mono leading-relaxed line-clamp-3">{gdocPreview}</p>
                </div>
              )}

              {/* Summary */}
              <div className="text-center py-2">
                <p className="text-4xl font-bold text-foreground">{items.length}</p>
                <p className="text-sm text-muted-foreground">words & phrases extracted</p>
              </div>

              {/* Word preview */}
              <div className="bg-muted/20 border border-border rounded-xl overflow-hidden max-h-44 overflow-y-auto">
                {items.slice(0, 25).map((item, i) => (
                  <div key={i} className={cn("flex items-center justify-between px-3 py-2 text-sm", i % 2 === 0 ? "" : "bg-muted/10")}>
                    <span className="font-medium text-foreground">{item.term}</span>
                    <span className="text-muted-foreground text-xs truncate ml-2">{item.translation}</span>
                  </div>
                ))}
                {items.length > 25 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground text-center border-t border-border">
                    +{items.length - 25} more words
                  </div>
                )}
              </div>

              <p className="text-sm font-semibold text-foreground text-center">How would you like to save these?</p>

              {/* Two save options */}
              <div className="space-y-3">
                <button
                  onClick={handleSaveAll}
                  className="w-full flex items-start gap-3 p-4 bg-primary/10 hover:bg-primary/15 border border-primary/30 rounded-xl transition-colors text-left"
                >
                  <div className="p-2 bg-primary/20 rounded-lg flex-shrink-0 mt-0.5">
                    <Layers className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-foreground">Save all {items.length} words at once</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Add everything to your library immediately — fastest option</p>
                  </div>
                </button>

                <button
                  onClick={handleConfirmOneByOne}
                  className="w-full flex items-start gap-3 p-4 bg-muted/30 hover:bg-muted/50 border border-border rounded-xl transition-colors text-left"
                >
                  <div className="p-2 bg-muted rounded-lg flex-shrink-0 mt-0.5">
                    <ListChecks className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-foreground">Review one by one</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Go through each word and choose to keep or skip — more control</p>
                  </div>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── REVIEW PHASE ── */}
        {phase === "review" && currentItem && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <CorrectionsBar />
            <div className="p-5 flex-1 overflow-y-auto">
              {/* Progress */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <button onClick={handleBack} disabled={!history.length} className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30">
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <span className="text-sm text-muted-foreground">{reviewIdx + 1} / {items.length}</span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-emerald-400 font-semibold">{kept.length} kept</span>
                  <span className="text-muted-foreground">{skipped} skipped</span>
                </div>
              </div>
              <div className="h-1 bg-muted rounded-full mb-5">
                <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${(reviewIdx / items.length) * 100}%` }} />
              </div>

              {/* Card */}
              <div className="bg-muted/40 border border-border rounded-2xl p-6 text-center mb-5">
                <span className={cn(
                  "inline-block text-xs px-2.5 py-1 rounded-full font-bold mb-3",
                  currentItem.kind === "phrase" ? "bg-violet-500/15 text-violet-400" : "bg-primary/15 text-primary"
                )}>
                  {currentItem.kind === "phrase" ? "📝 Phrase" : "📖 Word"}
                </span>
                <p className="text-2xl font-bold text-foreground mb-2">{currentItem.term}</p>
                <p className="text-muted-foreground">{currentItem.translation}</p>
              </div>

              <div className="flex gap-3">
                <button onClick={handleSkip} className="flex-1 py-2.5 bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-1.5">
                  <SkipForward className="w-4 h-4" /> Skip
                </button>
                <button onClick={handleKeep} className="flex-1 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" /> Keep
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── DONE PHASE ── */}
        {phase === "done" && (
          <div className="flex-1 flex flex-col items-center justify-center p-8 gap-4 text-center">
            <p className="text-5xl">🎉</p>
            <div>
              <p className="text-xl font-bold text-foreground">{kept.length} words selected</p>
              <p className="text-sm text-muted-foreground mt-1">{skipped} skipped</p>
            </div>
            <div className="flex gap-3 w-full">
              <button
                onClick={() => { setPhase("review"); setReviewIdx(0); setKept([]); setSkipped(0); }}
                className="flex-1 py-2.5 bg-muted/50 hover:bg-muted text-muted-foreground rounded-xl text-sm font-semibold transition-colors"
              >
                Start over
              </button>
              <button
                onClick={handleFinish}
                disabled={!kept.length}
                className="flex-1 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded-xl text-sm font-semibold transition-colors"
              >
                Add {kept.length} to Library
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

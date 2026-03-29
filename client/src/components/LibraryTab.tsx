import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { VocabEntry, SidebarTab, ImportItem } from "@/types";
import { Star, Trash2, Search, Download, Upload, Loader2, ChevronDown, ChevronRight, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import ImportModal from "./ImportModal";

function todayKey() { return new Date().toISOString().split("T")[0]; }
function yesterdayKey() { return new Date(Date.now() - 86400000).toISOString().split("T")[0]; }

/** Format a dateKey (YYYY-MM-DD) or a custom label string for display */
function fmtDateLabel(dateKey: string) {
  // If it looks like a YYYY-MM-DD date, format it nicely
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    if (dateKey === todayKey()) return "Today";
    if (dateKey === yesterdayKey()) return "Yesterday";
    return new Date(dateKey + "T12:00:00").toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
  }
  // Custom label — show as-is
  return dateKey;
}

function isDue(w: VocabEntry) {
  if (w.starred) return true;
  const seen = w.quizCount ?? 0;
  if (seen === 0) return true;
  const last = w.lastQuizzed ? new Date(w.lastQuizzed) : new Date(0);
  const days = (Date.now() - last.getTime()) / 86400000;
  return seen === 1 ? days >= 1 : days >= 3;
}

function exportCSV(words: VocabEntry[]) {
  const header = "French,English,Type,Date\n";
  const rows = words
    .map((w) => `"${w.term.replace(/"/g, '""')}","${w.translation.replace(/"/g, '""')}","${w.entryKind}","${w.dateKey}"`)
    .join("\n");
  const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "french_vocabulary.csv";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

// ─── Group header with collapse + rename ──────────────────────────────────────
function GroupHeader({
  dateKey,
  wordCount,
  dueCount,
  isOpen,
  onToggle,
  onRename,
}: {
  dateKey: string;
  wordCount: number;
  dueCount: number;
  isOpen: boolean;
  onToggle: () => void;
  onRename: (oldKey: string, newKey: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(fmtDateLabel(dateKey));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(fmtDateLabel(dateKey));
      setTimeout(() => inputRef.current?.select(), 50);
    }
  }, [editing, dateKey]);

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === fmtDateLabel(dateKey)) { setEditing(false); return; }
    // If the new name looks like a date, normalise it; otherwise use as custom label
    onRename(dateKey, trimmed);
    setEditing(false);
  };

  const cancel = () => { setEditing(false); setDraft(fmtDateLabel(dateKey)); };

  return (
    <div
      className="px-4 py-3 border-b border-border flex items-center gap-2 group/header"
      onClick={(e) => { if (!editing) { e.stopPropagation(); onToggle(); } }}
    >
      {/* Collapse toggle */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
      >
        {isOpen
          ? <ChevronDown className="w-3.5 h-3.5" />
          : <ChevronRight className="w-3.5 h-3.5" />}
      </button>

      {/* Label / edit input */}
      {editing ? (
        <div className="flex-1 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") cancel(); }}
            className="flex-1 text-xs font-bold uppercase tracking-wider bg-muted/60 border border-primary/50 rounded-lg px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Group name or YYYY-MM-DD"
          />
          <button onClick={commit} className="p-1 rounded-md text-emerald-400 hover:bg-emerald-500/10 transition-colors flex-shrink-0">
            <Check className="w-3.5 h-3.5" />
          </button>
          <button onClick={cancel} className="p-1 rounded-md text-muted-foreground hover:bg-muted transition-colors flex-shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <>
          <p className="flex-1 text-xs font-bold text-muted-foreground uppercase tracking-wider cursor-pointer select-none">
            {fmtDateLabel(dateKey)}
          </p>
          <button
            onClick={(e) => { e.stopPropagation(); setEditing(true); }}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors opacity-0 group-hover/header:opacity-100 flex-shrink-0"
            title="Rename group"
          >
            <Pencil className="w-3 h-3" />
          </button>
        </>
      )}

      <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
        {dueCount > 0 && (
          <span className="text-xs px-1.5 py-0.5 rounded-full bg-accent/20 text-accent font-semibold">{dueCount} due</span>
        )}
        <p className="text-xs text-muted-foreground">{wordCount} items</p>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function LibraryTab({ setActiveTab }: { setActiveTab: (tab: SidebarTab) => void }) {
  const [search, setSearch] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [filterStarred, setFilterStarred] = useState(false);
  // Track which groups are collapsed; default: all open
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const utils = trpc.useUtils();

  const { data: words = [], isLoading } = trpc.vocab.list.useQuery();

  const deleteMutation = trpc.vocab.delete.useMutation({
    onError: () => toast.error("Failed to delete"),
  });

  const starMutation = trpc.vocab.toggleStar.useMutation({
    onMutate: async ({ id }) => {
      await utils.vocab.list.cancel();
      const prev = utils.vocab.list.getData();
      utils.vocab.list.setData(undefined, (old) =>
        old?.map((w) => (w.id === id ? { ...w, starred: !w.starred } : w))
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => { if (ctx?.prev) utils.vocab.list.setData(undefined, ctx.prev); },
    onSettled: () => utils.vocab.list.invalidate(),
  });

  const renameGroupMutation = trpc.vocab.renameGroup.useMutation({
    onMutate: async ({ oldDateKey, newDateKey }) => {
      await utils.vocab.list.cancel();
      const prev = utils.vocab.list.getData();
      // Optimistically update all words in the old group
      utils.vocab.list.setData(undefined, (old) =>
        old?.map((w) => w.dateKey === oldDateKey ? { ...w, dateKey: newDateKey } : w)
      );
      // Update collapsed state to track new key
      setCollapsed((c) => {
        const next = new Set(c);
        if (next.has(oldDateKey)) { next.delete(oldDateKey); next.add(newDateKey); }
        return next;
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) utils.vocab.list.setData(undefined, ctx.prev);
      toast.error("Failed to rename group");
    },
    onSuccess: () => {
      utils.vocab.list.invalidate();
      toast.success("Group renamed");
    },
  });

  const bulkAddMutation = trpc.vocab.bulkAdd.useMutation({
    onSuccess: (data) => {
      utils.vocab.list.invalidate();
      toast.success(`Added ${data.count} words to your library!`);
    },
    onError: () => toast.error("Import failed"),
  });

  const handleImport = (items: ImportItem[], lessonName: string) => {
    bulkAddMutation.mutate(
      items.map((item) => ({
        term: item.term,
        translation: item.translation,
        entryKind: (item.kind ?? item.entryKind ?? "word") as "word" | "phrase",
        lessonSource: lessonName || undefined,
        dateKey: item.dateKey ?? todayKey(),
      }))
    );
  };

  const handleDelete = (id: number) => {
    const prev = utils.vocab.list.getData();
    utils.vocab.list.setData(undefined, (old) => old?.filter((w) => w.id !== id));
    deleteMutation.mutate(
      { id },
      {
        onError: () => {
          if (prev) utils.vocab.list.setData(undefined, prev);
          toast.error("Failed to delete");
        },
      }
    );
  };

  const toggleCollapse = (key: string) => {
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const handleRename = (oldKey: string, newKey: string) => {
    if (oldKey === newKey) return;
    renameGroupMutation.mutate({ oldDateKey: oldKey, newDateKey: newKey });
  };

  // Filter and group
  const filtered = words.filter((w) => {
    if (filterStarred && !w.starred) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return w.term.toLowerCase().includes(q) || w.translation.toLowerCase().includes(q);
  });

  const grouped = filtered.reduce<Record<string, VocabEntry[]>>((acc, w) => {
    const key = w.dateKey;
    if (!acc[key]) acc[key] = [];
    acc[key].push(w);
    return acc;
  }, {});

  // Sort groups newest-first (YYYY-MM-DD sorts lexicographically; custom labels go last)
  const sortedGroups = Object.entries(grouped).sort(([a], [b]) => {
    const aIsDate = /^\d{4}-\d{2}-\d{2}$/.test(a);
    const bIsDate = /^\d{4}-\d{2}-\d{2}$/.test(b);
    if (aIsDate && bIsDate) return b.localeCompare(a);
    if (aIsDate) return -1;
    if (bIsDate) return 1;
    return a.localeCompare(b);
  });

  const dueCount = words.filter((w) => isDue(w)).length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-border bg-background/80 backdrop-blur-sm px-4 py-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search your library…"
              className="w-full pl-9 pr-4 py-2 bg-card border border-border rounded-xl text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFilterStarred(!filterStarred)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors",
                filterStarred ? "bg-accent/20 text-accent" : "bg-card border border-border text-muted-foreground hover:text-foreground"
              )}
            >
              <Star className="w-3.5 h-3.5" /> Starred
            </button>
            {dueCount > 0 && (
              <span className="px-2.5 py-1 rounded-full bg-primary/15 text-primary text-xs font-bold">
                {dueCount} due
              </span>
            )}
            <button
              onClick={() => exportCSV(words)}
              disabled={!words.length}
              className="flex items-center gap-1.5 px-3 py-2 bg-card border border-border hover:bg-muted/50 text-muted-foreground hover:text-foreground rounded-xl text-xs font-semibold transition-colors disabled:opacity-40"
            >
              <Download className="w-3.5 h-3.5" /> Export
            </button>
            <button
              onClick={() => setShowImport(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-primary/15 hover:bg-primary/25 text-primary rounded-xl text-xs font-semibold transition-colors"
            >
              <Upload className="w-3.5 h-3.5" /> Import
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : words.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-5xl mb-4">📚</p>
            <p className="text-lg font-semibold text-foreground mb-2">Your library is empty</p>
            <p className="text-sm text-muted-foreground mb-6">Search words in the Dictionary, or import from lesson notes.</p>
            <button
              onClick={() => setShowImport(true)}
              className="px-5 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-semibold transition-colors"
            >
              Import Lesson Notes
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">🔍</p>
            <p className="text-muted-foreground text-sm">No words match your search</p>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">{filtered.length} of {words.length} words</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setCollapsed(new Set(sortedGroups.map(([k]) => k)))}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Collapse all
                </button>
                <span className="text-muted-foreground/40">·</span>
                <button
                  onClick={() => setCollapsed(new Set())}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Expand all
                </button>
              </div>
            </div>

            {sortedGroups.map(([dateKey, dayWords]) => {
              const isOpen = !collapsed.has(dateKey);
              const groupDue = dayWords.filter(isDue).length;
              return (
                <div key={dateKey} className="bg-card border border-border rounded-2xl overflow-hidden">
                  <GroupHeader
                    dateKey={dateKey}
                    wordCount={dayWords.length}
                    dueCount={groupDue}
                    isOpen={isOpen}
                    onToggle={() => toggleCollapse(dateKey)}
                    onRename={handleRename}
                  />

                  {isOpen && (
                    <div className="divide-y divide-border/50">
                      {dayWords.map((w) => (
                        <div
                          key={w.id}
                          className="flex items-center gap-2 px-4 py-3 hover:bg-muted/20 transition-colors group"
                        >
                          <span className={cn(
                            "text-xs px-2 py-0.5 rounded-full font-bold flex-shrink-0",
                            w.entryKind === "phrase"
                              ? "bg-violet-500/15 text-violet-400"
                              : "bg-primary/15 text-primary"
                          )}>
                            {w.entryKind === "phrase" ? "📝" : "📖"}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-foreground truncate">{w.term}</p>
                            <p className="text-xs text-muted-foreground truncate">{w.translation}</p>
                            {w.lessonSource && (
                              <p className="text-xs text-primary/70 truncate mt-0.5">📌 {w.lessonSource}</p>
                            )}
                          </div>
                          {isDue(w) && (
                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-accent/20 text-accent font-semibold flex-shrink-0">
                              due
                            </span>
                          )}
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              onClick={() => starMutation.mutate({ id: w.id })}
                              className={cn(
                                "p-1.5 rounded-lg transition-colors",
                                w.starred
                                  ? "text-accent"
                                  : "text-muted-foreground hover:text-accent opacity-0 group-hover:opacity-100"
                              )}
                            >
                              <Star className={cn("w-3.5 h-3.5", w.starred && "fill-current")} />
                            </button>
                            <button
                              onClick={() => handleDelete(w.id)}
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
                              title="Delete word"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImport={handleImport}
        />
      )}
    </div>
  );
}

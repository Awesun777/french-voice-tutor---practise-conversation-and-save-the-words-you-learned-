import { SidebarTab } from "@/types";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  BookOpen,
  BookMarked,
  Brain,
  CreditCard,
  MessageCircle,
  Mic,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  LogOut,
  User,
} from "lucide-react";
import { toast } from "sonner";

interface SidebarProps {
  activeTab: SidebarTab;
  setActiveTab: (tab: SidebarTab) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  user: { name?: string | null; email?: string | null };
}

const NAV_ITEMS: { id: SidebarTab; label: string; icon: React.ReactNode; emoji: string }[] = [
  { id: "dictionary", label: "Dictionary", icon: <BookOpen className="w-4.5 h-4.5" />, emoji: "📖" },
  { id: "tutor", label: "Tutor Chat", icon: <MessageCircle className="w-4.5 h-4.5" />, emoji: "💬" },
  { id: "voice-chat", label: "Voice Chat", icon: <Mic className="w-4.5 h-4.5" />, emoji: "🎙️" },
  { id: "library", label: "My Library", icon: <BookMarked className="w-4.5 h-4.5" />, emoji: "📚" },
  { id: "quiz", label: "Quiz", icon: <Brain className="w-4.5 h-4.5" />, emoji: "🧠" },
  { id: "flashcards", label: "Flashcards", icon: <CreditCard className="w-4.5 h-4.5" />, emoji: "🃏" },
  { id: "progress", label: "Progress", icon: <BarChart3 className="w-4.5 h-4.5" />, emoji: "📊" },
];

export default function Sidebar({ activeTab, setActiveTab, open, setOpen, user }: SidebarProps) {
  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => { window.location.reload(); },
    onError: () => toast.error("Logout failed"),
  });

  return (
    <aside
      className={cn(
        "flex flex-col h-full bg-sidebar border-r border-sidebar-border transition-all duration-300 ease-in-out flex-shrink-0",
        open ? "w-56" : "w-14"
      )}
    >
      {/* Header */}
      <div className={cn("flex items-center h-14 px-3 border-b border-sidebar-border gap-2.5 flex-shrink-0", !open && "justify-center")}>
        <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0">
          <span className="text-lg">🇫🇷</span>
        </div>
        {open && (
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-foreground truncate" style={{ fontFamily: "'Playfair Display', serif" }}>
              Le Dictionnaire
            </p>
          </div>
        )}
        <button
          onClick={() => setOpen(!open)}
          className="p-1 rounded-md hover:bg-sidebar-accent text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
        >
          {open ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={cn(
              "w-full flex items-center gap-3 px-2.5 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
              !open && "justify-center px-2",
              activeTab === item.id
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            )}
            title={!open ? item.label : undefined}
          >
            <span className={cn("flex-shrink-0", activeTab === item.id ? "text-primary" : "")}>
              {item.icon}
            </span>
            {open && <span className="truncate">{item.label}</span>}
          </button>
        ))}
      </nav>

      {/* User section */}
      <div className={cn("border-t border-sidebar-border p-2 flex-shrink-0", !open && "flex justify-center")}>
        {open ? (
          <div className="flex items-center gap-2.5 px-2 py-2">
            <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
              <User className="w-3.5 h-3.5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-foreground truncate">{user.name ?? "User"}</p>
              {user.email && <p className="text-xs text-muted-foreground truncate">{user.email}</p>}
            </div>
            <button
              onClick={() => logoutMutation.mutate()}
              className="p-1.5 rounded-md hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
              title="Sign out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => logoutMutation.mutate()}
            className="p-2 rounded-md hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        )}
      </div>
    </aside>
  );
}

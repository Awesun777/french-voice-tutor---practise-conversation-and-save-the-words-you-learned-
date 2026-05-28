import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { useState } from "react";
import { SidebarTab } from "@/types";
import Sidebar from "@/components/Sidebar";
import DictionaryTab from "@/components/DictionaryTab";
import LibraryTab from "@/components/LibraryTab";
import QuizTab from "@/components/QuizTab";
import FlashcardTab from "@/components/FlashcardTab";
import TutorTab from "@/components/TutorTab";
import ProgressTab from "@/components/ProgressTab";
import VoiceChatTab from "@/components/VoiceChatTab";
import { Loader2, BookOpen } from "lucide-react";

export default function Home() {
  const { user, loading } = useAuth();
  const [activeTab, setActiveTab] = useState<SidebarTab>("dictionary");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-primary/20 flex items-center justify-center">
            <BookOpen className="w-7 h-7 text-primary" />
          </div>
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-md w-full text-center space-y-8">
          {/* Logo */}
          <div className="flex flex-col items-center gap-4">
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-primary/30 to-primary/10 border border-primary/30 flex items-center justify-center shadow-lg shadow-primary/10">
              <span className="text-4xl">🇫🇷</span>
            </div>
            <div>
              <h1 className="text-4xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
                Le Dictionnaire
              </h1>
              <p className="text-muted-foreground mt-2 text-lg">Your personal French learning companion</p>
            </div>
          </div>

          {/* Features */}
          <div className="grid grid-cols-2 gap-3 text-left">
            {[
              { icon: "📖", label: "AI Dictionary", desc: "Instant lookups with conjugations" },
              { icon: "🧠", label: "Spaced Repetition", desc: "Smart quiz scheduling" },
              { icon: "🃏", label: "Flashcards", desc: "Flip & record your pronunciation" },
              { icon: "📊", label: "Progress Tracking", desc: "Streaks & growth charts" },
            ].map((f) => (
              <div key={f.label} className="bg-card border border-border rounded-xl p-3.5">
                <div className="text-2xl mb-1.5">{f.icon}</div>
                <p className="text-sm font-semibold text-foreground">{f.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{f.desc}</p>
              </div>
            ))}
          </div>

          <a
            href={getLoginUrl()}
            className="block w-full py-3.5 px-6 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-xl transition-all duration-200 shadow-lg shadow-primary/25 text-center"
          >
            Sign in to get started →
          </a>
          <p className="text-xs text-muted-foreground">Free to use · Your data stays private</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        open={sidebarOpen}
        setOpen={setSidebarOpen}
        user={user}
      />
      <main className="flex-1 overflow-hidden flex flex-col min-w-0">
        {activeTab === "dictionary" && <DictionaryTab />}
        {activeTab === "library" && <LibraryTab setActiveTab={setActiveTab} />}
        {activeTab === "quiz" && <QuizTab />}
        {activeTab === "flashcards" && <FlashcardTab />}
        {activeTab === "tutor" && <TutorTab />}
        {activeTab === "voice-chat" && <VoiceChatTab />}
        {activeTab === "progress" && <ProgressTab />}
      </main>
    </div>
  );
}

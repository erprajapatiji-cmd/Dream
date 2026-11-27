import { useState, useCallback, useEffect } from "react";
import MatchesPage from "@/pages/MatchesPage";
import MatchDetailPage from "@/pages/MatchDetailPage";
import UploadPage from "@/pages/UploadPage";
import SettingsPage from "@/pages/SettingsPage";
import LoginPage from "@/pages/LoginPage";
import { useUploadProgress } from "@/lib/uploadProgress";
import { supabase } from "@/lib/supabase";

type Page = "matches" | "match" | "upload" | "settings";

const ALLOWED_EMAIL = "erprajapatiji@gmail.com";

function App() {
  const [authed, setAuthed] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [page, setPage] = useState<Page>("matches");
  const [matchId, setMatchId] = useState<string>("");
  const { importing, progress, result } = useUploadProgress();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.email === ALLOWED_EMAIL) {
        setAuthed(true);
      }
      setCheckingAuth(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      (async () => {
        if (session?.user?.email === ALLOWED_EMAIL) {
          setAuthed(true);
        } else {
          setAuthed(false);
        }
      })();
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const navigate = useCallback((target: string, params?: Record<string, string>) => {
    if (target === "match" && params?.id) {
      setMatchId(params.id);
      setPage("match");
    } else if (target === "upload" || target === "settings" || target === "matches") {
      setPage(target as Page);
    }
    window.scrollTo(0, 0);
  }, []);

  if (checkingAuth) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-500">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-blue-500" />
      </div>
    );
  }

  if (!authed) {
    return <LoginPage onAuthSuccess={() => setAuthed(true)} />;
  }

  if (page === "upload") {
    return <UploadPage onNavigate={navigate} />;
  }

  const currentPage = (() => {
    switch (page) {
      case "settings":
        return <SettingsPage onNavigate={navigate} />;
      case "match":
        return <MatchDetailPage matchId={matchId} onNavigate={navigate} />;
      case "matches":
      default:
        return <MatchesPage onNavigate={navigate} backgroundUpload={importing ? { progress, result } : undefined} />;
    }
  })();

  return currentPage;
}

export default App;

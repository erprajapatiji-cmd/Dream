import { useState, useCallback } from "react";
import MatchesPage from "@/pages/MatchesPage";
import MatchDetailPage from "@/pages/MatchDetailPage";
import UploadPage from "@/pages/UploadPage";
import SettingsPage from "@/pages/SettingsPage";
import { useUploadProgress } from "@/lib/uploadProgress";

type Page = "matches" | "match" | "upload" | "settings";

function App() {
  const [page, setPage] = useState<Page>("matches");
  const [matchId, setMatchId] = useState<string>("");
  const { importing, progress, result } = useUploadProgress();

  const navigate = useCallback((target: string, params?: Record<string, string>) => {
    if (target === "match" && params?.id) {
      setMatchId(params.id);
      setPage("match");
    } else if (target === "upload" || target === "settings" || target === "matches") {
      setPage(target as Page);
    }
    window.scrollTo(0, 0);
  }, []);

  const currentPage = (() => {
    switch (page) {
      case "settings":
        return <SettingsPage onNavigate={navigate} />;
      case "match":
        return <MatchDetailPage matchId={matchId} onNavigate={navigate} />;
      case "matches":
      default:
        return <MatchesPage onNavigate={navigate} backgroundUpload={importing && page !== "upload" ? { progress, result } : undefined} />;
    }
  })();

  return (
    <>
      {page === "upload" ? (
        <UploadPage onNavigate={navigate} />
      ) : (
        currentPage
      )}
    </>
  );
}

export default App;

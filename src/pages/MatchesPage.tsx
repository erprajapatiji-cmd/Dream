import { useState, useEffect, useCallback } from "react";
import { Search, Calendar, MapPin, Trophy, Upload, Key, ChevronRight, Loader2, AlertCircle, CloudUpload, RefreshCw, LogOut } from "lucide-react";
import type { Match } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import type { ImportProgress, ImportResult } from "@/lib/uploadProgress";

interface MatchesPageProps {
  onNavigate: (page: string, params?: Record<string, string>) => void;
  backgroundUpload?: { progress: ImportProgress | null; result: ImportResult | null };
}

export default function MatchesPage({ onNavigate, backgroundUpload }: MatchesPageProps) {
  const [signingOut, setSigningOut] = useState(false);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [seasonFilter, setSeasonFilter] = useState("");

  const loadMatches = useCallback(async () => {
    setLoading(true);
    setError(null);

    const PAGE_SIZE = 1000;
    const allMatches: Match[] = [];
    let page = 0;

    for (;;) {
      const { data, error: err } = await supabase
        .from("matches")
        .select("*")
        .order("date", { ascending: false, nullsFirst: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (err) {
        setError(`Database error: ${err.message}${err.code ? ` (code: ${err.code})` : ""}`);
        setLoading(false);
        return;
      }

      allMatches.push(...(data ?? []));
      if (!data || data.length < PAGE_SIZE) break;
      page++;
    }

    setMatches(allMatches);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadMatches();
  }, [loadMatches]);


  const seasons = [...new Set(matches.map((m) => m.season).filter((season): season is string => Boolean(season)))].sort().reverse();

  const filtered = matches.filter((m) => {
    const matchesSearch = !search ||
      m.team1?.toLowerCase().includes(search.toLowerCase()) ||
      m.team2?.toLowerCase().includes(search.toLowerCase()) ||
      m.venue?.toLowerCase().includes(search.toLowerCase()) ||
      m.city?.toLowerCase().includes(search.toLowerCase()) ||
      m.player_of_match?.toLowerCase().includes(search.toLowerCase()) ||
      m.match_id?.toLowerCase().includes(search.toLowerCase());
    const matchesSeason = !seasonFilter || m.season === seasonFilter;
    return matchesSearch && matchesSeason;
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-emerald-500">
              <Trophy className="text-white" size={22} />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">CrickData</h1>
              <p className="text-xs text-slate-500">Ball-by-Ball Records</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onNavigate("upload")}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
            >
              <Upload size={16} />
              <span>Upload CSV</span>
            </button>
            <button
              onClick={() => onNavigate("settings")}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800 transition-colors"
            >
              <Key size={16} />
              <span className="hidden sm:inline">API Keys</span>
            </button>
            <button
              onClick={async () => {
                setSigningOut(true);
                await supabase.auth.signOut();
              }}
              disabled={signingOut}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors disabled:opacity-50"
              title="Sign out"
            >
              <LogOut size={16} />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Background upload indicator */}
        {backgroundUpload && (
          <div className="mb-6 rounded-xl border border-blue-500/30 bg-blue-500/10 p-4">
            {backgroundUpload.result ? (
              <div className="flex items-center gap-3">
                <CloudUpload className="text-emerald-400" size={20} />
                <p className="text-sm text-emerald-300">
                  Import complete — {backgroundUpload.result.matches} matches, {backgroundUpload.result.innings} innings, {backgroundUpload.result.balls.toLocaleString()} balls added. Tap Refresh to load new data.
                </p>
                <button
                  onClick={loadMatches}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 transition-colors"
                >
                  <RefreshCw size={14} />
                  Refresh
                </button>
              </div>
            ) : backgroundUpload.progress ? (
              <div>
                <div className="flex items-center gap-3">
                  <Loader2 className="animate-spin text-blue-400" size={20} />
                  <p className="text-sm text-slate-300">{backgroundUpload.progress.phase}</p>
                  <p className="ml-auto text-xs text-slate-500">
                    {backgroundUpload.progress.current.toLocaleString()} / {backgroundUpload.progress.total.toLocaleString()} rows
                  </p>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full bg-blue-500 transition-all"
                    style={{ width: `${(backgroundUpload.progress.current / backgroundUpload.progress.total) * 100}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Loader2 className="animate-spin text-blue-400" size={20} />
                <p className="text-sm text-slate-300">Uploading file...</p>
              </div>
            )}
          </div>
        )}

        {/* Stats banner */}
        <div className="grid grid-cols-3 gap-4 sm:gap-6">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 sm:p-5">
            <p className="text-xs text-slate-500">Total Matches</p>
            <p className="mt-1 text-2xl font-bold sm:text-3xl">{matches.length}</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 sm:p-5">
            <p className="text-xs text-slate-500">Seasons</p>
            <p className="mt-1 text-2xl font-bold sm:text-3xl">{seasons.length}</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 sm:p-5">
            <p className="text-xs text-slate-500">Teams</p>
            <p className="mt-1 text-2xl font-bold sm:text-3xl">
              {[...new Set([...matches.map((m) => m.team1), ...matches.map((m) => m.team2)].filter(Boolean))].length}
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
            <input
              type="text"
              placeholder="Search teams, venues, players..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 py-2.5 pl-10 pr-4 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <select
            value={seasonFilter}
            onChange={(e) => setSeasonFilter(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
          >
            <option value="">All Seasons</option>
            {seasons.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button
            onClick={loadMatches}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 px-4 py-2.5 text-sm text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="mt-12 flex flex-col items-center text-slate-500">
            <Loader2 className="animate-spin" size={32} />
            <p className="mt-3 text-sm">Loading matches...</p>
          </div>
        ) : error ? (
          <div className="mt-12 flex flex-col items-center text-center">
            <AlertCircle className="text-red-400" size={32} />
            <p className="mt-3 text-sm text-red-300">{error}</p>
            <button
              onClick={loadMatches}
              className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-12 flex flex-col items-center text-center">
            <Trophy className="text-slate-600" size={40} />
            <p className="mt-4 text-slate-400">
              {matches.length === 0
                ? "No matches yet. Upload your Kaggle CSV to get started."
                : "No matches found with current filters."}
            </p>
            {matches.length === 0 && (
              <button
                onClick={() => onNavigate("upload")}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
              >
                <Upload size={16} />
                Upload CSV
              </button>
            )}
          </div>
        ) : (
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((match) => (
              <button
                key={match.id}
                onClick={() => onNavigate("match", { id: match.match_id })}
                className="group rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-left transition-all hover:border-slate-700 hover:bg-slate-900"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-slate-100">
                      {match.team1 || "TBD"} <span className="text-slate-500">vs</span> {match.team2 || "TBD"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">{match.season || "—"}</p>
                  </div>
                  <ChevronRight className="shrink-0 text-slate-600 transition-colors group-hover:text-slate-400" size={18} />
                </div>

                <div className="mt-3 space-y-1.5 text-xs text-slate-400">
                  {match.date && (
                    <div className="flex items-center gap-1.5">
                      <Calendar size={12} className="text-slate-600" />
                      <span>{match.date}</span>
                    </div>
                  )}
                  {match.venue && (
                    <div className="flex items-center gap-1.5">
                      <MapPin size={12} className="text-slate-600" />
                      <span className="truncate">{match.city ? `${match.city}` : match.venue}</span>
                    </div>
                  )}
                  {match.result && (
                    <p className="mt-2 line-clamp-2 rounded bg-slate-800/50 px-2 py-1.5 text-slate-300">
                      {match.result}
                      {match.result_margin && ` — ${match.result_margin}`}
                    </p>
                  )}
                  {match.player_of_match && (
                    <p className="mt-1 text-amber-400/80">
                      Player of the Match: {match.player_of_match}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

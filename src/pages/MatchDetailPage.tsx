import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, MapPin, Trophy, Loader2, AlertCircle, User, Users, Tag } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Match, Innings, BallByBall } from "@/lib/types";

interface MatchDetailPageProps {
  matchId: string;
  onNavigate: (page: string, params?: Record<string, string>) => void;
}

interface BattingRow {
  name: string;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  dismissal: string;
}

interface BowlingRow {
  name: string;
  balls: number;
  runs: number;
  wickets: number;
}

function isLegalDelivery(ball: BallByBall): boolean {
  const extras = (ball.extras_type || "").toLowerCase().replace(/[ _-]/g, "");
  return !extras.includes("wide") && !extras.includes("noball");
}

function formatOvers(balls: number): string {
  return `${Math.floor(balls / 6)}.${balls % 6}`;
}

function getBallDisplay(ball: BallByBall): { text: string; color: string } {
  if (ball.is_wicket) return { text: "W", color: "bg-red-500/80 text-white" };
  if (ball.runs_total === 6) return { text: "6", color: "bg-emerald-500/80 text-white" };
  if (ball.runs_total === 4) return { text: "4", color: "bg-blue-500/80 text-white" };
  if (ball.runs_total === 0) return { text: "0", color: "bg-slate-700 text-slate-300" };
  if (ball.extras_type) return { text: `${ball.runs_total}e`, color: "bg-amber-500/80 text-white" };
  return { text: String(ball.runs_total), color: "bg-slate-600 text-slate-200" };
}

function getDeliveryLabel(ball: BallByBall): string {
  if (ball.is_wicket) return ball.wicket_type ? `Wicket · ${ball.wicket_type}` : "Wicket";
  if (ball.extras_type) return `${ball.runs_total} extra · ${ball.extras_type}`;
  return `${ball.runs_total} run${ball.runs_total !== 1 ? "s" : ""}`;
}

export default function MatchDetailPage({ matchId, onNavigate }: MatchDetailPageProps) {
  const [match, setMatch] = useState<Match | null>(null);
  const [innings, setInnings] = useState<Innings[]>([]);
  const [selectedInnings, setSelectedInnings] = useState<number>(1);
  const [balls, setBalls] = useState<BallByBall[]>([]);
  const [loading, setLoading] = useState(true);
  const [ballsLoading, setBallsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMatch = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data: matchData, error: matchErr } = await supabase
      .from("matches")
      .select("*")
      .eq("match_id", matchId)
      .maybeSingle();

    if (matchErr) {
      setError(matchErr.message);
      setLoading(false);
      return;
    }
    if (!matchData) {
      setError("Match not found");
      setLoading(false);
      return;
    }

    setMatch(matchData);

    const { data: innData, error: inningsErr } = await supabase
      .from("innings")
      .select("*")
      .eq("match_id", matchData.id)
      .order("innings_no", { ascending: true });

    if (inningsErr) {
      setError(inningsErr.message);
      setLoading(false);
      return;
    }

    setInnings(innData || []);
    if (innData && innData.length > 0) setSelectedInnings(innData[0].innings_no);
    setLoading(false);
  }, [matchId]);

  const loadBalls = useCallback(async () => {
    if (!match || innings.length === 0) return;
    const inn = innings.find((item) => item.innings_no === selectedInnings);
    if (!inn) return;

    setBallsLoading(true);
    const { data: ballData, error: ballsErr } = await supabase
      .from("ball_by_balls")
      .select("*")
      .eq("innings_id", inn.id)
      .order("over", { ascending: true })
      .order("ball", { ascending: true });

    if (ballsErr) setError(ballsErr.message);
    setBalls(ballData || []);
    setBallsLoading(false);
  }, [match, innings, selectedInnings]);

  useEffect(() => {
    loadMatch();
  }, [loadMatch]);

  useEffect(() => {
    loadBalls();
  }, [loadBalls]);

  const overs = balls.reduce((acc, ball) => {
    const key = ball.over;
    if (!acc[key]) acc[key] = [];
    acc[key].push(ball);
    return acc;
  }, {} as Record<number, BallByBall[]>);

  const overKeys = Object.keys(overs).map(Number).sort((a, b) => a - b);
  const currentInnings = innings.find((inn) => inn.innings_no === selectedInnings);

  const battingRows = Object.values(balls.reduce((acc, ball) => {
    const name = ball.batter || "Unknown batter";
    if (!acc[name]) acc[name] = { name, runs: 0, balls: 0, fours: 0, sixes: 0, dismissal: "Not out" };
    acc[name].runs += ball.runs_batter;
    if (isLegalDelivery(ball)) acc[name].balls += 1;
    if (ball.runs_batter === 4) acc[name].fours += 1;
    if (ball.runs_batter === 6) acc[name].sixes += 1;
    if (ball.is_wicket && ball.player_out === name) {
      acc[name].dismissal = ball.wicket_type || "Out";
    }
    return acc;
  }, {} as Record<string, BattingRow>));

  const bowlingRows = Object.values(balls.reduce((acc, ball) => {
    const name = ball.bowler || "Unknown bowler";
    if (!acc[name]) acc[name] = { name, balls: 0, runs: 0, wickets: 0 };
    if (isLegalDelivery(ball)) acc[name].balls += 1;
    const isBowlerExtra = !["bye", "legbye"].some((extra) => (ball.extras_type || "").toLowerCase().includes(extra));
    if (isBowlerExtra) acc[name].runs += ball.runs_total;
    if (ball.is_wicket && !["run out", "retired hurt", "obstructing the field"].includes((ball.wicket_type || "").toLowerCase())) {
      acc[name].wickets += 1;
    }
    return acc;
  }, {} as Record<string, BowlingRow>));

  const extras = balls.reduce((acc, ball) => {
    if (!ball.extras_type) return acc;
    const key = ball.extras_type.toLowerCase().replace(/[ _-]/g, "");
    acc[key] = (acc[key] || 0) + ball.runs_extra;
    return acc;
  }, {} as Record<string, number>);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-500"><Loader2 className="animate-spin" size={32} /></div>;
  }

  if (error || !match) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <div className="mx-auto max-w-4xl px-4 py-8">
          <button onClick={() => onNavigate("matches")} className="mb-6 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200"><ArrowLeft size={16} /> Back</button>
          <div className="flex flex-col items-center text-center"><AlertCircle className="text-red-400" size={32} /><p className="mt-3 text-red-300">{error || "Match not found"}</p></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <button onClick={() => onNavigate("matches")} className="mb-6 inline-flex items-center gap-2 text-sm text-slate-400 transition-colors hover:text-slate-200"><ArrowLeft size={16} /> All Matches</button>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-2xl shadow-slate-950/30 sm:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-400">Match centre</p>
              <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{match.team1 || "TBD"} <span className="text-slate-500">vs</span> {match.team2 || "TBD"}</h1>
              <p className="mt-2 text-sm text-slate-400">{match.season}{match.date ? ` · ${match.date}` : ""}{match.city ? ` · ${match.city}` : ""}</p>
            </div>
            {match.player_of_match && <div className="flex items-center gap-2 rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-300"><Trophy size={17} /><span>Player of the match: {match.player_of_match}</span></div>}
          </div>

          <div className="mt-6 grid grid-cols-1 gap-3 text-sm text-slate-400 sm:grid-cols-2 lg:grid-cols-4">
            {match.venue && <div className="flex items-center gap-2"><MapPin size={14} className="text-slate-600" /><span className="truncate">{match.venue}</span></div>}
            {match.match_format && match.match_format !== "Unknown" && <div className="flex items-center gap-2"><Tag size={14} className="text-slate-600" /><span>{match.match_format}</span></div>}
            {match.toss_winner && <div>Toss: <span className="text-slate-300">{match.toss_winner}</span> chose {match.toss_decision}</div>}
            {match.umpire1 && <div className="flex items-center gap-2"><User size={14} className="text-slate-600" />{match.umpire1}{match.umpire2 ? `, ${match.umpire2}` : ""}</div>}
            {match.result && <div className="font-medium text-slate-200">{match.result}{match.result_margin ? ` — ${match.result_margin}` : ""}</div>}
          </div>
        </div>

        {innings.length > 0 ? (
          <>
            <div className="mt-6 flex gap-2 overflow-x-auto">
              {innings.map((inn) => (
                <button key={inn.innings_no} onClick={() => setSelectedInnings(inn.innings_no)} className={`shrink-0 rounded-xl px-4 py-3 text-sm font-semibold transition-colors ${selectedInnings === inn.innings_no ? "bg-blue-600 text-white shadow-lg shadow-blue-950/30" : "border border-slate-700 text-slate-300 hover:bg-slate-800"}`}>
                  Innings {inn.innings_no}{inn.batting_team ? ` · ${inn.batting_team}` : ""}
                </button>
              ))}
            </div>

            {currentInnings && (
              <div className="mt-4 rounded-2xl border border-blue-900/50 bg-gradient-to-br from-blue-950/60 to-slate-900/70 p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <div><p className="text-sm text-blue-200">{currentInnings.batting_team || "Batting team"}</p><p className="mt-1 text-4xl font-bold tracking-tight">{currentInnings.total_runs}<span className="text-2xl text-slate-400">/{currentInnings.total_wickets}</span></p></div>
                  <div className="grid grid-cols-2 gap-6 text-right"><div><p className="text-xs uppercase tracking-wider text-slate-500">Overs</p><p className="mt-1 text-xl font-semibold">{currentInnings.total_overs.toFixed(1)}</p></div><div><p className="text-xs uppercase tracking-wider text-slate-500">Run rate</p><p className="mt-1 text-xl font-semibold">{currentInnings.total_overs > 0 ? (currentInnings.total_runs / currentInnings.total_overs).toFixed(2) : "0.00"}</p></div></div>
                </div>
                <div className="mt-5 flex flex-wrap gap-2 border-t border-blue-900/40 pt-4 text-xs text-slate-400"><span>Extras: {Object.values(extras).reduce((sum, value) => sum + value, 0)}</span>{Object.entries(extras).map(([name, value]) => <span key={name} className="rounded-full bg-slate-800/80 px-2.5 py-1">{name}: {value}</span>)}</div>
              </div>
            )}

            {ballsLoading ? <div className="flex justify-center py-12"><Loader2 className="animate-spin text-slate-500" size={28} /></div> : (
              <>
                <div className="mt-6 grid gap-4 lg:grid-cols-2">
                  <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
                    <div className="border-b border-slate-800 px-4 py-3"><h2 className="font-semibold">Batting scorecard</h2><p className="mt-1 text-xs text-slate-500">Runs · balls · boundaries</p></div>
                    <div className="overflow-x-auto"><table className="w-full min-w-[470px] text-left text-sm"><thead className="bg-slate-950/50 text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-4 py-3">Batter</th><th className="px-2 py-3 text-right">R</th><th className="px-2 py-3 text-right">B</th><th className="px-2 py-3 text-right">4s</th><th className="px-2 py-3 text-right">6s</th><th className="px-4 py-3 text-right">Status</th></tr></thead><tbody>{battingRows.map((row) => <tr key={row.name} className="border-t border-slate-800/80"><td className="px-4 py-3 font-medium text-slate-200">{row.name}</td><td className="px-2 py-3 text-right font-semibold">{row.runs}</td><td className="px-2 py-3 text-right text-slate-400">{row.balls}</td><td className="px-2 py-3 text-right text-slate-400">{row.fours}</td><td className="px-2 py-3 text-right text-slate-400">{row.sixes}</td><td className={`px-4 py-3 text-right text-xs ${row.dismissal === "Not out" ? "text-emerald-400" : "text-slate-400"}`}>{row.dismissal}</td></tr>)}</tbody></table></div>
                  </div>
                  <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
                    <div className="border-b border-slate-800 px-4 py-3"><h2 className="font-semibold">Bowling scorecard</h2><p className="mt-1 text-xs text-slate-500">Overs · runs · wickets · economy</p></div>
                    <div className="overflow-x-auto"><table className="w-full min-w-[430px] text-left text-sm"><thead className="bg-slate-950/50 text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-4 py-3">Bowler</th><th className="px-2 py-3 text-right">O</th><th className="px-2 py-3 text-right">R</th><th className="px-2 py-3 text-right">W</th><th className="px-4 py-3 text-right">Econ</th></tr></thead><tbody>{bowlingRows.map((row) => <tr key={row.name} className="border-t border-slate-800/80"><td className="px-4 py-3 font-medium text-slate-200">{row.name}</td><td className="px-2 py-3 text-right text-slate-400">{formatOvers(row.balls)}</td><td className="px-2 py-3 text-right text-slate-400">{row.runs}</td><td className="px-2 py-3 text-right font-semibold">{row.wickets}</td><td className="px-4 py-3 text-right text-slate-400">{row.balls ? (row.runs / (row.balls / 6)).toFixed(2) : "0.00"}</td></tr>)}</tbody></table></div>
                  </div>
                </div>

                <div className="mt-8">
                  <div className="mb-4 flex items-end justify-between"><div><h2 className="text-xl font-semibold">Ball by ball</h2><p className="mt-1 text-sm text-slate-500">Every delivery, over summary and dismissal detail</p></div><span className="text-xs text-slate-500">{balls.length} records</span></div>
                  {overKeys.length === 0 ? <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-8 text-center text-slate-400">No ball-by-ball data for this innings.</div> : <div className="space-y-4">{overKeys.map((overNum) => {
                    const overBalls = overs[overNum];
                    const visibleBalls = overBalls.slice(0, 6);
                    const extraDeliveries = Math.max(0, overBalls.length - visibleBalls.length);
                    const overRuns = overBalls.reduce((sum, ball) => sum + ball.runs_total, 0);
                    const overWickets = overBalls.filter((ball) => ball.is_wicket).length;
                    const legalBalls = overBalls.filter(isLegalDelivery).length;
                    const batters = [...new Set(overBalls.flatMap((ball) => [ball.batter, ball.non_striker]).filter((name): name is string => Boolean(name)))];
                    const bowler = overBalls[0]?.bowler;

                    return <div key={overNum} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 sm:p-5">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-x-4 gap-y-2"><span className="text-base font-semibold text-slate-100">Over {overNum + 1}</span>{bowler && <span className="flex items-center gap-1 text-xs text-slate-400"><User size={13} /> {bowler}</span>}</div><div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">{batters.length > 0 && <span className="flex items-center gap-1"><Users size={13} /> {batters.join(" · ")}</span>}</div></div><div className="text-left text-xs text-slate-400 sm:text-right"><div className="font-semibold text-slate-200">{overRuns} runs{overWickets > 0 ? ` · ${overWickets} wicket${overWickets > 1 ? "s" : ""}` : ""}</div><div className="mt-1 text-slate-500">{visibleBalls.length} balls shown · {legalBalls} legal</div>{extraDeliveries > 0 && <div className="mt-1 text-amber-400/80">{extraDeliveries} extra source record{extraDeliveries !== 1 ? "s" : ""}</div>}</div></div>
                      <div className="mt-4 flex flex-wrap gap-2">{visibleBalls.map((ball, index) => { const display = getBallDisplay(ball); return <div key={`${ball.id}-${index}`} className={`flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold ${display.color}`} title={`${ball.batter || "Batter"} · ${getDeliveryLabel(ball)}`}>{display.text}</div>; })}</div>
                      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-800/80"><table className="w-full min-w-[650px] text-left text-xs"><thead className="bg-slate-950/50 text-slate-500"><tr><th className="px-3 py-2">Ball</th><th className="px-3 py-2">Batter</th><th className="px-3 py-2">Bowler</th><th className="px-3 py-2">Outcome</th><th className="px-3 py-2">Runs</th><th className="px-3 py-2">Wicket</th></tr></thead><tbody>{visibleBalls.map((ball, index) => <tr key={`${ball.id}-detail`} className="border-t border-slate-800/80"><td className="px-3 py-2 text-slate-500">{overNum + 1}.{index + 1}</td><td className="px-3 py-2 font-medium text-slate-200">{ball.batter || "—"}</td><td className="px-3 py-2 text-slate-400">{ball.bowler || "—"}</td><td className="px-3 py-2 text-slate-300">{getDeliveryLabel(ball)}</td><td className="px-3 py-2 text-slate-300">{ball.runs_batter} + {ball.runs_extra}</td><td className="px-3 py-2 text-red-300">{ball.is_wicket ? `${ball.player_out || "Out"}${ball.fielder ? ` · ${ball.fielder}` : ""}` : "—"}</td></tr>)}</tbody></table></div>
                    </div>;
                  })}</div>}
                </div>
              </>
            )}
          </>
        ) : <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-8 text-center text-slate-400">No innings data found for this match. Upload the ball-by-ball CSV to see detailed records.<button onClick={() => onNavigate("upload")} className="mx-auto mt-4 block rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500">Upload ball-by-ball CSV</button></div>}
      </div>
    </div>
  );
}

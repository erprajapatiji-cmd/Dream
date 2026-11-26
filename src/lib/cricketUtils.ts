// Pure functions shared between the ball-by-ball-api edge function and unit tests.
// No Deno-specific imports — safe to import from vitest.

export interface MatchJSON {
  id: string;
  match_id: string;
  match_format: string;
  season: string | null;
  city: string | null;
  date: string | null;
  team1: string | null;
  team2: string | null;
  toss_winner: string | null;
  toss_decision: string | null;
  result: string | null;
  result_margin: string | null;
  player_of_match: string | null;
  venue: string | null;
  umpire1: string | null;
  umpire2: string | null;
  created_at: string | null;
}

export interface BallJSON {
  id: string;
  innings_id: string;
  match_id: string;
  over: number;
  ball: number;
  batter: string | null;
  bowler: string | null;
  non_striker: string | null;
  runs_batter: number;
  runs_extra: number;
  runs_total: number;
  extras_type: string | null;
  is_wicket: boolean;
  wicket_type: string | null;
  player_out: string | null;
  fielder: string | null;
  created_at: string | null;
}

export type TigzigRow = Record<string, unknown>;

// ─── Format Normalization ───────────────────────────────────────────────────

const FORMAT_MAP: Record<string, string> = {
  "test": "Test",
  "tests": "Test",
  "t20": "T20",
  "t20i": "T20",
  "twenty20": "T20",
  "twenty 20": "T20",
  "ipl": "T20",
  "odi": "ODI",
  "one day": "ODI",
  "one day international": "ODI",
  "t10": "T10",
  "ten10": "T10",
  "first class": "First Class",
  "first-class": "First Class",
  "list a": "List A",
  "list-a": "List A",
};

export function normalizeFormat(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ");
  if (!normalized) return null;
  if (FORMAT_MAP[normalized]) return FORMAT_MAP[normalized];
  if (/^(t20|twenty20|twenty 20)/.test(normalized) || /\b(ipl|bbl|psl|cpl)\b/.test(normalized)) return "T20";
  if (/^(odi|one day)/.test(normalized)) return "ODI";
  if (/^test/.test(normalized)) return "Test";
  if (/first class/.test(normalized)) return "First Class";
  if (/list a/.test(normalized)) return "List A";
  if (/^t10/.test(normalized)) return "T10";
  return null;
}

export function normalizeTigzigFormat(raw: unknown): string {
  const value = String(raw ?? "Unknown").trim().toUpperCase();
  if (value === "TEST") return "Test";
  if (value === "IPL" || value === "T20" || value === "T20I") return "T20";
  if (value === "ODI") return "ODI";
  if (value === "T10") return "T10";
  if (value === "FIRST CLASS" || value === "FIRSTCLASS") return "First Class";
  if (value === "LIST A" || value === "LISTA") return "List A";
  return "Unknown";
}

// ─── PostgREST Escaping ─────────────────────────────────────────────────────

export function escapePostgrest(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

// ─── Match Mapping (TigZig → local JSON shape) ──────────────────────────────

export function remoteMatch(row: TigzigRow): MatchJSON | null {
  const matchId = String(row.match_id ?? "");
  if (!matchId) return null;
  const date = (row.start_date ?? row.match_date ?? row.date ?? null) as string | null;
  return {
    id: `tigzig:${matchId}`,
    match_id: matchId,
    match_format: normalizeTigzigFormat(row.match_type),
    season: (row.season ?? null) as string | null,
    city: (row.city ?? null) as string | null,
    date,
    team1: (row.team1 ?? null) as string | null,
    team2: (row.team2 ?? null) as string | null,
    toss_winner: (row.toss_winner ?? null) as string | null,
    toss_decision: (row.toss_decision ?? null) as string | null,
    result: (row.winner ?? null) as string | null,
    result_margin: row.winner_runs ? `${row.winner_runs} runs` : row.winner_wickets ? `${row.winner_wickets} wickets` : null,
    player_of_match: (row.player_of_match1 ?? row.player_of_match ?? null) as string | null,
    venue: (row.venue ?? null) as string | null,
    umpire1: (row.umpire1 ?? null) as string | null,
    umpire2: (row.umpire2 ?? null) as string | null,
    created_at: null,
  };
}

// ─── Ball Mapping (TigZig → local JSON shape) ───────────────────────────────
// Canonical mapper: handles striker/batter, runs_off_bat/runs_batter,
// extras/runs_extra, player_dismissed/player_out, and both table variants.

export function mapTigzigBall(row: TigzigRow): BallJSON {
  const matchId = String(row.match_id ?? "");
  const inningsNo = Number(row.innings_no ?? row.innings ?? 1);
  const over = Number(row.over ?? 0);
  const ball = Number(row.ball ?? 0);
  const batter = (row.striker ?? row.batter ?? row.batsman ?? null) as string | null;
  const bowler = (row.bowler ?? null) as string | null;
  const nonStriker = (row.non_striker ?? row.nonstriker ?? null) as string | null;
  const runsBatter = Number(row.runs_off_bat ?? row.runs_batter ?? row.batsman_runs ?? 0);
  const runsExtra = Number(row.extras ?? row.runs_extra ?? row.extra_runs ?? 0);
  const runsTotal = Number(row.runs_total ?? row.total_runs ?? (runsBatter + runsExtra));
  const extrasType = (row.extras_type ?? row.extras_kind ?? (row.wide ? "wide" : row.noball ? "noball" : row.bye ? "bye" : row.legbye ? "legbye" : null)) as string | null;
  const wicketType = (row.wicket_type ?? row.dismissal_kind ?? row.dismissal_type ?? row.kind ?? null) as string | null;
  const playerOut = (row.player_dismissed ?? row.player_out ?? null) as string | null;
  const isWicket = Boolean(wicketType || playerOut) || String(row.is_wicket ?? "").toLowerCase() === "true";
  const fielder = (row.fielder ?? row.fielders_involved ?? null) as string | null;
  return {
    id: `tigzig:${matchId}:${inningsNo}:${over}:${ball}`,
    innings_id: `tigzig:${matchId}:${inningsNo}`,
    match_id: `tigzig:${matchId}`,
    over,
    ball,
    batter,
    bowler,
    non_striker: nonStriker,
    runs_batter: runsBatter,
    runs_extra: runsExtra,
    runs_total: runsTotal,
    extras_type: extrasType,
    is_wicket: isWicket,
    wicket_type: wicketType,
    player_out: playerOut,
    fielder,
    created_at: null,
  };
}

// ─── Merge Helpers ──────────────────────────────────────────────────────────

export function mergeRemoteMatches(local: unknown[], remoteRows: TigzigRow[]): MatchJSON[] {
  const merged = new Map<string, MatchJSON>();
  for (const row of local) {
    if (row && typeof row === "object") {
      const item = row as MatchJSON;
      merged.set(String(item.match_id), item);
    }
  }
  for (const row of remoteRows) {
    const item = remoteMatch(row);
    if (item && !merged.has(String(item.match_id))) merged.set(String(item.match_id), item);
  }
  return [...merged.values()].sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
}

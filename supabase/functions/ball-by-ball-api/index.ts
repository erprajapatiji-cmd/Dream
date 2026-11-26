import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-API-Key",
};

// ─── Types ──────────────────────────────────────────────────────────────────

type AdminClient = ReturnType<typeof createClient>;

interface MatchFilters {
  matchId: string | null;
  format: string | null;
  season: string | null;
  team: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  search: string | null;
}

interface MatchJSON {
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

interface InningsJSON {
  innings_no: number;
  batting_team: string | null;
  bowling_team: string | null;
  total_runs: number;
  total_wickets: number;
  total_overs: number;
}

interface BallJSON {
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

interface PlayerStatsJSON {
  player: string;
  matches: number;
  batting: {
    runs: number;
    balls: number;
    outs: number;
    six_count: number;
    average: number | null;
    strike_rate: number | null;
  };
  bowling: {
    runs_conceded: number;
    balls: number;
    wickets: number;
    economy: number | null;
    average: number | null;
  };
}

type TigzigRow = Record<string, unknown>;

type SupabaseQuery = {
  eq: (column: string, value: string) => SupabaseQuery;
  or: (filter: string) => SupabaseQuery;
  gte: (column: string, value: string) => SupabaseQuery;
  lte: (column: string, value: string) => SupabaseQuery;
  order: (column: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) => SupabaseQuery;
  range: (from: number, to: number) => SupabaseQuery;
};

// ─── Constants ──────────────────────────────────────────────────────────────

const MATCH_COLUMNS = "id, match_id, match_format, season, city, date, team1, team2, toss_winner, toss_decision, result, result_margin, player_of_match, venue, umpire1, umpire2, created_at";
const TIGZIG_URL = "https://db-mcp.tigzig.com/v1/query/postgres";
const TIGZIG_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const TIGZIG_TIMEOUT_MS = 10000;
const TIGZIG_MAX_RETRIES = 3;
const MAX_FILTER_LENGTH = 100;
const MAX_SEARCH_LENGTH = 100;
const MAX_MATCH_ID_LENGTH = 50;

// In-flight deduplication: identical concurrent SQL queries share a single TigZig call.
const inFlight = new Map<string, Promise<TigzigRow[]>>();

// ─── Helpers ────────────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status: number): Response {
  return json({ error: message }, status);
}

async function hashKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function validateApiKey(req: Request, supabase: AdminClient): Promise<boolean> {
  const apiKey = req.headers.get("X-API-Key") || req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!apiKey || apiKey.length < 20) return false;

  const keyHash = await hashKey(apiKey);
  const { data, error } = await supabase
    .from("api_keys")
    .select("id, is_active")
    .eq("key_hash", keyHash)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) return false;

  await supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return true;
}

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

function normalizeFormat(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ");
  if (!normalized) return null;
  if (FORMAT_MAP[normalized]) return FORMAT_MAP[normalized];
  // Fuzzy fallback
  if (/^(t20|twenty20|twenty 20)/.test(normalized) || /\b(ipl|bbl|psl|cpl)\b/.test(normalized)) return "T20";
  if (/^(odi|one day)/.test(normalized)) return "ODI";
  if (/^test/.test(normalized)) return "Test";
  if (/first class/.test(normalized)) return "First Class";
  if (/list a/.test(normalized)) return "List A";
  if (/^t10/.test(normalized)) return "T10";
  return null;
}

function normalizeTigzigFormat(raw: unknown): string {
  const value = String(raw ?? "Unknown").trim().toUpperCase();
  if (value === "TEST") return "Test";
  if (value === "IPL" || value === "T20" || value === "T20I") return "T20";
  if (value === "ODI") return "ODI";
  if (value === "T10") return "T10";
  if (value === "FIRST CLASS" || value === "FIRSTCLASS") return "First Class";
  if (value === "LIST A" || value === "LISTA") return "List A";
  return "Unknown";
}

// ─── Input Validation & Escaping ────────────────────────────────────────────

function truncate(value: string | null, max: number): string | null {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

function escapePostgrest(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function validDate(value: string | null): boolean {
  return !value || /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseMatchFilters(url: URL): MatchFilters | { error: string } {
  const formatInput = truncate(url.searchParams.get("format"), MAX_FILTER_LENGTH);
  const format = normalizeFormat(formatInput);
  if (formatInput && !format) return { error: "Invalid format filter" };

  const dateFrom = url.searchParams.get("date_from");
  const dateTo = url.searchParams.get("date_to");
  if (!validDate(dateFrom) || !validDate(dateTo)) return { error: "Dates must use YYYY-MM-DD format" };
  if (dateFrom && dateTo && dateFrom > dateTo) return { error: "date_from cannot be after date_to" };

  return {
    matchId: truncate(url.searchParams.get("match_id"), MAX_MATCH_ID_LENGTH),
    format,
    season: truncate(url.searchParams.get("season"), MAX_FILTER_LENGTH),
    team: truncate(url.searchParams.get("team"), MAX_FILTER_LENGTH),
    dateFrom,
    dateTo,
    search: truncate(url.searchParams.get("search"), MAX_SEARCH_LENGTH),
  };
}

function filtersObject(playerName: string | null, filters: MatchFilters): Record<string, unknown> {
  return {
    player: playerName,
    match_id: filters.matchId,
    format: filters.format,
    season: filters.season,
    team: filters.team,
    date_from: filters.dateFrom,
    date_to: filters.dateTo,
  };
}

function applyMatchFilters(query: SupabaseQuery, filters: MatchFilters): SupabaseQuery {
  let next = query;
  if (filters.matchId) next = next.eq("match_id", filters.matchId);
  if (filters.format) next = next.eq("match_format", filters.format);
  if (filters.season) next = next.eq("season", filters.season);
  if (filters.team) {
    const escaped = escapePostgrest(filters.team.toLowerCase());
    next = next.or(`team1.ilike.%${escaped}%,team2.ilike.%${escaped}%`);
  }
  if (filters.dateFrom) next = next.gte("date", filters.dateFrom);
  if (filters.dateTo) next = next.lte("date", filters.dateTo);
  return next;
}

// ─── SQL Escaping for TigZig ────────────────────────────────────────────────

function sqlText(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlDate(value: string | null): string {
  return value ? `DATE ${sqlText(value)}` : "DATE '1900-01-01'";
}

function tigzigFormatFilter(format: string | null): string | null {
  if (!format) return null;
  if (format === "Test") return "TEST";
  if (format === "T20") return "('T20','T20I','IPL')";
  if (format === "ODI") return "ODI";
  if (format === "T10") return "T10";
  return null;
}

// ─── TigZig Row Normalization ───────────────────────────────────────────────

function normalizeTigzigRows(payload: unknown): TigzigRow[] {
  if (Array.isArray(payload)) return payload.filter((row): row is TigzigRow => Boolean(row && typeof row === "object" && !Array.isArray(row)));
  if (!payload || typeof payload !== "object") return [];
  const body = payload as { columns?: unknown; rows?: unknown; data?: unknown; result?: unknown };
  const rows = Array.isArray(body.rows) ? body.rows : Array.isArray(body.data) ? body.data : Array.isArray(body.result) ? body.result : [];
  if (!Array.isArray(body.columns)) return rows.filter((row): row is TigzigRow => Boolean(row && typeof row === "object" && !Array.isArray(row)));
  return rows.map((row) => {
    if (!Array.isArray(row)) return row as TigzigRow;
    return Object.fromEntries(body.columns.map((column, index) => [String(column), row[index]]));
  });
}

// ─── Rate-Limit Shield ──────────────────────────────────────────────────────

async function waitForTigzigSlot(supabase: AdminClient): Promise<void> {
  const { data, error } = await supabase.rpc("claim_tigzig_request_slot");
  if (error) throw new Error("TigZig request gate unavailable");
  const scheduled = new Date(String(data)).getTime();
  const delay = scheduled - Date.now();
  if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
}

async function fetchTigzigRows(supabase: AdminClient, sql: string): Promise<TigzigRow[]> {
  const queryHash = await hashKey(sql);
  const now = new Date().toISOString();
  const { data: cached, error: cacheError } = await supabase
    .from("tigzig_sql_cache")
    .select("response_json, expires_at")
    .eq("query_hash", queryHash)
    .gt("expires_at", now)
    .maybeSingle();
  if (!cacheError && cached?.response_json) return normalizeTigzigRows(cached.response_json);

  const existing = inFlight.get(queryHash);
  if (existing) return existing;

  const promise = (async (): Promise<TigzigRow[]> => {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < TIGZIG_MAX_RETRIES; attempt++) {
      try {
        await waitForTigzigSlot(supabase);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIGZIG_TIMEOUT_MS);
        const response = await fetch(TIGZIG_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ sql }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!response.ok) {
          const message = `TigZig returned ${response.status}`;
          // 4xx other than 429 are not retryable
          if (response.status !== 429 && response.status < 500) throw new Error(message);
          // Retryable: 429, 5xx. Honor Retry-After for 429.
          if (response.status === 429 && attempt < TIGZIG_MAX_RETRIES - 1) {
            const retryAfter = Number.parseInt(response.headers.get("Retry-After") ?? "", 10);
            const delayMs = retryAfter > 0 ? retryAfter * 1000 : 2500;
            await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
            continue;
          }
          throw new Error(message);
        }
        const payload = await response.json();
        const rows = normalizeTigzigRows(payload);
        await supabase.from("tigzig_sql_cache").upsert({
          query_hash: queryHash,
          sql_query: sql,
          response_json: payload,
          expires_at: new Date(Date.now() + TIGZIG_CACHE_TTL_MS).toISOString(),
        }, { onConflict: "query_hash" });
        return rows;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const isTimeout = lastError.name === "AbortError";
        const is5xx = /TigZig returned 5\d\d/.test(lastError.message);
        const is429 = /TigZig returned 429/.test(lastError.message);
        if (!isTimeout && !is5xx && !is429) break;
        if (attempt === TIGZIG_MAX_RETRIES - 1) break;
        await new Promise<void>((resolve) => setTimeout(resolve, 2500));
      }
    }
    console.warn("TigZig fallback unavailable", lastError?.message);
    return [];
  })();

  inFlight.set(queryHash, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(queryHash);
  }
}

// ─── Match Mapping (TigZig → local JSON shape) ──────────────────────────────

function remoteMatch(row: TigzigRow): MatchJSON | null {
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

function mapTigzigBall(row: TigzigRow): BallJSON {
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

// ─── TigZig SQL Builders ────────────────────────────────────────────────────

function buildMatchWhereConditions(filters: MatchFilters, latestDate: string | null): string[] {
  const conditions: string[] = [];
  // For list queries: only fetch matches after latestDate to avoid redundant rows.
  // For exact match_id queries: fetch regardless of date (latestDate is null).
  if (latestDate) {
    conditions.push(`m.start_date > ${sqlDate(latestDate)}`);
  }
  if (filters.matchId) conditions.push(`m.match_id::text = ${sqlText(filters.matchId)}`);
  const fmtFilter = tigzigFormatFilter(filters.format);
  if (fmtFilter) {
    if (fmtFilter.startsWith("(")) {
      conditions.push(`m.match_type IN ${fmtFilter}`);
    } else {
      conditions.push(`m.match_type = ${sqlText(fmtFilter)}`);
    }
  }
  if (filters.season) conditions.push(`m.season = ${sqlText(filters.season)}`);
  if (filters.team) conditions.push(`(m.team1 ILIKE '%' || ${sqlText(filters.team)} || '%' OR m.team2 ILIKE '%' || ${sqlText(filters.team)} || '%')`);
  if (filters.dateFrom) conditions.push(`m.start_date >= ${sqlDate(filters.dateFrom)}`);
  if (filters.dateTo) conditions.push(`m.start_date <= ${sqlDate(filters.dateTo)}`);
  if (filters.search) conditions.push(`(m.match_id::text ILIKE '%' || ${sqlText(filters.search)} || '%' OR m.team1 ILIKE '%' || ${sqlText(filters.search)} || '%' OR m.team2 ILIKE '%' || ${sqlText(filters.search)} || '%' OR m.venue ILIKE '%' || ${sqlText(filters.search)} || '%' OR m.city ILIKE '%' || ${sqlText(filters.search)} || '%')`);
  return conditions;
}

function remoteMatchSql(filters: MatchFilters, latestDate: string | null): string {
  const conditions = buildMatchWhereConditions(filters, latestDate);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return `SELECT m.match_id, m.match_type, m.team1, m.team2, m.season, m.start_date, m.venue, m.city, m.toss_winner, m.toss_decision, m.winner, m.winner_runs, m.winner_wickets, m.player_of_match1, m.umpire1, m.umpire2 FROM match_info m ${where} ORDER BY m.start_date DESC LIMIT 1000`;
}

// Single exact match query — no date filter, fetch by match_id only.
function remoteExactMatchSql(matchId: string): string {
  return `SELECT m.match_id, m.match_type, m.team1, m.team2, m.season, m.start_date, m.venue, m.city, m.toss_winner, m.toss_decision, m.winner, m.winner_runs, m.winner_wickets, m.player_of_match1, m.umpire1, m.umpire2 FROM match_info m WHERE m.match_id::text = ${sqlText(matchId)} LIMIT 1`;
}

// Ball-by-ball fallback for a specific match from TigZig.
function remoteMatchBallsSql(matchId: string, inningsNo?: number): string {
  const inningsCond = inningsNo ? ` AND b.innings_no = ${inningsNo}` : "";
  return `SELECT b.match_id, b.innings_no, b.over, b.ball, b.striker, b.bowler, b.non_striker, b.runs_off_bat, b.extras, b.runs_total, b.extras_type, b.wicket_type, b.player_dismissed, b.fielder, b.wide, b.noball, b.bye, b.legbye FROM ball_by_ball b WHERE b.match_id::text = ${sqlText(matchId)}${inningsCond} ORDER BY b.innings_no, b.over, b.ball LIMIT 2000`;
}

// Innings-level data from TigZig for a specific match.
function remoteInningsSql(matchId: string): string {
  return `SELECT b.innings_no, MIN(m.team1) AS batting_team, MIN(m.team2) AS bowling_team, COALESCE(sum(b.runs_total), 0) AS total_runs, count(*) FILTER (WHERE b.wicket_type IS NOT NULL OR b.player_dismissed IS NOT NULL) AS total_wickets, ROUND(COUNT(*)::numeric / 6, 1) AS total_overs FROM ball_by_ball b JOIN match_info m ON b.match_id = m.match_id WHERE b.match_id::text = ${sqlText(matchId)} GROUP BY b.innings_no ORDER BY b.innings_no`;
}

function remotePlayerStatsSql(playerName: string, filters: MatchFilters, latestDate: string | null): string {
  const nameLower = sqlText(playerName.toLowerCase());
  const conditions = buildMatchWhereConditions(filters, latestDate);
  const whereClause = conditions.length > 0 ? conditions.join(" AND ") + " AND " : "";
  return `SELECT count(DISTINCT b.match_id) AS matches, COALESCE(sum(CASE WHEN lower(b.striker) = ${nameLower} THEN b.runs_off_bat ELSE 0 END), 0) AS runs, count(*) FILTER (WHERE lower(b.striker) = ${nameLower}) AS balls, count(*) FILTER (WHERE lower(b.player_dismissed) = ${nameLower}) AS outs, count(*) FILTER (WHERE lower(b.striker) = ${nameLower} AND b.runs_off_bat = 6) AS six_count, COALESCE(sum(CASE WHEN lower(b.bowler) = ${nameLower} THEN b.runs_off_bat + COALESCE(b.extras, 0) ELSE 0 END), 0) AS runs_conceded, count(*) FILTER (WHERE lower(b.bowler) = ${nameLower}) AS bowling_balls, count(*) FILTER (WHERE lower(b.bowler) = ${nameLower} AND b.wicket_type IS NOT NULL) AS wickets FROM ball_by_ball b JOIN match_info m ON b.match_id = m.match_id WHERE ${whereClause}(lower(b.striker) = ${nameLower} OR lower(b.non_striker) = ${nameLower} OR lower(b.bowler) = ${nameLower} OR lower(b.player_dismissed) = ${nameLower})`;
}

function remotePlayerMatchesSql(playerName: string, filters: MatchFilters, latestDate: string | null): string {
  const nameLower = sqlText(playerName.toLowerCase());
  const conditions = buildMatchWhereConditions(filters, latestDate);
  const whereClause = conditions.length > 0 ? conditions.join(" AND ") + " AND " : "";
  return `SELECT DISTINCT m.match_id, m.match_type, m.team1, m.team2, m.season, m.start_date, m.venue, m.city, m.toss_winner, m.toss_decision, m.winner, m.winner_runs, m.winner_wickets, m.player_of_match1, m.umpire1, m.umpire2 FROM match_info m JOIN ball_by_ball b ON m.match_id = b.match_id WHERE ${whereClause}(lower(b.striker) = ${nameLower} OR lower(b.non_striker) = ${nameLower} OR lower(b.bowler) = ${nameLower} OR lower(b.player_dismissed) = ${nameLower}) ORDER BY m.start_date DESC LIMIT 1000`;
}

// ─── Local-First Helpers ────────────────────────────────────────────────────

async function latestLocalMatchDate(supabase: AdminClient, filters: MatchFilters): Promise<string | null> {
  let query = supabase.from("matches").select("date").not("date", "is", null).order("date", { ascending: false }).limit(1);
  if (filters.matchId) query = query.eq("match_id", filters.matchId);
  if (filters.format) query = query.eq("match_format", filters.format);
  if (filters.season) query = query.eq("season", filters.season);
  if (filters.team) {
    const escaped = escapePostgrest(filters.team.toLowerCase());
    query = query.or(`team1.ilike.%${escaped}%,team2.ilike.%${escaped}%`);
  }
  if (filters.dateFrom) query = query.gte("date", filters.dateFrom);
  if (filters.dateTo) query = query.lte("date", filters.dateTo);
  if (filters.search) {
    const escaped = escapePostgrest(filters.search.toLowerCase());
    query = query.or(`match_id.ilike.%${escaped}%,team1.ilike.%${escaped}%,team2.ilike.%${escaped}%,venue.ilike.%${escaped}%,city.ilike.%${escaped}%`);
  }
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return data?.date ?? null;
}

function mergeRemoteMatches(local: unknown[], remoteRows: TigzigRow[]): MatchJSON[] {
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

function latestDateFromRows(rows: unknown[]): string | null {
  const dates = rows
    .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object"))
    .map((row) => String(row.date ?? ""))
    .filter(Boolean)
    .sort();
  return dates.at(-1) ?? null;
}

// ─── Handlers ───────────────────────────────────────────────────────────────

async function handleMatches(supabase: AdminClient, url: URL): Promise<Response> {
  const parsed = parseMatchFilters(url);
  if ("error" in parsed) return errorResponse(parsed.error, 400);

  const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "100", 10);
  if (!Number.isInteger(page) || page < 1) return errorResponse("page must be a positive integer", 400);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) return errorResponse("limit must be between 1 and 500", 400);

  // Fetch ALL local matches for the active filters (not just one page) so we can
  // merge with TigZig and then deterministically slice.
  let localQuery = supabase
    .from("matches")
    .select(MATCH_COLUMNS)
    .order("date", { ascending: false, nullsFirst: false }) as unknown as SupabaseQuery;
  localQuery = applyMatchFilters(localQuery, parsed);
  if (parsed.search) {
    const escaped = escapePostgrest(parsed.search.toLowerCase());
    localQuery = localQuery.or(`match_id.ilike.%${escaped}%,team1.ilike.%${escaped}%,team2.ilike.%${escaped}%,venue.ilike.%${escaped}%,city.ilike.%${escaped}%`);
  }
  const localResult = await (localQuery as unknown as { data: MatchJSON[] | null; error: { message: string } | null });
  if (localResult.error) throw new Error(localResult.error.message);
  const localMatches = localResult.data ?? [];

  // Fetch TigZig for the active filters, bounded to 1000 rows.
  // Use latestLocalDate to limit the window, but don't restrict to only-newer matches
  // when searching by exact match_id.
  const latestDate = await latestLocalMatchDate(supabase, parsed);
  const remoteRows = await fetchTigzigRows(supabase, remoteMatchSql(parsed, latestDate));

  // Merge and deduplicate by canonical string match_id, then slice for the page.
  const merged = mergeRemoteMatches(localMatches, remoteRows);
  const total = merged.length;
  const from = (page - 1) * limit;
  const pageMatches = merged.slice(from, from + limit);
  const totalPages = Math.ceil(total / limit) || 0;
  return json({
    matches: pageMatches,
    pagination: { page, limit, total, total_pages: totalPages, has_next: page < totalPages },
  });
}

async function handleMatchInnings(supabase: AdminClient, matchId: string): Promise<Response> {
  // Local-first: check if match exists locally
  const { data: match, error: matchError } = await supabase
    .from("matches")
    .select("id, match_id, match_format, season, city, date, team1, team2, toss_winner, toss_decision, result, result_margin, player_of_match, venue, umpire1, umpire2")
    .eq("match_id", matchId)
    .maybeSingle();
  if (matchError) throw new Error(matchError.message);

  if (match) {
    const { data: innings, error } = await supabase
      .from("innings")
      .select("innings_no, batting_team, bowling_team, total_runs, total_wickets, total_overs")
      .eq("match_id", match.id)
      .order("innings_no");
    if (error) throw new Error(error.message);
    return json({ match, innings: innings ?? [] });
  }

  // Fallback: fetch from TigZig regardless of date
  const remoteMatchRows = await fetchTigzigRows(supabase, remoteExactMatchSql(matchId));
  const remoteMatchItem = remoteMatchRows.length > 0 ? remoteMatch(remoteMatchRows[0]) : null;
  if (!remoteMatchItem) return errorResponse("Match not found", 404);

  const remoteInningsRows = await fetchTigzigRows(supabase, remoteInningsSql(matchId));
  const innings: InningsJSON[] = remoteInningsRows.map((row) => ({
    innings_no: Number(row.innings_no ?? 1),
    batting_team: (row.batting_team ?? null) as string | null,
    bowling_team: (row.bowling_team ?? null) as string | null,
    total_runs: Number(row.total_runs ?? 0),
    total_wickets: Number(row.total_wickets ?? 0),
    total_overs: Number(row.total_overs ?? 0),
  }));
  return json({ match: remoteMatchItem, innings });
}

async function handleInningsBalls(supabase: AdminClient, matchId: string, inningsNo: number): Promise<Response> {
  // Local-first
  const { data: match } = await supabase.from("matches").select("id").eq("match_id", matchId).maybeSingle();
  if (match) {
    const { data: inning } = await supabase
      .from("innings")
      .select("id")
      .eq("match_id", match.id)
      .eq("innings_no", inningsNo)
      .maybeSingle();
    if (inning) {
      const { data: balls, error } = await supabase
        .from("ball_by_balls")
        .select("*")
        .eq("innings_id", inning.id)
        .order("over")
        .order("ball");
      if (error) throw new Error(error.message);
      return json({ balls: balls ?? [] });
    }
  }

  // Fallback: fetch from TigZig
  const remoteRows = await fetchTigzigRows(supabase, remoteMatchBallsSql(matchId, inningsNo));
  if (remoteRows.length === 0) return errorResponse("Innings not found", 404);
  const balls: BallJSON[] = remoteRows.map(mapTigzigBall);
  return json({ balls });
}

async function handleMatchBalls(supabase: AdminClient, matchId: string): Promise<Response> {
  // Local-first
  const { data: match } = await supabase.from("matches").select("id").eq("match_id", matchId).maybeSingle();
  if (match) {
    const { data: balls, error } = await supabase
      .from("ball_by_balls")
      .select("*")
      .eq("match_id", match.id)
      .order("over")
      .order("ball");
    if (error) throw new Error(error.message);
    if (balls && balls.length > 0) return json({ balls });
  }

  // Fallback: fetch from TigZig
  const remoteRows = await fetchTigzigRows(supabase, remoteMatchBallsSql(matchId));
  const balls: BallJSON[] = remoteRows.map(mapTigzigBall);
  return json({ balls });
}

// ─── Player Handlers ────────────────────────────────────────────────────────

function emptyPlayerStats(playerName: string): PlayerStatsJSON {
  return {
    player: playerName,
    matches: 0,
    batting: { runs: 0, balls: 0, outs: 0, six_count: 0, average: null, strike_rate: null },
    bowling: { runs_conceded: 0, balls: 0, wickets: 0, economy: null, average: null },
  };
}

function mergeRemoteStats(local: PlayerStatsJSON, remote: TigzigRow | undefined): PlayerStatsJSON {
  if (!remote) return local;
  const remoteMatches = Number(remote.matches ?? 0);
  const remoteRuns = Number(remote.runs ?? 0);
  const remoteBalls = Number(remote.balls ?? 0);
  const remoteOuts = Number(remote.outs ?? 0);
  const remoteSixes = Number(remote.six_count ?? 0);
  const remoteConceded = Number(remote.runs_conceded ?? 0);
  const remoteBowlingBalls = Number(remote.bowling_balls ?? 0);
  const remoteWickets = Number(remote.wickets ?? 0);
  const runs = local.batting.runs + remoteRuns;
  const balls = local.batting.balls + remoteBalls;
  const outs = local.batting.outs + remoteOuts;
  const runsConceded = local.bowling.runs_conceded + remoteConceded;
  const bowlingBalls = local.bowling.balls + remoteBowlingBalls;
  const wickets = local.bowling.wickets + remoteWickets;
  return {
    ...local,
    matches: local.matches + remoteMatches,
    batting: {
      ...local.batting,
      runs,
      balls,
      outs,
      six_count: local.batting.six_count + remoteSixes,
      average: outs > 0 ? Number((runs / outs).toFixed(2)) : null,
      strike_rate: balls > 0 ? Number((runs * 100 / balls).toFixed(2)) : null,
    },
    bowling: {
      ...local.bowling,
      runs_conceded: runsConceded,
      balls: bowlingBalls,
      wickets,
      economy: bowlingBalls > 0 ? Number((runsConceded * 6 / bowlingBalls).toFixed(2)) : null,
      average: wickets > 0 ? Number((runsConceded / wickets).toFixed(2)) : null,
    },
  };
}

async function handlePlayerStats(supabase: AdminClient, playerName: string, url: URL): Promise<Response> {
  const parsed = parseMatchFilters(url);
  if ("error" in parsed) return errorResponse(parsed.error, 400);
  const { data, error } = await supabase.rpc("player_career_stats", { p_name: playerName, p_match_id: parsed.matchId, p_format: parsed.format, p_season: parsed.season, p_team: parsed.team, p_date_from: parsed.dateFrom, p_date_to: parsed.dateTo });
  if (error) console.warn("Local player stats unavailable", error.message);
  const localStats: PlayerStatsJSON = (error || !data) ? emptyPlayerStats(playerName) : data as PlayerStatsJSON;
  const latestDate = await latestLocalMatchDate(supabase, parsed);
  const rows = await fetchTigzigRows(supabase, remotePlayerStatsSql(playerName, parsed, latestDate));
  return json({ filters: filtersObject(playerName, parsed), stats: mergeRemoteStats(localStats, rows[0]) });
}

async function handlePlayerMatches(supabase: AdminClient, playerName: string, url: URL): Promise<Response> {
  const parsed = parseMatchFilters(url);
  if ("error" in parsed) return errorResponse(parsed.error, 400);
  const { data, error } = await supabase.rpc("player_matches", { p_name: playerName, p_match_id: parsed.matchId, p_format: parsed.format, p_season: parsed.season, p_team: parsed.team, p_date_from: parsed.dateFrom, p_date_to: parsed.dateTo });
  if (error) console.warn("Local player matches unavailable", error.message);
  const localRows = (error ? [] : data ?? []) as unknown[];
  const latestDate = latestDateFromRows(localRows);
  const remoteRows = await fetchTigzigRows(supabase, remotePlayerMatchesSql(playerName, parsed, latestDate));
  return json({ filters: filtersObject(playerName, parsed), matches: mergeRemoteMatches(localRows, remoteRows) });
}

async function handlePlayerMatchBalls(supabase: AdminClient, playerName: string, matchId: string, url: URL): Promise<Response> {
  // Local-first
  const { data: match } = await supabase.from("matches").select("id").eq("match_id", matchId).maybeSingle();

  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get("limit") ?? "500", 10) || 500, 1), 2000);
  const offset = Math.max(Number.parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);

  if (match) {
    const { data: balls, error } = await supabase.rpc("player_match_balls", {
      p_name: playerName,
      p_match_id: matchId,
      p_limit: limit,
      p_offset: offset,
    });
    if (!error && balls && (balls as unknown[]).length > 0) {
      return json({ balls });
    }
  }

  // Fallback: fetch from TigZig, then filter to the player
  const remoteRows = await fetchTigzigRows(supabase, remoteMatchBallsSql(matchId));
  const nameLower = playerName.toLowerCase();
  const allBalls: BallJSON[] = remoteRows.map(mapTigzigBall);
  const playerBalls = allBalls.filter((b) =>
    (b.batter?.toLowerCase() === nameLower) ||
    (b.bowler?.toLowerCase() === nameLower) ||
    (b.non_striker?.toLowerCase() === nameLower) ||
    (b.player_out?.toLowerCase() === nameLower) ||
    (b.fielder?.toLowerCase() === nameLower)
  );
  return json({ balls: playerBalls.slice(offset, offset + limit) });
}

// ─── Router ─────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "GET") return errorResponse("Method not allowed", 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) return errorResponse("Server not configured", 500);
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    if (!(await validateApiKey(req, supabase))) return errorResponse("Invalid or missing API key", 401);

    const url = new URL(req.url);
    const path = url.pathname.replace(/^.*\/ball-by-ball-api/, "");
    const segments = path.split("/").filter(Boolean);
    const playerName = segments[0] === "players" ? decodeURIComponent(segments[1]) : null;

    if (segments.length === 1 && segments[0] === "matches") {
      return handleMatches(supabase, url);
    }
    if (segments.length === 3 && segments[0] === "matches" && segments[2] === "innings") {
      return handleMatchInnings(supabase, segments[1]);
    }
    if (segments.length === 5 && segments[0] === "matches" && segments[2] === "innings" && segments[4] === "balls") {
      const inningsNo = Number.parseInt(segments[3], 10);
      if (!Number.isInteger(inningsNo) || inningsNo < 1) return errorResponse("Invalid innings number", 400);
      return handleInningsBalls(supabase, segments[1], inningsNo);
    }
    if (segments.length === 3 && segments[0] === "matches" && segments[2] === "balls") {
      return handleMatchBalls(supabase, segments[1]);
    }
    if (segments.length === 3 && segments[0] === "players" && segments[2] === "stats") {
      return handlePlayerStats(supabase, playerName!, url);
    }
    if (segments.length === 3 && segments[0] === "players" && segments[2] === "matches") {
      return handlePlayerMatches(supabase, playerName!, url);
    }
    if (segments.length === 5 && segments[0] === "players" && segments[2] === "matches" && segments[4] === "balls") {
      return handlePlayerMatchBalls(supabase, playerName!, segments[3], url);
    }

    return errorResponse("Not found", 404);
  } catch (error) {
    console.error("ball-by-ball-api failed", error);
    return errorResponse("Internal server error", 500);
  }
});

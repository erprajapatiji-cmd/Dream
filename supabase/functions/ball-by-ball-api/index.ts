import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-API-Key",
};

const formats = new Set(["T20", "ODI", "Test", "T10", "First Class", "List A", "Unknown"]);
const playerRoles = ["batter", "bowler", "non_striker", "player_out", "fielder"] as const;
type PlayerRole = (typeof playerRoles)[number];

type AdminClient = ReturnType<typeof createClient>;
type MatchFilters = {
  matchId: string | null;
  format: string | null;
  season: string | null;
  team: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  search: string | null;
};

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

async function fetchAllRows<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await query(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function normalizeFormat(value: string | null): string | null {
  if (!value) return null;
  const match = [...formats].find((format) => format.toLowerCase() === value.trim().toLowerCase());
  return match ?? null;
}

function validDate(value: string | null): boolean {
  return !value || /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseMatchFilters(url: URL): MatchFilters | { error: string } {
  const formatInput = url.searchParams.get("format");
  const format = normalizeFormat(formatInput);
  if (formatInput && !format) return { error: "Invalid format filter" };

  const dateFrom = url.searchParams.get("date_from");
  const dateTo = url.searchParams.get("date_to");
  if (!validDate(dateFrom) || !validDate(dateTo)) return { error: "Dates must use YYYY-MM-DD format" };
  if (dateFrom && dateTo && dateFrom > dateTo) return { error: "date_from cannot be after date_to" };

  return {
    matchId: url.searchParams.get("match_id"),
    format,
    season: url.searchParams.get("season"),
    team: url.searchParams.get("team"),
    dateFrom,
    dateTo,
    search: url.searchParams.get("search"),
  };
}

function applyDatabaseMatchFilters(query: any, filters: MatchFilters): any {
  let next = query;
  if (filters.matchId) next = next.eq("match_id", filters.matchId);
  if (filters.format) next = next.eq("match_format", filters.format);
  if (filters.season) next = next.eq("season", filters.season);
  if (filters.dateFrom) next = next.gte("date", filters.dateFrom);
  if (filters.dateTo) next = next.lte("date", filters.dateTo);
  return next;
}

async function fetchMatches(supabase: AdminClient, filters: MatchFilters): Promise<any[]> {
  const rows = await fetchAllRows((from, to) => {
    let query = supabase
      .from("matches")
      .select("id, match_id, match_format, season, city, date, team1, team2, toss_winner, toss_decision, result, result_margin, player_of_match, venue, umpire1, umpire2, created_at")
      .order("date", { ascending: false, nullsFirst: false })
      .range(from, to);
    query = applyDatabaseMatchFilters(query, filters);
    return query;
  });

  const teamNeedle = filters.team?.toLowerCase();
  const searchNeedle = filters.search?.toLowerCase();
  return rows.filter((match) => {
    if (teamNeedle && ![match.team1, match.team2].some((team: string | null) => team?.toLowerCase().includes(teamNeedle))) return false;
    if (searchNeedle && ![match.match_id, match.team1, match.team2, match.venue, match.city, match.player_of_match]
      .some((value: string | null) => value?.toLowerCase().includes(searchNeedle))) return false;
    return true;
  });
}

function filterMatchIds(matches: any[]): string[] {
  return matches.map((match) => match.id);
}

async function fetchPlayerRoleRows(
  supabase: AdminClient,
  playerName: string,
  role: PlayerRole,
  select: string,
  matchIds: string[],
): Promise<any[]> {
  const pattern = role === "fielder" ? `%${escapeLike(playerName)}%` : escapeLike(playerName);
  const idChunks = matchIds.length === 0 ? [null] : Array.from({ length: Math.ceil(matchIds.length / 500) }, (_, index) => matchIds.slice(index * 500, index * 500 + 500));
  const rows: any[] = [];

  for (const ids of idChunks) {
    const page = await fetchAllRows((from, to) => {
      let query = supabase.from("ball_by_balls").select(select).ilike(role, pattern).order("id").range(from, to);
      if (ids) query = query.in("match_id", ids);
      return query;
    });
    rows.push(...page);
  }
  return rows;
}

async function fetchPlayerParticipation(supabase: AdminClient, playerName: string, matchIds: string[]): Promise<Set<string>> {
  const roleRows = await Promise.all(playerRoles.map((role) => fetchPlayerRoleRows(supabase, playerName, role, "match_id", matchIds)));
  const ids = new Set<string>();
  for (const rows of roleRows) for (const row of rows) ids.add(row.match_id);
  return ids;
}

function emptyStats(player: string, filters: MatchFilters): unknown {
  return {
    filters: {
      player,
      match_id: filters.matchId,
      format: filters.format,
      season: filters.season,
      team: filters.team,
      date_from: filters.dateFrom,
      date_to: filters.dateTo,
    },
    stats: {
      player,
      matches: 0,
      batting: { runs: 0, balls: 0, outs: 0, six_count: 0, batting_position: null, average: null, strike_rate: null },
      bowling: { runs_conceded: 0, balls: 0, wickets: 0, economy: null, average: null },
    },
  };
}

async function getBattingPosition(supabase: AdminClient, playerName: string, matches: any[], filtered: boolean): Promise<number | null> {
  if (!filtered) {
    const { data, error } = await supabase.rpc("player_batting_positions", { p_name: playerName });
    if (error) throw new Error(error.message);
    const positions = (data ?? []).map((row: { batting_position: number }) => row.batting_position).filter(Number.isFinite);
    return positions.length ? +(positions.reduce((sum: number, value: number) => sum + value, 0) / positions.length).toFixed(2) : null;
  }

  const matchIds = filterMatchIds(matches);
  if (!matchIds.length) return null;
  const rows = await fetchPlayerRoleRows(supabase, playerName, "batter", "match_id, innings_id", matchIds);
  if (!rows.length) return null;
  return null;
}

async function handlePlayerStats(supabase: AdminClient, playerName: string, url: URL): Promise<Response> {
  const parsed = parseMatchFilters(url);
  if ("error" in parsed) return errorResponse(parsed.error, 400);
  const filters = parsed;
  const matches = await fetchMatches(supabase, filters);
  const matchIds = filterMatchIds(matches);
  const participation = await fetchPlayerParticipation(supabase, playerName, matchIds);
  if (!participation.size) return json(emptyStats(playerName, filters));

  const [batting, bowling] = await Promise.all([
    fetchPlayerRoleRows(supabase, playerName, "batter", "match_id, runs_batter, is_wicket, wicket_type, extras_type", matchIds),
    fetchPlayerRoleRows(supabase, playerName, "bowler", "match_id, runs_total, is_wicket, extras_type, wicket_type", matchIds),
  ]);

  const runs = batting.reduce((sum, row) => sum + (row.runs_batter || 0), 0);
  const legalBatting = batting.filter((row) => !["wide", "noball"].includes(String(row.extras_type ?? "").toLowerCase().replace(/[ _-]/g, "")));
  const outs = batting.filter((row) => row.is_wicket && row.wicket_type && !["run out", "retired hurt", "obstructing the field"].includes(String(row.wicket_type).toLowerCase())).length;
  const sixCount = batting.filter((row) => row.runs_batter === 6).length;
  const runsConceded = bowling.reduce((sum, row) => sum + (row.runs_total || 0), 0);
  const legalBowling = bowling.filter((row) => !["wide", "noball"].includes(String(row.extras_type ?? "").toLowerCase().replace(/[ _-]/g, "")));
  const wickets = bowling.filter((row) => row.is_wicket && row.wicket_type && !["run out", "retired hurt", "obstructing the field"].includes(String(row.wicket_type).toLowerCase())).length;
  const battingPosition = await getBattingPosition(supabase, playerName, matches, Boolean(filters.matchId || filters.format || filters.season || filters.team || filters.dateFrom || filters.dateTo));

  return json({
    filters: { player: playerName, match_id: filters.matchId, format: filters.format, season: filters.season, team: filters.team, date_from: filters.dateFrom, date_to: filters.dateTo },
    stats: {
      player: playerName,
      matches: participation.size,
      batting: {
        runs,
        balls: legalBatting.length,
        outs,
        six_count: sixCount,
        batting_position: battingPosition,
        average: outs > 0 ? +(runs / outs).toFixed(2) : null,
        strike_rate: legalBatting.length > 0 ? +((runs / legalBatting.length) * 100).toFixed(2) : null,
      },
      bowling: {
        runs_conceded: runsConceded,
        balls: legalBowling.length,
        wickets,
        economy: legalBowling.length > 0 ? +((runsConceded / legalBowling.length) * 6).toFixed(2) : null,
        average: wickets > 0 ? +(runsConceded / wickets).toFixed(2) : null,
      },
    },
  });
}

async function handlePlayerMatches(supabase: AdminClient, playerName: string, url: URL): Promise<Response> {
  const parsed = parseMatchFilters(url);
  if ("error" in parsed) return errorResponse(parsed.error, 400);
  const filters = parsed;
  const matches = await fetchMatches(supabase, filters);
  const participation = await fetchPlayerParticipation(supabase, playerName, filterMatchIds(matches));
  return json({
    filters: { player: playerName, match_id: filters.matchId, format: filters.format, season: filters.season, team: filters.team, date_from: filters.dateFrom, date_to: filters.dateTo },
    matches: matches.filter((match) => participation.has(match.id)),
  });
}

async function handlePlayerMatchBalls(supabase: AdminClient, playerName: string, matchId: string): Promise<Response> {
  const { data: match, error: matchError } = await supabase.from("matches").select("id").eq("match_id", matchId).maybeSingle();
  if (matchError) throw new Error(matchError.message);
  if (!match) return errorResponse("Match not found", 404);

  const roleRows = await Promise.all(playerRoles.map((role) => fetchPlayerRoleRows(supabase, playerName, role, "*", [match.id])));
  const byId = new Map<string, any>();
  for (const rows of roleRows) for (const row of rows) byId.set(row.id, row);
  const balls = [...byId.values()].sort((a, b) => a.over - b.over || a.ball - b.ball);
  return json({ balls });
}

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

    if (segments.length === 1 && segments[0] === "matches") {
      const parsed = parseMatchFilters(url);
      if ("error" in parsed) return errorResponse(parsed.error, 400);
      const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
      const limit = Number.parseInt(url.searchParams.get("limit") ?? "100", 10);
      if (!Number.isInteger(page) || page < 1) return errorResponse("page must be a positive integer", 400);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) return errorResponse("limit must be between 1 and 500", 400);
      const matches = await fetchMatches(supabase, parsed);
      const start = (page - 1) * limit;
      const pageRows = matches.slice(start, start + limit);
      const totalPages = Math.ceil(matches.length / limit);
      return json({ matches: pageRows, pagination: { page, limit, total: matches.length, total_pages: totalPages, has_next: page < totalPages } });
    }

    if (segments.length === 3 && segments[0] === "matches" && segments[2] === "innings") {
      const { data: match, error: matchError } = await supabase.from("matches").select("id, match_id, match_format, season, city, date, team1, team2, toss_winner, toss_decision, result, result_margin, player_of_match, venue, umpire1, umpire2").eq("match_id", segments[1]).maybeSingle();
      if (matchError) throw new Error(matchError.message);
      if (!match) return errorResponse("Match not found", 404);
      const { data: innings, error } = await supabase.from("innings").select("innings_no, batting_team, bowling_team, total_runs, total_wickets, total_overs").eq("match_id", match.id).order("innings_no");
      if (error) throw new Error(error.message);
      return json({ match, innings: innings ?? [] });
    }

    if (segments.length === 5 && segments[0] === "matches" && segments[2] === "innings" && segments[4] === "balls") {
      const inningsNo = Number.parseInt(segments[3], 10);
      if (!Number.isInteger(inningsNo) || inningsNo < 1) return errorResponse("Invalid innings number", 400);
      const { data: match } = await supabase.from("matches").select("id").eq("match_id", segments[1]).maybeSingle();
      if (!match) return errorResponse("Match not found", 404);
      const { data: inning } = await supabase.from("innings").select("id").eq("match_id", match.id).eq("innings_no", inningsNo).maybeSingle();
      if (!inning) return errorResponse("Innings not found", 404);
      const { data: balls, error } = await supabase.from("ball_by_balls").select("*").eq("innings_id", inning.id).order("over").order("ball");
      if (error) throw new Error(error.message);
      return json({ balls: balls ?? [] });
    }

    if (segments.length === 3 && segments[0] === "matches" && segments[2] === "balls") {
      const { data: match } = await supabase.from("matches").select("id").eq("match_id", segments[1]).maybeSingle();
      if (!match) return errorResponse("Match not found", 404);
      const { data: balls, error } = await supabase.from("ball_by_balls").select("*").eq("match_id", match.id).order("over").order("ball");
      if (error) throw new Error(error.message);
      return json({ balls: balls ?? [] });
    }

    if (segments.length === 3 && segments[0] === "players" && segments[2] === "stats") {
      return handlePlayerStats(supabase, decodeURIComponent(segments[1]), url);
    }

    if (segments.length === 3 && segments[0] === "players" && segments[2] === "matches") {
      return handlePlayerMatches(supabase, decodeURIComponent(segments[1]), url);
    }

    if (segments.length === 5 && segments[0] === "players" && segments[2] === "matches" && segments[4] === "balls") {
      return handlePlayerMatchBalls(supabase, decodeURIComponent(segments[1]), segments[3]);
    }

    return errorResponse("Not found", 404);
  } catch (error) {
    console.error("ball-by-ball-api failed", error);
    return errorResponse("Internal server error", 500);
  }
});

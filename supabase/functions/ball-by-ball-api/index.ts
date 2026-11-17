import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-API-Key",
};

const formats = new Set(["T20", "ODI", "Test", "T10", "First Class", "List A", "Unknown"]);

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

type SupabaseQuery = {
  eq: (column: string, value: string) => SupabaseQuery;
  or: (filter: string) => SupabaseQuery;
  gte: (column: string, value: string) => SupabaseQuery;
  lte: (column: string, value: string) => SupabaseQuery;
  order: (column: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) => SupabaseQuery;
  range: (from: number, to: number) => SupabaseQuery;
};

function applyMatchFilters(query: SupabaseQuery, filters: MatchFilters): SupabaseQuery {
  let next = query;
  if (filters.matchId) next = next.eq("match_id", filters.matchId);
  if (filters.format) next = next.eq("match_format", filters.format);
  if (filters.season) next = next.eq("season", filters.season);
  if (filters.team) {
    const team = filters.team.toLowerCase();
    next = next.or(`team1.ilike.%${team}%,team2.ilike.%${team}%`);
  }
  if (filters.dateFrom) next = next.gte("date", filters.dateFrom);
  if (filters.dateTo) next = next.lte("date", filters.dateTo);
  return next;
}

const MATCH_COLUMNS = "id, match_id, match_format, season, city, date, team1, team2, toss_winner, toss_decision, result, result_margin, player_of_match, venue, umpire1, umpire2, created_at";

async function handleMatches(supabase: AdminClient, url: URL): Promise<Response> {
  const parsed = parseMatchFilters(url);
  if ("error" in parsed) return errorResponse(parsed.error, 400);

  const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "100", 10);
  if (!Number.isInteger(page) || page < 1) return errorResponse("page must be a positive integer", 400);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) return errorResponse("limit must be between 1 and 500", 400);

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabase
    .from("matches")
    .select(MATCH_COLUMNS, { count: "exact" })
    .order("date", { ascending: false, nullsFirst: false })
    .range(from, to) as unknown as SupabaseQuery & { or: (filter: string) => SupabaseQuery & { data: unknown[]; error: { message: string } | null; count: number | null } };
  query = applyMatchFilters(query, parsed);

  const search = parsed.search?.toLowerCase();
  if (search) {
    query = query.or(`match_id.ilike.%${search}%,team1.ilike.%${search}%,team2.ilike.%${search}%,venue.ilike.%${search}%,city.ilike.%${search}%`);
  }

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);

  const total = count ?? 0;
  const totalPages = Math.ceil(total / limit) || 0;
  return json({
    matches: data ?? [],
    pagination: { page, limit, total, total_pages: totalPages, has_next: page < totalPages },
  });
}

async function handleMatchInnings(supabase: AdminClient, matchId: string): Promise<Response> {
  const { data: match, error: matchError } = await supabase
    .from("matches")
    .select("id, match_id, match_format, season, city, date, team1, team2, toss_winner, toss_decision, result, result_margin, player_of_match, venue, umpire1, umpire2")
    .eq("match_id", matchId)
    .maybeSingle();
  if (matchError) throw new Error(matchError.message);
  if (!match) return errorResponse("Match not found", 404);

  const { data: innings, error } = await supabase
    .from("innings")
    .select("innings_no, batting_team, bowling_team, total_runs, total_wickets, total_overs")
    .eq("match_id", match.id)
    .order("innings_no");
  if (error) throw new Error(error.message);
  return json({ match, innings: innings ?? [] });
}

async function handleInningsBalls(supabase: AdminClient, matchId: string, inningsNo: number): Promise<Response> {
  const { data: match } = await supabase.from("matches").select("id").eq("match_id", matchId).maybeSingle();
  if (!match) return errorResponse("Match not found", 404);
  const { data: inning } = await supabase
    .from("innings")
    .select("id")
    .eq("match_id", match.id)
    .eq("innings_no", inningsNo)
    .maybeSingle();
  if (!inning) return errorResponse("Innings not found", 404);
  const { data: balls, error } = await supabase
    .from("ball_by_balls")
    .select("*")
    .eq("innings_id", inning.id)
    .order("over")
    .order("ball");
  if (error) throw new Error(error.message);
  return json({ balls: balls ?? [] });
}

async function handleMatchBalls(supabase: AdminClient, matchId: string): Promise<Response> {
  const { data: match } = await supabase.from("matches").select("id").eq("match_id", matchId).maybeSingle();
  if (!match) return errorResponse("Match not found", 404);
  const { data: balls, error } = await supabase
    .from("ball_by_balls")
    .select("*")
    .eq("match_id", match.id)
    .order("over")
    .order("ball");
  if (error) throw new Error(error.message);
  return json({ balls: balls ?? [] });
}

async function handlePlayerStats(supabase: AdminClient, playerName: string, url: URL): Promise<Response> {
  const parsed = parseMatchFilters(url);
  if ("error" in parsed) return errorResponse(parsed.error, 400);

  const { data, error } = await supabase.rpc("player_career_stats", {
    p_name: playerName,
    p_match_id: parsed.matchId,
    p_format: parsed.format,
    p_season: parsed.season,
    p_team: parsed.team,
    p_date_from: parsed.dateFrom,
    p_date_to: parsed.dateTo,
  });
  if (error) throw new Error(error.message);

  const stats = data ?? {};
  return json({ filters: filtersObject(playerName, parsed), stats });
}

async function handlePlayerMatches(supabase: AdminClient, playerName: string, url: URL): Promise<Response> {
  const parsed = parseMatchFilters(url);
  if ("error" in parsed) return errorResponse(parsed.error, 400);

  const { data, error } = await supabase.rpc("player_matches", {
    p_name: playerName,
    p_match_id: parsed.matchId,
    p_format: parsed.format,
    p_season: parsed.season,
    p_team: parsed.team,
    p_date_from: parsed.dateFrom,
    p_date_to: parsed.dateTo,
  });
  if (error) throw new Error(error.message);
  return json({ filters: filtersObject(playerName, parsed), matches: data ?? [] });
}

async function handlePlayerMatchBalls(supabase: AdminClient, playerName: string, matchId: string, url: URL): Promise<Response> {
  const { data: match } = await supabase.from("matches").select("id").eq("match_id", matchId).maybeSingle();
  if (!match) return errorResponse("Match not found", 404);

  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get("limit") ?? "500", 10) || 500, 1), 2000);
  const offset = Math.max(Number.parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);

  const { data: balls, error } = await supabase.rpc("player_match_balls", {
    p_name: playerName,
    p_match_id: matchId,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw new Error(error.message);
  return json({ balls: balls ?? [] });
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
    const playerName = segments[0] === "players" ? decodeURIComponent(segments[1]) : null;

    // /matches
    if (segments.length === 1 && segments[0] === "matches") {
      return handleMatches(supabase, url);
    }
    // /matches/:id/innings
    if (segments.length === 3 && segments[0] === "matches" && segments[2] === "innings") {
      return handleMatchInnings(supabase, segments[1]);
    }
    // /matches/:id/innings/:no/balls
    if (segments.length === 5 && segments[0] === "matches" && segments[2] === "innings" && segments[4] === "balls") {
      const inningsNo = Number.parseInt(segments[3], 10);
      if (!Number.isInteger(inningsNo) || inningsNo < 1) return errorResponse("Invalid innings number", 400);
      return handleInningsBalls(supabase, segments[1], inningsNo);
    }
    // /matches/:id/balls
    if (segments.length === 3 && segments[0] === "matches" && segments[2] === "balls") {
      return handleMatchBalls(supabase, segments[1]);
    }
    // /players/:name/stats
    if (segments.length === 3 && segments[0] === "players" && segments[2] === "stats") {
      return handlePlayerStats(supabase, playerName!, url);
    }
    // /players/:name/matches
    if (segments.length === 3 && segments[0] === "players" && segments[2] === "matches") {
      return handlePlayerMatches(supabase, playerName!, url);
    }
    // /players/:name/matches/:matchId/balls
    if (segments.length === 5 && segments[0] === "players" && segments[2] === "matches" && segments[4] === "balls") {
      return handlePlayerMatchBalls(supabase, playerName!, segments[3], url);
    }

    return errorResponse("Not found", 404);
  } catch (error) {
    console.error("ball-by-ball-api failed", error);
    return errorResponse("Internal server error", 500);
  }
});

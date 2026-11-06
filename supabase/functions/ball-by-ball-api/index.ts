import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-API-Key",
};

async function hashKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function validateApiKey(req: Request, supabase: ReturnType<typeof createClient>): Promise<boolean> {
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

  // Update last_used_at
  await supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);

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
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const authorized = await validateApiKey(req, supabase);
    if (!authorized) {
      return new Response(
        JSON.stringify({ error: "Invalid or missing API key. Use X-API-Key or Authorization: Bearer." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const url = new URL(req.url);
    const path = url.pathname.replace(/^.*\/ball-by-ball-api/, "");
    const segments = path.split("/").filter(Boolean);

    // GET /matches — list all matches
    if (req.method === "GET" && segments.length === 1 && segments[0] === "matches") {
      const { data, error } = await supabase
        .from("matches")
        .select("*")
        .order("date", { ascending: false })
        .limit(100);

      if (error) throw error;
      return new Response(JSON.stringify({ matches: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET /matches/:matchId — match detail with innings summary
    if (req.method === "GET" && segments.length === 3 && segments[0] === "matches" && segments[2] === "innings") {
      const matchId = segments[1];
      const { data: match, error: matchError } = await supabase
        .from("matches")
        .select("id, match_id, season, city, date, team1, team2, toss_winner, toss_decision, result, result_margin, player_of_match, venue")
        .eq("match_id", matchId)
        .maybeSingle();

      if (matchError) throw matchError;
      if (!match) {
        return new Response(JSON.stringify({ error: "Match not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: innings, error: inningsError } = await supabase
        .from("innings")
        .select("*")
        .eq("match_id", match.id)
        .order("innings_no", { ascending: true });

      if (inningsError) throw inningsError;

      return new Response(JSON.stringify({ match, innings }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET /matches/:matchId/innings/:inningsNo/balls — ball-by-ball for an innings
    if (req.method === "GET" && segments.length === 5 && segments[0] === "matches" && segments[2] === "innings" && segments[4] === "balls") {
      const matchId = segments[1];
      const inningsNo = parseInt(segments[3], 10);

      const { data: match } = await supabase
        .from("matches")
        .select("id")
        .eq("match_id", matchId)
        .maybeSingle();

      if (!match) {
        return new Response(JSON.stringify({ error: "Match not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: inning } = await supabase
        .from("innings")
        .select("id")
        .eq("match_id", match.id)
        .eq("innings_no", inningsNo)
        .maybeSingle();

      if (!inning) {
        return new Response(JSON.stringify({ error: "Innings not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: balls, error: ballsError } = await supabase
        .from("ball_by_balls")
        .select("*")
        .eq("innings_id", inning.id)
        .order("over", { ascending: true })
        .order("ball", { ascending: true });

      if (ballsError) throw ballsError;

      return new Response(JSON.stringify({ balls }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET /matches/:matchId/balls — all balls for a match (both innings)
    if (req.method === "GET" && segments.length === 3 && segments[0] === "matches" && segments[2] === "balls") {
      const matchId = segments[1];

      const { data: match } = await supabase
        .from("matches")
        .select("id")
        .eq("match_id", matchId)
        .maybeSingle();

      if (!match) {
        return new Response(JSON.stringify({ error: "Match not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: balls, error: ballsError } = await supabase
        .from("ball_by_balls")
        .select("*")
        .eq("match_id", match.id)
        .order("over", { ascending: true })
        .order("ball", { ascending: true });

      if (ballsError) throw ballsError;

      return new Response(JSON.stringify({ balls }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET /players/:playerName/matches — all matches where player participated (as batter, bowler, or fielder)
    if (req.method === "GET" && segments.length === 3 && segments[0] === "players" && segments[2] === "matches") {
      const playerName = decodeURIComponent(segments[1]);

      // Find distinct match UUIDs where the player appears as batter, bowler, non_striker, player_out, or fielder
      const [batterRows, bowlerRows, fielderRows] = await Promise.all([
        fetchAllRows((from, to) => supabase.from("ball_by_balls").select("match_id").ilike("batter", playerName).order("id").range(from, to)),
        fetchAllRows((from, to) => supabase.from("ball_by_balls").select("match_id").ilike("bowler", playerName).order("id").range(from, to)),
        fetchAllRows((from, to) => supabase.from("ball_by_balls").select("match_id").or(`player_out.ilike.${playerName},fielder.ilike.${playerName}`).order("id").range(from, to)),
      ]);

      const matchUuids = new Set<string>();
      for (const row of [...batterRows, ...bowlerRows, ...fielderRows]) matchUuids.add(row.match_id);

      if (matchUuids.size === 0) {
        return new Response(JSON.stringify({ matches: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: matches, error: matchesError } = await supabase
        .from("matches")
        .select("*")
        .in("id", Array.from(matchUuids))
        .order("date", { ascending: false });

      if (matchesError) throw matchesError;
      return new Response(JSON.stringify({ matches }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET /players/:playerName/stats — career batting & bowling stats
    if (req.method === "GET" && segments.length === 3 && segments[0] === "players" && segments[2] === "stats") {
      const playerName = decodeURIComponent(segments[1]);

      // Batting: balls where this player is the batter
      const battingBallsList = await fetchAllRows((from, to) =>
        supabase
          .from("ball_by_balls")
          .select("runs_batter, is_wicket, wicket_type, extras_type")
          .ilike("batter", playerName)
          .order("id")
          .range(from, to)
      );
      const runs = battingBallsList.reduce((sum, b) => sum + (b.runs_batter || 0), 0);
      const validBalls = battingBallsList.filter((b) => b.extras_type === null || b.extras_type === "" || b.extras_type === "noball").length;
      const outs = battingBallsList.filter((b) => b.is_wicket && b.wicket_type && b.wicket_type !== "run out" && b.wicket_type !== "retired hurt").length;

      const { count: sixCount, error: sixError } = await supabase
        .from("ball_by_balls")
        .select("id", { count: "exact", head: true })
        .ilike("batter", playerName)
        .eq("runs_batter", 6);

      if (sixError) throw sixError;

      const { data: positionRows, error: positionError } = await supabase
        .rpc("player_batting_positions", { p_name: playerName });

      if (positionError) throw positionError;

      const positions = (positionRows || []).map((row: { batting_position: number }) => row.batting_position);
      const battingPosition = positions.length > 0
        ? +(positions.reduce((sum: number, p: number) => sum + p, 0) / positions.length).toFixed(2)
        : null;

      // Bowling: balls where this player is the bowler
      const bowlingBallsList = await fetchAllRows((from, to) =>
        supabase
          .from("ball_by_balls")
          .select("runs_total, is_wicket, extras_type, wicket_type")
          .ilike("bowler", playerName)
          .order("id")
          .range(from, to)
      );
      const runsConceded = bowlingBallsList.reduce((sum, b) => sum + (b.runs_total || 0), 0);
      const validBowlingBalls = bowlingBallsList.filter((b) => b.extras_type === null || b.extras_type === "" || b.extras_type === "noball").length;
      const wicketsTaken = bowlingBallsList.filter((b) => b.is_wicket && b.wicket_type && b.wicket_type !== "run out").length;

      // Match count
      const battingMatches = await fetchAllRows((from, to) =>
        supabase
          .from("ball_by_balls")
          .select("match_id")
          .ilike("batter", playerName)
          .order("id")
          .range(from, to)
      );
      const bowlingMatches = await fetchAllRows((from, to) =>
        supabase
          .from("ball_by_balls")
          .select("match_id")
          .ilike("bowler", playerName)
          .order("id")
          .range(from, to)
      );
      const matchUuids = new Set<string>();
      for (const row of battingMatches) matchUuids.add(row.match_id);
      for (const row of bowlingMatches) matchUuids.add(row.match_id);

      const stats = {
        player: playerName,
        matches: matchUuids.size,
        batting: {
          runs,
          balls: validBalls,
          outs,
          six_count: sixCount ?? 0,
          batting_position: battingPosition,
          average: outs > 0 ? +(runs / outs).toFixed(2) : null,
          strike_rate: validBalls > 0 ? +((runs / validBalls) * 100).toFixed(2) : null,
        },
        bowling: {
          runs_conceded: runsConceded,
          balls: validBowlingBalls,
          wickets: wicketsTaken,
          economy: validBowlingBalls > 0 ? +((runsConceded / validBowlingBalls) * 6).toFixed(2) : null,
          average: wicketsTaken > 0 ? +(runsConceded / wicketsTaken).toFixed(2) : null,
        },
      };

      return new Response(JSON.stringify({ stats }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET /players/:playerName/matches/:matchId/balls — player's ball-by-ball in a specific match
    if (req.method === "GET" && segments.length === 5 && segments[0] === "players" && segments[2] === "matches" && segments[4] === "balls") {
      const playerName = decodeURIComponent(segments[1]);
      const matchId = segments[3];

      const { data: match } = await supabase
        .from("matches")
        .select("id")
        .eq("match_id", matchId)
        .maybeSingle();

      if (!match) {
        return new Response(JSON.stringify({ error: "Match not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: balls, error: ballsError } = await supabase
        .from("ball_by_balls")
        .select("*")
        .eq("match_id", match.id)
        .or(`batter.ilike.${playerName},bowler.ilike.${playerName},non_striker.ilike.${playerName},player_out.ilike.${playerName},fielder.ilike.${playerName}`)
        .order("over", { ascending: true })
        .order("ball", { ascending: true });

      if (ballsError) throw ballsError;

      return new Response(JSON.stringify({ balls }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

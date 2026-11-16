// Server-side bulk CSV import.
// Runs with the service role key (bypasses RLS), does batched upserts,
// and returns the exact count of rows actually committed to the database.

import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface MatchRecord {
  match_id: string;
  match_format?: string | null;
  season?: string | null;
  city?: string | null;
  date?: string | null;
  team1?: string | null;
  team2?: string | null;
  toss_winner?: string | null;
  toss_decision?: string | null;
  result?: string | null;
  result_margin?: string | null;
  player_of_match?: string | null;
  venue?: string | null;
  umpire1?: string | null;
  umpire2?: string | null;
}

interface BallRecord {
  match_id: string;
  innings_no: number;
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
}

interface ImportRequest {
  format: "matches" | "balls";
  matches?: MatchRecord[];
  balls?: BallRecord[];
  matchStubs?: string[];
}

const BATCH = 300;
const MATCH_FORMATS = new Set(["T20", "ODI", "Test", "T10", "First Class", "List A", "Unknown"]);

function normalizeMatchFormat(value: string | null | undefined): string {
  return MATCH_FORMATS.has(value ?? "") ? value as string : "Unknown";
}

function isMissingTeam(value: string | null | undefined): boolean {
  return !value || /^(tbd|unknown|n\/a|na|null|undefined)$/i.test(value.trim());
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Reuse the admin client across invocations within the same instance lifetime.
let adminClient: ReturnType<typeof createClient> | null = null;
function getAdmin() {
  if (adminClient) return adminClient;
  const url = Deno.env.get("SUPABASE_URL") as string;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") as string;
  if (!url || !key) throw new Error("Server not configured");
  adminClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const admin = getAdmin();

    const body = (await req.json()) as ImportRequest;
    if (!body || !body.format) {
      return new Response(JSON.stringify({ error: "Missing 'format' in request body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Matches ───────────────────────────────────────────────────────────
    if (body.format === "matches") {
      const rows = (body.matches ?? []).filter((row) => !(isMissingTeam(row.team1) && isMissingTeam(row.team2)));
      if (rows.length === 0) return json({ committed: 0 });
      const cleanedRows = rows.map((row) => ({
        ...row,
        match_format: normalizeMatchFormat(row.match_format),
        team1: isMissingTeam(row.team1) ? null : row.team1?.trim() || null,
        team2: isMissingTeam(row.team2) ? null : row.team2?.trim() || null,
      }));
      let committed = 0;
      for (const batch of chunks(cleanedRows, BATCH)) {
        const { error } = await admin
          .from("matches")
          .upsert(batch, { onConflict: "match_id", ignoreDuplicates: false });
        if (error) throw new Error(error.message);
        committed += batch.length;
      }
      return json({ committed });
    }

    // ── Balls ─────────────────────────────────────────────────────────────
    if (body.format === "balls") {
      const balls = body.balls ?? [];
      if (balls.length === 0) {
        return json({ committed: 0, matchesCreated: 0, inningsCreated: 0, ballsRequested: 0 });
      }

      const stubs = [...new Set((body.matchStubs ?? []).filter(Boolean))];

      // 1. Upsert match stubs (only match_id, no detail overwrite).
      let matchesCreated = 0;
      if (stubs.length > 0) {
        const stubRows = stubs.map((match_id) => ({ match_id, match_format: "Unknown" }));
        for (const batch of chunks(stubRows, BATCH)) {
          const { data, error } = await admin
            .from("matches")
            .upsert(batch, { onConflict: "match_id", ignoreDuplicates: true })
            .select("match_id");
          if (error) throw new Error(error.message);
          matchesCreated += data?.length ?? 0;
        }
      }

      // 2. Resolve match_id (text) -> matches.id (uuid) in one pass.
      const matchMap = new Map<string, string>();
      for (const batch of chunks(stubs, 500)) {
        const { data, error } = await admin
          .from("matches")
          .select("id, match_id")
          .in("match_id", batch);
        if (error) throw new Error(error.message);
        for (const m of data ?? []) matchMap.set(m.match_id, m.id);
      }

      // 3. Determine which innings are needed, upsert them, then resolve ids.
      const neededInnings = new Set<string>(); // "uuid:innings_no"
      for (const b of balls) {
        const uuid = matchMap.get(b.match_id);
        if (!uuid) continue;
        neededInnings.add(`${uuid}:${b.innings_no}`);
      }

      const inningsRows: Array<{ match_id: string; innings_no: number }> = [];
      for (const key of neededInnings) {
        const [uuidStr, noStr] = key.split(":");
        inningsRows.push({ match_id: uuidStr, innings_no: Number.parseInt(noStr, 10) });
      }

      // Upsert innings with the unique index — one call instead of select+insert+re-fetch.
      for (const batch of chunks(inningsRows, BATCH)) {
        const { error } = await admin
          .from("innings")
          .upsert(batch, { onConflict: "match_id,innings_no", ignoreDuplicates: true });
        if (error) throw new Error(error.message);
      }

      // 4. Resolve innings ids (single pass covers both existing + newly created).
      const allUuids = [...new Set([...matchMap.values()])];
      const inningsMap = new Map<string, string>(); // "uuid:innings_no" -> innings.id
      for (const batch of chunks(allUuids, 300)) {
        const { data, error } = await admin
          .from("innings")
          .select("id, match_id, innings_no")
          .in("match_id", batch);
        if (error) throw new Error(error.message);
        for (const i of data ?? []) inningsMap.set(`${i.match_id}:${i.innings_no}`, i.id);
      }

      // 5. Build ball records, upsert idempotently on the unique delivery index.
      const records: Array<{
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
      }> = [];
      for (const b of balls) {
        const uuid = matchMap.get(b.match_id);
        if (!uuid) continue;
        const inningsId = inningsMap.get(`${uuid}:${b.innings_no}`);
        if (!inningsId) continue;
        records.push({
          innings_id: inningsId,
          match_id: uuid,
          over: b.over,
          ball: b.ball,
          batter: b.batter,
          bowler: b.bowler,
          non_striker: b.non_striker,
          runs_batter: b.runs_batter,
          runs_extra: b.runs_extra,
          runs_total: b.runs_total,
          extras_type: b.extras_type,
          is_wicket: b.is_wicket,
          wicket_type: b.wicket_type,
          player_out: b.player_out,
          fielder: b.fielder,
        });
      }

      let committed = 0;
      for (const batch of chunks(records, BATCH)) {
        const { data, error } = await admin
          .from("ball_by_balls")
          .upsert(batch, { onConflict: "match_id,innings_id,over,ball", ignoreDuplicates: true })
          .select("id");
        if (error) throw new Error(error.message);
        committed += data?.length ?? 0;
      }

      const inningsToRefresh = [...new Set(records.map((record) => record.innings_id))];
      for (const batch of chunks(inningsToRefresh, 100)) {
        const { error } = await admin.rpc("refresh_innings_totals", { p_innings_ids: batch });
        if (error) throw new Error(error.message);
      }

      return json({
        committed,
        matchesCreated,
        inningsCreated: inningsRows.length,
        ballsRequested: balls.length,
      });
    }

    return new Response(JSON.stringify({ error: `Unknown format: ${body.format}` }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

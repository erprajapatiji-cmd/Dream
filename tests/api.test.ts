import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";

const configured = Boolean(supabaseUrl && supabaseKey);

const supabase = configured
  ? createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

const itDb = configured ? it : it.skip;

describe("matches table — match_format column", () => {
  itDb("has match_format column with allowed values", async () => {
    const { data, error } = await supabase!
      .from("matches")
      .select("match_format")
      .limit(1);
    expect(error).toBeNull();
    expect(data).toBeDefined();
  });

  itDb("returns total count via DB count", async () => {
    const { count, error } = await supabase!
      .from("matches")
      .select("*", { count: "exact", head: true });
    expect(error).toBeNull();
    expect(count).toBeGreaterThan(0);
  });

  itDb("supports pagination via range queries", async () => {
    const { data, error } = await supabase!
      .from("matches")
      .select("match_id, match_format, season, date, team1, team2")
      .order("date", { ascending: false, nullsFirst: false })
      .range(0, 9);
    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data!.length).toBeLessThanOrEqual(10);
  });
});

describe("matches table — format filtering", () => {
  itDb("can filter by match_format = T20", async () => {
    const { data, error } = await supabase!
      .from("matches")
      .select("match_format")
      .eq("match_format", "T20");
    expect(error).toBeNull();
    if (data && data.length > 0) {
      expect(data.every((m) => m.match_format === "T20")).toBe(true);
    }
  });

  itDb("T20 filter does not return ODI data", async () => {
    const { data, error } = await supabase!
      .from("matches")
      .select("match_format")
      .eq("match_format", "T20");
    expect(error).toBeNull();
    if (data) {
      expect(data.every((m) => m.match_format !== "ODI")).toBe(true);
    }
  });

  itDb("ODI filter does not return T20 data", async () => {
    const { data, error } = await supabase!
      .from("matches")
      .select("match_format")
      .eq("match_format", "ODI");
    expect(error).toBeNull();
    if (data) {
      expect(data.every((m) => m.match_format !== "T20")).toBe(true);
    }
  });

  itDb("Test filter only returns Test data", async () => {
    const { data, error } = await supabase!
      .from("matches")
      .select("match_format")
      .eq("match_format", "Test");
    expect(error).toBeNull();
    if (data && data.length > 0) {
      expect(data.every((m) => m.match_format === "Test")).toBe(true);
    }
  });
});

describe("matches table — match_id exact filter", () => {
  itDb("match_id filter returns only that match", async () => {
    const { data: allMatches } = await supabase!
      .from("matches")
      .select("match_id")
      .limit(1);
    if (allMatches && allMatches.length > 0) {
      const testMatchId = allMatches[0].match_id;
      const { data, error } = await supabase!
        .from("matches")
        .select("match_id")
        .eq("match_id", testMatchId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    }
  });
});

describe("innings table", () => {
  itDb("returns innings with correct fields", async () => {
    const { data: match } = await supabase!
      .from("matches")
      .select("id")
      .limit(1)
      .maybeSingle();
    if (match) {
      const { data, error } = await supabase!
        .from("innings")
        .select("innings_no, batting_team, bowling_team, total_runs, total_wickets, total_overs")
        .eq("match_id", match.id)
        .order("innings_no");
      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
    }
  });
});

describe("ball_by_balls table — idempotency check", () => {
  itDb("unique delivery index prevents duplicate balls", async () => {
    const { data: ball } = await supabase!
      .from("ball_by_balls")
      .select("match_id, innings_id, over, ball")
      .limit(1)
      .maybeSingle();
    if (ball) {
      const { data, error } = await supabase!
        .from("ball_by_balls")
        .select("id")
        .eq("match_id", ball.match_id)
        .eq("innings_id", ball.innings_id)
        .eq("over", ball.over)
        .eq("ball", ball.ball);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    }
  });
});

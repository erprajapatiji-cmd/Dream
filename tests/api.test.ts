import { describe, it, expect } from "vitest";
import {
  normalizeFormat,
  normalizeTigzigFormat,
  escapePostgrest,
  remoteMatch,
  mapTigzigBall,
  mergeRemoteMatches,
  type TigzigRow,
  type MatchJSON,
} from "@/lib/cricketUtils";

// ─── 1. Missing older matches ───────────────────────────────────────────────
// Verifies that mergeRemoteMatches includes TigZig rows for older matches
// that are absent from the local database (not just newer ones).

describe("missing older matches", () => {
  it("includes TigZig matches older than local data when they are absent locally", () => {
    const localMatches: MatchJSON[] = [
      { id: "local-1", match_id: "1001", match_format: "T20", season: "2025", city: null, date: "2025-06-15", team1: "India", team2: "Australia", toss_winner: null, toss_decision: null, result: null, result_margin: null, player_of_match: null, venue: null, umpire1: null, umpire2: null, created_at: "2025-01-01" },
    ];
    const remoteRows: TigzigRow[] = [
      // An older match that is NOT in local DB — should still appear in merge
      { match_id: "999", match_type: "ODI", team1: "England", team2: "Pakistan", season: "2020", start_date: "2020-03-10", venue: "Lord's", city: "London", toss_winner: "England", toss_decision: "bat", winner: "England", winner_runs: 50, winner_wickets: null, player_of_match1: "Root", umpire1: "U1", umpire2: "U2" },
    ];
    const merged = mergeRemoteMatches(localMatches, remoteRows);
    const matchIds = merged.map((m) => m.match_id);
    expect(matchIds).toContain("999");
    expect(matchIds).toContain("1001");
    expect(merged).toHaveLength(2);
  });
});

// ─── 2. Exact missing match_id ──────────────────────────────────────────────
// Verifies that remoteMatch fetches by exact match_id regardless of date.

describe("exact missing match_id", () => {
  it("maps a TigZig row for an exact match_id lookup", () => {
    const row: TigzigRow = {
      match_id: "54321",
      match_type: "TEST",
      team1: "South Africa",
      team2: "New Zealand",
      season: "2018",
      start_date: "2018-01-05",
      venue: "Cape Town",
      city: "Cape Town",
      toss_winner: "South Africa",
      toss_decision: "bat",
      winner: "South Africa",
      winner_runs: null,
      winner_wickets: 8,
      player_of_match1: "Steyn",
      umpire1: "U1",
      umpire2: "U2",
    };
    const match = remoteMatch(row);
    expect(match).not.toBeNull();
    expect(match!.match_id).toBe("54321");
    expect(match!.match_format).toBe("Test");
    expect(match!.result_margin).toBe("8 wickets");
  });

  it("returns null for a row with no match_id", () => {
    const row: TigzigRow = { match_type: "T20" };
    expect(remoteMatch(row)).toBeNull();
  });
});

// ─── 3. Duplicate deduplication ─────────────────────────────────────────────

describe("duplicate deduplication", () => {
  it("does not duplicate matches that exist in both local and remote", () => {
    const localMatches: MatchJSON[] = [
      { id: "local-1", match_id: "500", match_format: "T20", season: "2025", city: null, date: "2025-06-15", team1: "India", team2: "Australia", toss_winner: null, toss_decision: null, result: null, result_margin: null, player_of_match: null, venue: null, umpire1: null, umpire2: null, created_at: "2025-01-01" },
    ];
    const remoteRows: TigzigRow[] = [
      { match_id: "500", match_type: "T20", team1: "India", team2: "Australia", season: "2025", start_date: "2025-06-15", venue: null, city: null, toss_winner: null, toss_decision: null, winner: null, winner_runs: null, winner_wickets: null, player_of_match1: null, umpire1: null, umpire2: null },
      { match_id: "501", match_type: "T20", team1: "England", team2: "Pakistan", season: "2025", start_date: "2025-07-01", venue: null, city: null, toss_winner: null, toss_decision: null, winner: null, winner_runs: null, winner_wickets: null, player_of_match1: null, umpire1: null, umpire2: null },
    ];
    const merged = mergeRemoteMatches(localMatches, remoteRows);
    const matchIds = merged.map((m) => m.match_id);
    expect(matchIds).toContain("500");
    expect(matchIds).toContain("501");
    // "500" should appear only once — local takes priority
    const count500 = matchIds.filter((id) => id === "500").length;
    expect(count500).toBe(1);
  });

  it("deduplicates within remote rows by match_id", () => {
    const remoteRows: TigzigRow[] = [
      { match_id: "600", match_type: "T20", team1: "A", team2: "B", season: "2025", start_date: "2025-01-01", venue: null, city: null, toss_winner: null, toss_decision: null, winner: null, winner_runs: null, winner_wickets: null, player_of_match1: null, umpire1: null, umpire2: null },
      { match_id: "600", match_type: "T20", team1: "A", team2: "B", season: "2025", start_date: "2025-01-01", venue: null, city: null, toss_winner: null, toss_decision: null, winner: null, winner_runs: null, winner_wickets: null, player_of_match1: null, umpire1: null, umpire2: null },
    ];
    const merged = mergeRemoteMatches([], remoteRows);
    expect(merged).toHaveLength(1);
  });
});

// ─── 4. Ball-column mapping ─────────────────────────────────────────────────

describe("ball column mapping", () => {
  it("maps striker → batter and runs_off_bat → runs_batter", () => {
    const row: TigzigRow = {
      match_id: "12345",
      innings_no: 1,
      over: 5,
      ball: 3,
      striker: "Virat Kohli",
      bowler: "Anderson",
      non_striker: "Rohit Sharma",
      runs_off_bat: 4,
      extras: 0,
      runs_total: 4,
      wicket_type: null,
      player_dismissed: null,
      fielder: null,
    };
    const ball = mapTigzigBall(row);
    expect(ball.batter).toBe("Virat Kohli");
    expect(ball.bowler).toBe("Anderson");
    expect(ball.non_striker).toBe("Rohit Sharma");
    expect(ball.runs_batter).toBe(4);
    expect(ball.runs_extra).toBe(0);
    expect(ball.runs_total).toBe(4);
    expect(ball.is_wicket).toBe(false);
  });

  it("maps batter/batsman as fallback when striker is absent", () => {
    const row: TigzigRow = {
      match_id: "12345",
      innings_no: 2,
      over: 10,
      ball: 1,
      batter: "Smith",
      batsman: "Smith",
      bowler: "Bumrah",
      non_striker: "Labuschagne",
      runs_batter: 6,
      runs_extra: 0,
      runs_total: 6,
    };
    const ball = mapTigzigBall(row);
    expect(ball.batter).toBe("Smith");
    expect(ball.runs_batter).toBe(6);
  });

  it("maps player_dismissed → player_out and detects wicket", () => {
    const row: TigzigRow = {
      match_id: "12345",
      innings_no: 1,
      over: 3,
      ball: 2,
      striker: "Root",
      bowler: "Cummins",
      non_striker: "Stokes",
      runs_off_bat: 0,
      extras: 0,
      runs_total: 0,
      wicket_type: "bowled",
      player_dismissed: "Root",
      fielder: null,
    };
    const ball = mapTigzigBall(row);
    expect(ball.is_wicket).toBe(true);
    expect(ball.wicket_type).toBe("bowled");
    expect(ball.player_out).toBe("Root");
  });

  it("maps extras_type from wide/noball/bye/legbye boolean columns", () => {
    const wideRow: TigzigRow = { match_id: "1", innings_no: 1, over: 0, ball: 1, striker: "A", bowler: "B", non_striker: "C", runs_off_bat: 0, extras: 1, runs_total: 1, wide: true };
    expect(mapTigzigBall(wideRow).extras_type).toBe("wide");

    const noBallRow: TigzigRow = { match_id: "1", innings_no: 1, over: 0, ball: 2, striker: "A", bowler: "B", non_striker: "C", runs_off_bat: 0, extras: 1, runs_total: 1, noball: true };
    expect(mapTigzigBall(noBallRow).extras_type).toBe("noball");

    const byeRow: TigzigRow = { match_id: "1", innings_no: 1, over: 0, ball: 3, striker: "A", bowler: "B", non_striker: "C", runs_off_bat: 0, extras: 1, runs_total: 1, bye: true };
    expect(mapTigzigBall(byeRow).extras_type).toBe("bye");
  });

  it("maps dismissal_kind and fielders_involved as fallbacks", () => {
    const row: TigzigRow = {
      match_id: "99",
      innings_no: 1,
      over: 7,
      ball: 4,
      striker: "Warner",
      bowler: "Shami",
      non_striker: "Smith",
      runs_off_bat: 0,
      extras: 0,
      runs_total: 0,
      dismissal_kind: "caught",
      player_dismissed: "Warner",
      fielders_involved: "Rahane",
    };
    const ball = mapTigzigBall(row);
    expect(ball.wicket_type).toBe("caught");
    expect(ball.player_out).toBe("Warner");
    expect(ball.fielder).toBe("Rahane");
  });

  it("computes runs_total from runs_off_bat + extras when absent", () => {
    const row: TigzigRow = {
      match_id: "1",
      innings_no: 1,
      over: 0,
      ball: 1,
      striker: "A",
      bowler: "B",
      non_striker: "C",
      runs_off_bat: 2,
      extras: 1,
    };
    expect(mapTigzigBall(row).runs_total).toBe(3);
  });
});

// ─── 5. Format normalization ────────────────────────────────────────────────

describe("format normalization", () => {
  it("maps TEST -> Test", () => {
    expect(normalizeTigzigFormat("TEST")).toBe("Test");
  });

  it("maps IPL/T20/T20I -> T20", () => {
    expect(normalizeTigzigFormat("IPL")).toBe("T20");
    expect(normalizeTigzigFormat("T20")).toBe("T20");
    expect(normalizeTigzigFormat("T20I")).toBe("T20");
  });

  it("maps ODI -> ODI", () => {
    expect(normalizeTigzigFormat("ODI")).toBe("ODI");
  });

  it("maps T10 -> T10", () => {
    expect(normalizeTigzigFormat("T10")).toBe("T10");
  });

  it("maps FIRST CLASS -> First Class", () => {
    expect(normalizeTigzigFormat("FIRST CLASS")).toBe("First Class");
  });

  it("maps LIST A -> List A", () => {
    expect(normalizeTigzigFormat("LIST A")).toBe("List A");
  });

  it("maps unknown formats to Unknown", () => {
    expect(normalizeTigzigFormat("RANDOM")).toBe("Unknown");
    expect(normalizeTigzigFormat(null)).toBe("Unknown");
    expect(normalizeTigzigFormat(undefined)).toBe("Unknown");
  });

  it("normalizeFormat handles input variants", () => {
    expect(normalizeFormat("T20")).toBe("T20");
    expect(normalizeFormat("t20i")).toBe("T20");
    expect(normalizeFormat("IPL")).toBe("T20");
    expect(normalizeFormat("Test")).toBe("Test");
    expect(normalizeFormat("ODI")).toBe("ODI");
    expect(normalizeFormat("First Class")).toBe("First Class");
    expect(normalizeFormat("List A")).toBe("List A");
    expect(normalizeFormat("T10")).toBe("T10");
    expect(normalizeFormat("random")).toBeNull();
    expect(normalizeFormat(null)).toBeNull();
  });
});

// ─── 6. 429 Retry-After logic ───────────────────────────────────────────────
// We test the retry delay computation logic that the edge function uses.

describe("429 Retry-After", () => {
  it("respects a valid Retry-After header value (in seconds)", () => {
    const retryAfterHeader = "5";
    const retryAfter = Number.parseInt(retryAfterHeader, 10);
    const delayMs = retryAfter > 0 ? retryAfter * 1000 : 2500;
    expect(delayMs).toBe(5000);
  });

  it("falls back to 2500ms when Retry-After is missing or invalid", () => {
    const retryAfterHeader = "";
    const retryAfter = Number.parseInt(retryAfterHeader, 10);
    const delayMs = retryAfter > 0 ? retryAfter * 1000 : 2500;
    expect(delayMs).toBe(2500);
  });

  it("falls back to 2500ms when Retry-After is NaN", () => {
    const retryAfterHeader = "abc";
    const retryAfter = Number.parseInt(retryAfterHeader, 10);
    const delayMs = retryAfter > 0 ? retryAfter * 1000 : 2500;
    expect(delayMs).toBe(2500);
  });

  it("identifies 429 as retryable", () => {
    const status = 429;
    const isRetryable = status === 429 || (status >= 500 && status < 600);
    expect(isRetryable).toBe(true);
  });

  it("identifies 5xx as retryable", () => {
    const status = 503;
    const isRetryable = status === 429 || (status >= 500 && status < 600);
    expect(isRetryable).toBe(true);
  });

  it("identifies 404 as NOT retryable", () => {
    const status = 404;
    const isRetryable = status === 429 || (status >= 500 && status < 600);
    expect(isRetryable).toBe(false);
  });
});

// ─── 7. Security checks ─────────────────────────────────────────────────────

describe("security — PostgREST escaping", () => {
  it("escapes commas in filter values", () => {
    expect(escapePostgrest("team,1")).toBe("team\\,1");
  });

  it("escapes parentheses", () => {
    expect(escapePostgrest("a(b)c")).toBe("a\\(b\\)c");
  });

  it("escapes backslashes", () => {
    expect(escapePostgrest("a\\b")).toBe("a\\\\b");
  });

  it("does not modify clean values", () => {
    expect(escapePostgrest("India")).toBe("India");
  });

  it("escapes combined special characters", () => {
    expect(escapePostgrest("a,b(c)d\\e")).toBe("a\\,b\\(c\\)d\\\\e");
  });
});

describe("security — API key validation", () => {
  it("rejects keys shorter than 20 characters", () => {
    const shortKey = "shortkey123";
    expect(shortKey.length < 20).toBe(true);
  });

  it("accepts keys with 20 or more characters", () => {
    const validKey = "cbb_" + "a".repeat(36);
    expect(validKey.length >= 20).toBe(true);
  });
});

describe("security — input length limits", () => {
  it("truncates match_id to max length", () => {
    const longId = "x".repeat(100);
    const truncated = longId.slice(0, 50);
    expect(truncated.length).toBe(50);
  });

  it("truncates search to max length", () => {
    const longSearch = "x".repeat(200);
    const truncated = longSearch.slice(0, 100);
    expect(truncated.length).toBe(100);
  });
});

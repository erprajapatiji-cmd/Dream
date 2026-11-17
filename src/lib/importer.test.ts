import { describe, it, expect } from "vitest";
import { classifyAndPair } from "@/lib/filePairing";
import { normalizeMatchFormat, detectMatchFormat } from "@/lib/csvImport";
import { parseCricsheetCsv } from "@/lib/cricsheetCsv";
import { parseCricsheetJson } from "@/lib/cricsheetJson";
import type { ParsedMatchRow } from "@/lib/csv";

function makeFile(name: string, content: string): File {
  return new File([content], name, { type: "text/csv" });
}

const INFO_CSV = `info,version,1.5.0
info,team,India
info,team,Australia
info,season,2024/25
info,date,2024-11-15
info,venue,Melbourne Cricket Ground
info,city,Melbourne
info,toss,winner,India,decision,bat
info,match_type,T20
info,overs,20
info,player_of_match,Virat Kohli
info,umpire,Michael Gough
info,umpire,Paul Reiffel
info,outcome,winner,India
info,outcome,by,5 wickets`;

const BALL_CSV = `ball,1,0,0.1,Virat Kohli,Shubman Gill,Mitchell Starc,4,0,4,,,,,,,0.1
ball,1,0,0.2,Virat Kohli,Shubman Gill,Mitchell Starc,0,0,0,,,,,,,0.2
ball,1,0,0.3,Virat Kohli,Shubman Gill,Mitchell Starc,6,0,6,,,,,,,0.3`;

const COMBINED_CSV = `${INFO_CSV}
${BALL_CSV}`;

const JSON_MATCH = JSON.stringify({
  info: {
    match_type: "T20",
    overs: 20,
    season: "2024/25",
    dates: ["2024-11-15"],
    teams: ["India", "Australia"],
    venue: "Melbourne Cricket Ground",
    city: "Melbourne",
    toss: { winner: "India", decision: "bat" },
    player_of_match: ["Virat Kohli"],
    officials: { umpires: ["Michael Gough", "Paul Reiffel"] },
    outcome: { winner: "India", by: { wickets: 5 } },
    event: { name: "T20 World Cup" },
  },
  innings: [
    {
      team: "India",
      overs: [
        {
          over: 0,
          deliveries: [
            { batter: "Virat Kohli", bowler: "Mitchell Starc", non_striker: "Shubman Gill", runs: { batter: 4, extras: 0, total: 4 }, actual_delivery: "0.1" },
            { batter: "Virat Kohli", bowler: "Mitchell Starc", non_striker: "Shubman Gill", runs: { batter: 0, extras: 0, total: 0 }, actual_delivery: "0.2" },
            { batter: "Virat Kohli", bowler: "Mitchell Starc", non_striker: "Shubman Gill", runs: { batter: 6, extras: 0, total: 6 }, actual_delivery: "0.3" },
          ],
        },
      ],
    },
  ],
});

const SUMMARY_CSV = `match_id,season,date,team1,team2,venue,city,result,result_margin
99999,2024,2024-11-15,India,Australia,Melbourne Cricket Ground,Melbourne,India,5 wickets`;

describe("normalizeMatchFormat", () => {
  it("detects T20 from various inputs", () => {
    expect(normalizeMatchFormat("T20")).toBe("T20");
    expect(normalizeMatchFormat("t20i")).toBe("T20");
    expect(normalizeMatchFormat("twenty20")).toBe("T20");
    expect(normalizeMatchFormat("20 overs")).toBe("T20");
  });

  it("detects ODI", () => {
    expect(normalizeMatchFormat("ODI")).toBe("ODI");
    expect(normalizeMatchFormat("One Day International")).toBe("ODI");
    expect(normalizeMatchFormat("50 overs")).toBe("ODI");
  });

  it("detects Test", () => {
    expect(normalizeMatchFormat("Test")).toBe("Test");
    expect(normalizeMatchFormat("test match")).toBe("Test");
  });

  it("detects T10", () => {
    expect(normalizeMatchFormat("T10")).toBe("T10");
    expect(normalizeMatchFormat("10 overs")).toBe("T10");
  });

  it("detects First Class and List A", () => {
    expect(normalizeMatchFormat("First Class")).toBe("First Class");
    expect(normalizeMatchFormat("List A")).toBe("List A");
  });

  it("returns Unknown for unrecognised", () => {
    expect(normalizeMatchFormat("")).toBe("Unknown");
    expect(normalizeMatchFormat("random")).toBe("Unknown");
  });
});

describe("detectMatchFormat", () => {
  it("uses explicit match_type first", () => {
    const row: ParsedMatchRow = { match_type: "T20", overs: "50" };
    expect(detectMatchFormat(row)).toBe("T20");
  });

  it("falls back to event name", () => {
    const row: ParsedMatchRow = { event: "T20 World Cup" };
    expect(detectMatchFormat(row)).toBe("T20");
  });

  it("falls back to overs value", () => {
    const row: ParsedMatchRow = { overs: "20" };
    expect(detectMatchFormat(row)).toBe("T20");
    const row2: ParsedMatchRow = { overs: "50" };
    expect(detectMatchFormat(row2)).toBe("ODI");
  });

  it("returns Unknown when nothing matches", () => {
    const row: ParsedMatchRow = {};
    expect(detectMatchFormat(row)).toBe("Unknown");
  });
});

describe("classifyAndPair — file pairing", () => {
  it("pairs info and ball files by match_id", async () => {
    const files = [
      makeFile("63963_info.csv", INFO_CSV),
      makeFile("63963.csv", BALL_CSV),
    ];
    const result = await classifyAndPair(files);
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0].matchId).toBe("63963");
    expect(result.pairs[0].info).toBeDefined();
    expect(result.pairs[0].balls).toBeDefined();
    expect(result.infoOnly).toHaveLength(0);
    expect(result.ballOnly).toHaveLength(0);
  });

  it("detects info-only file with missing ball file", async () => {
    const files = [makeFile("63964_info.csv", INFO_CSV)];
    const result = await classifyAndPair(files);
    expect(result.infoOnly).toHaveLength(1);
    expect(result.infoOnly[0].matchId).toBe("63964");
    expect(result.pairs.filter((p) => p.info && p.balls)).toHaveLength(0);
  });

  it("detects ball-only file with missing info file", async () => {
    const files = [makeFile("63965.csv", BALL_CSV)];
    const result = await classifyAndPair(files);
    expect(result.ballOnly).toHaveLength(1);
    expect(result.ballOnly[0].matchId).toBe("63965");
  });

  it("classifies combined cricsheet CSV separately from paired files", async () => {
    const files = [makeFile("63966.csv", COMBINED_CSV)];
    const result = await classifyAndPair(files);
    expect(result.combined).toHaveLength(1);
    expect(result.combined[0].name).toBe("63966.csv");
    expect(result.pairs.filter((p) => p.info && p.balls)).toHaveLength(0);
  });

  it("classifies JSON files separately", async () => {
    const files = [makeFile("63967.json", JSON_MATCH)];
    const result = await classifyAndPair(files);
    expect(result.jsonFiles).toHaveLength(1);
  });

  it("classifies summary CSV files", async () => {
    const files = [makeFile("summary.csv", SUMMARY_CSV)];
    const result = await classifyAndPair(files);
    expect(result.summaryFiles).toHaveLength(1);
  });

  it("handles multiple pairs simultaneously", async () => {
    const files = [
      makeFile("10001_info.csv", INFO_CSV),
      makeFile("10001.csv", BALL_CSV),
      makeFile("10002_info.csv", INFO_CSV),
      makeFile("10002.csv", BALL_CSV),
    ];
    const result = await classifyAndPair(files);
    expect(result.pairs.filter((p) => p.info && p.balls)).toHaveLength(2);
    expect(result.infoOnly).toHaveLength(0);
    expect(result.ballOnly).toHaveLength(0);
  });
});

describe("parseCricsheetCsv — combined format", () => {
  it("parses info and ball rows from combined CSV", () => {
    const parsed = parseCricsheetCsv(COMBINED_CSV, "63963");
    expect(parsed.matchRow.team1).toBe("India");
    expect(parsed.matchRow.team2).toBe("Australia");
    expect(parsed.matchRow.season).toBe("2024/25");
    expect(parsed.matchRow.match_type).toBe("T20");
    expect(parsed.deliveries).toHaveLength(3);
    expect(parsed.deliveries[0].batter).toBe("Virat Kohli");
    expect(parsed.deliveries[0].batsman_runs).toBe("4");
  });

  it("throws for empty file", () => {
    expect(() => parseCricsheetCsv("info,version\n", "empty")).toThrow();
  });
});

describe("parseCricsheetJson", () => {
  it("parses JSON match with info and deliveries", () => {
    const parsed = parseCricsheetJson(JSON_MATCH, "63967");
    expect(parsed.matchRow.team1).toBe("India");
    expect(parsed.matchRow.team2).toBe("Australia");
    expect(parsed.matchRow.match_type).toBe("T20");
    expect(parsed.deliveries).toHaveLength(3);
    expect(parsed.deliveries[0].batter).toBe("Virat Kohli");
    expect(parsed.deliveries[0].batsman_runs).toBe("4");
  });

  it("throws for invalid JSON", () => {
    expect(() => parseCricsheetJson("not json", "bad")).toThrow();
  });
});

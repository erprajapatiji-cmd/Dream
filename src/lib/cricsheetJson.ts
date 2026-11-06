import type { ParsedMatchRow } from "@/lib/csv";

export interface ParsedCricsheetMatch {
  matchRow: ParsedMatchRow;
  deliveries: ParsedMatchRow[];
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

export function parseCricsheetJson(raw: string, matchId: string): ParsedCricsheetMatch {
  let root: JsonObject | null;
  try {
    root = asObject(JSON.parse(raw));
  } catch {
    throw new Error(`${matchId}.json is not a valid JSON file.`);
  }
  if (!root) throw new Error(`${matchId}.json does not contain a match.`);

  const info = asObject(root.info) ?? {};
  const players = asObject(info.players) ?? {};
  const teams = asArray(info.teams).map(str).filter(Boolean);
  const teamNames = teams.length > 0 ? teams : Object.keys(players);
  const dates = asArray(info.dates).map(str).filter(Boolean);
  const outcome = asObject(info.outcome) ?? {};
  const byEntry = Object.entries(asObject(outcome.by) ?? {})[0];
  const toss = asObject(info.toss) ?? {};
  const playersOfMatch = asArray(info.player_of_match).map(str).filter(Boolean);
  const umpires = asArray(asObject(info.officials)?.umpires).map(str).filter(Boolean);

  const matchRow: ParsedMatchRow = {
    match_id: matchId,
    season: str(info.season),
    city: str(info.city),
    date: str(dates[0]).replace(/\//g, "-"),
    team1: teamNames[0] ?? "",
    team2: teamNames[1] ?? "",
    toss_winner: str(toss.winner),
    toss_decision: str(toss.decision),
    result: str(outcome.winner) || str(outcome.result),
    result_margin: byEntry ? `${str(byEntry[1])} ${str(byEntry[0])}` : "",
    player_of_match: playersOfMatch.join(", "),
    venue: str(info.venue),
    umpire1: umpires[0] ?? "",
    umpire2: umpires[1] ?? "",
  };

  const deliveries: ParsedMatchRow[] = [];
  asArray(root.innings).forEach((inning, inningIndex) => {
    const inningObject = asObject(inning);
    if (!inningObject) return;

    const overDeliveries = asArray(inningObject.overs).flatMap((over) => asArray(asObject(over)?.deliveries));
    for (const entry of overDeliveries) {
      const delivery = asObject(entry);
      if (!delivery) continue;

      const runs = asObject(delivery.runs) ?? {};
      const extras = asObject(delivery.extras);
      const wicket = asObject(asArray(delivery.wickets)[0]);
      const fielders = asArray(wicket?.fielders)
        .map((f) => str(asObject(f)?.name ?? f))
        .filter(Boolean)
        .join(", ");

      deliveries.push({
        match_id: matchId,
        innings_no: String(inningIndex + 1),
        actual_delivery: str(delivery.actual_delivery),
        batter: str(delivery.batter),
        bowler: str(delivery.bowler),
        non_striker: str(delivery.non_striker),
        batsman_runs: str(runs.batter ?? 0),
        extra_runs: str(runs.extras ?? 0),
        total_runs: str(runs.total ?? 0),
        extras_type: extras ? (Object.keys(extras)[0] ?? "") : "",
        wicket_type: str(wicket?.kind),
        player_out: str(wicket?.player_out),
        fielder: fielders,
      });
    }
  });

  if (!matchRow.team1 && !matchRow.team2 && deliveries.length === 0) {
    throw new Error(`${matchId}.json does not contain match details or deliveries.`);
  }

  return { matchRow, deliveries };
}

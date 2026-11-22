import { normalizeHeader, parseCSVLine, type ParsedMatchRow } from "@/lib/csv";
import type { ParsedCricsheetMatch } from "@/lib/cricsheetJson";

const EXTRAS_COLUMNS: Array<[number, string]> = [
  [9, "wides"],
  [10, "noballs"],
  [11, "byes"],
  [12, "legbyes"],
  [13, "penalty"],
];

export function parseCricsheetInfo(text: string, matchId: string): ParsedMatchRow {
  const teams: string[] = [];
  const umpires: string[] = [];
  text = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const values: ParsedMatchRow = { match_id: matchId };

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const columns = parseCSVLine(line);
    if (columns[0]?.toLowerCase() !== "info") continue;

    const key = normalizeHeader(columns[1]);
    const value = columns.slice(2).filter(Boolean).join(", ");
    if (!value) continue;

    if (key === "team") teams.push(value);
    else if (key === "season") values.season = value;
    else if (key === "date" || key === "dates") {
      if (!values.date) values.date = value.replace(/\//g, "-");
    }
    else if (key === "city") values.city = value;
    else if (key === "venue") values.venue = value;
    else if (key === "tosswinner") values.toss_winner = value;
    else if (key === "tossdecision") values.toss_decision = value;
    else if (key === "playerofmatch") values.player_of_match = value;
    else if (key === "umpire") umpires.push(value);
    else if (key === "winner") values.result = value;
    else if (key === "winnerruns") values.result_margin = `${value} runs`;
    else if (key === "winnerwickets") values.result_margin = `${value} wickets`;
    else if (key === "matchtype" || key === "matchformat" || key === "format") values.match_type = value;
    else if (key === "overs" || key === "overlimit") values.overs = value;
    else if (key === "event" || key === "competition") values.event_name = value;
    else if (key === "outcome") {
      if (normalizeHeader(columns[2]) === "winner") values.result = columns.slice(3).filter(Boolean).join(", ");
      if (normalizeHeader(columns[2]) === "by") values.result_margin = columns.slice(3).filter(Boolean).join(" ");
    }
  }

  if (teams[0]) values.team1 = teams[0];
  if (teams[1]) values.team2 = teams[1];
  if (umpires[0]) values.umpire1 = umpires[0];
  if (umpires[1]) values.umpire2 = umpires[1];
  return values;
}

function toBallRow(columns: string[], matchId: string): ParsedMatchRow {
  const extrasType = EXTRAS_COLUMNS.find(([index]) => columns[index])?.[1] ?? "";
  return {
    match_id: matchId,
    innings_no: columns[1] ?? "",
    actual_delivery: columns[2] ?? "",
    batter: columns[4] ?? "",
    non_striker: columns[5] ?? "",
    bowler: columns[6] ?? "",
    batsman_runs: columns[7] || "0",
    extra_runs: columns[8] || "0",
    extras_type: extrasType,
    wicket_type: columns[14] ?? "",
    player_out: columns[15] ?? "",
    fielder: [columns[18], columns[19], columns[20]].filter(Boolean).join(", "),
  };
}

export function parseCricsheetCsv(text: string, matchId: string): ParsedCricsheetMatch {
  const cleaned = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const matchRow = parseCricsheetInfo(cleaned, matchId);

  const deliveries: ParsedMatchRow[] = [];
  for (const line of cleaned.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const columns = parseCSVLine(line);
    if (columns[0]?.toLowerCase() === "ball") deliveries.push(toBallRow(columns, matchId));
  }

  if (!matchRow.team1 && !matchRow.team2 && deliveries.length === 0) {
    throw new Error(`${matchId}.csv does not contain match details or deliveries.`);
  }

  return { matchRow, deliveries };
}

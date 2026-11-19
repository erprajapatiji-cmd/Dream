import { getField, type ParsedMatchRow } from "@/lib/csv";

export interface CsvImportResult {
  matches: number;
  innings: number;
  balls: number;
  committed: number;
}

export interface BatchProgress {
  committed: number;
  total: number;
  batchSize: number;
  rowsSent: number;
  retries: number;
}

interface MatchPayload {
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
}

interface BallPayload {
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
  batting_team: string | null;
  bowling_team: string | null;
}

function uniqueMatchId(row: ParsedMatchRow): string {
  return getField(row, "match_id", "matchid", "ID", "id", "matchnumber", "matchno");
}

function optionalField(row: ParsedMatchRow, ...names: string[]): string | null {
  const value = getField(row, ...names).trim();
  if (!value || /^(tbd|unknown|n\/a|na|null|undefined)$/i.test(value)) return null;
  return value;
}

export type MatchFormat = "T20" | "ODI" | "Test" | "T10" | "First Class" | "List A" | "Unknown";

export function normalizeMatchFormat(value: string): MatchFormat {
  const normalized = value.trim().toLowerCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ");
  if (!normalized) return "Unknown";
  if (/^(t20|t20i|twenty20|twenty 20|20 overs?)$/.test(normalized)) return "T20";
  if (/^(t10|ten10|ten 10|10 overs?)$/.test(normalized)) return "T10";
  if (/^(odi|one day|one day international|50 overs?)$/.test(normalized)) return "ODI";
  if (/^(test|test match|five day|five day test)$/.test(normalized)) return "Test";
  if (/^(first class|first-class)$/.test(normalized)) return "First Class";
  if (/^(list a|list-a)$/.test(normalized)) return "List A";
  if (/\b(t20|twenty20)\b/.test(normalized) || /\b(ipl|bbl|psl|cpl|t20 world cup)\b/.test(normalized)) return "T20";
  if (/\b(odi|one day)\b/.test(normalized)) return "ODI";
  if (/\b(test|first class)\b/.test(normalized)) return normalized.includes("first class") ? "First Class" : "Test";
  if (/\blist a\b/.test(normalized)) return "List A";
  if (/\bt10\b/.test(normalized)) return "T10";
  return "Unknown";
}

export function detectMatchFormat(row: ParsedMatchRow): MatchFormat {
  const explicit = getField(row, "match_type", "matchtype", "format", "match_format", "matchformat");
  const explicitFormat = normalizeMatchFormat(explicit);
  if (explicitFormat !== "Unknown") return explicitFormat;

  const event = getField(row, "event", "event_name", "eventname", "competition", "competition_name");
  const eventFormat = normalizeMatchFormat(event);
  if (eventFormat !== "Unknown") return eventFormat;

  const overs = Number.parseFloat(getField(row, "overs", "over_limit", "overlimit"));
  if (overs === 20) return "T20";
  if (overs === 10) return "T10";
  if (overs === 50) return "ODI";
  return "Unknown";
}

function toMatchPayload(row: ParsedMatchRow): MatchPayload | null {
  const team1 = optionalField(row, "team1", "Team1", "team1name", "teamone");
  const team2 = optionalField(row, "team2", "Team2", "team2name", "teamtwo");
  if (!team1 && !team2) return null;

  return {
    match_id: uniqueMatchId(row) || crypto.randomUUID(),
    match_format: detectMatchFormat(row),
    season: optionalField(row, "season", "Season", "seasonyear", "year"),
    city: optionalField(row, "city", "City", "cityname"),
    date: optionalField(row, "date", "Date", "matchdate"),
    team1,
    team2,
    toss_winner: optionalField(row, "toss_winner", "TossWinner", "tosswinner"),
    toss_decision: optionalField(row, "toss_decision", "TossDecision", "tossdecision"),
    result: optionalField(row, "result", "Result", "winningteam", "matchresult"),
    result_margin: optionalField(row, "result_margin", "ResultMargin", "margin", "winmargin"),
    player_of_match: optionalField(row, "player_of_match", "Player_of_Match", "playerofmatch", "manofthematch"),
    venue: optionalField(row, "venue", "Venue", "stadium"),
    umpire1: optionalField(row, "umpire1", "Umpire1"),
    umpire2: optionalField(row, "umpire2", "Umpire2"),
  };
}

function numericField(row: ParsedMatchRow, ...names: string[]): number {
  const value = Number.parseFloat(getField(row, ...names));
  return Number.isFinite(value) ? value : 0;
}

export function toBallPayload(row: ParsedMatchRow, matchIdOverride?: string): BallPayload | null {
  const matchId = matchIdOverride || uniqueMatchId(row);
  if (!matchId) return null;

  const inningsNo = Math.trunc(numericField(row, "innings_no", "innings", "Innings", "inningsnumber", "inningsid")) || 1;
  const deliveryNumber = numericField(row, "ball", "Ball", "ballnumber", "ballno", "ballofover", "actual_delivery");
  const explicitOver = getField(row, "over", "Over", "overs", "Overs", "overnumber");
  const over = explicitOver ? Math.trunc(Number.parseFloat(explicitOver)) : Math.floor(deliveryNumber);
  const deliveryFraction = Math.round((deliveryNumber - Math.floor(deliveryNumber)) * 10);
  const ball = explicitOver ? Math.max(0, Math.trunc(deliveryNumber)) : Math.max(0, deliveryFraction - 1);
  const runsBatter = numericField(row, "batsman_runs", "runs_batter", "BatsmanRun", "batsmanrun", "batterruns", "batter_runs", "runs_off_bat", "runsoffbat");
  const runsExtra = numericField(row, "extra_runs", "runs_extra", "ExtrasRun", "extraruns", "extras", "extrarun");
  const totalValue = getField(row, "total_runs", "runs_total", "TotalRun", "totalruns", "totalrun", "total", "run");
  const wicketType = getField(row, "dismissal_kind", "wicket_type", "wicket_kind", "Kind", "dismissalkind", "dismissaltype", "wickettype", "kindofwicket");
  const playerOut = getField(row, "player_out", "PlayerOut", "PlayerDismissed", "playerdismissed", "playerout", "batsmandismissed", "outplayer");
  const wicketFlag = getField(row, "is_wicket", "IsWicketDelivery", "iswicket", "iswicketdelivery", "wicket", "iswicketdelivery");

  return {
    match_id: matchId,
    innings_no: inningsNo,
    over,
    ball,
    batter: getField(row, "batter", "Batter", "batsman", "Batsman", "batsmanname", "striker", "battersname") || null,
    bowler: getField(row, "bowler", "Bowler", "bowlersname", "bowlername") || null,
    non_striker: getField(row, "non_striker", "NonStriker", "nonstriker", "nonstrikername") || null,
    runs_batter: runsBatter,
    runs_extra: runsExtra,
    runs_total: totalValue ? Number.parseFloat(totalValue) || 0 : runsBatter + runsExtra,
    extras_type: getField(row, "extras_type", "ExtraType", "extratype", "extraskind") || null,
    is_wicket: Boolean(wicketType || playerOut) || wicketFlag === "1" || wicketFlag.toLowerCase() === "true" || wicketFlag.toLowerCase() === "yes",
    wicket_type: wicketType || null,
    player_out: playerOut || null,
    fielder: getField(row, "fielder", "Fielder", "FieldersInvolved", "fieldersinvolved", "fielder_1") || null,
    batting_team: getField(row, "batting_team", "BattingTeam", "battingteam", "bat_team", "batteam") || null,
    bowling_team: getField(row, "bowling_team", "BowlingTeam", "bowlingteam", "bowl_team", "bowlteam") || null,
  };
}

const EDGE_FUNCTION_TIMEOUT_MS = 60000;
const MAX_BATCH = 2000;
const MIN_BATCH = 100;
const BATCH_SPLIT_STEPS = [2000, 1000, 500, 250, 100];
const FAST_THRESHOLD_MS = 15000;
const MAX_RETRIES = 3;

function isRetryableError(err: unknown, statusCode?: number): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (err instanceof TypeError) return true; // network error
  if (statusCode) {
    return statusCode === 408 || statusCode === 429 || (statusCode >= 500 && statusCode < 600);
  }
  // Check for network-related messages
  const msg = err instanceof Error ? err.message.toLowerCase() : "";
  return msg.includes("failed to fetch") || msg.includes("network") || msg.includes("timeout") || msg.includes("aborted");
}

function extractStatusCode(err: unknown): number | undefined {
  const msg = err instanceof Error ? err.message : "";
  const match = msg.match(/returned (\d{3})/);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

async function postImport(
  payload: { format: "matches" | "balls"; matches?: MatchPayload[]; balls?: BallPayload[]; matchStubs?: string[] },
  onRetry?: (attempt: number, reason: string) => void
): Promise<{ committed: number; matchesCreated?: number; inningsCreated?: number; durationMs: number }> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), EDGE_FUNCTION_TIMEOUT_MS);
      const startTime = performance.now();
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/csv-import`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        }
      );
      clearTimeout(timeoutId);
      const durationMs = performance.now() - startTime;

      if (!response.ok) {
        const retryAfter = Number.parseInt(response.headers.get("Retry-After") ?? "", 10);
        const errorText = await response.text().catch(() => "");
        const detail = errorText ? `: ${errorText.slice(0, 200)}` : "";
        const error = new Error(`Import service returned ${response.status}${detail}${retryAfter ? `|retry-after=${retryAfter}` : ""}`);
        if (isRetryableError(error, response.status) && attempt < MAX_RETRIES - 1) {
          onRetry?.(attempt + 1, `HTTP ${response.status}`);
          const retryAfterMs = retryAfter ? retryAfter * 1000 : 0;
          const delay = Math.max(retryAfterMs, 1500 * 2 ** attempt);
          await new Promise<void>((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }

      const data = await response.json();
      if (!data || typeof data !== "object") throw new Error("Invalid response from import service");
      if (data.error) throw new Error(String(data.error));
      return {
        committed: Number(data.committed ?? 0),
        matchesCreated: Number(data.matchesCreated ?? 0),
        inningsCreated: Number(data.inningsCreated ?? 0),
        durationMs,
      };
    } catch (err) {
      const status = extractStatusCode(err);
      lastError = err instanceof Error ? err : new Error(String(err));

      if (isRetryableError(err, status) && attempt < MAX_RETRIES - 1) {
        const reason = err instanceof DOMException && err.name === "AbortError" ? "timeout" : status ? `HTTP ${status}` : "network";
        onRetry?.(attempt + 1, reason);
        await new Promise<void>((resolve) => setTimeout(resolve, 1500 * 2 ** attempt));
        continue;
      }
      throw lastError;
    }
  }
  throw lastError ?? new Error("Import request failed");
}

interface AdaptiveBatchResult {
  committed: number;
  matchesCreated: number;
  inningsCreated: number;
  totalRetries: number;
  finalBatchSize: number;
}

async function sendBatchAdaptive<T extends MatchPayload | BallPayload>(
  items: T[],
  buildPayload: (slice: T[]) => { format: "matches" | "balls"; matches?: MatchPayload[]; balls?: BallPayload[]; matchStubs?: string[] },
  onProgress?: (p: BatchProgress) => void,
  initialBatchSize?: number
): Promise<AdaptiveBatchResult> {
  let batchSize = Math.min(initialBatchSize ?? MAX_BATCH, MAX_BATCH);
  let committed = 0;
  let matchesCreated = 0;
  let inningsCreated = 0;
  let totalRetries = 0;
  let offset = 0;

  while (offset < items.length) {
    const slice = items.slice(offset, offset + batchSize);
  
    try {
      const result = await postImport(buildPayload(slice), () => {
        totalRetries += 1;
        onProgress?.({
          committed,
          total: items.length,
          batchSize,
          rowsSent: slice.length,
          retries: totalRetries,
        });
      });

      committed += result.committed;
      matchesCreated += result.matchesCreated ?? 0;
      inningsCreated += result.inningsCreated ?? 0;
      offset += slice.length;

      // Ramp up if request was fast
      if (result.durationMs < FAST_THRESHOLD_MS && batchSize < MAX_BATCH) {
        const nextStep = BATCH_SPLIT_STEPS.find((s) => s > batchSize);
        if (nextStep) batchSize = nextStep;
      }

      onProgress?.({
        committed,
        total: items.length,
        batchSize,
        rowsSent: slice.length,
        retries: totalRetries,
      });
    } catch (err) {
      const status = extractStatusCode(err);
      // Only split and retry on retryable errors (timeout, network, 408, 429, 5xx)
      if (isRetryableError(err, status) && slice.length > MIN_BATCH) {
        const halfSize = Math.max(MIN_BATCH, Math.floor(slice.length / 2));
        batchSize = halfSize;
        totalRetries += 1;
        onProgress?.({
          committed,
          total: items.length,
          batchSize,
          rowsSent: slice.length,
          retries: totalRetries,
        });
        // Retry the same offset with smaller batch — don't advance offset
        continue;
      }
      throw err;
    }
  }

  return { committed, matchesCreated, inningsCreated, totalRetries, finalBatchSize: batchSize };
}

export async function importMatchesBatch(
  rows: ParsedMatchRow[],
  onProgress?: (current: number, total: number) => void,
): Promise<number> {
  const total = rows.length;
  if (total === 0) return 0;

  const payloads = rows.map(toMatchPayload).filter((payload): payload is MatchPayload => payload !== null);
  if (payloads.length === 0) return 0;

  const result = await sendBatchAdaptive(
    payloads,
    (slice) => ({ format: "matches", matches: slice }),
    onProgress
      ? (p) => onProgress(p.committed, p.total)
      : undefined
  );
  return result.committed;
}

export async function importBallsBatch(
  rows: ParsedMatchRow[],
  onProgress?: (current: number, total: number) => void,
  matchIdOverride?: string,
): Promise<CsvImportResult> {
  const payloads: BallPayload[] = [];
  for (const row of rows) {
    const ball = toBallPayload(row, matchIdOverride);
    if (ball) payloads.push(ball);
  }
  if (payloads.length === 0) {
    return { matches: 0, innings: 0, balls: 0, committed: 0 };
  }

  const result = await sendBatchAdaptive(
    payloads,
    (slice) => ({
      format: "balls",
      balls: slice,
      matchStubs: [...new Set(slice.map((b) => b.match_id))],
    }),
    onProgress
      ? (p) => onProgress(p.committed, p.total)
      : undefined
  );

  return {
    matches: result.matchesCreated,
    innings: result.inningsCreated,
    balls: result.committed,
    committed: result.committed,
  };
}

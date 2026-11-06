export interface ParsedMatchRow {
  [key: string]: string;
}

export function parseCSVLine(line: string, delimiter = ","): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

// Normalize header names: lowercase, remove spaces/underscores/hyphens for matching
export function normalizeHeader(value: unknown): string {
  return String(value ?? "").toLowerCase().trim().replace(/[\s_-]/g, "");
}

export function parseCSV(text: string): { headers: string[]; rows: ParsedMatchRow[] } {
  // Strip BOM if present
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const delimiter = detectDelimiter(lines[0]);
  const headers = parseCSVLine(lines[0], delimiter);
  const rows: ParsedMatchRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i], delimiter);
    const row: ParsedMatchRow = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || "";
    }
    rows.push(row);
  }

  return { headers, rows };
}

// Streaming parser: reads a File in chunks, yields batches of parsed rows.
// Handles quoted fields spanning newlines. Calls onProgress with bytes processed.
export async function* parseCSVStream(
  file: File,
  options?: { startByte?: number },
): AsyncGenerator<{ headers: string[]; rows: ParsedMatchRow[] }, void, unknown> {
  const startByte = options?.startByte ?? 0;
  const reader = file.stream().getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let headers: string[] | null = null;
  let delimiter = ",";
  const rowQueue: ParsedMatchRow[] = [];
  const FLUSH_THRESHOLD = 2000;

  if (startByte > 0) {
    // Skip forward to startByte; we assume headers already known via separate read
    let skipped = 0;
    while (skipped < startByte) {
      const { value, done } = await reader.read();
      if (done) break;
      skipped += value.byteLength;
    }
    buffer = "";
  }

  const parseCompleteLines = (text: string, isFinal: boolean): { rows: ParsedMatchRow[]; remainder: string } => {
    const out: ParsedMatchRow[] = [];
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch !== "\n" && ch !== "\r") continue;
      // skip \r\n together
      const lineEnd = i;
      const line = text.slice(start, lineEnd);
      if (line.length > 0) {
        if (!headers) {
          delimiter = detectDelimiter(line);
          headers = parseCSVLine(line, delimiter);
        } else {
          const values = parseCSVLine(line, delimiter);
          const row: ParsedMatchRow = {};
          for (let j = 0; j < headers.length; j++) {
            row[headers[j]] = values[j] || "";
          }
          out.push(row);
        }
      }
      // advance past newline chars
      start = i + 1;
      if (ch === "\r" && text[i + 1] === "\n") i++;
    }
    const remainder = isFinal ? "" : text.slice(start);
    if (isFinal && remainder.length > 0 && headers) {
      const values = parseCSVLine(remainder, delimiter);
      const row: ParsedMatchRow = {};
      for (let j = 0; j < headers.length; j++) {
        row[headers[j]] = values[j] || "";
      }
      out.push(row);
    }
    return { rows: out, remainder };
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        const { rows } = parseCompleteLines(buffer, true);
        rowQueue.push(...rows);
        if (rowQueue.length > 0) {
          yield { headers: headers ?? [], rows: rowQueue };
        }
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const { rows, remainder } = parseCompleteLines(buffer, false);
      buffer = remainder;
      rowQueue.push(...rows);
      if (rowQueue.length >= FLUSH_THRESHOLD) {
        yield { headers: headers ?? [], rows: rowQueue.splice(0, rowQueue.length) };
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// Read just the header line from a file (for format detection before streaming).
export async function readCSVHeaders(file: File): Promise<string[]> {
  const slice = file.slice(0, Math.min(65536, file.size));
  const text = await slice.text();
  const cleaned = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const firstLine = cleaned.split(/\r?\n/)[0] ?? "";
  if (firstLine.length === 0) return [];
  const delimiter = detectDelimiter(firstLine);
  return parseCSVLine(firstLine, delimiter);
}

function detectDelimiter(headerLine: string): string {
  const candidates = [",", "\t", ";", "|"];
  return candidates
    .map((delimiter) => ({ delimiter, count: headerLine.split(delimiter).length }))
    .sort((a, b) => b.count - a.count)[0].delimiter;
}

// Find a value from a row using multiple possible column names
export function detectFormatFromHeaders(headers: string[]): "matches" | "balls" | "unknown" {
  const normalized = headers.map(normalizeHeader);

  const hasOver = normalized.some((h) => h === "over" || h === "overs" || h === "overnumber");
  const hasBatter = normalized.some((h) => h === "batter" || h === "batsman" || h === "batsmanname" || h === "striker" || h === "battersname" || h === "batssman");
  const hasBowler = normalized.some((h) => h === "bowler" || h === "bowlersname" || h === "bowlername");

  if (hasOver && (hasBatter || hasBowler)) return "balls";

  const hasSeason = normalized.some((h) => h === "season" || h === "seasonyear" || h === "year");
  const hasTeam = normalized.some((h) => h === "team1" || h === "team2" || h === "teamone" || h === "teamtwo" || h === "team1name" || h === "team2name");
  if (hasSeason && hasTeam) return "matches";

  const hasDate = normalized.some((h) => h === "date" || h === "matchdate");
  const hasVenue = normalized.some((h) => h === "venue" || h === "stadium" || h === "city" || h === "cityname");
  if (hasDate && hasVenue) return "matches";

  return "unknown";
}

export function getField(row: Record<string, string>, ...candidates: string[]): string {
  const normalizedKeys: Record<string, string> = {};
  for (const key of Object.keys(row)) {
    normalizedKeys[normalizeHeader(key)] = key;
  }
  for (const candidate of candidates) {
    const norm = normalizeHeader(candidate);
    if (normalizedKeys[norm] !== undefined) {
      return row[normalizedKeys[norm]] || "";
    }
  }
  return "";
}

function escapeCSVValue(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function stringifyCSV(headers: string[], rows: ParsedMatchRow[]): string {
  return [
    headers.map(escapeCSVValue).join(","),
    ...rows.map((row) => headers.map((header) => escapeCSVValue(row[header] || "")).join(",")),
  ].join("\n");
}

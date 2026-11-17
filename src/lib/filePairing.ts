import { readCSVHeaders, detectFormatFromHeaders, normalizeHeader } from "@/lib/csv";

export type FileKind = "cricsheet-combined" | "cricsheet-info" | "cricsheet-balls" | "summary" | "tabular-balls" | "json" | "unknown";

export interface ClassifiedFile {
  file: File;
  kind: FileKind;
  matchId: string;
}

export interface PairedGroup {
  matchId: string;
  info?: File;
  balls?: File;
  combined?: File;
  summary?: File;
  json?: File;
}

export interface PairingResult {
  pairs: PairedGroup[];
  combined: File[];
  infoOnly: { file: File; matchId: string }[];
  ballOnly: { file: File; matchId: string }[];
  summaryFiles: File[];
  jsonFiles: File[];
  unknownFiles: File[];
}

function extractMatchId(fileName: string): string {
  return fileName
    .replace(/\.json$/i, "")
    .replace(/_info\.csv$/i, "")
    .replace(/\.csv$/i, "")
    .replace(/\.tsv$/i, "")
    .replace(/\.txt$/i, "");
}

export async function classifyFile(file: File): Promise<ClassifiedFile> {
  const matchId = extractMatchId(file.name);

  if (/\.json$/i.test(file.name)) {
    return { file, kind: "json", matchId };
  }

  if (/_info\.csv$/i.test(file.name)) {
    return { file, kind: "cricsheet-info", matchId };
  }

  const headers = await readCSVHeaders(file);
  if (headers.length === 0) {
    return { file, kind: "unknown", matchId };
  }

  if (normalizeHeader(headers[0]) === "version" || normalizeHeader(headers[0]) === "info") {
    return { file, kind: "cricsheet-combined", matchId };
  }

  const detected = detectFormatFromHeaders(headers);
  if (detected === "matches") {
    return { file, kind: "summary", matchId };
  }
  if (detected === "balls") {
    // Could be cricsheet-balls (paired with _info) or standalone tabular balls
    if (/^[0-9]+\.csv$/i.test(file.name)) {
      return { file, kind: "cricsheet-balls", matchId };
    }
    return { file, kind: "tabular-balls", matchId };
  }

  if (/\.csv$/i.test(file.name) && /^[0-9]+\.csv$/i.test(file.name)) {
    return { file, kind: "cricsheet-balls", matchId };
  }

  return { file, kind: "unknown", matchId };
}

export async function classifyAndPair(files: File[]): Promise<PairingResult> {
  const classified: ClassifiedFile[] = [];
  for (const file of files) {
    try {
      classified.push(await classifyFile(file));
    } catch {
      classified.push({ file, kind: "unknown", matchId: extractMatchId(file.name) });
    }
  }

  const byMatchId = new Map<string, PairedGroup>();
  const combined: File[] = [];
  const summaryFiles: File[] = [];
  const jsonFiles: File[] = [];
  const unknownFiles: File[] = [];

  for (const c of classified) {
    if (c.kind === "unknown") {
      unknownFiles.push(c.file);
      continue;
    }
    if (c.kind === "cricsheet-combined") {
      combined.push(c.file);
      continue;
    }
    if (c.kind === "json") {
      jsonFiles.push(c.file);
      continue;
    }

    let group = byMatchId.get(c.matchId);
    if (!group) {
      group = { matchId: c.matchId };
      byMatchId.set(c.matchId, group);
    }

    if (c.kind === "cricsheet-info") group.info = c.file;
    else if (c.kind === "cricsheet-balls") group.balls = c.file;
    else if (c.kind === "summary") {
      group.summary = c.file;
      summaryFiles.push(c.file);
    } else if (c.kind === "tabular-balls") group.balls = c.file;
  }

  const pairs: PairedGroup[] = [];
  const infoOnly: { file: File; matchId: string }[] = [];
  const ballOnly: { file: File; matchId: string }[] = [];

  for (const group of byMatchId.values()) {
    if (group.info && group.balls) {
      pairs.push(group);
    } else if (group.info && !group.balls) {
      infoOnly.push({ file: group.info, matchId: group.matchId });
    } else if (group.balls && !group.info) {
      ballOnly.push({ file: group.balls, matchId: group.matchId });
      pairs.push(group);
    } else if (group.summary) {
      pairs.push(group);
    }
  }

  return { pairs, combined, infoOnly, ballOnly, summaryFiles, jsonFiles, unknownFiles };
}

export interface ImportSummary {
  pairedGroups: number;
  combinedFiles: number;
  infoOnlyFiles: number;
  ballOnlyFiles: number;
  summaryFiles: number;
  jsonFiles: number;
  importedMatches: number;
  importedInnings: number;
  importedBalls: number;
  failedFiles: number;
  skippedFiles: number;
}

export function emptyImportSummary(): ImportSummary {
  return {
    pairedGroups: 0,
    combinedFiles: 0,
    infoOnlyFiles: 0,
    ballOnlyFiles: 0,
    summaryFiles: 0,
    jsonFiles: 0,
    importedMatches: 0,
    importedInnings: 0,
    importedBalls: 0,
    failedFiles: 0,
    skippedFiles: 0,
  };
}

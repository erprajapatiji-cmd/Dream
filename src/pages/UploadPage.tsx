import { useState, useRef, useCallback, useEffect } from "react";
import { Upload, CheckCircle, AlertCircle, Loader2, ArrowLeft, Database, FilePlus2, FolderOpen, Info, AlertTriangle } from "lucide-react";
import { parseCSVStream, parseCSV, normalizeHeader } from "@/lib/csv";
import { importMatchesBatch, importBallsBatch } from "@/lib/csvImport";
import { parseCricsheetJson, type ParsedCricsheetMatch } from "@/lib/cricsheetJson";
import { parseCricsheetCsv, parseCricsheetInfo } from "@/lib/cricsheetCsv";
import { classifyAndPair, emptyImportSummary, type PairingResult } from "@/lib/filePairing";
import {
  setUploadImporting,
  setUploadProgress,
  setUploadResult,
  setUploadError,
  resetUpload,
  useUploadProgress,
} from "@/lib/uploadProgress";

interface UploadPageProps {
  onNavigate: (page: string, params?: Record<string, string>) => void;
}

const MAX_FILES_PER_SELECTION = 25000;
const isMobile = typeof window !== "undefined" && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

interface ProgressState {
  phase: string;
  total: number;
  current: number;
  committedRows: number;
}

export default function UploadPage({ onNavigate }: UploadPageProps) {
  const seenFilesRef = useRef<Set<string>>(new Set());
  const [importedFileCount, setImportedFileCount] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const { importing, progress, result, error } = useUploadProgress();

  const importingRef = useRef(importing);
  useEffect(() => {
    importingRef.current = importing;
  }, [importing]);

  useEffect(() => {
    return () => {
      if (!importingRef.current) resetUpload();
    };
  }, []);

  const setProgress = useCallback((state: ProgressState) => {
    setUploadProgress({ total: state.total, current: state.current, phase: state.phase, committedRows: state.committedRows });
  }, []);

  const streamImport = useCallback(async (f: File, matchId: string, basePhase: string): Promise<{ matches: number; innings: number; balls: number }> => {
    let totalRows = Math.max(1, Math.floor(f.size / 80));
    let processed = 0;
    let committedRows = 0;
    let matchesCount = 0;
    let inningsCount = 0;
    let ballsCount = 0;
    let determinedTotal = false;
    let useRowMatchId = false;

    setProgress({ total: totalRows, current: 0, phase: `${basePhase} — reading ${f.name}...`, committedRows: 0 });

    for await (const batch of parseCSVStream(f)) {
      if (batch.rows.length === 0 && batch.headers.length === 0) continue;

      if (!determinedTotal && batch.rows.length > 0) {
        const approxRowsPerByte = batch.rows.length / Math.min(f.size, 1024 * 1024);
        totalRows = Math.max(batch.rows.length, Math.floor(f.size * approxRowsPerByte));
        determinedTotal = true;
        // Check if rows have their own match_id column with varying values (multi-match CSV)
        const hasMatchIdCol = batch.headers.some((h) => normalizeHeader(h) === "matchid" || normalizeHeader(h) === "id");
        if (hasMatchIdCol) {
          const distinctIds = new Set(batch.rows.slice(0, 100).map((r) => r[batch.headers.find((h) => normalizeHeader(h) === "matchid" || normalizeHeader(h) === "id") ?? "match_id"]));
          useRowMatchId = distinctIds.size > 1;
        }
      }

      const res = await importBallsBatch(batch.rows, (c) => {
        setProgress({ total: totalRows, current: processed + batch.rows.length, phase: `${basePhase} — saving rows from ${f.name}...`, committedRows: committedRows + c });
      }, useRowMatchId ? undefined : matchId);
      processed += batch.rows.length;
      matchesCount += res.matches;
      inningsCount += res.innings;
      ballsCount += res.balls;
      committedRows += res.committed;

      setProgress({ total: totalRows, current: processed, phase: `${basePhase} — saving rows from ${f.name}...`, committedRows });
    }

    return { matches: matchesCount, innings: inningsCount, balls: ballsCount };
  }, [setProgress]);

  const importCricsheetMatch = useCallback(async (fileName: string, parsed: ParsedCricsheetMatch, matchId: string): Promise<{ matches: number; innings: number; balls: number }> => {
    if (parsed.deliveries.length === 0) return { matches: 0, innings: 0, balls: 0 };
    setProgress({ total: parsed.deliveries.length, current: 0, phase: `Saving match details from ${fileName}...`, committedRows: 0 });
    const matches = await importMatchesBatch([parsed.matchRow]);

    const res = await importBallsBatch(parsed.deliveries, (c) => {
      setProgress({ total: parsed.deliveries.length, current: c, phase: `Saving ball-by-ball rows from ${fileName}...`, committedRows: c });
    }, matchId);

    return { matches, innings: res.innings, balls: res.balls };
  }, [setProgress]);

  const importInfoFile = useCallback(async (file: File, matchId: string): Promise<number> => {
    const text = await file.text();
    const matchRow = parseCricsheetInfo(text, matchId);
    if (!matchRow.team1 && !matchRow.team2) return 0;
    const committed = await importMatchesBatch([matchRow]);
    return committed;
  }, []);

  const importSummaryFile = useCallback(async (file: File): Promise<number> => {
    const text = await file.text();
    const { headers, rows } = parseCSV(text);
    if (rows.length === 0) return 0;
    const hasMatchId = headers.some((h) => normalizeHeader(h) === "matchid" || normalizeHeader(h) === "id");
    if (!hasMatchId) return 0;
    return importMatchesBatch(rows);
  }, []);

  const importFiles = useCallback(async (selectedFiles: File[]) => {
    setUploadError(null);
    setUploadResult(null);
    setUploadImporting(true);

    const summary = emptyImportSummary();
    const warnings: string[] = [];
    const failedFiles: string[] = [];

    try {
      // Phase 1: Classify and pair all files
      setProgress({ total: selectedFiles.length, current: 0, phase: `Classifying ${selectedFiles.length.toLocaleString()} files...`, committedRows: 0 });
      const pairing: PairingResult = await classifyAndPair(selectedFiles);

      summary.pairedGroups = pairing.pairs.filter((p) => p.info && p.balls).length;
      summary.combinedFiles = pairing.combined.length;
      summary.infoOnlyFiles = pairing.infoOnly.length;
      summary.ballOnlyFiles = pairing.ballOnly.length;
      summary.summaryFiles = pairing.summaryFiles.length;
      summary.jsonFiles = pairing.jsonFiles.length;

      // Generate warnings for info-only and ball-only files
      for (const { file, matchId } of pairing.infoOnly) {
        warnings.push(`${file.name} mila, lekin ${matchId}.csv ball-by-ball file nahi mili.`);
      }
      for (const { file, matchId } of pairing.ballOnly) {
        warnings.push(`${file.name} import ho gaya, lekin ${matchId}_info.csv match information file nahi mili.`);
      }

      const totalUnits =
        pairing.pairs.length +
        pairing.combined.length +
        pairing.jsonFiles.length +
        pairing.infoOnly.length;
      let completedUnits = 0;

      const tickProgress = (phase: string, committed: number) => {
        setProgress({ total: totalUnits, current: completedUnits, phase, committedRows: committed });
      };

      // Phase 2: Process paired groups (info + balls, or ball-only with stub, or summary-only)
      const CONCURRENCY = 3;
      const processPair = async (group: { matchId: string; info?: File; balls?: File; summary?: File; combined?: File; json?: File }) => {
        try {
          if (group.info) {
            await importInfoFile(group.info, group.matchId);
            summary.importedMatches += 1;
          }
          if (group.balls) {
            if (group.info) {
              // Paired: parse info, upsert match, then stream balls
              const infoText = await group.info.text();
              const matchRow = parseCricsheetInfo(infoText, group.matchId);
              if (matchRow.team1 || matchRow.team2) {
                await importMatchesBatch([matchRow]);
              }
            }
            // Check if it's a cricsheet-format ball file (header starts with "version" or "ball")
            const headers = await readCSVHeadersSafe(group.balls);
            if (normalizeHeader(headers[0]) === "ball") {
              // Cricsheet separate ball file — parse and import as cricsheet match
              const parsed = parseCricsheetCsv(await group.balls.text(), group.matchId);
              const counts = await importCricsheetMatch(group.balls.name, parsed, group.matchId);
              summary.importedInnings += counts.innings;
              summary.importedBalls += counts.balls;
              if (counts.matches > 0) summary.importedMatches += counts.matches;
            } else {
              // Tabular ball file — stream import
              const counts = await streamImport(group.balls, group.matchId, `Paired import ${group.matchId}`);
              summary.importedMatches += counts.matches;
              summary.importedInnings += counts.innings;
              summary.importedBalls += counts.balls;
            }
          }
          if (group.summary && !group.info && !group.balls) {
            const committed = await importSummaryFile(group.summary);
            summary.importedMatches += committed;
          }
        } catch (err) {
          console.error(`Import failed for pair ${group.matchId}`, err);
          summary.failedFiles += 1;
          failedFiles.push(group.matchId);
        } finally {
          completedUnits += 1;
          tickProgress(`Processed ${completedUnits}/${totalUnits} groups`, summary.importedBalls);
        }
      };

      // Phase 3: Process combined cricsheet CSV files
      const processCombined = async (file: File) => {
        try {
          const matchId = file.name.replace(/\.csv$/i, "");
          const parsed = parseCricsheetCsv(await file.text(), matchId);
          const counts = await importCricsheetMatch(file.name, parsed, matchId);
          summary.importedMatches += counts.matches;
          summary.importedInnings += counts.innings;
          summary.importedBalls += counts.balls;
          if (parsed.deliveries.length === 0) summary.skippedFiles += 1;
        } catch (err) {
          console.error(`Import failed for ${file.name}`, err);
          summary.failedFiles += 1;
          failedFiles.push(file.name);
        } finally {
          completedUnits += 1;
          tickProgress(`Processed ${completedUnits}/${totalUnits} files`, summary.importedBalls);
        }
      };

      // Phase 4: Process JSON files
      const processJson = async (file: File) => {
        try {
          const matchId = file.name.replace(/\.json$/i, "");
          const parsed = parseCricsheetJson(await file.text(), matchId);
          const counts = await importCricsheetMatch(file.name, parsed, matchId);
          summary.importedMatches += counts.matches;
          summary.importedInnings += counts.innings;
          summary.importedBalls += counts.balls;
          if (parsed.deliveries.length === 0) summary.skippedFiles += 1;
        } catch (err) {
          console.error(`Import failed for ${file.name}`, err);
          summary.failedFiles += 1;
          failedFiles.push(file.name);
        } finally {
          completedUnits += 1;
          tickProgress(`Processed ${completedUnits}/${totalUnits} files`, summary.importedBalls);
        }
      };

      // Phase 5: Process info-only files (save match info without balls)
      const processInfoOnly = async ({ file, matchId }: { file: File; matchId: string }) => {
        try {
          const committed = await importInfoFile(file, matchId);
          if (committed > 0) summary.importedMatches += committed;
          else summary.skippedFiles += 1;
        } catch (err) {
          console.error(`Import failed for ${file.name}`, err);
          summary.failedFiles += 1;
          failedFiles.push(file.name);
        } finally {
          completedUnits += 1;
          tickProgress(`Processed ${completedUnits}/${totalUnits} files`, summary.importedBalls);
        }
      };

      // Run all phases with controlled concurrency
      const allTasks: Promise<void>[] = [];

      for (let i = 0; i < pairing.pairs.length; i += CONCURRENCY) {
        const batch = pairing.pairs.slice(i, i + CONCURRENCY);
        allTasks.push(Promise.all(batch.map(processPair)).then(() => {}));
      }

      for (let i = 0; i < pairing.combined.length; i += CONCURRENCY) {
        const batch = pairing.combined.slice(i, i + CONCURRENCY);
        allTasks.push(Promise.all(batch.map(processCombined)).then(() => {}));
      }

      for (let i = 0; i < pairing.jsonFiles.length; i += CONCURRENCY) {
        const batch = pairing.jsonFiles.slice(i, i + CONCURRENCY);
        allTasks.push(Promise.all(batch.map(processJson)).then(() => {}));
      }

      for (let i = 0; i < pairing.infoOnly.length; i += CONCURRENCY) {
        const batch = pairing.infoOnly.slice(i, i + CONCURRENCY);
        allTasks.push(Promise.all(batch.map(processInfoOnly)).then(() => {}));
      }

      await Promise.all(allTasks);

      if (summary.importedMatches === 0 && summary.importedBalls === 0) {
        throw new Error("No ball-by-ball data was found in the selected files, so nothing was saved.");
      }

      const allNotices: string[] = [...warnings];
      if (summary.failedFiles > 0) {
        allNotices.push(`${summary.failedFiles} file(s) could not be imported.`);
      }
      if (summary.skippedFiles > 0) {
        allNotices.push(`${summary.skippedFiles} file(s) were skipped because they have no ball-by-ball data.`);
      }
      if (allNotices.length > 0) {
        setUploadError(`${allNotices.join(" ")} All other files were saved.`);
      }

      setUploadResult({
        ...summary,
        matches: summary.importedMatches,
        innings: summary.importedInnings,
        balls: summary.importedBalls,
      });
      setImportedFileCount((n) => n + selectedFiles.length);
    } catch (err) {
      console.error("CSV import failed", err);
      setUploadError(err instanceof Error && err.message ? err.message : "Could not import the selected CSV files.");
    } finally {
      setUploadImporting(false);
      setUploadProgress(null);
    }
  }, [streamImport, importCricsheetMatch, importInfoFile, importSummaryFile, setProgress]);

  const addFiles = useCallback(async (newFiles: File[]) => {
    setUploadError(null);

    const seen = seenFilesRef.current;
    const fresh: File[] = [];
    const CHUNK = 500;
    for (let i = 0; i < newFiles.length; i += CHUNK) {
      for (const f of newFiles.slice(i, i + CHUNK)) {
        const key = f.name + f.size;
        if (!seen.has(key)) {
          seen.add(key);
          fresh.push(f);
        }
      }
      if (i + CHUNK < newFiles.length) {
        await new Promise<void>((r) => setTimeout(r, 0));
      }
    }

    if (fresh.length === 0) return;
    await importFiles(fresh);
  }, [importFiles]);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length > 0) {
      await addFiles(droppedFiles);
    } else {
      setUploadError("Could not read the dropped files.");
    }
  };

  const handleFileSelection = async (e: React.ChangeEvent<HTMLInputElement>, folderOnly: boolean) => {
    const input = e.currentTarget;
    const fileList = input.files;
    if (!fileList || fileList.length === 0) return;

    if (fileList.length > MAX_FILES_PER_SELECTION) {
      setUploadError(
        `You selected ${fileList.length.toLocaleString()} files. For reliability, please select up to ${MAX_FILES_PER_SELECTION.toLocaleString()} files at a time. You can add more files in multiple batches.`
      );
      input.value = "";
      return;
    }

    const allSelected: File[] = [];
    for (let i = 0; i < fileList.length; i++) {
      allSelected.push(fileList[i]);
    }

    if (folderOnly) {
      const filtered: File[] = [];
      for (let i = 0; i < allSelected.length; i++) {
        if (/\.(csv|tsv|txt|json)$/i.test(allSelected[i].name)) {
          filtered.push(allSelected[i]);
        }
      }
      if (filtered.length > 0) {
        await addFiles(filtered);
      } else if (allSelected.length > 0) {
        setUploadError(`No CSV/TSV/TXT files found in the selected folder (${allSelected.length} files were other types).`);
      }
    } else {
      await addFiles(allSelected);
    }
  };

  const reset = () => {
    seenFilesRef.current = new Set();
    setImportedFileCount(0);
    resetUpload();
    if (inputRef.current) inputRef.current.value = "";
    if (folderInputRef.current) folderInputRef.current.value = "";
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <button
          onClick={() => onNavigate("matches")}
          className="mb-6 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
        >
          <ArrowLeft size={16} />
          Back to Matches
        </button>

        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Upload CSV Data</h1>
        <p className="mt-2 text-slate-400">
          Pick your CSV or JSON files and they are imported automatically — paired info+balls, combined Cricsheet, JSON, or summary CSV.
        </p>

      {result ? (
        <div className="mt-8 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <CheckCircle className="text-emerald-400" size={28} />
              <div>
                <h2 className="text-lg font-semibold text-emerald-300">Import Complete</h2>
                <p className="mt-1 text-sm text-emerald-200/70">{importedFileCount} file{importedFileCount !== 1 ? "s" : ""} processed</p>
              </div>
            </div>
            <span className="inline-flex w-fit items-center rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-300">
              Completed
            </span>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-4">
            <div className="rounded-lg bg-slate-900/60 p-4 text-center">
              <p className="text-2xl font-bold">{result.importedMatches}</p>
              <p className="text-sm text-slate-400">Matches</p>
            </div>
            <div className="rounded-lg bg-slate-900/60 p-4 text-center">
              <p className="text-2xl font-bold">{result.importedInnings}</p>
              <p className="text-sm text-slate-400">Innings</p>
            </div>
            <div className="rounded-lg bg-slate-900/60 p-4 text-center">
              <p className="text-2xl font-bold">{(result.importedBalls ?? 0).toLocaleString()}</p>
              <p className="text-sm text-slate-400">Balls</p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-400 sm:grid-cols-3">
            <div className="rounded-lg bg-slate-900/40 px-3 py-2">Paired groups: <span className="font-semibold text-slate-200">{result.pairedGroups}</span></div>
            <div className="rounded-lg bg-slate-900/40 px-3 py-2">Combined files: <span className="font-semibold text-slate-200">{result.combinedFiles}</span></div>
            <div className="rounded-lg bg-slate-900/40 px-3 py-2">JSON files: <span className="font-semibold text-slate-200">{result.jsonFiles}</span></div>
            <div className="rounded-lg bg-slate-900/40 px-3 py-2">Info-only: <span className="font-semibold text-slate-200">{result.infoOnlyFiles}</span></div>
            <div className="rounded-lg bg-slate-900/40 px-3 py-2">Ball-only: <span className="font-semibold text-slate-200">{result.ballOnlyFiles}</span></div>
            <div className="rounded-lg bg-slate-900/40 px-3 py-2">Summary: <span className="font-semibold text-slate-200">{result.summaryFiles}</span></div>
            {(result.failedFiles ?? 0) > 0 && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-red-300">Failed: {result.failedFiles}</div>}
            {(result.skippedFiles ?? 0) > 0 && <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-amber-300">Skipped: {result.skippedFiles}</div>}
          </div>

          {error && (
            <div className="mt-4 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
              <AlertTriangle className="mt-0.5 shrink-0 text-amber-400" size={20} />
              <p className="text-sm text-amber-300">{error}</p>
            </div>
          )}

          <div className="mt-6 flex gap-3">
            <button
              onClick={() => onNavigate("matches")}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 transition-colors"
            >
              View Matches
            </button>
            <button
              onClick={reset}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800 transition-colors"
            >
              Upload More
            </button>
          </div>
        </div>
      ) : importing ? (
        <div className="mt-8 rounded-xl border border-slate-800 bg-slate-900/60 p-8 text-center">
          <Loader2 className="mx-auto animate-spin text-blue-400" size={32} />
          {progress && (
            <>
              <p className="mt-4 text-slate-300">{progress.phase}</p>
              {progress.total > 1 && (
                <>
                  <p className="mt-1 text-sm text-slate-500">
                    {progress.current.toLocaleString()} / {progress.total.toLocaleString()} processed
                  </p>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full bg-blue-500 transition-all"
                      style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
                    />
                  </div>
                </>
              )}
              <div className="mt-5 inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2">
                <Database className="text-emerald-400" size={18} />
                <span className="text-sm text-emerald-300">
                  <span className="font-bold">{progress.committedRows.toLocaleString()}</span> rows saved to database
                </span>
              </div>
            </>
          )}
        </div>
      ) : (
        <>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={(e) => {
              if (e.target === e.currentTarget) inputRef.current?.click();
            }}
            className={`mt-8 cursor-pointer rounded-xl border-2 border-dashed p-12 text-center transition-colors ${
              dragOver ? "border-blue-500 bg-blue-500/5" : "border-slate-700 hover:border-slate-600"
            }`}
          >
            <Upload className="mx-auto text-slate-500" size={40} />
            <p className="mt-4 text-slate-300 font-medium">Drop CSV or JSON files here or click to browse</p>
            <p className="mt-1 text-sm text-slate-500">Select up to {MAX_FILES_PER_SELECTION.toLocaleString()} files at a time — import starts automatically</p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <div className="relative">
                <input
                  id="csv-file-picker"
                  ref={inputRef}
                  type="file"
                  accept=".csv,.tsv,.txt,.json"
                  multiple
                  onClick={(e) => {
                    e.stopPropagation();
                    e.currentTarget.value = "";
                  }}
                  onChange={(e) => handleFileSelection(e, false)}
                  className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                />
                <div className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800/60 px-5 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-800">
                  <FilePlus2 size={18} />
                  Select Files
                </div>
              </div>
              {!isMobile && (
              <div className="relative">
                <input
                  id="csv-folder-picker"
                  ref={folderInputRef}
                  type="file"
                  multiple
                  {...({ webkitdirectory: "" } as unknown as React.InputHTMLAttributes<HTMLInputElement>)}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.currentTarget.value = "";
                  }}
                  onChange={(e) => handleFileSelection(e, true)}
                  className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                />
                <div className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800/60 px-5 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-800">
                  <FolderOpen size={18} />
                  Select Entire Folder
                </div>
              </div>
              )}
            </div>
          </div>

          {error && (
            <div className="mt-4 flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
              <AlertCircle className="mt-0.5 shrink-0 text-red-400" size={20} />
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
            <div className="flex items-center gap-2 text-slate-300">
              <Info size={16} className="text-blue-400" />
              <h3 className="text-sm font-semibold">Supported file formats</h3>
            </div>
            <ul className="mt-3 space-y-2 text-sm text-slate-400">
              <li><span className="text-slate-200 font-medium">Paired CSV</span> — <code className="text-blue-300">63963_info.csv</code> + <code className="text-blue-300">63963.csv</code> are automatically paired into one match</li>
              <li><span className="text-slate-200 font-medium">Combined Cricsheet CSV</span> — info and ball rows in a single file</li>
              <li><span className="text-slate-200 font-medium">Cricsheet JSON</span> — <code className="text-blue-300">.json</code> match files</li>
              <li><span className="text-slate-200 font-medium">Summary CSV</span> — match summary rows are upserted into the matches table</li>
            </ul>
          </div>
        </>
      )}
      </div>
    </div>
  );
}

async function readCSVHeadersSafe(file: File): Promise<string[]> {
  const slice = file.slice(0, Math.min(65536, file.size));
  const text = await slice.text();
  const cleaned = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const firstLine = cleaned.split(/\r?\n/)[0] ?? "";
  if (firstLine.length === 0) return [];
  const delimiter = (function detectDelimiter(line: string) {
    const candidates = [",", "\t", ";", "|"];
    return candidates.map((d) => ({ d, count: line.split(d).length })).sort((a, b) => b.count - a.count)[0].d;
  })(firstLine);
  return (function parseCSVLine(line: string, delimiter: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (char === delimiter && !inQuotes) {
        result.push(current.trim()); current = "";
      } else { current += char; }
    }
    result.push(current.trim());
    return result;
  })(firstLine, delimiter);
}

import { useState, useRef, useCallback, useEffect } from "react";
import { Upload, CheckCircle, AlertCircle, Loader2, ArrowLeft, Database, FilePlus2, FolderOpen } from "lucide-react";
import { parseCSVStream, readCSVHeaders, detectFormatFromHeaders, normalizeHeader } from "@/lib/csv";
import { importMatchesBatch, importBallsBatch } from "@/lib/csvImport";
import { parseCricsheetJson, type ParsedCricsheetMatch } from "@/lib/cricsheetJson";
import { parseCricsheetCsv } from "@/lib/cricsheetCsv";
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

interface ImportCounts {
  matches: number;
  innings: number;
  balls: number;
}

const MAX_FILES_PER_SELECTION = 25000;
const isMobile = typeof window !== "undefined" && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

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

  const streamImport = useCallback(async (f: File, matchId?: string): Promise<ImportCounts> => {
    let totalRows = Math.max(1, Math.floor(f.size / 80));
    let processed = 0;
    let committedRows = 0;
    let matchesCount = 0;
    let inningsCount = 0;
    let ballsCount = 0;
    let determinedTotal = false;

    setUploadProgress({ total: totalRows, current: 0, phase: `Streaming ${f.name} from disk...`, committedRows: 0 });

    try {
      for await (const batch of parseCSVStream(f)) {
        if (batch.rows.length === 0 && batch.headers.length === 0) continue;

        if (!determinedTotal && batch.rows.length > 0) {
          const approxRowsPerByte = batch.rows.length / Math.min(f.size, 1024 * 1024);
          totalRows = Math.max(batch.rows.length, Math.floor(f.size * approxRowsPerByte));
          determinedTotal = true;
        }

        const res = await importBallsBatch(batch.rows, (c) => {
          setUploadProgress({
            total: totalRows,
            current: processed + batch.rows.length,
            phase: `Saving ball-by-ball rows from ${f.name}...`,
            committedRows: committedRows + c,
          });
        }, matchId);
        processed += batch.rows.length;
        matchesCount += res.matches;
        inningsCount += res.innings;
        ballsCount += res.balls;
        committedRows += res.committed;

        setUploadProgress({
          total: totalRows,
          current: processed,
          phase: `Saving ball-by-ball rows from ${f.name}...`,
          committedRows,
        });
      }

      setUploadProgress({ total: totalRows, current: processed, phase: `Saved ${f.name} to the database`, committedRows });
      return { matches: matchesCount, innings: inningsCount, balls: ballsCount };
    } finally {
      setUploadProgress(null);
    }
  }, []);

  const importCricsheetMatch = useCallback(async (fileName: string, parsed: ParsedCricsheetMatch, matchId: string): Promise<ImportCounts> => {
    if (parsed.deliveries.length === 0) return { matches: 0, innings: 0, balls: 0 };
    setUploadProgress({ total: parsed.deliveries.length, current: 0, phase: `Saving match details from ${fileName}...`, committedRows: 0 });
    const matches = await importMatchesBatch([parsed.matchRow]);

    const res = await importBallsBatch(parsed.deliveries, (c) => {
      setUploadProgress({
        total: parsed.deliveries.length,
        current: c,
        phase: `Saving ball-by-ball rows from ${fileName}...`,
        committedRows: c,
      });
    }, matchId);

    return { matches, innings: res.innings, balls: res.balls };
  }, []);

  const importFiles = useCallback(async (selectedFiles: File[]) => {
    setUploadError(null);
    setUploadResult(null);
    setUploadImporting(true);

    const totals: ImportCounts = { matches: 0, innings: 0, balls: 0 };
    const failedFiles: string[] = [];
    const skippedFiles: string[] = [];

    try {
      let completedFiles = 0;
      const FILE_CONCURRENCY = 3;

      const processFile = async (selectedFile: File, fileNumber: number): Promise<void> => {
        setUploadProgress({
          total: selectedFiles.length,
          current: completedFiles,
          phase: `Processing file ${fileNumber} of ${selectedFiles.length}: ${selectedFile.name}`,
          committedRows: 0,
        });

        const matchId = selectedFile.name.replace(/\.json$/i, "").replace(/_info\.csv$/i, "").replace(/\.csv$/i, "");

        try {
          if (/\.json$/i.test(selectedFile.name)) {
            const parsed = parseCricsheetJson(await selectedFile.text(), matchId);
            const jsonCounts = await importCricsheetMatch(selectedFile.name, parsed, matchId);
            totals.matches += jsonCounts.matches;
            totals.innings += jsonCounts.innings;
            totals.balls += jsonCounts.balls;
            if (parsed.deliveries.length === 0) skippedFiles.push(selectedFile.name);
            return;
          }

          const headers = await readCSVHeaders(selectedFile);
          if (headers.length === 0) {
            throw new Error(`${selectedFile.name} is empty or does not contain a valid CSV header.`);
          }

          if (normalizeHeader(headers[0]) === "version") {
            const parsed = parseCricsheetCsv(await selectedFile.text(), matchId);
            const combinedCounts = await importCricsheetMatch(selectedFile.name, parsed, matchId);
            totals.matches += combinedCounts.matches;
            totals.innings += combinedCounts.innings;
            totals.balls += combinedCounts.balls;
            if (parsed.deliveries.length === 0) skippedFiles.push(selectedFile.name);
            return;
          }

          if (/_info\.csv$/i.test(selectedFile.name)) {
            skippedFiles.push(selectedFile.name);
            return;
          }

          const detectedFormat = detectFormatFromHeaders(headers);
          if (detectedFormat === "matches") {
            skippedFiles.push(selectedFile.name);
            return;
          }
          if (detectedFormat === "unknown" && !selectedFile.name.toLowerCase().endsWith(".csv")) {
            throw new Error(`${selectedFile.name}: could not detect CSV format.`);
          }

          const counts = await streamImport(selectedFile, matchId);
          totals.matches += counts.matches;
          totals.innings += counts.innings;
          totals.balls += counts.balls;
        } catch (fileErr) {
          console.error(`Import failed for ${selectedFile.name}`, fileErr);
          failedFiles.push(selectedFile.name);
        } finally {
          completedFiles += 1;
          setUploadProgress({
            total: selectedFiles.length,
            current: completedFiles,
            phase: `Processed ${completedFiles.toLocaleString()} of ${selectedFiles.length.toLocaleString()} files`,
            committedRows: totals.balls,
          });
        }
      };

      for (let i = 0; i < selectedFiles.length; i += FILE_CONCURRENCY) {
        const group = selectedFiles.slice(i, i + FILE_CONCURRENCY);
        await Promise.all(group.map((file, offset) => processFile(file, i + offset + 1)));
      }

      if (totals.matches === 0 && totals.balls === 0) {
        throw new Error("No ball-by-ball data was found in the selected files, so nothing was saved.");
      }
      const notices: string[] = [];
      if (failedFiles.length > 0) {
        const preview = failedFiles.slice(0, 5).join(", ");
        const more = failedFiles.length > 5 ? ` and ${failedFiles.length - 5} more` : "";
        notices.push(`${failedFiles.length} file(s) could not be imported: ${preview}${more}.`);
      }
      if (skippedFiles.length > 0) {
        notices.push(`${skippedFiles.length} file(s) were skipped because they have no ball-by-ball data.`);
      }
      if (notices.length > 0) setUploadError(`${notices.join(" ")} All other files were saved.`);
      setUploadResult(totals);
      setImportedFileCount((n) => n + selectedFiles.length);
    } catch (err) {
      console.error("CSV import failed", err);
      setUploadError(err instanceof Error && err.message ? err.message : "Could not import the selected CSV files.");
    } finally {
      setUploadImporting(false);
      setUploadProgress(null);
    }
  }, [streamImport, importCricsheetMatch]);

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
          Pick your CSV files and they are imported automatically — match summaries, ball-by-ball, or a mix.
        </p>

      {result ? (
        <div className="mt-8 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <CheckCircle className="text-emerald-400" size={28} />
              <div>
                <h2 className="text-lg font-semibold text-emerald-300">Import Complete</h2>
                <p className="mt-1 text-sm text-emerald-200/70">{importedFileCount} CSV file{importedFileCount !== 1 ? "s" : ""} imported</p>
              </div>
            </div>
            <span className="inline-flex w-fit items-center rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-300">
              Completed
            </span>
          </div>
          <p className="mt-4 text-sm text-slate-300">All rows from the selected CSV files have been saved to the database.</p>
          <div className="mt-4 grid grid-cols-3 gap-4">
            <div className="rounded-lg bg-slate-900/60 p-4 text-center">
              <p className="text-2xl font-bold">{result.matches}</p>
              <p className="text-sm text-slate-400">Matches</p>
            </div>
            <div className="rounded-lg bg-slate-900/60 p-4 text-center">
              <p className="text-2xl font-bold">{result.innings}</p>
              <p className="text-sm text-slate-400">Innings</p>
            </div>
            <div className="rounded-lg bg-slate-900/60 p-4 text-center">
              <p className="text-2xl font-bold">{result.balls.toLocaleString()}</p>
              <p className="text-sm text-slate-400">Balls</p>
            </div>
          </div>
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
                    {progress.current.toLocaleString()} / {progress.total.toLocaleString()} rows read
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
              <p className="mt-4 text-xs text-slate-500">
                Streaming in chunks — the committed count shows rows actually written to the database so far.
              </p>
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
        </>
      )}
      </div>
    </div>
  );
}

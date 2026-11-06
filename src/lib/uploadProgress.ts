import { createStore } from "./tinyStore";

export interface ImportProgress {
  total: number;
  current: number;
  phase: string;
  committedRows: number;
}

export interface ImportResult {
  matches: number;
  innings: number;
  balls: number;
}

interface UploadState {
  importing: boolean;
  progress: ImportProgress | null;
  result: ImportResult | null;
  error: string | null;
}

const store = createStore<UploadState>({
  importing: false,
  progress: null,
  result: null,
  error: null,
});

export function setUploadImporting(importing: boolean) {
  store.setState({ importing });
}

export function setUploadProgress(progress: ImportProgress | null) {
  store.setState({ progress });
}

export function setUploadResult(result: ImportResult | null) {
  store.setState({ result });
}

export function setUploadError(error: string | null) {
  store.setState({ error });
}

export function resetUpload() {
  store.setState({ importing: false, progress: null, result: null, error: null });
}

export function useUploadProgress(): UploadState {
  return store.useStore();
}

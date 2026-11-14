import { useRef, useState, type DragEvent } from "react";
import { flushSync } from "react-dom";
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../lib/api";
import { shortenFileName } from "../lib/activityFormat";
import { useActivityStore } from "../stores/activityStore";

export type ImportProgress = {
  completed: number;
  total: number;
  current?: string;
  currentIndex?: number;
  status: "processing" | "refreshing";
};

function isTauriRuntime(): boolean {
  return isTauri();
}

export function useImportQueue() {
  const refresh = useActivityStore((s) => s.refresh);

  const [isImporting, setIsImporting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [forceBrowserPicker, setForceBrowserPicker] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function waitForUiPaint() {
    // Two RAF ticks ensure at least one paint happens before heavy async work starts.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }

  function pushImportProgress(
    progress: ImportProgress,
    message?: string,
  ) {
    flushSync(() => {
      setImportProgress(progress);
      if (message) setImportMessage(message);
    });
  }

  function startImportProgress(total: number) {
    flushSync(() => {
      setIsImporting(true);
      setImportProgress({ completed: 0, total, current: "Preparing queue...", status: "processing" });
      setImportMessage(`Processing 0/${total}`);
    });
  }

  async function importFromPaths(paths: string[]) {
    if (!paths.length || isImporting || isSyncing) return;
    const validPaths = paths.filter((p) => {
      const lower = p.toLowerCase();
      return lower.endsWith(".fit") || lower.endsWith(".tcx") || lower.endsWith(".gpx");
    });
    if (!validPaths.length) {
      setImportMessage("No supported files selected (.fit, .tcx, .gpx).");
      return;
    }

    startImportProgress(validPaths.length);
    await waitForUiPaint();
    let imported = 0, duplicates = 0, skipped = 0, failed = 0;
    let refreshError: string | null = null;
    for (let i = 0; i < validPaths.length; i++) {
      const path = validPaths[i];
      const fileName = path.split(/[\\/]/).pop() ?? path;
      const fileNameDisplay = shortenFileName(fileName);
      pushImportProgress(
        { completed: i, total: validPaths.length, current: fileNameDisplay, currentIndex: i + 1, status: "processing" },
        `Processing ${i + 1}/${validPaths.length}: ${fileNameDisplay}`,
      );
      await waitForUiPaint();
      try {
        const result: any = await api.importActivityPath(path);
        if (result?.status === "duplicate") {
          duplicates++;
        } else if (result?.status === "skipped") {
          skipped++;
        } else {
          imported++;
          if (imported % 10 === 0) {
            pushImportProgress(
              {
                completed: i + 1,
                total: validPaths.length,
                current: `Refreshing after ${imported} successful imports...`,
                status: "refreshing",
              },
              `Imported ${imported} files. Refreshing list and stats...`,
            );
            await waitForUiPaint();
            try {
              await refresh();
            } catch (err) {
              if (!refreshError) refreshError = err instanceof Error ? err.message : "unknown";
            }
            pushImportProgress(
              { completed: i + 1, total: validPaths.length, current: fileNameDisplay, currentIndex: i + 1, status: "processing" },
            );
            await waitForUiPaint();
          }
        }
      } catch (err) {
        failed++;
        setImportMessage(`Failed on ${fileNameDisplay}: ${err instanceof Error ? err.message : "unknown"}`);
      }
      pushImportProgress(
        { completed: i + 1, total: validPaths.length, current: fileNameDisplay, currentIndex: i + 1, status: "processing" },
        `Processed ${i + 1}/${validPaths.length}: ${fileNameDisplay}`,
      );
      await waitForUiPaint();
    }

    try {
      pushImportProgress(
        { completed: validPaths.length, total: validPaths.length, current: "Refreshing activity list...", status: "refreshing" },
        "Import queue finished, refreshing activity list...",
      );
      await waitForUiPaint();
      await refresh();
    } catch (err) {
      if (!refreshError) refreshError = err instanceof Error ? err.message : "unknown";
    }
    setIsImporting(false);
    setImportProgress(null);
    if (refreshError) {
      setImportMessage(`Batch complete: imported ${imported}, duplicates ${duplicates}, skipped ${skipped}, failed ${failed}. Refresh failed: ${refreshError}`);
    } else {
      setImportMessage(`Batch complete: imported ${imported}, duplicates ${duplicates}, skipped ${skipped}, failed ${failed}.`);
    }
  }

  function parseDroppedFileUris(raw: string): string[] {
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        if (line.startsWith("file://")) {
          try {
            return decodeURIComponent(line.replace(/^file:\/\//, ""));
          } catch {
            return line.replace(/^file:\/\//, "");
          }
        }
        return line;
      });
  }

  async function handleImportDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    if (isImporting || isSyncing) return;

    const fileList = e.dataTransfer.files;
    if (fileList && fileList.length > 0) {
      setForceBrowserPicker(false);
      await importBatch(fileList);
      return;
    }

    if (!isTauriRuntime()) {
      setImportMessage("No supported files dropped (.fit, .tcx, .gpx).");
      return;
    }

    const uriList = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
    if (!uriList) {
      setImportMessage("No supported files dropped (.fit, .tcx, .gpx).");
      return;
    }
    const paths = parseDroppedFileUris(uriList);
    await importFromPaths(paths);
  }

  async function importBatch(fileList: FileList | null) {
    if (!fileList || fileList.length === 0 || isImporting) return;
    const files = Array.from(fileList).filter((f) => {
      const name = f.name.toLowerCase();
      return name.endsWith(".fit") || name.endsWith(".tcx") || name.endsWith(".gpx");
    });
    if (!files.length) { setImportMessage("No supported files selected (.fit, .tcx, .gpx)."); return; }
    startImportProgress(files.length);
    await waitForUiPaint();
    let imported = 0, duplicates = 0, skipped = 0, failed = 0;
    let refreshError: string | null = null;
    for (let i = 0; i < files.length; i++) {
      const fileNameDisplay = shortenFileName(files[i].name);
      pushImportProgress(
        { completed: i, total: files.length, current: fileNameDisplay, currentIndex: i + 1, status: "processing" },
        `Processing ${i + 1}/${files.length}: ${fileNameDisplay}`,
      );
      await waitForUiPaint();
      try {
        const result: any = await api.importFit(files[i]);
        if (result?.status === "duplicate") {
          duplicates++;
        } else if (result?.status === "skipped") {
          skipped++;
        } else {
          imported++;
          if (imported % 10 === 0) {
            pushImportProgress(
              {
                completed: i + 1,
                total: files.length,
                current: `Refreshing after ${imported} successful imports...`,
                status: "refreshing",
              },
              `Imported ${imported} files. Refreshing list and stats...`,
            );
            await waitForUiPaint();
            try {
              await refresh();
            } catch (err) {
              if (!refreshError) refreshError = err instanceof Error ? err.message : "unknown";
            }
            pushImportProgress(
              { completed: i + 1, total: files.length, current: fileNameDisplay, currentIndex: i + 1, status: "processing" },
            );
            await waitForUiPaint();
          }
        }
      } catch (err) {
        failed++;
        setImportMessage(`Failed on ${fileNameDisplay}: ${err instanceof Error ? err.message : "unknown"}`);
      }
      pushImportProgress(
        { completed: i + 1, total: files.length, current: fileNameDisplay, currentIndex: i + 1, status: "processing" },
        `Processed ${i + 1}/${files.length}: ${fileNameDisplay}`,
      );
      await waitForUiPaint();
    }
    try {
      pushImportProgress(
        { completed: files.length, total: files.length, current: "Refreshing activity list...", status: "refreshing" },
        "Import queue finished, refreshing activity list...",
      );
      await waitForUiPaint();
      await refresh();
    } catch (err) {
      if (!refreshError) refreshError = err instanceof Error ? err.message : "unknown";
    }
    setIsImporting(false);
    setImportProgress(null);
    if (refreshError) {
      setImportMessage(`Batch complete: imported ${imported}, duplicates ${duplicates}, skipped ${skipped}, failed ${failed}. Refresh failed: ${refreshError}`);
    } else {
      setImportMessage(`Batch complete: imported ${imported}, duplicates ${duplicates}, skipped ${skipped}, failed ${failed}.`);
    }
  }

  async function importFromDesktopDialog() {
    if (isImporting || isSyncing) return;
    setForceBrowserPicker(false);
    let picked: string | string[] | null = null;
    try {
      picked = await open({
        multiple: true,
        filters: [
          { name: "Activity logs", extensions: ["fit", "FIT", "tcx", "TCX", "gpx", "GPX"] },
          { name: "FIT", extensions: ["fit", "FIT"] },
          { name: "TCX", extensions: ["tcx", "TCX"] },
          { name: "GPX", extensions: ["gpx", "GPX"] },
        ],
      });
    } catch (err) {
      setForceBrowserPicker(true);
      setImportMessage(
        `Native file picker unavailable (${err instanceof Error ? err.message : "unknown"}). Falling back to browser picker.`
      );
      // Trigger browser picker immediately so users do not need a second click.
      fileInputRef.current?.click();
      return;
    }
    if (!picked) return;

    const paths = (Array.isArray(picked) ? picked : [picked]).map((p) => p.trim());
    await importFromPaths(paths);
  }

  function handleSelectFilesClick() {
    if (isImporting || isSyncing) return;
    if (isTauriRuntime() && !forceBrowserPicker) {
      void importFromDesktopDialog();
      return;
    }
    fileInputRef.current?.click();
  }

  async function syncFromStorage() {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const paths = await api.listSyncFiles();
      const total = paths.length;
      if (total === 0) {
        setImportMessage("Sync complete: no supported files found.");
        return;
      }

      let imported = 0;
      let duplicates = 0;
      let blacklisted = 0;
      let skipped = 0;
      let failed = 0;

      pushImportProgress(
        { completed: 0, total, current: "Preparing sync queue...", status: "processing" },
        `Sync: 0/${total}`
      );
      await waitForUiPaint();

      for (let i = 0; i < paths.length; i++) {
        const path = paths[i];
        const fileName = path.split(/[\\/]/).pop() ?? path;
        const fileNameDisplay = shortenFileName(fileName);
        pushImportProgress(
          { completed: i, total, current: fileNameDisplay, currentIndex: i + 1, status: "processing" },
          `Sync: ${i + 1}/${total} - ${fileNameDisplay}`
        );
        await waitForUiPaint();

        try {
          const result = await api.processSyncFile(path);
          if (result.status === "imported") {
            imported++;
            if (imported % 10 === 0) {
              pushImportProgress(
                { completed: i + 1, total, current: `Refreshing after ${imported} successful syncs...`, status: "refreshing" },
                `Sync: Imported ${imported} files. Refreshing list and stats...`
              );
              await waitForUiPaint();
              try {
                await refresh();
              } catch (err) {
                tracingError("sync intermediate refresh failed", err);
              }
              pushImportProgress(
                { completed: i + 1, total, current: fileNameDisplay, currentIndex: i + 1, status: "processing" },
                `Sync: ${i + 1}/${total} - ${fileNameDisplay}`
              );
              await waitForUiPaint();
            }
          }
          else if (result.status === "duplicate") duplicates++;
          else if (result.status === "blacklisted") blacklisted++;
          else if (result.status === "skipped") skipped++;
        } catch (err) {
          failed++;
          tracingError("sync file processing failed", err);
        }

        pushImportProgress(
          { completed: i + 1, total, current: fileNameDisplay, currentIndex: i + 1, status: "processing" },
          `Sync: ${i + 1}/${total} - ${fileNameDisplay}`
        );
        await waitForUiPaint();
      }

      try {
        pushImportProgress(
          {
            completed: total,
            total,
            current: "Refreshing activity list...",
            status: "refreshing",
          },
          "Sync finished, refreshing activity list..."
        );
        await refresh();
      } catch (err) {
        setImportMessage(`Sync finished, but refresh failed: ${err instanceof Error ? err.message : "unknown"}`);
        return;
      }
      setImportMessage(
        `Sync complete: scanned ${total}, imported ${imported}, duplicates ${duplicates}, blacklisted ${blacklisted}, skipped ${skipped}, failed ${failed}.`
      );
    } catch (err) {
      setImportMessage(`Sync failed: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setImportProgress(null);
      setIsSyncing(false);
    }
  }

  function tracingError(message: string, err: unknown) {
    console.warn(message, err);
  }

  const importDisplayIndex = importProgress
    ? (importProgress.status === "processing"
        ? (importProgress.currentIndex ?? importProgress.completed)
        : importProgress.completed)
    : 0;

  return {
    isImporting,
    isSyncing,
    importProgress,
    importMessage,
    setImportMessage,
    isDragActive,
    setIsDragActive,
    forceBrowserPicker,
    setForceBrowserPicker,
    fileInputRef,
    importDisplayIndex,
    handleImportDrop,
    handleSelectFilesClick,
    importBatch,
    syncFromStorage,
  };
}

export type ImportQueue = ReturnType<typeof useImportQueue>;

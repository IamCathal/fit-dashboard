import type { BulkExportProgress } from "../lib/exportUtils";
import { useTranslation } from "../lib/i18n";
import { IconDownload, IconTrash } from "./icons";

type Props = {
  isExporting: boolean;
  isBulkDeleting: boolean;
  exportProgress: BulkExportProgress | null;
  bulkDeleteProgress: { done: number; total: number } | null;
};

export function BulkProgressOverlay({
  isExporting,
  isBulkDeleting,
  exportProgress,
  bulkDeleteProgress,
}: Props) {
  const { t } = useTranslation();

  if (!isExporting && !isBulkDeleting) return null;

  return (
    <div className="bulk-progress-overlay">
      <div className="bulk-progress-modal">
        <div className="bulk-progress-title">
          {isExporting ? (
            <><IconDownload /> {t("bulk.exportingActivities")}</>
          ) : (
            <><IconTrash /> {t("bulk.deletingActivities")}</>
          )}
        </div>
        {isExporting && exportProgress && (
          <>
            <div className="bulk-progress-file">{exportProgress.currentFile || t("bulk.finishing")}</div>
            <div className="bulk-progress-track">
              <div className="bulk-progress-fill" style={{ width: `${(exportProgress.done / (exportProgress.total || 1)) * 100}%` }} />
            </div>
            <div className="bulk-progress-stats">
              <span>{exportProgress.done} of {exportProgress.total}</span>
              <span>{Math.round((exportProgress.done / (exportProgress.total || 1)) * 100)}%</span>
            </div>
          </>
        )}
        {isBulkDeleting && bulkDeleteProgress && (
          <>
            <div className="bulk-progress-file">{t("bulk.removingData")}</div>
            <div className="bulk-progress-track">
              <div className="bulk-progress-fill danger" style={{ width: `${(bulkDeleteProgress.done / (bulkDeleteProgress.total || 1)) * 100}%` }} />
            </div>
            <div className="bulk-progress-stats">
              <span>{bulkDeleteProgress.done} of {bulkDeleteProgress.total}</span>
              <span>{Math.round((bulkDeleteProgress.done / (bulkDeleteProgress.total || 1)) * 100)}%</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

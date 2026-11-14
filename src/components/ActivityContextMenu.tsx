import type { Activity } from "../types";
import type { ExportFormat } from "../lib/exportUtils";
import { useTranslation } from "../lib/i18n";
import {
  IconEdit,
  IconDistance,
  IconTrash,
  IconDownload,
  IconChevron,
  IconFile,
} from "./icons";

type Props = {
  contextMenu: { x: number; y: number; activityId: number; activityName: string };
  contextActivity: Activity | null;
  contextExportOpen: boolean;
  setContextExportOpen: (open: boolean) => void;
  onRenameClick: () => void;
  onDeleteClick: () => void;
  onToggleOverviewVisibility: (activity: Activity) => void;
  onExport: (activityId: number, format: ExportFormat) => void;
};

export function ActivityContextMenu({
  contextMenu,
  contextActivity,
  contextExportOpen,
  setContextExportOpen,
  onRenameClick,
  onDeleteClick,
  onToggleOverviewVisibility,
  onExport,
}: Props) {
  const { t } = useTranslation();

  return (
    <div className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
      <button onClick={onRenameClick}><IconEdit /> {t("contextMenu.rename")}</button>
      {contextActivity && (
        <button onClick={() => onToggleOverviewVisibility(contextActivity)}>
          <IconDistance />
          {contextActivity.show_in_overview === false
            ? t("contextMenu.showInOverview")
            : t("contextMenu.hideFromOverview")}
        </button>
      )}
      <button className="ctx-danger" onClick={onDeleteClick}><IconTrash /> {t("contextMenu.delete")}</button>
      <div className="ctx-divider" />
      <div className="ctx-export-parent" onMouseEnter={() => setContextExportOpen(true)} onMouseLeave={() => setContextExportOpen(false)}>
        <button className="ctx-with-submenu"><IconDownload /> {t("contextMenu.export")} <IconChevron /></button>
        {contextExportOpen && (
          <div className="ctx-submenu">
            <button onClick={() => onExport(contextMenu.activityId, "csv")}><IconFile /> CSV</button>
            <button onClick={() => onExport(contextMenu.activityId, "json")}><IconFile /> JSON</button>
            <button onClick={() => onExport(contextMenu.activityId, "gpx")}><IconFile /> GPX</button>
            <button onClick={() => onExport(contextMenu.activityId, "kml")}><IconFile /> KML</button>
          </div>
        )}
      </div>
    </div>
  );
}

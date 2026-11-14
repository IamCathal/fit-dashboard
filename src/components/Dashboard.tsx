import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import { useActivityStore } from "../stores/activityStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useTranslation } from "../lib/i18n";
import { api } from "../lib/api";
import {
  exportSingleActivity,
  exportBulkActivities,
  type ExportFormat,
  type BulkExportProgress,
} from "../lib/exportUtils";
import { distanceDivisor, distanceLabel } from "../lib/units";
import { parseUtcDate } from "../lib/activityFormat";
import type { Activity, RecordPoint } from "../types";
import { AppHeader, type DashboardTab } from "./AppHeader";
import { Sidebar } from "./Sidebar";
import { OverviewView, type OverviewTimeframe } from "./OverviewView";
import { DetailView } from "./DetailView";
import { CompareCharts } from "./CompareCharts";
import { DonationBanner } from "./DonationBanner";
import { SettingsPanel } from "./SettingsPanel";
import { ActivityContextMenu } from "./ActivityContextMenu";
import { BulkProgressOverlay } from "./BulkProgressOverlay";
import { IconBarChart } from "./icons";
import { useActivityFilters } from "../hooks/useActivityFilters";
import { useImportQueue } from "../hooks/useImportQueue";

type Props = { onLogout: () => Promise<void> };

const OVERVIEW_TIMEFRAME_MONTHS: Record<Exclude<OverviewTimeframe, "all">, number> = {
  "1m": 1,
  "2m": 2,
  "3m": 3,
  "6m": 6,
  "1y": 12,
};

export function Dashboard({ onLogout }: Props) {
  const [tab, setTab] = useState<DashboardTab>("overview");
  const [overviewTimeframe, setOverviewTimeframe] = useState<OverviewTimeframe>("all");
  const [selectedWeekStart, setSelectedWeekStart] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Export state
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<BulkExportProgress | null>(null);
  const [contextExportOpen, setContextExportOpen] = useState(false);
  const [bulkExportDropdownOpen, setBulkExportDropdownOpen] = useState(false);

  // Bulk delete state
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [bulkDeleteProgress, setBulkDeleteProgress] = useState<{ done: number; total: number } | null>(null);

  // Context menu / inline rename-delete state
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; activityId: number; activityName: string;
  } | null>(null);
  const [renameTarget, setRenameTarget] = useState<{ id: number; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);

  const {
    activities, selectedActivity, records,
    selectActivity, refresh, setActivityOverviewVisibility,
  } = useActivityStore();
  const {
    distanceUnit, timeFormat, supporterBadge,
    toggleSettings, setTheme, mapStyle, setMapStyle,
    loadSupporterStatus, theme, hrZoneBounds,
  } = useSettingsStore();
  const { t } = useTranslation();

  const filters = useActivityFilters(activities);
  const importQueue = useImportQueue();
  const { filtered } = filters;

  useEffect(() => {
    void loadSupporterStatus();
  }, []);

  useEffect(() => {
    const close = () => { setContextMenu(null); setBulkExportDropdownOpen(false); };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  // A week selection only makes sense within the current timeframe.
  useEffect(() => {
    setSelectedWeekStart(null);
  }, [overviewTimeframe]);

  useEffect(() => {
    const allowed = new Set(filtered.map((a) => a.id));
    setCompareIds((prev) => {
      const next = prev.filter((id) => allowed.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [filtered]);

  // Overview panels only show runs within the selected timeframe. The sidebar
  // list and bulk actions keep using the full `filtered` set.
  const overviewFiltered = useMemo(() => {
    if (overviewTimeframe === "all") return filtered;
    const months = OVERVIEW_TIMEFRAME_MONTHS[overviewTimeframe];
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const cutoffTs = cutoff.getTime();
    return filtered.filter((a) => {
      const ts = parseUtcDate(a.start_ts_utc).getTime();
      return Number.isFinite(ts) && ts >= cutoffTs;
    });
  }, [filtered, overviewTimeframe]);

  // Activities explicitly hidden from the overview map are excluded from the
  // map's default auto-zoom only. They are still rendered as routes/points so
  // navigating to their location reveals them.
  const overviewMapActivities = useMemo(
    () => overviewFiltered.filter((a) => a.show_in_overview !== false),
    [overviewFiltered],
  );

  const overviewRecords = useMemo(() => {
    if (tab !== "overview") return [];
    return overviewFiltered
      .filter((a) => typeof a.start_latitude === "number" && typeof a.start_longitude === "number")
      .map((a) => {
        const ts = parseUtcDate(a.start_ts_utc).getTime();
        return {
          timestamp_ms: Number.isFinite(ts) ? ts : 0,
          latitude: a.start_latitude,
          longitude: a.start_longitude,
        } as RecordPoint;
      });
  }, [tab, overviewFiltered]);

  const selectedWeekActivities = useMemo(() => {
    if (!selectedWeekStart) return [] as Activity[];
    const start = new Date(`${selectedWeekStart}T00:00:00`).getTime();
    if (!Number.isFinite(start)) return [] as Activity[];
    const end = start + 7 * 86400000;
    return overviewFiltered.filter((a) => {
      const ts = parseUtcDate(a.start_ts_utc).getTime();
      return Number.isFinite(ts) && ts >= start && ts < end;
    });
  }, [overviewFiltered, selectedWeekStart]);

  // When a week is selected, the shared map should render only that week's
  // runs (routes, density points, coverage and auto-zoom all follow suit).
  const overviewMapScope = selectedWeekStart ? selectedWeekActivities : overviewFiltered;
  const overviewMapFitScope = useMemo(
    () =>
      (selectedWeekStart ? selectedWeekActivities : overviewMapActivities).filter(
        (a) => a.show_in_overview !== false,
      ),
    [selectedWeekStart, selectedWeekActivities, overviewMapActivities],
  );
  const overviewMapRecords = useMemo(() => {
    if (!selectedWeekStart) return overviewRecords;
    const start = new Date(`${selectedWeekStart}T00:00:00`).getTime();
    if (!Number.isFinite(start)) return overviewRecords;
    const end = start + 7 * 86400000;
    return overviewRecords.filter(
      (record) =>
        Number.isFinite(record.timestamp_ms) &&
        record.timestamp_ms >= start &&
        record.timestamp_ms < end,
    );
  }, [overviewRecords, selectedWeekStart]);

  const distanceDivisorValue = distanceDivisor(distanceUnit);
  const distanceSuffix = distanceLabel(distanceUnit);
  const filteredTotalDistanceM = overviewFiltered.reduce((sum, a) => sum + a.distance_m, 0);
  const filteredTotalDurationS = overviewFiltered.reduce((sum, a) => sum + a.duration_s, 0);
  const totalDistance = filteredTotalDistanceM / distanceDivisorValue;
  const totalDuration = filteredTotalDurationS;
  const avgDistance = overviewFiltered.length ? totalDistance / overviewFiltered.length : 0;

  async function toggleOverviewVisibility(activity: Activity, visible: boolean) {
    try {
      await api.setActivityOverviewVisibility(activity.id, visible);
      setActivityOverviewVisibility(activity.id, visible);
    } catch (err) {
      importQueue.setImportMessage(
        `Failed to update overview visibility: ${err instanceof Error ? err.message : "unknown"}`
      );
    }
  }

  function onItemContextMenu(e: MouseEvent, activity: Activity) {
    e.preventDefault();
    setContextExportOpen(false);
    setContextMenu({
      x: e.clientX, y: e.clientY,
      activityId: activity.id,
      activityName: activity.activity_name || activity.file_name,
    });
  }

  function onRenameClick() {
    if (!contextMenu) return;
    setRenameTarget({ id: contextMenu.activityId, name: contextMenu.activityName });
    setDeleteTarget(null);
    setContextMenu(null);
  }

  function onDeleteClick() {
    if (!contextMenu) return;
    setDeleteTarget(contextMenu.activityId);
    setRenameTarget(null);
    setContextMenu(null);
  }

  async function handleSingleExport(activityId: number, format: ExportFormat) {
    setContextMenu(null);
    setContextExportOpen(false);
    const activity = activities.find((a) => a.id === activityId);
    if (!activity) return;
    try {
      await exportSingleActivity(activity, format);
    } catch (err) {
      console.error("Export failed:", err);
    }
  }

  async function handleBulkExport(format: ExportFormat) {
    if (filtered.length === 0 || isExporting) return;
    setIsExporting(true);
    try {
      const result = await exportBulkActivities(filtered, format, setExportProgress);
      if (result === "cancelled") {
        // User cancelled the folder picker — no-op
        return;
      }
    } catch (err) {
      console.error("Bulk export failed:", err);
    } finally {
      setIsExporting(false);
      setTimeout(() => setExportProgress(null), 2000);
    }
  }

  async function handleBulkDelete() {
    if (filtered.length === 0 || isBulkDeleting) return;
    setIsBulkDeleting(true);
    setConfirmBulkDelete(false);
    const total = filtered.length;
    let failed = 0;
    const failedReasons: string[] = [];
    try {
      for (let i = 0; i < filtered.length; i++) {
        flushSync(() => { setBulkDeleteProgress({ done: i, total }); });
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        try {
          await api.deleteActivity(filtered[i].id);
        } catch (err) {
          failed++;
          failedReasons.push(err instanceof Error ? err.message : "unknown");
          console.error(`Failed to delete activity ${filtered[i].id}:`, err);
        }
      }
      flushSync(() => { setBulkDeleteProgress({ done: total, total }); });
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (selectedActivity && filtered.some((a) => a.id === selectedActivity.id)) {
        await selectActivity(null);
      }
      await refresh();
      importQueue.setImportMessage(
        failed > 0
          ? `Bulk delete finished with ${failed} failure(s): ${failedReasons.slice(0, 2).join(" | ")}`
          : "Bulk delete completed."
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      importQueue.setImportMessage(`Bulk delete completed, but refresh failed: ${detail || "unknown"}`);
    } finally {
      setIsBulkDeleting(false);
      setBulkDeleteProgress(null);
    }
  }

  const contextActivity = contextMenu
    ? activities.find((a) => a.id === contextMenu.activityId) ?? null
    : null;

  return (
    <div className="app-shell">
      <AppHeader
        tab={tab}
        setTab={setTab}
        theme={theme}
        setTheme={setTheme}
        toggleSettings={toggleSettings}
        onLogout={onLogout}
        supporterBadge={supporterBadge}
        onToggleSidebar={() => setIsSidebarCollapsed((v) => !v)}
      />

      <SettingsPanel />

      <div className={`app-body ${isSidebarCollapsed ? "sidebar-collapsed" : ""}`}>
        <Sidebar
          tab={tab}
          setTab={setTab}
          compareIds={compareIds}
          setCompareIds={setCompareIds}
          onItemContextMenu={onItemContextMenu}
          importQueue={importQueue}
          filters={filters}
          isSidebarCollapsed={isSidebarCollapsed}
          setIsSidebarCollapsed={setIsSidebarCollapsed}
          isExporting={isExporting}
          bulkExportDropdownOpen={bulkExportDropdownOpen}
          setBulkExportDropdownOpen={setBulkExportDropdownOpen}
          onBulkExport={(format) => void handleBulkExport(format)}
          confirmBulkDelete={confirmBulkDelete}
          setConfirmBulkDelete={setConfirmBulkDelete}
          isBulkDeleting={isBulkDeleting}
          onBulkDelete={() => void handleBulkDelete()}
          renameTarget={renameTarget}
          setRenameTarget={setRenameTarget}
          deleteTarget={deleteTarget}
          setDeleteTarget={setDeleteTarget}
        />

        <main className="main-content">
          <DonationBanner
            supporterBadge={supporterBadge}
            dismissed={bannerDismissed}
            onDismiss={() => setBannerDismissed(true)}
          />

          {tab === "overview" ? (
            <OverviewView
              activities={activities}
              overviewFiltered={overviewFiltered}
              overviewTimeframe={overviewTimeframe}
              setOverviewTimeframe={setOverviewTimeframe}
              overviewMapRecords={overviewMapRecords}
              overviewMapScope={overviewMapScope}
              overviewMapFitScope={overviewMapFitScope}
              mapStyle={mapStyle}
              setMapStyle={setMapStyle}
              onSelectActivity={(activity) => {
                void selectActivity(activity);
                setTab("individual");
              }}
              totalDistance={totalDistance}
              totalDuration={totalDuration}
              avgDistance={avgDistance}
              distanceSuffix={distanceSuffix}
              distanceUnit={distanceUnit}
              theme={theme}
              selectedWeekStart={selectedWeekStart}
              setSelectedWeekStart={setSelectedWeekStart}
              selectedWeekActivities={selectedWeekActivities}
              timeFormat={timeFormat}
            />
          ) : tab === "compare" ? (
            <CompareCharts compareIds={compareIds} activities={activities} theme={theme} distanceUnit={distanceUnit} />
          ) : selectedActivity ? (
            <DetailView
              activity={selectedActivity}
              records={records}
              theme={theme}
              distanceUnit={distanceUnit}
              timeFormat={timeFormat}
              hrZoneBounds={hrZoneBounds}
              mapStyle={mapStyle}
              setMapStyle={setMapStyle}
              onToggleOverviewVisibility={(activity, visible) => void toggleOverviewVisibility(activity, visible)}
            />
          ) : (
            <div className="empty-state">
              <span className="empty-icon"><IconBarChart size={40} /></span>
              <span>{t("detail.selectActivity")}</span>
            </div>
          )}
        </main>
      </div>

      {contextMenu && (
        <ActivityContextMenu
          contextMenu={contextMenu}
          contextActivity={contextActivity}
          contextExportOpen={contextExportOpen}
          setContextExportOpen={setContextExportOpen}
          onRenameClick={onRenameClick}
          onDeleteClick={onDeleteClick}
          onToggleOverviewVisibility={(activity) => {
            void toggleOverviewVisibility(activity, activity.show_in_overview === false);
            setContextMenu(null);
          }}
          onExport={(id, format) => void handleSingleExport(id, format)}
        />
      )}

      <BulkProgressOverlay
        isExporting={isExporting}
        isBulkDeleting={isBulkDeleting}
        exportProgress={exportProgress}
        bulkDeleteProgress={bulkDeleteProgress}
      />
    </div>
  );
}

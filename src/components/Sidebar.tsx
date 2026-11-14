import { useRef, useState, type MouseEvent } from "react";
import type { Activity } from "../types";
import type { ExportFormat } from "../lib/exportUtils";
import { useActivityStore } from "../stores/activityStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useTranslation } from "../lib/i18n";
import { api } from "../lib/api";
import { formatDateShort, formatDuration, formatTimeShort } from "../lib/activityFormat";
import { distanceDivisor, distanceLabel } from "../lib/units";
import { DatePickerPopover } from "./DatePickerPopover";
import type { DashboardTab } from "./AppHeader";
import type { ActivityFilters } from "../hooks/useActivityFilters";
import type { ImportQueue } from "../hooks/useImportQueue";
import {
  IconChevron,
  IconCollapse,
  IconExpand,
  IconRefresh,
  IconX,
  IconDownload,
  IconTrash,
  IconCheck,
  IconSort,
  IconSortDirection,
  IconClipboard,
} from "./icons";

type Props = {
  tab: DashboardTab;
  setTab: (tab: DashboardTab) => void;
  compareIds: number[];
  setCompareIds: (ids: number[]) => void;
  onItemContextMenu: (e: MouseEvent, activity: Activity) => void;
  importQueue: ImportQueue;
  filters: ActivityFilters;
  isSidebarCollapsed: boolean;
  setIsSidebarCollapsed: (v: boolean) => void;
  isExporting: boolean;
  bulkExportDropdownOpen: boolean;
  setBulkExportDropdownOpen: (v: boolean) => void;
  onBulkExport: (format: ExportFormat) => void;
  confirmBulkDelete: boolean;
  setConfirmBulkDelete: (v: boolean) => void;
  isBulkDeleting: boolean;
  onBulkDelete: () => void;
  renameTarget: { id: number; name: string } | null;
  setRenameTarget: (v: { id: number; name: string } | null) => void;
  deleteTarget: number | null;
  setDeleteTarget: (v: number | null) => void;
};

export function Sidebar({
  tab,
  setTab,
  compareIds,
  setCompareIds,
  onItemContextMenu,
  importQueue,
  filters,
  isSidebarCollapsed,
  setIsSidebarCollapsed,
  isExporting,
  bulkExportDropdownOpen,
  setBulkExportDropdownOpen,
  onBulkExport,
  confirmBulkDelete,
  setConfirmBulkDelete,
  isBulkDeleting,
  onBulkDelete,
  renameTarget,
  setRenameTarget,
  deleteTarget,
  setDeleteTarget,
}: Props) {
  const { activities, selectedActivity, selectActivity, refresh } = useActivityStore();
  const distanceUnit = useSettingsStore((s) => s.distanceUnit);
  const timeFormat = useSettingsStore((s) => s.timeFormat);
  const { t } = useTranslation();

  const {
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
  } = importQueue;

  const {
    filterSport,
    setFilterSport,
    searchQuery,
    setSearchQuery,
    minDurationMinutes,
    setMinDurationMinutes,
    maxDurationMinutes,
    setMaxDurationMinutes,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    sortBy,
    setSortBy,
    sortDirection,
    setSortDirection,
    filtered,
    sortedForList,
    sports,
    hasFilters,
    clearFilters,
  } = filters;

  const [isImportOpen, setIsImportOpen] = useState(true);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isSortOpen, setIsSortOpen] = useState(false);
  const [datePickerFromOpen, setDatePickerFromOpen] = useState(false);
  const [datePickerToOpen, setDatePickerToOpen] = useState(false);
  const dateFromBtnRef = useRef<HTMLButtonElement>(null);
  const dateToBtnRef = useRef<HTMLButtonElement>(null);

  const distanceDivisorValue = distanceDivisor(distanceUnit);
  const distanceSuffix = distanceLabel(distanceUnit);

  async function confirmRename() {
    if (!renameTarget || !renameTarget.name.trim()) { setRenameTarget(null); return; }
    await api.renameActivity(renameTarget.id, renameTarget.name.trim());
    await refresh();
    setRenameTarget(null);
  }

  async function confirmDelete() {
    if (deleteTarget === null) return;
    try {
      await api.deleteActivity(deleteTarget);
      if (selectedActivity?.id === deleteTarget) await selectActivity(null);
      await refresh();
    } catch (err) {
      setImportMessage(`Delete failed: ${err instanceof Error ? err.message : "unknown"}`);
      return;
    }
    setDeleteTarget(null);
    setImportMessage("Activity deleted.");
  }

  return (
    <>
      <div className={`sidebar-mobile-backdrop ${isSidebarCollapsed ? "hidden" : ""}`} onClick={() => setIsSidebarCollapsed(true)} />

      <aside className={`sidebar ${isSidebarCollapsed ? "collapsed" : ""}`}>
        {/* Collapsed strip (desktop only) */}
        <div className="sidebar-collapsed-strip">
          <button className="sidebar-expand-btn" onClick={() => setIsSidebarCollapsed(false)} aria-label={t("sidebar.expandSidebar")} title={t("sidebar.expandSidebar")}>
            <IconExpand />
          </button>
          <span className="sidebar-collapsed-count">{t("sidebar.logsCount", { count: filtered.length })}</span>
        </div>

        {/* Full sidebar content */}
        <div className="sidebar-inner">
          <div className="sidebar-head">
            <h3>{t("sidebar.activityCenter")}</h3>
            <button className="sidebar-collapse-btn" onClick={() => setIsSidebarCollapsed(true)} aria-label={t("sidebar.collapseSidebar")}>
              <IconCollapse />
            </button>
          </div>

          {/* Import */}
          <section className="sidebar-section">
            <button className={`section-header ${isImportOpen ? "open" : ""} ${isImporting ? "active" : ""}`} onClick={() => {
              setIsImportOpen((v) => {
                const next = !v;
                if (next) setIsFilterOpen(false);
                return next;
              });
            }}>
              <span className="section-title">{isImporting ? t("sidebar.importingProgress", { current: importDisplayIndex, total: importProgress?.total ?? 0 }) : t("sidebar.importFiles")}</span>
              <span className="section-header-right"><span className="chevron"><IconChevron /></span></span>
            </button>
            {isImportOpen && (
              <div className="section-body">
                <div
                  className={`import-zone import-dropzone ${isDragActive ? "drag-active" : ""}`}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!isImporting && !isSyncing) setIsDragActive(true);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!isImporting && !isSyncing) setIsDragActive(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const next = e.relatedTarget as Node | null;
                    if (!next || !e.currentTarget.contains(next)) {
                      setIsDragActive(false);
                    }
                  }}
                  onDrop={(e) => { void handleImportDrop(e); }}
                >
                  <input ref={fileInputRef} type="file" accept=".fit,.FIT,.tcx,.TCX,.gpx,.GPX" multiple hidden onChange={(e) => { setForceBrowserPicker(false); void importBatch(e.target.files); e.currentTarget.value = ""; }} />
                  <div className="import-drop-label">{t("sidebar.dragDrop")}</div>
                  <div className="import-actions">
                    <button
                      className="import-btn"
                      onClick={handleSelectFilesClick}
                      disabled={isImporting || isSyncing}
                    >
                      {isImporting ? t("sidebar.importing") : t("sidebar.selectFiles")}
                    </button>
                    <button
                      className="btn-secondary import-sync-btn"
                      onClick={() => void syncFromStorage()}
                      disabled={isImporting || isSyncing}
                      aria-label={isSyncing ? t("sidebar.syncInProgress") : t("sidebar.sync")}
                      title={isSyncing ? t("sidebar.syncInProgress") : t("sidebar.sync")}
                    >
                      {isSyncing ? <span className="btn-spinner" aria-hidden="true" /> : <><IconRefresh /> {t("sidebar.sync")}</>}
                    </button>
                  </div>
                  {isImporting && importProgress && (
                    <div className="import-hint" role="status" aria-live="polite">
                      {t("sidebar.importQueue", { current: importDisplayIndex, total: importProgress.total })}
                      {importProgress.current ? ` - ${importProgress.current}` : ""}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* Filters */}
          <section className="sidebar-section">
            <button className={`section-header ${isFilterOpen ? "open" : ""} ${hasFilters ? "active" : ""}`} onClick={() => {
              setIsFilterOpen((v) => {
                const next = !v;
                if (next) setIsImportOpen(false);
                return next;
              });
            }}>
              <span className="section-title-with-action">
                <span className="section-title">{hasFilters ? t("sidebar.filterActive") : t("sidebar.filters")}</span>
                {hasFilters && (
                  <button
                    type="button"
                    className="section-header-reset"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      clearFilters();
                    }}
                    aria-label={t("sidebar.resetFilters")}
                    title={t("sidebar.resetFilters")}
                  >
                    <IconX />
                  </button>
                )}
              </span>
              <span className="section-header-right"><span className="chevron"><IconChevron /></span></span>
            </button>
            {isFilterOpen && (
              <div className="section-body">
                <div className="filter-fields">
                  <label>{t("sidebar.sport")}<select value={filterSport} onChange={(e) => setFilterSport(e.target.value)}>
                    <option value="all">{t("sidebar.allSports")}</option>
                    {sports.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select></label>
                  <label>
                    {t("sidebar.dateRange")}
                    <div className="filter-date-wrapper" style={{ display: "flex", gap: "8px" }}>
                      <div style={{ flex: 1, position: "relative" }}>
                        <button
                          className="btn-outline-secondary"
                          type="button"
                          ref={dateFromBtnRef}
                          style={{ width: "100%", justifyContent: "flex-start", textAlign: "left", fontWeight: "normal" }}
                          onClick={() => setDatePickerFromOpen(!datePickerFromOpen)}
                        >
                          {dateFrom ? formatDateShort(dateFrom.toISOString()) : t("sidebar.start")}
                        </button>
                        <DatePickerPopover
                          isOpen={datePickerFromOpen}
                          onClose={() => setDatePickerFromOpen(false)}
                          selected={dateFrom}
                          onSelect={setDateFrom}
                          anchorRef={dateFromBtnRef}
                        />
                      </div>
                      <div style={{ flex: 1, position: "relative" }}>
                        <button
                          className="btn-outline-secondary"
                          type="button"
                          ref={dateToBtnRef}
                          style={{ width: "100%", justifyContent: "flex-start", textAlign: "left", fontWeight: "normal" }}
                          onClick={() => setDatePickerToOpen(!datePickerToOpen)}
                        >
                          {dateTo ? formatDateShort(dateTo.toISOString()) : t("sidebar.end")}
                        </button>
                        <DatePickerPopover
                          isOpen={datePickerToOpen}
                          onClose={() => setDatePickerToOpen(false)}
                          selected={dateTo}
                          onSelect={setDateTo}
                          anchorRef={dateToBtnRef}
                        />
                      </div>
                    </div>
                  </label>
                  <label>
                    {t("sidebar.durationMinutes")}
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>
                      <input style={{ minWidth: 0 }} type="number" min="0" step="1" placeholder={t("sidebar.min")} value={minDurationMinutes} onChange={(e) => setMinDurationMinutes(e.target.value)} />
                      <span style={{ color: "var(--text-muted)" }}>—</span>
                      <input style={{ minWidth: 0 }} type="number" min="0" step="1" placeholder={t("sidebar.max")} value={maxDurationMinutes} onChange={(e) => setMaxDurationMinutes(e.target.value)} />
                    </div>
                  </label>
                  <div className="filter-actions"><button className="btn-secondary" style={{ flex: 1 }} onClick={clearFilters}>{t("sidebar.reset")}</button></div>
                </div>
              </div>
            )}
          </section>

          {importMessage && <div className="import-message">{importMessage}</div>}

          <div className="sidebar-search">
            <div className="sidebar-search-row">
              <input id="sidebar-search-input" placeholder={t("sidebar.searchPlaceholder")} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
              <div className="sidebar-sort-controls" onClick={(e) => e.stopPropagation()}>
                <button
                  className="sidebar-sort-btn"
                  type="button"
                  onClick={() => setIsSortOpen((open) => !open)}
                  aria-label={`Sort activities by ${sortBy}`}
                  title={t("sidebar.sort")}
                >
                  <IconSort />
                </button>
                <button
                  className="sidebar-sort-btn direction"
                  type="button"
                  onClick={() => setSortDirection((dir) => (dir === "asc" ? "desc" : "asc"))}
                  aria-label={`Toggle sort direction: ${sortDirection === "asc" ? "ascending" : "descending"}`}
                  title={sortDirection === "asc" ? t("sidebar.ascending") : t("sidebar.descending")}
                >
                  <IconSortDirection direction={sortDirection} />
                </button>
                {isSortOpen && (
                  <div className="sidebar-sort-dropdown">
                    <button type="button" className={sortBy === "date" ? "active" : ""} onClick={() => { setSortBy("date"); setIsSortOpen(false); }}>{t("sidebar.sortDate")}</button>
                    <button type="button" className={sortBy === "name" ? "active" : ""} onClick={() => { setSortBy("name"); setIsSortOpen(false); }}>{t("sidebar.sortName")}</button>
                    <button type="button" className={sortBy === "duration" ? "active" : ""} onClick={() => { setSortBy("duration"); setIsSortOpen(false); }}>{t("sidebar.sortDuration")}</button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="log-count">
            <span>{t("sidebar.logsSelected", { filtered: filtered.length, total: activities.length })}</span>
            {hasFilters && <button onClick={clearFilters}>{t("sidebar.clearFilters")}</button>}
          </div>

          {/* Bulk Actions */}
          <div className="bulk-actions-bar" onClick={(e) => e.stopPropagation()}>
            <div className="bulk-export-wrapper">
              <button className="btn-outline-accent" disabled={filtered.length === 0 || isExporting} onClick={() => setBulkExportDropdownOpen(!bulkExportDropdownOpen)}>
                <IconDownload /> {t("sidebar.exportFiltered")}
              </button>
              {bulkExportDropdownOpen && (
                <div className="bulk-export-dropdown">
                  <button onClick={() => { setBulkExportDropdownOpen(false); onBulkExport("csv"); }}>CSV</button>
                  <button onClick={() => { setBulkExportDropdownOpen(false); onBulkExport("json"); }}>JSON</button>
                  <button onClick={() => { setBulkExportDropdownOpen(false); onBulkExport("gpx"); }}>GPX</button>
                  <button onClick={() => { setBulkExportDropdownOpen(false); onBulkExport("kml"); }}>KML</button>
                </div>
              )}
            </div>
            {!confirmBulkDelete ? (
              <button className="btn-outline-danger" disabled={filtered.length === 0 || isBulkDeleting} onClick={() => setConfirmBulkDelete(true)}>
                <IconTrash /> {t("sidebar.deleteFiltered")}
              </button>
            ) : (
              <div className="bulk-delete-confirm">
                <span>{t("sidebar.deleteCount", { count: filtered.length })}</span>
                <button className="btn-compact danger" onClick={onBulkDelete}><IconCheck /></button>
                <button className="btn-compact cancel" onClick={() => setConfirmBulkDelete(false)}><IconX /></button>
              </div>
            )}
          </div>

          {/* Activity List */}
          <div className="activity-list-box">
            <div className="activity-list">
              {sortedForList.map((a) => {
                const isRenaming = renameTarget?.id === a.id;
                const isDeleting = deleteTarget === a.id;
                const isActive = selectedActivity?.id === a.id;

                return (
                  <div key={a.id} className={`activity-item ${isActive ? "active" : ""}`}>
                    {isRenaming ? (
                      <div className="inline-rename">
                        <input
                          autoFocus
                          value={renameTarget.name}
                          onChange={(e) => setRenameTarget({ ...renameTarget, name: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void confirmRename();
                            if (e.key === "Escape") setRenameTarget(null);
                          }}
                        />
                        <div className="inline-actions">
                          <button className="btn-compact confirm" onClick={() => void confirmRename()} title={t("sidebar.save")}><IconCheck /> {t("sidebar.save")}</button>
                          <button className="btn-compact cancel" onClick={() => setRenameTarget(null)} title={t("sidebar.cancel")}><IconX /> {t("sidebar.cancel")}</button>
                        </div>
                      </div>
                    ) : isDeleting ? (
                      <div className="inline-delete-confirm">
                        <span>{t("sidebar.deleteActivity")}</span>
                        <div className="inline-actions">
                          <button className="btn-compact danger" onClick={() => void confirmDelete()}><IconTrash /> {t("sidebar.delete")}</button>
                          <button className="btn-compact cancel" onClick={() => setDeleteTarget(null)}><IconX /> {t("sidebar.cancel")}</button>
                        </div>
                      </div>
                    ) : (
                      <div className="activity-item-wrapper" style={{ display: "flex", alignItems: "center", position: "relative", minWidth: 0 }}>
                        {tab === "compare" && (
                          <input
                            className="compare-checkbox"
                            type="checkbox"
                            checked={compareIds.includes(a.id)}
                            onChange={(e) => {
                              if (e.target.checked && compareIds.length < 4) {
                                setCompareIds([...compareIds, a.id]);
                              } else if (!e.target.checked) {
                                setCompareIds(compareIds.filter(id => id !== a.id));
                              }
                            }}
                            disabled={!compareIds.includes(a.id) && compareIds.length >= 4}
                          />
                        )}
                        <div
                          className="activity-item-content"
                          role="button"
                          tabIndex={0}
                          style={{ flex: 1, paddingLeft: tab === "compare" ? "8px" : "" }}
                          onClick={() => {
                            if (tab === "compare") {
                              const checked = compareIds.includes(a.id);
                              if (!checked && compareIds.length < 4) setCompareIds([...compareIds, a.id]);
                              else if (checked) setCompareIds(compareIds.filter(id => id !== a.id));
                            } else {
                              void selectActivity(a);
                              setTab("individual");
                            }
                          }}
                          onContextMenu={(e) => onItemContextMenu(e, a)}
                        >
                          <span className="activity-name">{a.activity_name || a.file_name}</span>
                          <div className="activity-meta-rows">
                            <div className="activity-meta-row" style={{ color: "var(--text-muted)", marginBottom: "4px" }}>
                              <span>{formatDateShort(a.start_ts_utc)} &bull; {formatTimeShort(a.start_ts_utc, timeFormat)}</span>
                            </div>
                            <div className="activity-meta-row" style={{ fontWeight: 600 }}>
                              <span className="activity-pill">{(a.distance_m / distanceDivisorValue).toFixed(1)} {distanceSuffix}</span>
                              <span className="spacer" />
                              <span className="activity-pill">{formatDuration(a.duration_s)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {filtered.length === 0 && (
                <div className="empty-state" style={{ minHeight: 120, border: "none", padding: "1rem" }}>
                  <span className="empty-icon"><IconClipboard /></span>
                  <span>{t("sidebar.noActivitiesMatch")}</span>
                </div>
              )}
            </div>
          </div>

          <div className="sidebar-footer">
            <div className="sidebar-footer-left">
              <span>{t("sidebar.filesImported", { count: activities.length })}</span>
            </div>
            <button onClick={() => void refresh()} title={t("sidebar.refreshData")}><IconRefresh /></button>
          </div>
        </div>
      </aside>
    </>
  );
}

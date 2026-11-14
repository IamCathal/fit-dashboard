import { useEffect, useMemo, useState } from "react";
import type { Activity, RecordPoint } from "../types";
import type { DistanceUnit, MapStyle, Theme, TimeFormat } from "../stores/settingsStore";
import { ActivityChart } from "./ActivityChart";
import { ActivitySplits, type SplitSummary } from "./ActivitySplits";
import { ActivityMap } from "./ActivityMap";
import { ActivityInsights } from "./ActivityInsights";
import {
  IconClock,
  IconCalendar,
  IconDistance,
  IconSpeed,
  IconHeart,
  IconMountain,
  IconPower,
  IconCadence,
  IconBattery,
  IconAvg,
  IconFlame,
  IconVo2,
  IconMapPin,
  IconMapPinOff,
  type Icon,
} from "./icons";
import {
  computeRecordStats,
  formatDate,
  formatDuration,
  formatPace,
  parseActivityMetadata,
} from "../lib/activityFormat";
import {
  convertElevationMeters,
  convertSpeedKmh,
  distanceDivisor,
  distanceLabel,
  elevationLabel,
  speedLabel,
} from "../lib/units";
import { useTranslation } from "../lib/i18n";

type Props = {
  activity: Activity;
  records: RecordPoint[];
  theme: Theme;
  distanceUnit: DistanceUnit;
  timeFormat: TimeFormat;
  hrZoneBounds: number[];
  mapStyle: MapStyle;
  setMapStyle: (style: MapStyle) => void;
  onToggleOverviewVisibility: (activity: Activity, visible: boolean) => void;
};

export function DetailView({
  activity,
  records,
  theme,
  distanceUnit,
  timeFormat,
  hrZoneBounds,
  mapStyle,
  setMapStyle,
  onToggleOverviewVisibility,
}: Props) {
  const { t } = useTranslation();

  const [telemetryZoom, setTelemetryZoom] = useState<{ start: number; end: number } | null>(null);
  const [playbackElapsedMs, setPlaybackElapsedMs] = useState<number | null>(null);
  const [selectedSplitRange, setSelectedSplitRange] = useState<{ startM: number; endM: number } | null>(null);
  const [splitSummaries, setSplitSummaries] = useState<SplitSummary[]>([]);
  const [hoverSplitRange, setHoverSplitRange] = useState<{ startM: number; endM: number } | null>(null);
  const [smoothGraphs, setSmoothGraphs] = useState(true);
  const [showLaps, setShowLaps] = useState(true);
  const [showMoreInsights, setShowMoreInsights] = useState(false);

  // Reset the shared playhead when a different activity is selected. The map
  // reports its position again once the new records are loaded.
  useEffect(() => {
    setPlaybackElapsedMs(null);
    setSelectedSplitRange(null);
    setHoverSplitRange(null);
  }, [activity.id]);

  // Escape clears the shared split selection from anywhere on the detail view.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedSplitRange(null);
        setHoverSplitRange(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const distanceDivisorValue = distanceDivisor(distanceUnit);
  const distanceSuffix = distanceLabel(distanceUnit);
  const recordStats = useMemo(() => computeRecordStats(records), [records]);
  const selectedMetadata = useMemo(
    () => parseActivityMetadata(activity.metadata_json),
    [activity.metadata_json]
  );
  const lapTimestampsUtc = useMemo(
    () => (selectedMetadata?.laps ?? [])
      .map((lap) => lap.start_ts_utc ?? lap.end_ts_utc ?? "")
      .filter((ts) => !!ts),
    [selectedMetadata]
  );
  // The watch reports average pace using moving/timer time, not elapsed
  // wall-clock time. `duration_s` from the activity is elapsed (includes
  // pauses), so prefer the lap timer times when available. This mirrors the
  // summary row at the bottom of the laps table.
  const lapSummary = useMemo(() => {
    const laps = selectedMetadata?.laps ?? [];
    let distanceM = 0;
    let timerTimeS = 0;
    for (const lap of laps) {
      if (typeof lap.total_distance_m === "number") distanceM += lap.total_distance_m;
      const lapTime = typeof lap.total_timer_time_s === "number"
        ? lap.total_timer_time_s
        : (typeof lap.total_elapsed_time_s === "number" ? lap.total_elapsed_time_s : null);
      if (lapTime != null) timerTimeS += Math.max(0, lapTime);
    }
    return { distanceM, timerTimeS };
  }, [selectedMetadata]);
  const overallAvgPaceSec = useMemo(() => {
    if (lapSummary.distanceM > 0 && lapSummary.timerTimeS > 0) {
      return lapSummary.timerTimeS / (lapSummary.distanceM / distanceDivisorValue);
    }
    if (activity.distance_m > 0) {
      return activity.duration_s / (activity.distance_m / distanceDivisorValue);
    }
    return 0;
  }, [lapSummary, activity, distanceDivisorValue]);
  const detailStats = useMemo(() => {
    const out: Array<{ key: string; label: string; value: string; secondary?: string; icon: Icon }> = [];
    const seen = new Set<string>();
    const push = (key: string, label: string, value: string | null | undefined, icon: Icon, secondary?: string) => {
      if (!value || seen.has(key)) return;
      seen.add(key);
      out.push({ key, label, value, secondary, icon });
    };

    const session = selectedMetadata?.session ?? {};
    const metric = selectedMetadata?.activity_metrics ?? {};
    const avgPaceText = formatPace(overallAvgPaceSec, distanceSuffix);
    const avgHr = recordStats.avgHr > 0 ? Math.round(recordStats.avgHr) : (typeof session.avg_heart_rate === "number" ? session.avg_heart_rate : null);
    const maxHr = recordStats.maxHr > 0 ? recordStats.maxHr : (typeof session.max_heart_rate === "number" ? session.max_heart_rate : null);

    // Primary stats — always visible, in this order.
    push("distance", t("detail.distance"), `${(activity.distance_m / distanceDivisorValue).toFixed(2)} ${distanceSuffix}`, "distance");
    if (avgPaceText !== "-") push("avg_pace", t("detail.avgPace"), avgPaceText, "speed");
    if (typeof session.total_calories === "number" && session.total_calories > 0) push("total_calories", t("detail.calories"), `${Math.round(session.total_calories)} kcal`, "flame");
    push("duration", t("detail.duration"), formatDuration(activity.duration_s), "clock");
    if (avgHr && avgHr > 0) push("avg_hr", t("detail.avgHr"), `${Math.round(avgHr)} bpm`, "heart");
    push("date", t("detail.date"), formatDate(activity.start_ts_utc), "calendar");

    // Secondary stats — hidden behind the "show more" toggle.
    if (recordStats.avgSpeed > 0) push("avg_speed", t("detail.avgSpeed"), `${convertSpeedKmh(recordStats.avgSpeed, distanceUnit).toFixed(1)} ${speedLabel(distanceUnit)}`, "speed");
    if (recordStats.maxSpeed > 0) push("max_speed", t("detail.maxSpeed"), `${convertSpeedKmh(recordStats.maxSpeed, distanceUnit).toFixed(1)} ${speedLabel(distanceUnit)}`, "speed");
    if (maxHr && maxHr > 0) push("max_hr", t("detail.maxHr"), `${Math.round(maxHr)} bpm`, "heart");

    if (recordStats.maxAlt > 0) push("max_alt", t("detail.maxAltitude"), `${convertElevationMeters(recordStats.maxAlt, distanceUnit).toFixed(0)} ${elevationLabel(distanceUnit)}`, "mountain");
    if (recordStats.avgPower > 0) push("avg_power", t("detail.avgPower"), `${Math.round(recordStats.avgPower)} W`, "power");

    if (typeof session.avg_cadence === "number" && session.avg_cadence > 0) push("avg_cadence", t("detail.avgCadence"), `${Math.round(session.avg_cadence)} rpm`, "cadence");
    if (typeof session.max_cadence === "number" && session.max_cadence > 0) push("max_cadence", t("detail.maxCadence"), `${Math.round(session.max_cadence)} rpm`, "cadence");
    if (typeof session.beginning_body_battery === "number" && typeof session.ending_body_battery === "number") {
      const delta = session.ending_body_battery - session.beginning_body_battery;
      const deltaLabel = delta > 0 ? `+${delta}` : `${delta}`;
      push(
        "bb_change",
        "Body Battery Change",
        deltaLabel,
        "battery",
        `${session.beginning_body_battery} -> ${session.ending_body_battery}`
      );
    }
    if (typeof metric.vo2_max === "number" && metric.vo2_max > 0) push("vo2_max", "VO2 Max", `${metric.vo2_max.toFixed(1)}`, "vo2");
    if (lapTimestampsUtc.length > 0) push("laps", t("detail.laps"), String(lapTimestampsUtc.length), "avg");

    return out;
  }, [activity, selectedMetadata, recordStats, distanceDivisorValue, distanceSuffix, distanceUnit, lapTimestampsUtc.length, overallAvgPaceSec, t]);

  const lapRows = useMemo(() => {
    const laps = selectedMetadata?.laps ?? [];
    let cumulativeSeconds = 0;
    let cumulativeDistanceMeters = 0;

    return laps.map((lap, index) => {
      const lapTimeSec = typeof lap.total_timer_time_s === "number"
        ? lap.total_timer_time_s
        : (typeof lap.total_elapsed_time_s === "number" ? lap.total_elapsed_time_s : null);
      if (lapTimeSec != null) cumulativeSeconds += Math.max(0, lapTimeSec);
      const distanceMeters = typeof lap.total_distance_m === "number" ? lap.total_distance_m : null;
      if (distanceMeters != null) cumulativeDistanceMeters += distanceMeters;
      const avgPace = lap.avg_speed_m_s && lap.avg_speed_m_s > 0
        ? formatPace((distanceDivisorValue / lap.avg_speed_m_s), distanceSuffix)
        : "-";
      const bestPace = lap.best_speed_m_s && lap.best_speed_m_s > 0
        ? formatPace((distanceDivisorValue / lap.best_speed_m_s), distanceSuffix)
        : "-";
      return {
        index: index + 1,
        lapTimeSec,
        cumulativeSeconds,
        distanceMeters,
        cumulativeDistanceMeters,
        avgPace,
        avgHr: lap.avg_heart_rate,
        maxHr: lap.max_heart_rate,
        ascentMeters: lap.total_ascent_m,
        descentMeters: lap.total_descent_m,
        avgCadence: lap.avg_cadence,
        calories: lap.total_calories,
        bestPace,
      };
    });
  }, [selectedMetadata?.laps, distanceDivisorValue, distanceSuffix]);

  const rangesMatch = (
    a: { startM: number; endM: number } | null,
    b: { startM: number; endM: number },
  ): boolean =>
    a != null && Math.abs(a.startM - b.startM) < 0.5 && Math.abs(a.endM - b.endM) < 0.5;

  const toggleSplitRange = (range: { startM: number; endM: number }) => {
    setSelectedSplitRange((prev) =>
      rangesMatch(prev, range) ? null : { startM: range.startM, endM: range.endM },
    );
  };

  // Map a distance clicked on the chart or map back to the split containing it,
  // keeping every view in sync.
  const selectSplitAtDistance = (distanceM: number) => {
    const range = splitSummaries.find((r) => distanceM >= r.startM - 0.5 && distanceM <= r.endM + 0.5);
    if (range) toggleSplitRange(range);
  };

  const lapRangeFor = (lap: { distanceMeters: number | null; cumulativeDistanceMeters: number }) => {
    if (lap.distanceMeters == null || lap.distanceMeters <= 0) return null;
    return {
      startM: Math.max(0, lap.cumulativeDistanceMeters - lap.distanceMeters),
      endM: lap.cumulativeDistanceMeters,
    };
  };

  // The split matching the current selection, when the selection came from a
  // split (or a lap that aligns with one). Used by the summary chip and map pill.
  const selectedSplit = selectedSplitRange
    ? splitSummaries.find((split) => rangesMatch(selectedSplitRange, split)) ?? null
    : null;

  const primaryStatKeys = ["distance", "avg_pace", "total_calories", "duration", "avg_hr", "date"];
  const primaryStats = detailStats.filter((s) => primaryStatKeys.includes(s.key));
  const secondaryStats = detailStats.filter((s) => !primaryStatKeys.includes(s.key));

  const renderMiniStat = (s: (typeof detailStats)[number], variant: "primary" | "secondary" = "primary") => (
    <div key={s.key} className={`mini-stat ${variant === "secondary" ? "mini-stat-muted" : ""}`}>
      <span className={`mini-icon ${s.key === "max_hr" ? "danger" : ""}`}>
        {s.icon === "clock" && <IconClock />}
        {s.icon === "calendar" && <IconCalendar />}
        {s.icon === "distance" && <IconDistance />}
        {s.icon === "speed" && <IconSpeed />}
        {s.icon === "heart" && <IconHeart />}
        {s.icon === "mountain" && <IconMountain />}
        {s.icon === "power" && <IconPower />}
        {s.icon === "cadence" && <IconCadence />}
        {s.icon === "battery" && <IconBattery />}
        {s.icon === "avg" && <IconAvg />}
        {s.icon === "flame" && <IconFlame />}
        {s.icon === "vo2" && <IconVo2 />}
      </span>
      <span className="mini-value">{s.value}</span>
      <span className="mini-label">{s.label}</span>
      {s.secondary && <span className="mini-label" style={{ fontSize: "0.68rem", marginTop: "2px" }}>{s.secondary}</span>}
    </div>
  );

  return (
    <>
      <div className="detail-header">
        <div className="detail-identity">
          <div className="detail-name-row">
            <h2 className="detail-activity-name">{activity.activity_name || activity.file_name}</h2>
            <button
              type="button"
              className={`icon-btn detail-overview-toggle ${activity.show_in_overview === false ? "off" : "active"}`}
              onClick={() => onToggleOverviewVisibility(activity, activity.show_in_overview === false)}
              title={activity.show_in_overview === false ? t("detail.showInOverviewTooltip") : t("detail.hideFromOverviewTooltip")}
              aria-label={activity.show_in_overview === false ? t("detail.showInOverview") : t("detail.hideFromOverview")}
              aria-pressed={activity.show_in_overview !== false}
            >
              {activity.show_in_overview === false ? <IconMapPinOff /> : <IconMapPin />}
            </button>
          </div>
        </div>
        <div className="detail-header-right">
          <div className="detail-primary-stats">
            {primaryStats.map((s) => renderMiniStat(s))}
            {secondaryStats.map((s) => renderMiniStat(s, "secondary"))}
          </div>
        </div>
      </div>
      {selectedSplitRange && (
        <div className="split-summary-chip">
          <span className="split-summary-title">
            {selectedSplit
              ? `${t("splits.split")} ${selectedSplit.index}${selectedSplit.isPartial ? ` (${t("splits.partial")})` : ""}`
              : t("splits.title")}
          </span>
          {selectedSplit ? (
            <>
              <span className="split-summary-metric">
                <span className="split-summary-label">{t("splits.pace")}</span>
                <strong>{formatPace((selectedSplit.paceMinPerUnit ?? 0) * 60, distanceSuffix)}</strong>
              </span>
              <span className="split-summary-metric">
                <span className="split-summary-label">{t("splits.time")}</span>
                <strong>{formatDuration(selectedSplit.durationS)}</strong>
              </span>
              {selectedSplit.avgHr != null && (
                <span className="split-summary-metric">
                  <span className="split-summary-label">{t("splits.avgHr")}</span>
                  <strong>{Math.round(selectedSplit.avgHr)} bpm</strong>
                </span>
              )}
              {selectedSplit.elevationGainM > 0 && (
                <span className="split-summary-metric">
                  <span className="split-summary-label">{t("splits.elevGain")}</span>
                  <strong>{Math.round(convertElevationMeters(selectedSplit.elevationGainM, distanceUnit))} {elevationLabel(distanceUnit)}</strong>
                </span>
              )}
            </>
          ) : (
            <span className="split-summary-metric">
              <strong>
                {(selectedSplitRange.startM / distanceDivisorValue).toFixed(2)}–{(selectedSplitRange.endM / distanceDivisorValue).toFixed(2)} {distanceSuffix}
              </strong>
            </span>
          )}
          <button
            type="button"
            className="split-summary-clear"
            onClick={() => setSelectedSplitRange(null)}
            aria-label={t("splits.clearSelection")}
            title={t("splits.clearSelection")}
          >
            ×
          </button>
        </div>
      )}
      <div className="detail-focus-row">
        <div className="panel detail-chart-panel">
          <div className="detail-chart-toolbar">
            <label className="detail-toggle-badge" title={t("detail.smoothGraphsTooltip")}>
              <input
                type="checkbox"
                checked={smoothGraphs}
                onChange={(e) => setSmoothGraphs(e.target.checked)}
              />
              <span>{t("detail.smoothGraphs")}</span>
            </label>
            <button className="btn-secondary detail-chart-reset-zoom" onClick={() => setTelemetryZoom(null)}>
              {t("detail.resetZoom")}
            </button>
          </div>
          <ActivityChart
            records={records}
            theme={theme}
            distanceUnit={distanceUnit}
            heartRateZoneBoundsBpm={hrZoneBounds}
            zoomRange={telemetryZoom}
            onZoomChange={setTelemetryZoom}
            lapTimestampsUtc={lapTimestampsUtc}
            smoothGraphs={smoothGraphs}
            playbackElapsedMs={playbackElapsedMs}
            highlightRange={hoverSplitRange ?? selectedSplitRange}
            onSelectDistance={selectSplitAtDistance}
          />
        </div>
        <ActivityMap
          records={records}
          mapStyle={mapStyle}
          setMapStyle={setMapStyle}
          sport={activity.sport}
          lapTimestampsUtc={lapTimestampsUtc}
          onPlaybackChange={setPlaybackElapsedMs}
          focusRange={selectedSplitRange}
          onSelectDistance={selectSplitAtDistance}
          focusLabel={selectedSplit ? `${t("splits.split")} ${selectedSplit.index}` : null}
          onClearFocus={() => setSelectedSplitRange(null)}
        />
      </div>
      <ActivitySplits
        records={records}
        theme={theme}
        distanceUnit={distanceUnit}
        sport={activity.sport}
        overallAvgPaceSecPerUnit={overallAvgPaceSec > 0 ? overallAvgPaceSec : null}
        selectedSplitRange={selectedSplitRange}
        onSelectSplit={setSelectedSplitRange}
        onSplitsChange={setSplitSummaries}
        onHoverSplit={setHoverSplitRange}
      />
      {lapRows.length > 0 && (
        <div className="panel laps-table-panel laps-collapsible">
          <button
            type="button"
            className={`laps-toggle ${showLaps ? "open" : ""}`}
            onClick={() => setShowLaps((v) => !v)}
            aria-expanded={showLaps}
          >
            <span>{t("detail.laps")} <span className="laps-toggle-count">({lapRows.length})</span></span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="detail-stats-chevron">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {showLaps && (
            <div className="laps-table-wrap">
              <table className="laps-table">
                <thead>
                  <tr>
                    <th>{t("detail.laps")}</th>
                    <th>{t("detail.time")}</th>
                    <th>{t("detail.distance")}</th>
                    <th>{t("detail.avgPace")}</th>
                    <th>{t("detail.avgHr")}</th>
                  </tr>
                </thead>
                <tbody>
                  {lapRows.map((lap) => {
                    const lapRange = lapRangeFor(lap);
                    const isActive = lapRange != null && rangesMatch(selectedSplitRange, lapRange);
                    return (
                      <tr
                        key={`lap-${lap.index}`}
                        className={`lap-row ${isActive ? "active" : ""}`}
                        onClick={() => { if (lapRange) toggleSplitRange(lapRange); }}
                      >
                        <td>{lap.index}</td>
                        <td>{lap.lapTimeSec != null ? formatDuration(lap.lapTimeSec) : "-"}</td>
                        <td>{lap.distanceMeters != null ? `${(lap.distanceMeters / distanceDivisorValue).toFixed(2)} ${distanceSuffix}` : "-"}</td>
                        <td>{lap.avgPace}</td>
                        <td>{typeof lap.avgHr === "number" ? Math.round(lap.avgHr) : "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td>{t("detail.summary")}</td>
                    <td>{formatDuration(lapRows.reduce((a, b) => a + (b.lapTimeSec || 0), 0))}</td>
                    <td>{(() => {
                      const d = lapRows.reduce((a, b) => a + (b.distanceMeters || 0), 0);
                      return d > 0 ? `${(d / distanceDivisorValue).toFixed(2)} ${distanceSuffix}` : "-";
                    })()}</td>
                    <td>{(() => {
                      const d = lapRows.reduce((a, b) => a + (b.distanceMeters || 0), 0);
                      const t = lapRows.reduce((a, b) => a + (b.lapTimeSec || 0), 0);
                      return d > 0 && t > 0 ? formatPace((distanceDivisorValue / (d / t)), distanceSuffix) : "-";
                    })()}</td>
                    <td>{(() => {
                      const hrs = lapRows.map(l => l.avgHr).filter((h): h is number => typeof h === "number");
                      return hrs.length > 0 ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : "-";
                    })()}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
      <div className="insight-more-toggle-row">
        <button
          type="button"
          className={`detail-stats-toggle insight-more-toggle ${showMoreInsights ? "open" : ""}`}
          onClick={() => setShowMoreInsights((v) => !v)}
          aria-expanded={showMoreInsights}
        >
          <span>{showMoreInsights ? t("insights.hideMore") : t("insights.showMore")}</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="detail-stats-chevron">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>
      {showMoreInsights && (
        <ActivityInsights mode="more" records={records} theme={theme} distanceUnit={distanceUnit} heartRateZoneBoundsBpm={hrZoneBounds} zoomRange={telemetryZoom} onZoomChange={setTelemetryZoom} lapTimestampsUtc={lapTimestampsUtc} smoothGraphs={smoothGraphs} playbackElapsedMs={playbackElapsedMs} highlightRange={hoverSplitRange ?? selectedSplitRange} />
      )}
    </>
  );
}

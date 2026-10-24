import { useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import type { RecordPoint } from "../types";
import { enableChartWheelPageScroll } from "../lib/chartScroll";
import { buildHeartRateZones } from "../lib/hrZones";
import { applyRollingAverageSeries, getDynamicSmoothingWindow } from "../lib/chartSmoothing";
import { convertDistanceMeters, convertPaceMinPerKm, distanceLabel, paceLabel, type DistanceUnit } from "../lib/units";
import { useTranslation } from "../lib/i18n";
import { PaceRangeSlider } from "./PaceRangeSlider";

type Props = {
  records: RecordPoint[];
  theme: "light" | "dark";
  distanceUnit: DistanceUnit;
  heartRateZoneBoundsBpm?: number[];
  zoomRange?: { start: number; end: number } | null;
  onZoomChange?: (range: { start: number; end: number }) => void;
  lapTimestampsUtc?: string[];
  smoothGraphs?: boolean;
};

/** Slider granularity: one second expressed in minutes. */
const PACE_RANGE_STEP = 1 / 60;

/** Default half-width of the visible pace window, in minutes. */
const DEFAULT_PACE_HALF_WINDOW_MIN = 1.5;

export function ActivityChart({
  records,
  theme,
  distanceUnit,
  heartRateZoneBoundsBpm,
  zoomRange,
  onZoomChange,
  lapTimestampsUtc = [],
  smoothGraphs = true,
}: Props) {
  const t0 = records[0]?.timestamp_ms ?? 0;
  const totalDurationMs = Math.max(0, (records[records.length - 1]?.timestamp_ms ?? t0) - t0);
  const smoothWindow = smoothGraphs ? getDynamicSmoothingWindow(records.length, totalDurationMs, zoomRange) : 1;
  const { t } = useTranslation();
  
  // Format MM:SS or HH:MM:SS
  const formatRelTime = (ms: number) => {
    const totalSec = Math.floor(Math.max(0, ms) / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    }
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const formatAbsTime = (relMs: number) => {
    const absolute = new Date(t0 + Math.max(0, relMs));
    const hh = String(absolute.getHours()).padStart(2, "0");
    const mm = String(absolute.getMinutes()).padStart(2, "0");
    const ss = String(absolute.getSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  };

  const formatTooltipHeader = (relMs: number) =>
    `<div style="display:flex;align-items:center;gap:6px;"><strong>${formatRelTime(relMs)}</strong><span style="display:inline-flex;align-items:center;border-radius:999px;padding:1px 6px;font-size:11px;background:rgba(148,163,184,0.22);">${formatAbsTime(relMs)}</span></div>`;

  const hrZones = buildHeartRateZones(heartRateZoneBoundsBpm);
  const hrSeriesData = useMemo(
    () => records.map((r) => [r.timestamp_ms - t0, r.heart_rate ?? null, r.timestamp_ms, typeof r.distance_m === "number" ? r.distance_m / 1000 : null]),
    [records, t0],
  );
  const paceSeriesData = useMemo(
    () => records.map((r, i) => {
      const relMs = r.timestamp_ms - t0;
      const prev = i > 0 ? records[i - 1] : undefined;
      const dtS = prev ? (r.timestamp_ms - prev.timestamp_ms) / 1000 : 0;
      const derivedSpeed =
        (!r.speed_m_s && prev && typeof r.distance_m === "number" && typeof prev.distance_m === "number" && dtS > 0)
          ? Math.max(0, (r.distance_m - prev.distance_m) / dtS)
          : undefined;
      const speedMs = r.speed_m_s ?? derivedSpeed;
      const paceMinPerKm = speedMs && speedMs > 0 ? 1000 / (speedMs * 60) : null;
      const paceMinPerUnit = paceMinPerKm == null ? null : convertPaceMinPerKm(paceMinPerKm, distanceUnit);
      return [relMs, paceMinPerUnit, r.timestamp_ms] as [number, number | null, number];
    }),
    [records, t0, distanceUnit],
  );

  // Running average pace: cumulative moving time divided by cumulative
  // distance. Stopped segments (speed below a small threshold) are excluded so
  // pauses don't drag the average down.
  const avgPaceSeriesData = useMemo(() => {
    const firstDistance = records.find((r) => typeof r.distance_m === "number")?.distance_m ?? 0;
    let movingTimeS = 0;
    let cumulativeDistanceM = 0;
    let prev: RecordPoint | undefined;

    return records.map((r) => {
      const relMs = r.timestamp_ms - t0;
      if (prev) {
        const dtS = (r.timestamp_ms - prev.timestamp_ms) / 1000;
        if (dtS > 0) {
          let speedMs: number | undefined;
          if (typeof r.distance_m === "number" && typeof prev.distance_m === "number") {
            speedMs = (r.distance_m - prev.distance_m) / dtS;
          } else {
            speedMs = r.speed_m_s ?? prev.speed_m_s;
          }
          if (typeof speedMs === "number" && speedMs > 0.2) {
            movingTimeS += dtS;
          }
        }
      }
      if (typeof r.distance_m === "number") {
        cumulativeDistanceM = Math.max(0, r.distance_m - firstDistance);
      }
      prev = r;

      const paceMinPerKm = cumulativeDistanceM > 0 && movingTimeS > 0
        ? (movingTimeS / 60) / (cumulativeDistanceM / 1000)
        : null;
      const paceMinPerUnit = paceMinPerKm == null ? null : convertPaceMinPerKm(paceMinPerKm, distanceUnit);
      return [relMs, paceMinPerUnit, r.timestamp_ms] as [number, number | null, number];
    });
  }, [records, t0, distanceUnit]);

  const overallAvgPace = useMemo(() => {
    for (let i = avgPaceSeriesData.length - 1; i >= 0; i -= 1) {
      const value = avgPaceSeriesData[i][1];
      if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
    }
    return null;
  }, [avgPaceSeriesData]);

  const hrSeriesSmoothed = useMemo(
    () => (smoothGraphs ? applyRollingAverageSeries(hrSeriesData, 1, smoothWindow) : hrSeriesData),
    [hrSeriesData, smoothGraphs, smoothWindow],
  );
  const paceSeriesSmoothed = useMemo(
    () => (smoothGraphs ? applyRollingAverageSeries(paceSeriesData, 1, smoothWindow) : paceSeriesData),
    [paceSeriesData, smoothGraphs, smoothWindow],
  );

  // Median pace is used as the centre of the default visible window because it
  // is far less sensitive to stop/start outliers than the mean.
  const paceStats = useMemo(() => {
    const values: number[] = [];
    for (const row of paceSeriesSmoothed) {
      const value = row[1];
      if (typeof value === "number" && Number.isFinite(value) && value > 0) values.push(value);
    }
    if (values.length === 0) return null;
    values.sort((a, b) => a - b);
    const min = values[0];
    const max = values[values.length - 1];
    const mid = Math.floor(values.length / 2);
    const median = values.length % 2 === 1 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
    return { min, max, median };
  }, [paceSeriesSmoothed]);

  // null means "use the default window centred on the median pace".
  const [paceWindow, setPaceWindow] = useState<{ fast: number; slow: number } | null>(null);
  const [showPaceRange, setShowPaceRange] = useState(false);
  const [showCurrentPace, setShowCurrentPace] = useState(true);
  const [showAvgPace, setShowAvgPace] = useState(true);

  useEffect(() => {
    setPaceWindow(null);
    setShowPaceRange(false);
  }, [records, distanceUnit, smoothGraphs]);

  const paceDomain = useMemo(() => {
    if (!paceStats) return null;

    // Ensure the slider always has a workable span, even for an almost
    // perfectly constant pace.
    const minSpan = PACE_RANGE_STEP * 10;
    let dataMin = paceStats.min;
    let dataMax = paceStats.max;
    if (dataMax - dataMin < minSpan) {
      const centre = (dataMin + dataMax) / 2;
      dataMin = centre - minSpan / 2;
      dataMax = centre + minSpan / 2;
    }

    const clampToData = (value: number) => Math.max(dataMin, Math.min(dataMax, value));
    // Keep the running average line inside the default visible window.
    const defaultFast = clampToData(
      Math.min(paceStats.median - DEFAULT_PACE_HALF_WINDOW_MIN, overallAvgPace ?? Infinity),
    );
    const defaultSlow = clampToData(
      Math.max(paceStats.median + DEFAULT_PACE_HALF_WINDOW_MIN, overallAvgPace ?? -Infinity),
    );

    let fast = clampToData(paceWindow ? paceWindow.fast : defaultFast);
    let slow = clampToData(paceWindow ? paceWindow.slow : defaultSlow);
    if (slow - fast < PACE_RANGE_STEP) {
      fast = clampToData(paceStats.median - PACE_RANGE_STEP * 15);
      slow = clampToData(paceStats.median + PACE_RANGE_STEP * 15);
    }
    if (slow - fast < PACE_RANGE_STEP) {
      slow = fast + PACE_RANGE_STEP;
    }

    return {
      min: dataMin,
      max: dataMax,
      fast,
      slow,
      usingDefault: paceWindow === null,
      isFullRange:
        fast <= dataMin + PACE_RANGE_STEP / 2 && slow >= dataMax - PACE_RANGE_STEP / 2,
    };
  }, [paceStats, paceWindow, overallAvgPace]);

  const formatPaceMinutes = (value: number) => {
    const totalSeconds = Math.round(Math.max(0, value) * 60);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  };

  const lapMarkers = lapTimestampsUtc
    .slice(1)
    .map((ts, idx) => {
      const parsed = Date.parse(ts);
      if (!Number.isFinite(parsed)) return null;
      const relMs = parsed - t0;
      if (relMs < 0) return null;
      return { xAxis: relMs, name: `Lap ${idx + 1}` };
    })
    .filter((m): m is { xAxis: number; name: string } => m !== null);

  const isDark = theme === "dark";
  const axisColor = isDark ? "#8899b8" : "#64748b";
  const gridLine = isDark ? "rgba(100, 140, 220, 0.08)" : "rgba(0, 0, 0, 0.06)";
  const tooltipBg = isDark ? "rgba(14, 22, 45, 0.95)" : "rgba(255, 255, 255, 0.95)";
  const tooltipBorder = isDark ? "rgba(100, 140, 220, 0.2)" : "rgba(0, 0, 0, 0.08)";
  const tooltipText = isDark ? "#e2e8f4" : "#0f172a";

  const hrOption = {
    tooltip: {
      trigger: "axis",
      backgroundColor: tooltipBg,
      borderColor: tooltipBorder,
      textStyle: { color: tooltipText, fontSize: 12 },
      formatter: (params: any) => {
        const p = params[0];
        const relTime = Number(p.value[0] ?? 0);
        let html = formatTooltipHeader(relTime);
        for (const s of params) {
          if (s.value[1] !== null && s.value[1] !== undefined) {
            html += `<div>${s.marker} ${s.seriesName}: <strong>${s.value[1]}</strong></div>`;
          }
        }
        const distanceKm = p?.value?.[3] as number | null | undefined;
        if (distanceKm !== null && distanceKm !== undefined) {
          const distanceInUnit = convertDistanceMeters(Number(distanceKm) * 1000, distanceUnit);
          html += `<div style="margin-top:2px;">${t("chart.distance")}: <strong>${distanceInUnit.toFixed(2)} ${distanceLabel(distanceUnit)}</strong></div>`;
        }
        return html;
      }
    },
    legend: {
      data: [t("chart.heartRate")],
      textStyle: { color: axisColor, fontSize: 12 },
      top: 0,
    },
    visualMap: {
      show: false,
      seriesIndex: 0,
      dimension: 1,
      pieces: hrZones.map((zone) => {
        if (zone.maxInclusive === null) {
          return { gt: zone.minExclusive, color: zone.color };
        }
        if (!Number.isFinite(zone.minExclusive)) {
          return { lte: zone.maxInclusive, color: zone.color };
        }
        return { gt: zone.minExclusive, lte: zone.maxInclusive, color: zone.color };
      }),
    },
    grid: { left: 48, right: 16, top: 36, bottom: 38 },
    xAxis: {
      type: "value",
      axisLabel: {
        color: axisColor,
        fontSize: 11,
        formatter: (val: number) => formatRelTime(val)
      },
      axisLine: { lineStyle: { color: gridLine } },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      name: "bpm",
      min: 40,
      nameTextStyle: { color: axisColor, fontSize: 11 },
      axisLabel: { color: axisColor, fontSize: 11 },
      splitLine: { lineStyle: { color: gridLine } },
    },
    dataZoom: [
      {
        type: "inside",
        zoomOnMouseWheel: "ctrl",
        moveOnMouseWheel: false,
        start: zoomRange?.start ?? 0,
        end: zoomRange?.end ?? 100,
      },
    ],
    series: [
      {
        name: t("chart.heartRate"),
        type: "line",
        smooth: smoothGraphs,
        showSymbol: false,
        lineStyle: { width: 2 },
        areaStyle: { opacity: 0.12 },
        sampling: smoothGraphs ? "lttb" : undefined,
        data: hrSeriesSmoothed,
        markLine: lapMarkers.length ? {
          animation: false,
          symbol: ["none", "none"],
          lineStyle: { color: isDark ? "rgba(148,163,184,0.55)" : "rgba(71,85,105,0.5)", type: "dashed", width: 1 },
          label: { color: axisColor, fontSize: 10, formatter: "{b}", position: "insideEndTop" },
          data: lapMarkers,
        } : undefined,
      },
    ],
  };

  const paceOption = {
    tooltip: {
      trigger: "axis",
      backgroundColor: tooltipBg,
      borderColor: tooltipBorder,
      textStyle: { color: tooltipText, fontSize: 12 },
      formatter: (params: any) => {
        const p = params[0];
        const relTime = Number(p.value[0] ?? 0);
        let html = formatTooltipHeader(relTime);
        for (const s of params) {
          if (s.value[1] !== null && s.value[1] !== undefined) {
            const pace = Number(s.value[1]);
            const min = Math.floor(pace);
            const sec = Math.floor((pace - min) * 60);
            html += `<div>${s.marker} ${s.seriesName}: <strong>${min}:${String(sec).padStart(2, "0")} ${paceLabel(distanceUnit)}</strong></div>`;
          }
        }
        return html;
      }
    },
    legend: {
      data: [
        ...(showCurrentPace ? [t("chart.pace")] : []),
        ...(showAvgPace ? [t("chart.avgPace")] : []),
      ],
      selectedMode: false,
      textStyle: { color: axisColor, fontSize: 12 },
      top: 0,
    },
    grid: { left: 48, right: 16, top: 36, bottom: 38 },
    xAxis: {
      type: "value",
      axisLabel: {
        color: axisColor,
        fontSize: 11,
        formatter: (val: number) => formatRelTime(val)
      },
      axisLine: { lineStyle: { color: gridLine } },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      name: paceLabel(distanceUnit),
      inverse: true,
      ...(paceDomain ? { min: paceDomain.fast, max: paceDomain.slow } : {}),
      nameTextStyle: { color: axisColor, fontSize: 11 },
      axisLabel: { color: axisColor, fontSize: 11 },
      splitLine: { lineStyle: { color: gridLine } },
    },
    dataZoom: [
      {
        type: "inside",
        zoomOnMouseWheel: "ctrl",
        moveOnMouseWheel: false,
        start: zoomRange?.start ?? 0,
        end: zoomRange?.end ?? 100,
      },
    ],
    series: [
      ...(showCurrentPace ? [{
        name: t("chart.pace"),
        type: "line",
        smooth: smoothGraphs,
        showSymbol: false,
        lineStyle: { width: 2, color: "#f43f5e" },
        areaStyle: { color: isDark ? "rgba(244, 63, 94, 0.1)" : "rgba(244, 63, 94, 0.12)" },
        sampling: smoothGraphs ? "lttb" : undefined,
        data: paceSeriesSmoothed,
        markLine: lapMarkers.length ? {
          animation: false,
          symbol: ["none", "none"],
          lineStyle: { color: isDark ? "rgba(148,163,184,0.55)" : "rgba(71,85,105,0.5)", type: "dashed", width: 1 },
          label: { color: axisColor, fontSize: 10, formatter: "{b}", position: "insideEndTop" },
          data: lapMarkers,
        } : undefined,
      }] : []),
      ...(showAvgPace ? [{
        name: t("chart.avgPace"),
        type: "line",
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 2, type: "dashed", color: "#3b82f6" },
        itemStyle: { color: "#3b82f6" },
        sampling: "lttb",
        data: avgPaceSeriesData,
      }] : []),
    ],
  };

  const onEvents = {
    datazoom: (evt: any) => {
      const batch = evt?.batch?.[0];
      const start = typeof batch?.start === "number" ? batch.start : (typeof evt?.start === "number" ? evt.start : null);
      const end = typeof batch?.end === "number" ? batch.end : (typeof evt?.end === "number" ? evt.end : null);
      if (start !== null && end !== null) {
        onZoomChange?.({ start, end });
      }
    },
  };

  return (
    <div style={{ display: "grid", gap: 12, minWidth: 0, width: "100%", overflow: "hidden" }}>
      <ReactECharts option={hrOption} onEvents={onEvents} onChartReady={enableChartWheelPageScroll} notMerge style={{ height: 220, width: "100%", minWidth: 0, overflow: "hidden" }} />
      <div className="chart-series-toggles">
        <span className="chart-series-toggles-label">{t("chart.paceSeries")}</span>
        <button
          type="button"
          className={`chart-series-toggle ${showCurrentPace ? "active" : ""}`}
          aria-pressed={showCurrentPace}
          onClick={() => setShowCurrentPace((value) => (value && !showAvgPace ? value : !value))}
        >
          {t("chart.currentPace")}
        </button>
        <button
          type="button"
          className={`chart-series-toggle ${showAvgPace ? "active" : ""}`}
          aria-pressed={showAvgPace}
          onClick={() => setShowAvgPace((value) => (value && !showCurrentPace ? value : !value))}
        >
          {t("chart.avgPace")}
        </button>
      </div>
      <ReactECharts option={paceOption} onEvents={onEvents} onChartReady={enableChartWheelPageScroll} notMerge style={{ height: 220, width: "100%", minWidth: 0, overflow: "hidden" }} />
      {paceDomain && (
        <div className="pace-range-control">
          <div className="pace-range-summary">
            <div className="pace-range-summary-text">
              <span className="pace-range-summary-label">{t("chart.paceRange")}</span>
              <span className="pace-range-summary-value">
                {formatPaceMinutes(paceDomain.fast)} – {formatPaceMinutes(paceDomain.slow)} {paceLabel(distanceUnit)}
              </span>
            </div>
            <div className="pace-range-quick-actions">
              <button
                type="button"
                className="btn-secondary pace-range-quick"
                onClick={() => setPaceWindow({ fast: paceDomain.min, slow: paceDomain.max })}
                disabled={paceDomain.isFullRange}
              >
                {t("chart.paceRangeShowAll")}
              </button>
              <button
                type="button"
                className="btn-secondary pace-range-quick"
                onClick={() => setPaceWindow(null)}
                disabled={paceDomain.usingDefault}
              >
                {t("chart.paceRangeShowZoomed")}
              </button>
            </div>
            <button
              type="button"
              className="btn-secondary pace-range-toggle"
              aria-expanded={showPaceRange}
              onClick={() => setShowPaceRange((value) => !value)}
            >
              {showPaceRange ? t("chart.paceRangeHide") : t("chart.paceRangeAdjust")}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          </div>
          {showPaceRange && (
            <div className="pace-range-panel">
              <PaceRangeSlider
                min={paceDomain.min}
                max={paceDomain.max}
                fast={paceDomain.fast}
                slow={paceDomain.slow}
                step={PACE_RANGE_STEP}
                ariaLabel={t("chart.paceRange")}
                onChange={(fast, slow) => setPaceWindow({ fast, slow })}
              />
              <div className="pace-range-scale">
                <span className="pace-range-scale-bound">
                  <span className="pace-range-scale-label">{t("chart.paceRangeFastest")}</span>
                  <strong>{formatPaceMinutes(paceDomain.min)}</strong>
                </span>
                <span className="pace-range-scale-bound">
                  <span className="pace-range-scale-label">{t("chart.paceRangeSlowest")}</span>
                  <strong>{formatPaceMinutes(paceDomain.max)}</strong>
                </span>
              </div>
              <div className="pace-range-panel-footer">
                <span className="pace-range-hint">{t("chart.paceRangeHint")}</span>
                <button
                  className="btn-secondary pace-range-reset"
                  onClick={() => setPaceWindow(null)}
                  disabled={paceDomain.usingDefault}
                >
                  {t("chart.paceRangeReset")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

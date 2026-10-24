import { useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import type { RecordPoint } from "../types";
import { enableChartWheelPageScroll } from "../lib/chartScroll";
import {
  METERS_PER_KILOMETER,
  METERS_PER_MILE,
  convertElevationMeters,
  distanceLabel,
  elevationLabel,
  paceLabel,
  type DistanceUnit,
} from "../lib/units";
import { useTranslation } from "../lib/i18n";

type Props = {
  records: RecordPoint[];
  theme: "light" | "dark" | "paper" | "paper-dark";
  distanceUnit: DistanceUnit;
  sport?: string;
  /**
   * Watch-reported average pace in seconds per distance unit, based on moving
   * (timer) time rather than elapsed time. When present this is used for the
   * "average" mark line so it matches the activity header and laps summary.
   */
  overallAvgPaceSecPerUnit?: number | null;
};

type Split = {
  index: number;
  distanceM: number;
  durationS: number;
  paceMinPerUnit: number | null;
  elevationGainM: number;
  elevationLossM: number;
  avgHr: number | null;
  isPartial: boolean;
};

type SplitPoint = {
  d: number;
  t: number;
  alt: number | null;
  hr: number | null;
};

const SPLIT_SIZE_OPTIONS = [1, 5];

function isCyclingSport(sport?: string): boolean {
  if (!sport) return false;
  const value = sport.toLowerCase();
  return ["ride", "bike", "cycl", "biking", "cycling", "virtualride", "ebike", "e-bike"].some((keyword) =>
    value.includes(keyword),
  );
}

function formatPace(minPerUnit: number | null): string {
  if (minPerUnit == null || !Number.isFinite(minPerUnit) || minPerUnit <= 0) return "-";
  // Truncate rather than round so the average mark line renders the exact same
  // value as the header and laps summary (which also truncate seconds).
  const totalSeconds = Math.floor(minPerUnit * 60);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDuration(seconds: number): string {
  const total = Math.round(Math.max(0, seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function computeSplits(records: RecordPoint[], unitMeters: number, splitSizeUnits: number): Split[] {
  const points: SplitPoint[] = records
    .filter((r) => typeof r.distance_m === "number" && Number.isFinite(r.distance_m))
    .map((r) => ({
      d: r.distance_m as number,
      t: r.timestamp_ms,
      alt: typeof r.altitude_m === "number" ? r.altitude_m : null,
      hr: typeof r.heart_rate === "number" ? r.heart_rate : null,
    }));

  if (points.length < 2) return [];

  // Guard against GPS distance glitches that make the cumulative distance jump
  // backwards. Splits are only meaningful on a monotonic distance axis.
  let maxDistance = -Infinity;
  for (const point of points) {
    if (point.d < maxDistance) point.d = maxDistance;
    else maxDistance = point.d;
  }

  const totalDistance = points[points.length - 1].d;
  if (!(totalDistance > 0)) return [];

  const splitMeters = unitMeters * splitSizeUnits;
  if (!(splitMeters > 0)) return [];

  const timeAtDistance = (targetDistance: number): number => {
    let lo = 0;
    let hi = points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (points[mid].d >= targetDistance) hi = mid;
      else lo = mid + 1;
    }
    const index = lo;
    if (index === 0) return points[0].t;
    const prev = points[index - 1];
    const next = points[index];
    const span = next.d - prev.d;
    if (span <= 0) return next.t;
    const ratio = Math.min(1, Math.max(0, (targetDistance - prev.d) / span));
    return prev.t + ratio * (next.t - prev.t);
  };

  const aggregate = (startDistance: number, endDistance: number) => {
    let gain = 0;
    let loss = 0;
    let hrSum = 0;
    let hrCount = 0;
    let prevAlt: number | null = null;

    for (const point of points) {
      if (point.d < startDistance) {
        if (point.alt !== null) prevAlt = point.alt;
        continue;
      }
      if (point.d > endDistance) break;

      if (point.alt !== null) {
        if (prevAlt !== null) {
          const delta = point.alt - prevAlt;
          if (delta > 0) gain += delta;
          else loss += -delta;
        }
        prevAlt = point.alt;
      }
      if (point.hr !== null) {
        hrSum += point.hr;
        hrCount += 1;
      }
    }

    return { gain, loss, avgHr: hrCount > 0 ? hrSum / hrCount : null };
  };

  const splits: Split[] = [];
  let previousBoundaryDistance = 0;
  let previousBoundaryTime = points[0].t;
  let splitIndex = 1;

  while (previousBoundaryDistance < totalDistance - 0.5) {
    const nextBoundaryDistance = Math.min(totalDistance, splitIndex * splitMeters);
    const nextBoundaryTime = timeAtDistance(nextBoundaryDistance);
    const distanceM = nextBoundaryDistance - previousBoundaryDistance;
    const durationS = Math.max(0, (nextBoundaryTime - previousBoundaryTime) / 1000);

    if (distanceM > 0.5 && durationS > 0) {
      const paceMinPerUnit = durationS / 60 / (distanceM / unitMeters);
      const aggregateResult = aggregate(previousBoundaryDistance, nextBoundaryDistance);
      splits.push({
        index: splitIndex,
        distanceM,
        durationS,
        paceMinPerUnit: Number.isFinite(paceMinPerUnit) && paceMinPerUnit > 0 ? paceMinPerUnit : null,
        elevationGainM: aggregateResult.gain,
        elevationLossM: aggregateResult.loss,
        avgHr: aggregateResult.avgHr,
        isPartial: distanceM < splitMeters - 0.5,
      });
    }

    previousBoundaryDistance = nextBoundaryDistance;
    previousBoundaryTime = nextBoundaryTime;
    splitIndex += 1;

    // Safety valve for pathological data.
    if (splitIndex > 2000) break;
  }

  return splits;
}

function mixColor(from: [number, number, number], to: [number, number, number], t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  const r = Math.round(from[0] + (to[0] - from[0]) * clamped);
  const g = Math.round(from[1] + (to[1] - from[1]) * clamped);
  const b = Math.round(from[2] + (to[2] - from[2]) * clamped);
  return `rgb(${r}, ${g}, ${b})`;
}

const SLOW_COLOR: [number, number, number] = [244, 63, 94];
const MID_COLOR: [number, number, number] = [245, 158, 11];
const FAST_COLOR: [number, number, number] = [34, 197, 94];

function paceColor(speed: number, minSpeed: number, maxSpeed: number): string {
  if (!(maxSpeed > minSpeed)) return mixColor(MID_COLOR, FAST_COLOR, 0.5);
  const t = (speed - minSpeed) / (maxSpeed - minSpeed);
  if (t < 0.5) return mixColor(SLOW_COLOR, MID_COLOR, t * 2);
  return mixColor(MID_COLOR, FAST_COLOR, (t - 0.5) * 2);
}

export function ActivitySplits({ records, theme, distanceUnit, sport, overallAvgPaceSecPerUnit }: Props) {
  const { t } = useTranslation();
  const unitMeters = distanceUnit === "mi" ? METERS_PER_MILE : METERS_PER_KILOMETER;
  const defaultSplitSize = isCyclingSport(sport) ? 5 : 1;
  const [splitSize, setSplitSize] = useState(defaultSplitSize);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    setSplitSize(defaultSplitSize);
  }, [defaultSplitSize, records]);

  const splits = useMemo(
    () => computeSplits(records, unitMeters, splitSize),
    [records, unitMeters, splitSize],
  );

  const speeds = useMemo(
    () => splits.map((split) => (split.paceMinPerUnit ? 60 / split.paceMinPerUnit : 0)),
    [splits],
  );

  const positiveSpeeds = speeds.filter((speed) => speed > 0);
  const maxSpeed = positiveSpeeds.length ? Math.max(...positiveSpeeds) : 0;
  const minSpeed = positiveSpeeds.length ? Math.min(...positiveSpeeds) : 0;

  let fastestIndex = -1;
  let fastestSpeed = -Infinity;
  speeds.forEach((speed, index) => {
    if (speed > fastestSpeed) {
      fastestSpeed = speed;
      fastestIndex = index;
    }
  });

  const totalDistanceM = splits.reduce((sum, split) => sum + split.distanceM, 0);
  const totalDurationS = splits.reduce((sum, split) => sum + split.durationS, 0);
  // Prefer the watch's moving-time average when supplied; falling back to the
  // elapsed-time split aggregate keeps the line meaningful without lap data.
  const avgSpeed = overallAvgPaceSecPerUnit != null && overallAvgPaceSecPerUnit > 0
    ? 3600 / overallAvgPaceSecPerUnit
    : totalDurationS > 0
      ? (totalDistanceM / unitMeters) / (totalDurationS / 3600)
      : 0;

  // Zoom the value axis to the actual spread of split speeds. Starting at zero
  // makes steady efforts look almost identical; a padded min/max range keeps
  // the fastest and slowest splits visually distinct.
  const speedRange = maxSpeed - minSpeed;
  const speedPadding = speedRange > 0 ? speedRange * 0.15 : Math.max(maxSpeed * 0.05, 0.1);
  const axisMin = Math.max(0, minSpeed - speedPadding);
  const axisMax = Math.max(axisMin + 0.001, maxSpeed + speedPadding);

  if (splits.length === 0) {
    return null;
  }

  const isDark = theme === "dark" || theme === "paper-dark";
  const axisColor = isDark ? "#8899b8" : "#64748b";
  const accentColor = isDark ? "#22d3ee" : "#0891b2";
  const gridLine = isDark ? "rgba(100, 140, 220, 0.08)" : "rgba(0, 0, 0, 0.06)";
  const tooltipBg = isDark ? "rgba(14, 22, 45, 0.95)" : "rgba(255, 255, 255, 0.95)";
  const tooltipBorder = isDark ? "rgba(100, 140, 220, 0.2)" : "rgba(0, 0, 0, 0.08)";
  const tooltipText = isDark ? "#e2e8f4" : "#0f172a";

  const barData = splits.map((split, index) => {
    const speed = speeds[index];
    const isFastest = index === fastestIndex && splits.length > 1;
    return {
      value: speed,
      itemStyle: {
        color: paceColor(speed, minSpeed, maxSpeed),
        borderRadius: [4, 4, 0, 0] as [number, number, number, number],
      },
      label: isFastest
        ? {
            show: true,
            position: "top" as const,
            formatter: `${formatPace(split.paceMinPerUnit)} ★`,
            color: accentColor,
            fontSize: 12,
            fontWeight: 600,
          }
        : undefined,
      split,
    };
  });

  const option = {
    animationDuration: 400,
    tooltip: {
      trigger: "item",
      backgroundColor: tooltipBg,
      borderColor: tooltipBorder,
      textStyle: { color: tooltipText, fontSize: 12 },
      formatter: (params: any) => {
        const split: Split | undefined = params?.data?.split;
        if (!split) return "";
        const distance = (split.distanceM / unitMeters).toFixed(2);
        let html = `<div style="font-weight:600;margin-bottom:4px;">${t("splits.split")} ${split.index}${
          split.isPartial ? ` (${t("splits.partial")})` : ""
        }</div>`;
        html += `<div>${t("splits.distance")}: <strong>${distance} ${distanceLabel(distanceUnit)}</strong></div>`;
        html += `<div>${t("splits.time")}: <strong>${formatDuration(split.durationS)}</strong></div>`;
        html += `<div>${t("splits.pace")}: <strong>${formatPace(split.paceMinPerUnit)} ${paceLabel(distanceUnit)}</strong></div>`;
        if (split.elevationGainM > 0) {
          html += `<div>${t("splits.elevGain")}: <strong>${Math.round(
            convertElevationMeters(split.elevationGainM, distanceUnit),
          )} ${elevationLabel(distanceUnit)}</strong></div>`;
        }
        if (split.avgHr != null) {
          html += `<div>${t("splits.avgHr")}: <strong>${Math.round(split.avgHr)} bpm</strong></div>`;
        }
        return html;
      },
    },
    grid: { left: 52, right: 16, top: 30, bottom: 34 },
    xAxis: {
      type: "category",
      data: splits.map((split) => String(split.index)),
      axisLabel: {
        color: axisColor,
        fontSize: 11,
        interval: splits.length > 24 ? "auto" : 0,
      },
      axisLine: { lineStyle: { color: gridLine } },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      min: axisMin,
      max: axisMax,
      axisLabel: {
        color: axisColor,
        fontSize: 11,
        formatter: (value: number) => (value > 0 ? formatPace(60 / value) : ""),
      },
      splitLine: { lineStyle: { color: gridLine } },
    },
    series: [
      {
        type: "bar",
        data: barData,
        barMaxWidth: 42,
        label: {
          show: true,
          position: "top",
          color: axisColor,
          fontSize: 12,
          formatter: (params: any) => {
            const split: Split | undefined = params?.data?.split;
            return split ? formatPace(split.paceMinPerUnit) : "";
          },
        },
        labelLayout: { hideOverlap: true },
        emphasis: {
          itemStyle: { shadowBlur: 8, shadowColor: "rgba(0, 0, 0, 0.2)" },
        },
        markLine: avgSpeed > 0
          ? {
              silent: true,
              symbol: ["none", "none"],
              lineStyle: {
                color: isDark ? "rgba(148, 163, 184, 0.6)" : "rgba(71, 85, 105, 0.5)",
                type: "dashed",
                width: 1,
              },
              label: {
                color: axisColor,
                fontSize: 10,
                formatter: `${t("splits.average")} ${formatPace(60 / avgSpeed)}`,
                position: "insideEndTop",
              },
              data: [{ yAxis: avgSpeed }],
            }
          : undefined,
      },
    ],
  };

  return (
    <div className="panel splits-panel">
      <div className="splits-header">
        <h3>{t("splits.title")}</h3>
        <div className="splits-controls">
          <span className="splits-control-label">{t("splits.splitSize")}</span>
          <div className="splits-size-toggle">
            {SPLIT_SIZE_OPTIONS.map((size) => (
              <button
                key={size}
                type="button"
                className={splitSize === size ? "active" : ""}
                onClick={() => setSplitSize(size)}
              >
                {size} {distanceLabel(distanceUnit)}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="splits-table-toggle"
            aria-expanded={showTable}
            onClick={() => setShowTable((value) => !value)}
          >
            {showTable ? t("splits.hideSummary") : t("splits.showSummary")}
          </button>
        </div>
      </div>

      <ReactECharts
        option={option}
        notMerge
        onChartReady={enableChartWheelPageScroll}
        style={{ height: 280, width: "100%", minWidth: 0 }}
      />

      {showTable && (
        <div className="splits-table-wrap">
          <table className="splits-table">
            <thead>
              <tr>
                <th>{t("splits.split")}</th>
                <th>{t("splits.distance")}</th>
                <th>{t("splits.time")}</th>
                <th>{t("splits.pace")}</th>
                <th>{t("splits.elevGain")}</th>
                <th>{t("splits.avgHr")}</th>
              </tr>
            </thead>
            <tbody>
              {splits.map((split, index) => (
                <tr key={split.index} className={index === fastestIndex && splits.length > 1 ? "fastest" : ""}>
                  <td>
                    {split.index}
                    {split.isPartial ? "*" : ""}
                  </td>
                  <td>
                    {(split.distanceM / unitMeters).toFixed(2)} {distanceLabel(distanceUnit)}
                  </td>
                  <td>{formatDuration(split.durationS)}</td>
                  <td>
                    {formatPace(split.paceMinPerUnit)} {paceLabel(distanceUnit)}
                  </td>
                  <td>
                    {split.elevationGainM > 0
                      ? `${Math.round(convertElevationMeters(split.elevationGainM, distanceUnit))} ${elevationLabel(distanceUnit)}`
                      : "-"}
                  </td>
                  <td>{split.avgHr != null ? Math.round(split.avgHr) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

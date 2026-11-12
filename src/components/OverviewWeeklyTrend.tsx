import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import type { Activity } from "../types";
import { useTranslation } from "../lib/i18n";
import { startOfWeek, toDateKey } from "../lib/date";

type Props = {
  activities: Activity[];
  distanceUnit: "km" | "mi";
  theme: "light" | "dark" | "paper" | "paper-dark";
  selectedWeekStart?: string | null;
  onSelectWeek?: (weekStart: string | null) => void;
};

type WeekBucket = {
  key: string;
  start: Date;
  label: string;
  total: number;
  longest: number;
  rest: number;
  runCount: number;
};

type ScatterPoint = {
  value: [number, number];
  weekIndex: number;
  itemStyle: {
    borderColor: string;
    borderWidth: number;
  };
};

export function OverviewWeeklyTrend({
  activities,
  distanceUnit,
  theme,
  selectedWeekStart,
  onSelectWeek,
}: Props) {
  const isDark = theme === "dark" || theme === "paper-dark";
  const { t } = useTranslation();
  const axisColor = isDark ? "#8899b8" : "#64748b";
  const gridLine = isDark ? "rgba(100, 140, 220, 0.08)" : "rgba(0, 0, 0, 0.06)";
  const tooltipBg = isDark ? "rgba(14, 22, 45, 0.95)" : "rgba(255, 255, 255, 0.95)";
  const tooltipBorder = isDark ? "rgba(100, 140, 220, 0.2)" : "rgba(0, 0, 0, 0.08)";
  const tooltipText = isDark ? "#e2e8f4" : "#0f172a";

  const buckets = useMemo<WeekBucket[]>(() => {
    const divisor = distanceUnit === "km" ? 1000 : 1609.344;
    const byWeek = new Map<string, { start: Date; distances: number[] }>();

    for (const activity of activities) {
      const ts = new Date(activity.start_ts_utc);
      if (Number.isNaN(ts.getTime())) continue;
      const wk = startOfWeek(ts);
      const key = toDateKey(wk);
      const existing = byWeek.get(key) ?? { start: wk, distances: [] };
      existing.distances.push(activity.distance_m / divisor);
      byWeek.set(key, existing);
    }

    if (byWeek.size === 0) return [];

    const starts = Array.from(byWeek.values()).map((w) => w.start.getTime());
    const minStart = Math.min(...starts);
    const maxStart = Math.max(...starts);

    // Walk every Monday in the range so weeks without runs keep their slot
    // instead of collapsing the timeline.
    const result: WeekBucket[] = [];
    const cursor = new Date(minStart);
    const end = new Date(maxStart);
    while (cursor.getTime() <= end.getTime()) {
      const start = new Date(cursor);
      const key = toDateKey(start);
      const distances = byWeek.get(key)?.distances ?? [];
      const total = distances.reduce((sum, d) => sum + d, 0);
      const longest = distances.length > 0 ? Math.max(...distances) : 0;
      result.push({
        key,
        start,
        label: start.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
        total,
        longest,
        rest: total - longest,
        runCount: distances.length,
      });
      cursor.setDate(cursor.getDate() + 7);
    }
    return result;
  }, [activities, distanceUnit]);

  const zeroPoints = useMemo<ScatterPoint[]>(
    () =>
      buckets.flatMap((bucket, index) =>
        bucket.total <= 0
          ? [{
              value: [index, 0] as [number, number],
              weekIndex: index,
              itemStyle: {
                borderColor: bucket.key === selectedWeekStart ? "#facc15" : "transparent",
                borderWidth: bucket.key === selectedWeekStart ? 2 : 0,
              },
            }]
          : [],
      ),
    [buckets, selectedWeekStart],
  );

  const onEvents = useMemo(
    () => ({
      click: (params: any) => {
        const index =
          typeof params?.data?.weekIndex === "number"
            ? params.data.weekIndex
            : params?.dataIndex;
        if (typeof index !== "number") return;
        const bucket = buckets[index];
        if (!bucket) return;
        onSelectWeek?.(bucket.key === selectedWeekStart ? null : bucket.key);
      },
    }),
    [buckets, onSelectWeek, selectedWeekStart],
  );

  const option = {
    tooltip: {
      trigger: "axis",
      backgroundColor: tooltipBg,
      borderColor: tooltipBorder,
      textStyle: { color: tooltipText, fontSize: 12 },
      formatter: (params: any) => {
        const list = Array.isArray(params) ? params : [params];
        const index =
          typeof list[0]?.data?.weekIndex === "number"
            ? list[0].data.weekIndex
            : list[0]?.dataIndex;
        const bucket = typeof index === "number" ? buckets[index] : undefined;
        if (!bucket) return "";
        const title = bucket.start.toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        });
        if (bucket.total <= 0) {
          return `<div style="font-weight:700;margin-bottom:2px">${title}</div><div>${t("trend.noRuns")}</div>`;
        }
        return [
          `<div style="font-weight:700;margin-bottom:4px">${title}</div>`,
          `<div>${t("trend.total")}: <strong>${bucket.total.toFixed(2)} ${distanceUnit}</strong></div>`,
          `<div>${t("trend.longestRun")}: <strong>${bucket.longest.toFixed(2)} ${distanceUnit}</strong></div>`,
          `<div>${t("trend.otherRuns")}: <strong>${bucket.rest.toFixed(2)} ${distanceUnit}</strong></div>`,
          `<div>${bucket.runCount} ${bucket.runCount === 1 ? t("heatmap.activity") : t("heatmap.activities")}</div>`,
        ].join("");
      },
    },
    grid: { left: 52, right: 16, top: 42, bottom: 46 },
    xAxis: {
      type: "category",
      data: buckets.map((b) => b.label),
      axisLabel: { color: axisColor, fontSize: 11, rotate: 30, hideOverlap: true },
      axisLine: { lineStyle: { color: gridLine } },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      name: distanceUnit,
      axisLabel: { color: axisColor, fontSize: 11 },
      nameTextStyle: { color: axisColor, fontSize: 11 },
      splitLine: { lineStyle: { color: gridLine } },
    },
    series: [
      {
        name: t("trend.longestRun"),
        type: "bar",
        stack: "week",
        barMaxWidth: 48,
        barCategoryGap: "20%",
        itemStyle: { color: "#22d3ee" },
        emphasis: { focus: "series" },
        label: {
          show: true,
          position: "top",
          color: axisColor,
          fontSize: 14,
          fontWeight: 600,
          formatter: (params: any) => {
            const index =
              typeof params?.data?.weekIndex === "number"
                ? params.data.weekIndex
                : params?.dataIndex;
            const bucket = typeof index === "number" ? buckets[index] : undefined;
            // Only the longest segment carries the total when there is no
            // "other runs" segment above it.
            return bucket && bucket.total > 0 && bucket.rest <= 0
              ? bucket.total.toFixed(1)
              : "";
          },
        },
        labelLayout: { hideOverlap: true },
        data: buckets.map((b, index) => ({
          value: b.longest,
          weekIndex: index,
          itemStyle: {
            borderColor: b.key === selectedWeekStart ? "#facc15" : "transparent",
            borderWidth: b.key === selectedWeekStart ? 2 : 0,
          },
        })),
      },
      {
        name: t("trend.otherRuns"),
        type: "bar",
        stack: "week",
        barMaxWidth: 48,
        itemStyle: { color: "#06b6d4", borderRadius: [4, 4, 0, 0] },
        emphasis: { focus: "series" },
        label: {
          show: true,
          position: "top",
          color: axisColor,
          fontSize: 14,
          fontWeight: 600,
          formatter: (params: any) => {
            const index =
              typeof params?.data?.weekIndex === "number"
                ? params.data.weekIndex
                : params?.dataIndex;
            const bucket = typeof index === "number" ? buckets[index] : undefined;
            return bucket && bucket.total > 0 && bucket.rest > 0
              ? bucket.total.toFixed(1)
              : "";
          },
        },
        labelLayout: { hideOverlap: true },
        data: buckets.map((b, index) => ({
          value: b.rest,
          weekIndex: index,
          itemStyle: {
            borderColor: b.key === selectedWeekStart ? "#facc15" : "transparent",
            borderWidth: b.key === selectedWeekStart ? 2 : 0,
          },
        })),
      },
      {
        // Visible marker for weeks with no runs.
        name: t("trend.noRuns"),
        type: "scatter",
        symbolSize: 7,
        tooltip: { show: false },
        itemStyle: { color: axisColor, opacity: 0.7 },
        data: zeroPoints,
        z: 3,
      },
    ],
  };

  return (
    <div className="panel overview-weekly-trend-panel">
      <div className="overview-weekly-trend-head">
        <h3>{t("trend.weeklyTrainingTrend")}</h3>
        {selectedWeekStart && (
          <button
            type="button"
            className="overview-week-clear"
            onClick={() => onSelectWeek?.(null)}
          >
            {t("trend.showWholePeriod")}
          </button>
        )}
      </div>
      <div className="overview-weekly-trend-chart">
        <ReactECharts
          option={option}
          notMerge
          onEvents={onEvents}
          style={{ height: "100%", width: "100%" }}
        />
      </div>
    </div>
  );
}

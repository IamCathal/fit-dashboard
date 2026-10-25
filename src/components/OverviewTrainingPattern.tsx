import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import type { Activity } from "../types";
import { useTranslation } from "../lib/i18n";

type Props = {
  activities: Activity[];
  theme: "light" | "dark" | "paper" | "paper-dark";
};

type TimeBucket = "morning" | "afternoon" | "evening" | "night";

const DAY_KEYS = [
  "pattern.mon",
  "pattern.tue",
  "pattern.wed",
  "pattern.thu",
  "pattern.fri",
  "pattern.sat",
  "pattern.sun",
];

const BUCKETS: { key: TimeBucket; labelKey: string; color: string }[] = [
  { key: "morning", labelKey: "pattern.morning", color: "#f59e0b" },
  { key: "afternoon", labelKey: "pattern.afternoon", color: "#06b6d4" },
  { key: "evening", labelKey: "pattern.evening", color: "#a855f7" },
  { key: "night", labelKey: "pattern.night", color: "#3b82f6" },
];

function bucketForHour(hour: number): TimeBucket {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

export function OverviewTrainingPattern({ activities, theme }: Props) {
  const isDark = theme === "dark" || theme === "paper-dark";
  const { t } = useTranslation();
  const axisColor = isDark ? "#a1a1aa" : "#475569";
  const gridLine = isDark ? "rgba(100, 140, 220, 0.08)" : "rgba(0, 0, 0, 0.06)";
  const tooltipBg = isDark ? "rgba(14, 22, 45, 0.95)" : "rgba(255, 255, 255, 0.95)";
  const tooltipBorder = isDark ? "rgba(100, 140, 220, 0.2)" : "rgba(0, 0, 0, 0.08)";
  const tooltipText = isDark ? "#e2e8f4" : "#0f172a";

  const { dayLabels, seriesData } = useMemo(() => {
    // counts[dayIndex][bucket]
    const counts: Record<TimeBucket, number[]> = {
      morning: [0, 0, 0, 0, 0, 0, 0],
      afternoon: [0, 0, 0, 0, 0, 0, 0],
      evening: [0, 0, 0, 0, 0, 0, 0],
      night: [0, 0, 0, 0, 0, 0, 0],
    };

    for (const activity of activities) {
      const ts = new Date(activity.start_ts_utc);
      if (Number.isNaN(ts.getTime())) continue;
      // Monday = 0 ... Sunday = 6
      const dayIndex = (ts.getDay() + 6) % 7;
      const bucket = bucketForHour(ts.getHours());
      counts[bucket][dayIndex] += 1;
    }

    return {
      dayLabels: DAY_KEYS.map((key) => t(key)),
      seriesData: BUCKETS.map((b) => ({
        ...b,
        data: counts[b.key],
      })),
    };
  }, [activities, t]);

  const option = {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: tooltipBg,
      borderColor: tooltipBorder,
      textStyle: { color: tooltipText, fontSize: 12 },
    },
    legend: {
      bottom: 0,
      textStyle: { color: axisColor, fontSize: 11 },
      itemWidth: 10,
      itemHeight: 10,
    },
    grid: { left: 8, right: 8, top: 12, bottom: 44, containLabel: true },
    xAxis: {
      type: "category",
      data: dayLabels,
      axisLabel: { color: axisColor, fontSize: 11 },
      axisLine: { lineStyle: { color: gridLine } },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      axisLabel: { color: axisColor, fontSize: 11 },
      splitLine: { lineStyle: { color: gridLine } },
    },
    series: seriesData.map((s) => ({
      name: t(s.labelKey),
      type: "bar",
      stack: "total",
      barMaxWidth: 26,
      itemStyle: { color: s.color },
      emphasis: { focus: "series" },
      data: s.data,
    })),
  };

  return (
    <div className="panel overview-training-pattern-panel">
      <h3>{t("pattern.title")}</h3>
      <ReactECharts option={option} notMerge style={{ height: 240, width: "100%" }} />
    </div>
  );
}

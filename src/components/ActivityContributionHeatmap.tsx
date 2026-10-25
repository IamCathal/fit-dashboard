import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Activity } from "../types";
import { useTranslation } from "../lib/i18n";
import { useSettingsStore } from "../stores/settingsStore";
import { distanceDivisor, distanceLabel } from "../lib/units";

type Props = {
  activities: Activity[];
  onSelectActivity?: (activity: Activity) => void;
};

type AnchorState = {
  key: string;
  x: number;
  y: number;
};

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

function formatDuration(seconds: number): string {
  const total = Math.round(Math.max(0, seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ActivityContributionHeatmap({ activities, onSelectActivity }: Props) {
  const { t, language } = useTranslation();
  const distanceUnit = useSettingsStore((s) => s.distanceUnit);
  const [hover, setHover] = useState<AnchorState | null>(null);
  const [pinned, setPinned] = useState<AnchorState | null>(null);

  const { weeks, daysByKey, maxCount, startDate, endDate } = useMemo(() => {
    const today = startOfDay(new Date());
    const rangeStart = addDays(today, -364);

    const grouped = new Map<string, Activity[]>();
    for (const a of activities) {
      const dt = new Date(a.start_ts_utc);
      if (Number.isNaN(dt.getTime())) continue;
      const key = toDateKey(startOfDay(dt));
      const existing = grouped.get(key);
      if (existing) existing.push(a);
      else grouped.set(key, [a]);
    }

    const gridStart = addDays(rangeStart, -rangeStart.getDay());
    const gridEnd = addDays(today, 6 - today.getDay());

    const days: Date[] = [];
    for (let d = new Date(gridStart); d <= gridEnd; d = addDays(d, 1)) {
      days.push(new Date(d));
    }

    const weekChunks: Date[][] = [];
    for (let i = 0; i < days.length; i += 7) {
      weekChunks.push(days.slice(i, i + 7));
    }

    let peak = 0;
    for (const value of grouped.values()) {
      if (value.length > peak) peak = value.length;
    }

    return {
      weeks: weekChunks,
      daysByKey: grouped,
      maxCount: peak,
      startDate: rangeStart,
      endDate: today,
    };
  }, [activities]);

  useEffect(() => {
    if (!pinned) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".overview-heatmap-tooltip, .overview-heatmap-weeks .overview-heatmap-cell")) {
        return;
      }
      setPinned(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPinned(null);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [pinned]);

  const cellColor = (count: number): string => {
    if (count <= 0) return "rgba(148, 163, 184, 0.20)";
    const ratio = maxCount > 0 ? count / maxCount : 0;
    if (ratio < 0.25) return "#155e75";
    if (ratio < 0.5) return "#0891b2";
    if (ratio < 0.75) return "#06b6d4";
    return "#22d3ee";
  };

  const rangeLabel = `${startDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} - ${endDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`;

  const active = hover ?? pinned;
  const activeDate = active ? new Date(`${active.key}T00:00:00`) : null;
  const activeActivities = active ? (daysByKey.get(active.key) ?? []) : [];
  const activeCount = activeActivities.length;
  const activeDistance = activeActivities.reduce((sum, a) => sum + (a.distance_m || 0), 0);
  const activeDuration = activeActivities.reduce((sum, a) => sum + (a.duration_s || 0), 0);

  const sportCounts = new Map<string, number>();
  for (const a of activeActivities) {
    const sport = a.sport?.trim() || "—";
    sportCounts.set(sport, (sportCounts.get(sport) ?? 0) + 1);
  }
  const sortedSports = Array.from(sportCounts.entries()).sort((a, b) => b[1] - a[1]);

  const tooltipWidth = 280;
  const tooltipLeft = active
    ? active.x + 14 + tooltipWidth > window.innerWidth
      ? Math.max(8, active.x - tooltipWidth - 14)
      : active.x + 14
    : 0;
  const tooltipTop = active ? Math.max(8, Math.min(active.y, window.innerHeight - 360)) : 0;

  const handleCellClick = (key: string, cell: HTMLElement) => {
    const dayActivities = daysByKey.get(key) ?? [];
    setHover(null);
    if (dayActivities.length === 0) {
      setPinned(null);
      return;
    }
    const rect = cell.getBoundingClientRect();
    setPinned((current) =>
      current?.key === key ? null : { key, x: rect.right, y: rect.top }
    );
  };

  const handleActivityClick = (activity: Activity) => {
    setPinned(null);
    setHover(null);
    onSelectActivity?.(activity);
  };

  return (
    <div className="panel overview-activity-contribution-panel">
      <div className="overview-heatmap-head">
        <h3>{t("heatmap.activityContributions")}</h3>
        <span className="small">{rangeLabel}</span>
      </div>
      <div className="overview-heatmap-wrap">
        <div className="overview-heatmap-grid">
          <div className="overview-heatmap-months">
            {weeks.map((week, i) => {
              const d = week[0];
              const showMonth = d.getDate() <= 7;
              return (
                <div key={i} className="overview-heatmap-month">
                  {showMonth ? d.toLocaleDateString("en-US", { month: "short" }) : ""}
                </div>
              );
            })}
          </div>

          <div className="overview-heatmap-body">
            <div className="overview-heatmap-daylabels">
              <span>{t("heatmap.mon")}</span>
              <span>{t("heatmap.wed")}</span>
              <span>{t("heatmap.fri")}</span>
            </div>
            <div className="overview-heatmap-weeks">
              {weeks.map((week, wi) => (
                <div key={wi} className="overview-heatmap-week">
                  {week.map((d) => {
                    const key = toDateKey(d);
                    const count = daysByKey.get(key)?.length ?? 0;
                    const isActive = active?.key === key;
                    const isPinned = pinned?.key === key;
                    return (
                      <div
                        key={key}
                        className={`overview-heatmap-cell${isActive ? " is-hovered" : ""}${isPinned ? " is-pinned" : ""}`}
                        aria-label={`${d.toDateString()} - ${count} ${count === 1 ? t("heatmap.activity") : t("heatmap.activities")}`}
                        style={{ backgroundColor: cellColor(count) }}
                        onMouseEnter={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setHover({ key, x: rect.right, y: rect.top });
                        }}
                        onMouseLeave={() => setHover(null)}
                        onClick={(e) => handleCellClick(key, e.currentTarget)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="overview-heatmap-legend small">
        <span>{t("heatmap.less")}</span>
        <div className="overview-heatmap-cell" style={{ backgroundColor: "rgba(148, 163, 184, 0.20)" }} />
        <div className="overview-heatmap-cell" style={{ backgroundColor: "#155e75" }} />
        <div className="overview-heatmap-cell" style={{ backgroundColor: "#0891b2" }} />
        <div className="overview-heatmap-cell" style={{ backgroundColor: "#06b6d4" }} />
        <div className="overview-heatmap-cell" style={{ backgroundColor: "#22d3ee" }} />
        <span>{t("heatmap.more")}</span>
      </div>

      {active && activeDate && createPortal(
        <div
          className={`overview-heatmap-tooltip${pinned ? " is-pinned" : ""}`}
          style={{
            left: tooltipLeft,
            top: tooltipTop,
            width: tooltipWidth,
            pointerEvents: pinned ? "auto" : "none",
          }}
          role="tooltip"
        >
          <div className="overview-heatmap-tooltip-date">
            {activeDate.toLocaleDateString(language, {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </div>
          <div className="overview-heatmap-tooltip-count">
            {activeCount} {activeCount === 1 ? t("heatmap.activity") : t("heatmap.activities")}
          </div>
          {activeCount > 0 && (
            <>
              <div className="overview-heatmap-tooltip-stats">
                <div>
                  <span>{t("overview.totalDistance")}</span>
                  <strong>
                    {(activeDistance / distanceDivisor(distanceUnit)).toFixed(1)}{" "}
                    {distanceLabel(distanceUnit)}
                  </strong>
                </div>
                <div>
                  <span>{t("overview.totalDuration")}</span>
                  <strong>{formatDuration(activeDuration)}</strong>
                </div>
              </div>
              {sortedSports.length > 0 && (
                <div className="overview-heatmap-tooltip-sports">
                  {sortedSports.map(([sport, sportCount]) => (
                    <span key={sport} className="overview-heatmap-sport-chip">
                      {sport}
                      <em>{sportCount}</em>
                    </span>
                  ))}
                </div>
              )}
              <ul className="overview-heatmap-tooltip-list">
                {activeActivities.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      className="overview-heatmap-activity-btn"
                      disabled={!onSelectActivity}
                      onClick={() => handleActivityClick(a)}
                    >
                      <span className="overview-heatmap-tooltip-name">
                        {a.activity_name?.trim() || a.sport || "—"}
                      </span>
                      <span className="overview-heatmap-tooltip-meta">
                        {(a.distance_m / distanceDivisor(distanceUnit)).toFixed(2)}{" "}
                        {distanceLabel(distanceUnit)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

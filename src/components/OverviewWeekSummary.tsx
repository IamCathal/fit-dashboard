import { useEffect, useMemo, useRef, useState } from "react";
import type { Activity } from "../types";
import { useTranslation } from "../lib/i18n";
import { distanceDivisor, distanceLabel } from "../lib/units";
import { api } from "../lib/api";
import { RunRoutePreview } from "./RunRoutePreview";

type Props = {
  weekStart: string;
  activities: Activity[];
  distanceUnit: "km" | "mi";
  onSelectActivity?: (activity: Activity) => void;
  onClear: () => void;
};

/** Coarse resolution is plenty for a thumbnail-sized route preview. */
const PREVIEW_RESOLUTION_MS = 30_000;
const PREVIEW_ROUTE_LIMIT = 200;

function formatDuration(seconds: number): string {
  const total = Math.round(Math.max(0, seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatPace(secondsPerUnit: number, unit: "km" | "mi"): string {
  if (!Number.isFinite(secondsPerUnit) || secondsPerUnit <= 0) return "—";
  const m = Math.floor(secondsPerUnit / 60);
  const s = Math.floor(secondsPerUnit % 60);
  return `${m}:${String(s).padStart(2, "0")} /${unit}`;
}

const SPORT_COLORS: Record<string, string> = {
  run: "#ec4899",
  jog: "#ec4899",
  ride: "#f59e0b",
  bike: "#f59e0b",
  cycl: "#f59e0b",
  walk: "#a3e635",
  hike: "#a3e635",
  swim: "#38bdf8",
};

function colorForSport(sport: string): string {
  const value = sport.toLowerCase();
  for (const [keyword, color] of Object.entries(SPORT_COLORS)) {
    if (value.includes(keyword)) return color;
  }
  return "var(--accent)";
}

export function OverviewWeekSummary({
  weekStart,
  activities,
  distanceUnit,
  onSelectActivity,
  onClear,
}: Props) {
  const { t } = useTranslation();
  const start = new Date(`${weekStart}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);

  const totalDistance = activities.reduce((sum, a) => sum + (a.distance_m || 0), 0);
  const totalDuration = activities.reduce((sum, a) => sum + (a.duration_s || 0), 0);
  const sorted = useMemo(
    () =>
      [...activities].sort(
        (a, b) => Date.parse(a.start_ts_utc) - Date.parse(b.start_ts_utc),
      ),
    [activities],
  );

  const [routes, setRoutes] = useState<Record<number, [number, number][]>>({});
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  const routeCacheRef = useRef<Map<number, [number, number][]>>(new Map());

  // Fetch the week's GPS tracks in a single bulk request and cache them so
  // switching weeks back and forth does not refetch the same routes.
  useEffect(() => {
    const ids = activities.map((activity) => activity.id);
    if (ids.length === 0) {
      setRoutes({});
      setLoadingRoutes(false);
      return;
    }

    let cancelled = false;
    const cache = routeCacheRef.current;
    const missing = ids.filter((id) => !cache.has(id));

    const publish = () => {
      if (cancelled) return;
      const next: Record<number, [number, number][]> = {};
      for (const id of ids) {
        const coordinates = cache.get(id);
        if (coordinates) next[id] = coordinates;
      }
      setRoutes(next);
    };

    if (missing.length === 0) {
      publish();
      setLoadingRoutes(false);
      return;
    }

    setLoadingRoutes(true);
    // Show any already-cached previews immediately while the rest load.
    publish();
    void (async () => {
      try {
        const fetched = await api.getOverviewRoutes(
          missing,
          PREVIEW_RESOLUTION_MS,
          PREVIEW_ROUTE_LIMIT,
        );
        for (const route of fetched) {
          cache.set(route.id, route.coordinates);
        }
        // Cache empty results so activities without a usable track are not
        // requested again on the next render.
        for (const id of missing) {
          if (!cache.has(id)) cache.set(id, []);
        }
      } catch {
        // Keep whatever is already cached; previews fall back to a placeholder.
      } finally {
        if (!cancelled) {
          publish();
          setLoadingRoutes(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activities]);

  const rangeLabel = `${start.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  })} – ${end.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })}`;

  return (
    <div className="panel overview-week-summary">
      <div className="overview-week-summary-head">
        <div className="overview-week-summary-heading">
          <span className="overview-week-summary-eyebrow">{t("weekSummary.title")}</span>
          <h3>{rangeLabel}</h3>
        </div>
        <button
          type="button"
          className="overview-week-summary-clear"
          onClick={onClear}
          title={t("weekSummary.showWholePeriod")}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
          {t("weekSummary.showWholePeriod")}
        </button>
      </div>

      <div className="overview-week-summary-stats">
        <div>
          <span>{t("overview.totalDistance")}</span>
          <strong>
            {(totalDistance / distanceDivisor(distanceUnit)).toFixed(2)}{" "}
            {distanceLabel(distanceUnit)}
          </strong>
        </div>
        <div>
          <span>{t("overview.totalDuration")}</span>
          <strong>{formatDuration(totalDuration)}</strong>
        </div>
        <div>
          <span>{t("weekSummary.runs")}</span>
          <strong>{activities.length}</strong>
        </div>
      </div>

      <div className="overview-week-summary-list">
        {sorted.length === 0 ? (
          <span className="small">{t("weekSummary.noRuns")}</span>
        ) : (
          sorted.map((activity) => {
            const divisor = distanceDivisor(distanceUnit);
            const distance = activity.distance_m / divisor;
            const pace = activity.distance_m > 0 ? activity.duration_s / distance : 0;
            const coordinates = routes[activity.id] as [number, number][] | undefined;
            const isLoading = loadingRoutes && coordinates === undefined;
            const sportColor = colorForSport(activity.sport || "");

            return (
              <button
                key={activity.id}
                type="button"
                className="overview-week-run-card"
                disabled={!onSelectActivity}
                onClick={() => onSelectActivity?.(activity)}
              >
                <RunRoutePreview
                  coordinates={coordinates ?? []}
                  loading={isLoading}
                  color={sportColor}
                />
                <span className="overview-week-run-chevron" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </span>
                <span className="overview-week-run-card-body">
                  <span className="overview-week-run-card-top">
                    <span className="overview-week-run-date">
                      {new Date(activity.start_ts_utc).toLocaleDateString("en-GB", {
                        weekday: "short",
                        day: "2-digit",
                        month: "short",
                      })}
                    </span>
                    {activity.sport && (
                      <span className="overview-week-run-sport">
                        <span
                          className="overview-week-run-sport-dot"
                          style={{ backgroundColor: sportColor }}
                        />
                        {activity.sport}
                      </span>
                    )}
                  </span>
                  <span className="overview-week-run-name">
                    {activity.activity_name?.trim() || activity.sport || "—"}
                  </span>
                  <span className="overview-week-run-card-meta">
                    <span className="overview-week-run-distance">
                      {distance.toFixed(2)} {distanceLabel(distanceUnit)}
                    </span>
                    <span>{formatDuration(activity.duration_s)}</span>
                    <span>{formatPace(pace, distanceUnit)}</span>
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

import type { Activity } from "../types";
import { useTranslation } from "../lib/i18n";
import { distanceDivisor, distanceLabel } from "../lib/units";

type Props = {
  weekStart: string;
  activities: Activity[];
  distanceUnit: "km" | "mi";
  onSelectActivity?: (activity: Activity) => void;
  onClear: () => void;
};

function formatDuration(seconds: number): string {
  const total = Math.round(Math.max(0, seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
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
  const sorted = [...activities].sort(
    (a, b) => Date.parse(a.start_ts_utc) - Date.parse(b.start_ts_utc),
  );

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
        <div>
          <h3>{t("weekSummary.title")}</h3>
          <span className="small">{rangeLabel}</span>
        </div>
        <button type="button" className="btn-outline-secondary" onClick={onClear}>
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
          sorted.map((activity) => (
            <button
              key={activity.id}
              type="button"
              className="overview-week-run"
              disabled={!onSelectActivity}
              onClick={() => onSelectActivity?.(activity)}
            >
              <span className="overview-week-run-date">
                {new Date(activity.start_ts_utc).toLocaleDateString("en-GB", {
                  weekday: "short",
                  day: "2-digit",
                  month: "short",
                })}
              </span>
              <span className="overview-week-run-name">
                {activity.activity_name?.trim() || activity.sport || "—"}
              </span>
              <span className="overview-week-run-meta">
                {(activity.distance_m / distanceDivisor(distanceUnit)).toFixed(2)}{" "}
                {distanceLabel(distanceUnit)} · {formatDuration(activity.duration_s)}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

import { useMemo } from "react";
import type { Activity } from "../types";
import {
  convertElevationMeters,
  distanceDivisor,
  distanceLabel,
  elevationLabel,
  paceLabel,
  type DistanceUnit,
} from "../lib/units";
import { useTranslation } from "../lib/i18n";

type Props = {
  activities: Activity[];
  distanceUnit: DistanceUnit;
  onSelectActivity?: (activity: Activity) => void;
};

type MetadataLike = {
  session?: {
    total_ascent_m?: number | null;
    total_descent_m?: number | null;
  } | null;
  laps?: Array<{
    total_distance_m?: number | null;
    total_timer_time_s?: number | null;
    total_elapsed_time_s?: number | null;
    total_ascent_m?: number | null;
  }> | null;
};

type EffectiveMetrics = {
  distanceM: number;
  seconds: number;
};

type RecordCard = {
  key: string;
  labelKey: string;
  icon: string;
  value: string;
  sublabel?: string;
  activity: Activity;
};

function parseActivityMetadata(raw?: string): MetadataLike | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function parseUtcDate(input: string): Date {
  const trimmed = input.trim();
  const normalized = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
  const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(normalized);
  return new Date(hasZone ? normalized : `${normalized}Z`);
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatPace(secondsPerUnit: number, unit: DistanceUnit): string {
  if (!Number.isFinite(secondsPerUnit) || secondsPerUnit <= 0) return "-";
  const m = Math.floor(secondsPerUnit / 60);
  const s = Math.floor(secondsPerUnit % 60);
  return `${m}:${String(s).padStart(2, "0")} /${distanceLabel(unit)}`;
}

function formatDate(input: string): string {
  const date = parseUtcDate(input);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Garmin names many activities like "Gaillimh, Connaught - Running". Since this
 * fork is running-only, drop the trailing sport suffix for a cleaner display.
 */
function cleanActivityName(activity: Activity): string {
  const raw = (activity.activity_name?.trim() || activity.file_name).trim();
  const cleaned = raw
    .replace(/\s*[-–—]\s*(running|run|jogging|jog)\s*$/i, "")
    .replace(/\s*[-–—]\s*$/i, "")
    .trim();
  return cleaned || raw;
}

/**
 * Prefer the watch's moving/timer time and summed lap distance when available.
 * Elapsed activity duration includes pauses, which would unfairly slow down a
 * "fastest 5K" estimate.
 */
function effectiveMetrics(activity: Activity, metadata: MetadataLike | null): EffectiveMetrics {
  const laps = metadata?.laps ?? [];
  let lapDistanceM = 0;
  let lapSeconds = 0;
  for (const lap of laps) {
    if (typeof lap.total_distance_m === "number") lapDistanceM += lap.total_distance_m;
    const lapTime = typeof lap.total_timer_time_s === "number"
      ? lap.total_timer_time_s
      : (typeof lap.total_elapsed_time_s === "number" ? lap.total_elapsed_time_s : null);
    if (typeof lapTime === "number") lapSeconds += Math.max(0, lapTime);
  }
  if (lapDistanceM > 0 && lapSeconds > 0) {
    return { distanceM: lapDistanceM, seconds: lapSeconds };
  }
  return { distanceM: activity.distance_m, seconds: activity.duration_s };
}

function totalAscent(metadata: MetadataLike | null): number | null {
  const laps = metadata?.laps ?? [];
  let lapAscent = 0;
  let hasLapAscent = false;
  for (const lap of laps) {
    if (typeof lap.total_ascent_m === "number") {
      lapAscent += lap.total_ascent_m;
      hasLapAscent = true;
    }
  }
  if (hasLapAscent) return lapAscent;
  if (typeof metadata?.session?.total_ascent_m === "number") {
    return metadata.session.total_ascent_m;
  }
  return null;
}

function RecordIcon({ icon }: { icon: string }) {
  const props = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (icon === "climb") {
    return <svg {...props}><path d="m8 3 4 8 5-5 5 15H2L8 3z" /></svg>;
  }
  if (icon === "duration") {
    return <svg {...props}><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></svg>;
  }
  if (icon === "longest") {
    return <svg {...props}><circle cx="6" cy="19" r="2" /><circle cx="18" cy="5" r="2" /><path d="M8 19h6a4 4 0 0 0 0-8H10a4 4 0 0 1 0-8h2" /></svg>;
  }
  // Race distance (stopwatch)
  return (
    <svg {...props}>
      <circle cx="12" cy="13" r="8" />
      <line x1="12" y1="13" x2="12" y2="9" />
      <line x1="9" y1="2" x2="15" y2="2" />
      <line x1="12" y1="2" x2="12" y2="5" />
    </svg>
  );
}

const RACE_TARGETS = [
  { key: "records.fastest5k", meters: 5000 },
  { key: "records.fastest10k", meters: 10000 },
  { key: "records.fastestHalf", meters: 21097.5 },
  { key: "records.fastestMarathon", meters: 42195 },
];

export function OverviewPersonalRecords({ activities, distanceUnit, onSelectActivity }: Props) {
  const { t } = useTranslation();

  const cards = useMemo<RecordCard[]>(() => {
    const divisor = distanceDivisor(distanceUnit);
    const unitMeters = divisor;
    const prepared = activities.map((activity) => {
      const metadata = parseActivityMetadata(activity.metadata_json);
      return {
        activity,
        metadata,
        effective: effectiveMetrics(activity, metadata),
        ascent: totalAscent(metadata),
      };
    });

    const out: RecordCard[] = [];

    for (const target of RACE_TARGETS) {
      let best: { activity: Activity; estimatedSeconds: number; paceSecPerUnit: number } | null = null;
      for (const entry of prepared) {
        const { activity, effective } = entry;
        // Qualify using the activity's reported distance (GPS/rounding can make
        // summed lap distance slightly shorter), but estimate with the moving
        // time and distance from the laps where available.
        if (!(activity.distance_m >= target.meters * 0.999) || !(effective.distanceM > 0) || !(effective.seconds > 0)) continue;
        const estimatedSeconds = effective.seconds * (target.meters / effective.distanceM);
        if (!Number.isFinite(estimatedSeconds) || estimatedSeconds <= 0) continue;
        if (!best || estimatedSeconds < best.estimatedSeconds) {
          best = {
            activity,
            estimatedSeconds,
            paceSecPerUnit: estimatedSeconds / (target.meters / unitMeters),
          };
        }
      }
      if (best) {
        out.push({
          key: target.key,
          labelKey: target.key,
          icon: "race",
          value: formatDuration(best.estimatedSeconds),
          sublabel: formatPace(best.paceSecPerUnit, distanceUnit),
          activity: best.activity,
        });
      }
    }

    const longest = prepared.reduce<(typeof prepared)[number] | null>(
      (best, entry) => (!best || entry.activity.distance_m > best.activity.distance_m ? entry : best),
      null,
    );
    if (longest && longest.activity.distance_m > 0) {
      out.push({
        key: "records.longestRun",
        labelKey: "records.longestRun",
        icon: "longest",
        value: `${(longest.activity.distance_m / divisor).toFixed(2)} ${distanceLabel(distanceUnit)}`,
        sublabel: formatDuration(longest.activity.duration_s),
        activity: longest.activity,
      });
    }

    const longestDuration = prepared.reduce<(typeof prepared)[number] | null>(
      (best, entry) => (!best || entry.activity.duration_s > best.activity.duration_s ? entry : best),
      null,
    );
    if (longestDuration && longestDuration.activity.duration_s > 0) {
      out.push({
        key: "records.longestDuration",
        labelKey: "records.longestDuration",
        icon: "duration",
        value: formatDuration(longestDuration.activity.duration_s),
        sublabel: `${(longestDuration.activity.distance_m / divisor).toFixed(2)} ${distanceLabel(distanceUnit)}`,
        activity: longestDuration.activity,
      });
    }

    const biggestClimb = prepared.reduce<(typeof prepared)[number] | null>(
      (best, entry) => {
        if (entry.ascent == null || entry.ascent <= 0) return best;
        if (!best || (best.ascent ?? 0) < entry.ascent) return entry;
        return best;
      },
      null,
    );
    if (biggestClimb && biggestClimb.ascent != null && biggestClimb.ascent > 0) {
      out.push({
        key: "records.biggestClimb",
        labelKey: "records.biggestClimb",
        icon: "climb",
        value: `${Math.round(convertElevationMeters(biggestClimb.ascent, distanceUnit))} ${elevationLabel(distanceUnit)}`,
        sublabel: `${(biggestClimb.activity.distance_m / divisor).toFixed(2)} ${distanceLabel(distanceUnit)}`,
        activity: biggestClimb.activity,
      });
    }

    return out;
  }, [activities, distanceUnit]);

  if (!cards.length) return null;

  return (
    <div className="panel overview-records-panel">
      <div className="overview-records-head">
        <h3>{t("records.title")}</h3>
        <span className="overview-records-hint">{t("records.hint")}</span>
      </div>
      <div className="overview-records-grid">
        {cards.map((card) => {
          const name = cleanActivityName(card.activity);
          const date = formatDate(card.activity.start_ts_utc);
          return (
            <button
              key={card.key}
              type="button"
              className="record-card"
              onClick={() => onSelectActivity?.(card.activity)}
              disabled={!onSelectActivity}
              title={`${name}${date ? ` · ${date}` : ""}`}
            >
              <span className="record-icon"><RecordIcon icon={card.icon} /></span>
              <span className="record-label">{t(card.labelKey)}</span>
              <span className="record-value">{card.value}</span>
              {card.sublabel && <span className="record-sub">{card.sublabel}</span>}
              {date && <span className="record-date">{date}</span>}
              <span className="record-name">{name}</span>
            </button>
          );
        })}
      </div>
      <span className="overview-records-footnote">{t("records.estimatedFootnote", { pace: paceLabel(distanceUnit) })}</span>
    </div>
  );
}

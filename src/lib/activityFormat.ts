import type { RecordPoint } from "../types";

export type ActivityMetadata = {
  heart_rate_zone_bounds_bpm?: number[];
  file_id?: {
    product_name?: string | null;
    serial_number?: number | null;
  };
  activity_metrics?: {
    vo2_max?: number | null;
  };
  session?: {
    beginning_body_battery?: number | null;
    ending_body_battery?: number | null;
    max_heart_rate?: number | null;
    avg_heart_rate?: number | null;
    max_cadence?: number | null;
    avg_cadence?: number | null;
    total_elapsed_time_s?: number | null;
    total_distance_m?: number | null;
    total_calories?: number | null;
  };
  laps?: Array<{
    start_ts_utc?: string | null;
    end_ts_utc?: string | null;
    total_elapsed_time_s?: number | null;
    total_timer_time_s?: number | null;
    total_distance_m?: number | null;
    avg_speed_m_s?: number | null;
    max_speed_m_s?: number | null;
    avg_heart_rate?: number | null;
    max_heart_rate?: number | null;
    total_ascent_m?: number | null;
    total_descent_m?: number | null;
    avg_cadence?: number | null;
    max_cadence?: number | null;
    total_calories?: number | null;
    best_speed_m_s?: number | null;
  }>;
};

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatPace(secondsPerUnit: number, unit: string): string {
  if (!Number.isFinite(secondsPerUnit) || secondsPerUnit <= 0) return "-";
  const min = Math.floor(secondsPerUnit / 60);
  const sec = Math.floor(secondsPerUnit % 60);
  return `${min}:${String(sec).padStart(2, "0")} /${unit}`;
}

export function shortenFileName(name: string, maxLength = 45): string {
  if (name.length <= maxLength) return name;
  return `${name.slice(0, maxLength)}...`;
}

export function parseActivityMetadata(raw?: string): ActivityMetadata | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ActivityMetadata;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function computeRecordStats(records: RecordPoint[]) {
  let maxSpeed = 0, totalSpeed = 0, speedCount = 0;
  let maxHr = 0, totalHr = 0, hrCount = 0;
  let maxAlt = -Infinity;
  let maxPower = 0, totalPower = 0, powerCount = 0;

  for (const r of records) {
    if (typeof r.speed_m_s === "number") {
      const kmh = r.speed_m_s * 3.6;
      totalSpeed += kmh; speedCount++;
      if (kmh > maxSpeed) maxSpeed = kmh;
    }
    if (typeof r.heart_rate === "number") {
      totalHr += r.heart_rate; hrCount++;
      if (r.heart_rate > maxHr) maxHr = r.heart_rate;
    }
    if (typeof r.altitude_m === "number" && r.altitude_m > maxAlt) maxAlt = r.altitude_m;
    if (typeof r.power === "number") {
      totalPower += r.power; powerCount++;
      if (r.power > maxPower) maxPower = r.power;
    }
  }

  return {
    avgSpeed: speedCount > 0 ? totalSpeed / speedCount : 0,
    maxSpeed,
    avgHr: hrCount > 0 ? totalHr / hrCount : 0,
    maxHr,
    maxAlt: maxAlt === -Infinity ? 0 : maxAlt,
    avgPower: powerCount > 0 ? totalPower / powerCount : 0,
    maxPower,
  };
}

export function parseUtcDate(input: string): Date {
  const trimmed = input.trim();
  const normalized = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
  const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(normalized);
  return new Date(hasZone ? normalized : `${normalized}Z`);
}

export function formatDate(input: string): string {
  const date = parseUtcDate(input);
  if (Number.isNaN(date.getTime())) return input;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).replace(/^(\d{2}\s+[A-Za-z]{3})\s+(\d{4})$/, "$1, $2");
}

export function formatDateShort(input: string): string {
  return formatDate(input);
}

export function formatTimeShort(input: string, timeFormat: "12h" | "24h"): string {
  const date = parseUtcDate(input);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: timeFormat === "12h" });
}

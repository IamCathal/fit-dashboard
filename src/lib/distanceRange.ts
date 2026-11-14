import type { RecordPoint } from "../types";

/** A contiguous distance window (metres) along an activity, e.g. one split. */
export type DistanceRange = { startM: number; endM: number };

/**
 * Translate a distance range (metres) into an elapsed-time window relative to
 * the first record, so time-axis charts can shade the matching section.
 *
 * Returns `null` when the range is missing or cannot be mapped onto the
 * records. When a boundary cannot be located the window is clamped to the
 * start/end of the activity, matching the behaviour historically duplicated in
 * the chart components.
 */
export function distanceRangeToTimeRange(
  records: RecordPoint[],
  range: DistanceRange | null | undefined,
): { startMs: number; endMs: number } | null {
  if (!range || !records.length) return null;

  const t0 = records[0].timestamp_ms;
  const totalDurationMs = Math.max(0, records[records.length - 1].timestamp_ms - t0);
  const { startM, endM } = range;

  let startMs: number | null = null;
  let endMs: number | null = null;
  for (const record of records) {
    if (typeof record.distance_m !== "number") continue;
    if (startMs === null && record.distance_m >= startM) startMs = record.timestamp_ms - t0;
    if (record.distance_m >= endM) {
      endMs = record.timestamp_ms - t0;
      break;
    }
  }

  if (startMs === null) startMs = 0;
  if (endMs === null) endMs = totalDurationMs;
  if (endMs <= startMs) return null;

  return { startMs, endMs };
}

/**
 * Find the first and last record indices whose cumulative distance falls within
 * the given range. Records are expected in chronological order on a monotonic
 * distance axis (the same assumption the map and charts already make).
 *
 * Returns `null` when no usable section exists, so callers can fall back to the
 * full route.
 */
export function indicesForDistanceRange(
  records: RecordPoint[],
  range: DistanceRange | null | undefined,
): { startIdx: number; endIdx: number } | null {
  if (!range || !records.length) return null;

  let startIdx = -1;
  for (let i = 0; i < records.length; i += 1) {
    const distance = records[i].distance_m;
    if (typeof distance === "number" && distance >= range.startM) {
      startIdx = i;
      break;
    }
  }

  let endIdx = -1;
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const distance = records[i].distance_m;
    if (typeof distance === "number" && distance <= range.endM) {
      endIdx = i;
      break;
    }
  }

  if (startIdx < 0 || endIdx <= startIdx) return null;
  return { startIdx, endIdx };
}

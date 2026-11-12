import { useId, useMemo } from "react";

type Props = {
  /** `[longitude, latitude]` pairs in chronological order. */
  coordinates: [number, number][];
  loading?: boolean;
  className?: string;
  /** Optional route color, e.g. derived from the activity's sport. */
  color?: string;
};

const VIEW_W = 100;
const VIEW_H = 62.5;
const PADDING = 10;

type ProjectedPoint = { x: number; y: number };

/**
 * Project a lon/lat track into the preview viewBox while preserving its aspect
 * ratio. Longitude is scaled by cos(latitude) so routes near the poles are not
 * stretched horizontally.
 */
function projectTrack(coordinates: [number, number][]): ProjectedPoint[] | null {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  for (const [lon, lat] of coordinates) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  if (!Number.isFinite(minLon) || !Number.isFinite(minLat)) return null;

  const centerLon = (minLon + maxLon) / 2;
  const centerLat = (minLat + maxLat) / 2;
  const lonScale = Math.cos((centerLat * Math.PI) / 180);
  const lonSpan = (maxLon - minLon) * lonScale;
  const latSpan = maxLat - minLat;
  const availableW = VIEW_W - PADDING * 2;
  const availableH = VIEW_H - PADDING * 2;
  const scale = Math.min(
    availableW / Math.max(lonSpan, 1e-6),
    availableH / Math.max(latSpan, 1e-6),
  );

  const points: ProjectedPoint[] = [];
  for (const [lon, lat] of coordinates) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    points.push({
      x: VIEW_W / 2 + (lon - centerLon) * lonScale * scale,
      y: VIEW_H / 2 - (lat - centerLat) * scale,
    });
  }
  return points.length > 0 ? points : null;
}

/**
 * A compact, dependency-free preview of an activity's GPS track. It renders a
 * map-like grid background with the route drawn on top, plus start/end markers.
 * Using SVG instead of a full MapLibre instance keeps a list of runs cheap to
 * render and avoids loading map tiles for every card.
 */
export function RunRoutePreview({ coordinates, loading = false, className, color }: Props) {
  const rawId = useId();
  const uid = rawId.replace(/[^a-zA-Z0-9_-]/g, "");
  const bgId = `run-route-bg-${uid}`;
  const gridId = `run-route-grid-${uid}`;
  const vignetteId = `run-route-vignette-${uid}`;
  const routeColor = color ?? "var(--run-preview-route, var(--accent))";

  const points = useMemo(() => projectTrack(coordinates), [coordinates]);

  const path = useMemo(() => {
    if (!points || points.length < 2) return null;
    return points
      .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
      .join(" ");
  }, [points]);

  const start = points?.[0];
  const end = points && points.length > 1 ? points[points.length - 1] : null;

  return (
    <span className={`run-route-preview${className ? ` ${className}` : ""}`}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id={bgId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--run-preview-bg-1, var(--input-bg))" />
            <stop offset="100%" stopColor="var(--run-preview-bg-2, var(--bg-surface))" />
          </linearGradient>
          <pattern id={gridId} width="12.5" height="12.5" patternUnits="userSpaceOnUse">
            <path
              d="M 12.5 0 L 0 0 0 12.5"
              fill="none"
              stroke="var(--run-preview-grid, var(--border))"
              strokeWidth="0.5"
            />
          </pattern>
          <radialGradient id={vignetteId} cx="50%" cy="45%" r="72%">
            <stop offset="55%" stopColor="rgba(0, 0, 0, 0)" />
            <stop offset="100%" stopColor="rgba(0, 0, 0, 0.22)" />
          </radialGradient>
        </defs>

        <rect width={VIEW_W} height={VIEW_H} fill={`url(#${bgId})`} />
        <rect width={VIEW_W} height={VIEW_H} fill={`url(#${gridId})`} />
        <rect width={VIEW_W} height={VIEW_H} fill={`url(#${vignetteId})`} />

        {path && (
          <>
            <path
              d={path}
              fill="none"
              stroke="rgba(0, 0, 0, 0.32)"
              strokeWidth="4.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={path}
              fill="none"
              stroke={routeColor}
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        )}

        {start && (
          <circle cx={start.x} cy={start.y} r="3" fill="#22c55e" stroke="#0b0f14" strokeWidth="1" />
        )}
        {end && (
          <circle cx={end.x} cy={end.y} r="3" fill="#ef4444" stroke="#0b0f14" strokeWidth="1" />
        )}
      </svg>

      {loading && <span className="run-route-preview-loading" aria-hidden="true" />}
      {!loading && !path && (
        <span className="run-route-preview-empty" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 20 3 17V4l6 3 6-3 6 3v13l-6-3-6 3Z" />
            <path d="M9 7v13" />
            <path d="M15 4v13" />
          </svg>
        </span>
      )}
    </span>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import type { Activity, RecordPoint } from "../types";
import type { MapStyle } from "../stores/settingsStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useTranslation } from "../lib/i18n";
import { api } from "../lib/api";
import { distanceDivisor, distanceLabel } from "../lib/units";

type Props = {
  records: RecordPoint[];
  activities: Activity[];
  mapStyle: MapStyle;
  setMapStyle: (style: MapStyle) => void;
  onSelectActivity?: (activity: Activity) => void;
};

type BaseMapInfo = { label: string; tileUrl: string; attribution: string };

type RouteLine = {
  id: number;
  name: string;
  sport: string;
  start_ts_utc: string;
  color: string;
  coordinates: [number, number][];
};

type ViewMode = "routes" | "density" | "coverage";

/**
 * One approximate coverage cell. `count` is the number of distinct activities
 * that passed through the cell, not the number of GPS samples.
 */
type CoverageCell = {
  key: string;
  count: number;
  activityIds: number[];
  /** `[minLon, minLat, maxLon, maxLat]` */
  bounds: [number, number, number, number];
  /** `[lon, lat]` */
  center: [number, number];
  firstTs: number;
  lastTs: number;
};

const BASEMAPS: Record<"light" | "dark" | "openstreet" | "topo" | "satellite", BaseMapInfo> = {
  light: {
    label: "Light",
    tileUrl: "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    attribution: "(c) OpenStreetMap contributors (c) CARTO",
  },
  openstreet: {
    label: "OpenStreet",
    tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "(c) OpenStreetMap contributors",
  },
  topo: {
    label: "Topo",
    tileUrl: "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: "(c) OpenStreetMap contributors, SRTM | OpenTopoMap",
  },
  satellite: {
    label: "Satellite",
    tileUrl: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles (c) Esri, Maxar, Earthstar Geographics",
  },
  dark: {
    label: "Dark",
    tileUrl: "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    attribution: "(c) OpenStreetMap contributors (c) CARTO",
  },
};

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
  return "#a855f7";
}

function styleFromMap(ms: MapStyle, theme: "light" | "dark" | "paper" | "paper-dark"): StyleSpecification | string {
  const baseTheme = theme === "dark" || theme === "paper-dark" ? "dark" : "light";
  const actualStyle = ms === "default" ? baseTheme : ms;
  if (actualStyle === "light") {
    return "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
  }
  if (actualStyle === "dark") {
    return "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
  }
  const s = BASEMAPS[actualStyle as keyof typeof BASEMAPS];
  return {
    version: 8,
    sources: {
      basemap: {
        type: "raster",
        tiles: [s.tileUrl],
        tileSize: 256,
        attribution: s.attribution,
      },
    },
    layers: [{ id: "basemap", type: "raster", source: "basemap" }],
  };
}

const HEAT_SOURCE_ID = "overview-heat-source";
const CLUSTER_SOURCE_ID = "overview-cluster-source";
const ROUTE_SOURCE_ID = "overview-route-source";
const COVERAGE_SOURCE_ID = "overview-coverage-source";
const HIGHLIGHT_SOURCE_ID = "overview-highlight-source";
const HEAT_LAYER_ID = "overview-heat-layer";
const CLUSTER_LAYER_ID = "overview-cluster-layer";
const CLUSTER_LABEL_LAYER_ID = "overview-cluster-label-layer";
const POINT_LAYER_ID = "overview-point-layer";
const ROUTE_LAYER_ID = "overview-route-layer";
const COVERAGE_LAYER_ID = "overview-coverage-layer";
const HIGHLIGHT_LAYER_ID = "overview-highlight-layer";

/** Coarse downsampling is plenty for a whole-history route overlay. */
const ROUTE_RESOLUTION_MS = 60_000;
/** Guard rail so a very large history does not request unlimited tracks. */
const MAX_ROUTE_ACTIVITIES = 400;
/** How long the chronological draw-in animation lasts. */
const REVEAL_DURATION_MS = 5_000;
/**
 * Approximate grid cell size in degrees. At mid latitudes this is roughly
 * 100-170 m, which is a reasonable "stretch of route" for a first pass.
 */
const GRID_SIZE_DEG = 0.0015;
/** Cap interpolation work for unusually long GPS gaps. */
const MAX_INTERPOLATION_STEPS = 120;

function cellKeyFor(lat: number, lon: number): string {
  return `${Math.floor(lat / GRID_SIZE_DEG)}:${Math.floor(lon / GRID_SIZE_DEG)}`;
}

/**
 * Build a grid of distinct-activity visit counts from the downsampled routes.
 *
 * Each activity contributes at most one visit per cell, so standing still or
 * passing the same stretch twice in one run does not inflate the count. Gaps
 * between downsampled points are filled by walking the segment, which keeps
 * the coverage continuous without requesting a finer route resolution.
 */
function buildCoverageCells(routes: RouteLine[]): Map<string, CoverageCell> {
  const cells = new Map<string, CoverageCell>();

  for (const route of routes) {
    const seen = new Set<string>();
    const startTs = Date.parse(route.start_ts_utc);

    const addPoint = (lat: number, lon: number) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      const key = cellKeyFor(lat, lon);
      if (seen.has(key)) return;
      seen.add(key);

      const latIndex = Math.floor(lat / GRID_SIZE_DEG);
      const lonIndex = Math.floor(lon / GRID_SIZE_DEG);
      const minLon = lonIndex * GRID_SIZE_DEG;
      const minLat = latIndex * GRID_SIZE_DEG;
      const maxLon = minLon + GRID_SIZE_DEG;
      const maxLat = minLat + GRID_SIZE_DEG;

      const existing = cells.get(key);
      if (existing) {
        existing.count += 1;
        existing.activityIds.push(route.id);
        if (Number.isFinite(startTs)) {
          if (startTs < existing.firstTs) existing.firstTs = startTs;
          if (startTs > existing.lastTs) existing.lastTs = startTs;
        }
      } else {
        cells.set(key, {
          key,
          count: 1,
          activityIds: [route.id],
          bounds: [minLon, minLat, maxLon, maxLat],
          center: [(minLon + maxLon) / 2, (minLat + maxLat) / 2],
          firstTs: Number.isFinite(startTs) ? startTs : Number.POSITIVE_INFINITY,
          lastTs: Number.isFinite(startTs) ? startTs : Number.NEGATIVE_INFINITY,
        });
      }
    };

    for (let i = 0; i < route.coordinates.length; i += 1) {
      const [lon, lat] = route.coordinates[i];
      addPoint(lat, lon);
      if (i === 0) continue;

      const [prevLon, prevLat] = route.coordinates[i - 1];
      const dLat = lat - prevLat;
      const dLon = lon - prevLon;
      const steps = Math.min(
        MAX_INTERPOLATION_STEPS,
        Math.max(1, Math.ceil(Math.max(Math.abs(dLat), Math.abs(dLon)) / (GRID_SIZE_DEG * 0.5))),
      );
      for (let step = 1; step < steps; step += 1) {
        const t = step / steps;
        addPoint(prevLat + dLat * t, prevLon + dLon * t);
      }
    }
  }

  return cells;
}

function formatVisitDate(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "-";
  return new Date(ts).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function OverviewLocationMap({ records, activities, mapStyle, setMapStyle, onSelectActivity }: Props) {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const theme = useSettingsStore((s) => s.theme);
  const distanceUnit = useSettingsStore((s) => s.distanceUnit);
  const { t } = useTranslation();
  const selectedStyle = mapStyle === "default" ? theme : mapStyle;

  const [viewMode, setViewMode] = useState<ViewMode>("routes");
  const [routes, setRoutes] = useState<RouteLine[]>([]);
  const [revealedRoutes, setRevealedRoutes] = useState<RouteLine[]>([]);
  const [routesLoading, setRoutesLoading] = useState(false);
  const [isRevealing, setIsRevealing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedCell, setSelectedCell] = useState<CoverageCell | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [highlightedActivityId, setHighlightedActivityId] = useState<number | null>(null);
  const routeCacheRef = useRef<Map<number, RouteLine>>(new Map());
  const activitiesRef = useRef(activities);
  activitiesRef.current = activities;
  const onSelectActivityRef = useRef(onSelectActivity);
  onSelectActivityRef.current = onSelectActivity;
  const hasFitRoutesRef = useRef(false);
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const routesRef = useRef(routes);
  routesRef.current = routes;
  const revealFrameRef = useRef<number | null>(null);
  const revealLastUpdateRef = useRef(0);
  const locationRequestRef = useRef(0);
  const handleCoverageClickRef = useRef<(key: string) => void>(() => {});

  const geojson = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(() => {
    const features: GeoJSON.Feature<GeoJSON.Point>[] = records
      .filter((r) => typeof r.latitude === "number" && typeof r.longitude === "number")
      .map((r) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [r.longitude as number, r.latitude as number],
        },
        properties: {},
      }));
    return { type: "FeatureCollection", features };
  }, [records]);

  const routeGeojson = useMemo<GeoJSON.FeatureCollection<GeoJSON.LineString>>(() => {
    const features: GeoJSON.Feature<GeoJSON.LineString>[] = revealedRoutes.map((route) => ({
      type: "Feature",
      geometry: { type: "LineString", coordinates: route.coordinates },
      properties: { id: route.id, name: route.name, sport: route.sport, color: route.color },
    }));
    return { type: "FeatureCollection", features };
  }, [revealedRoutes]);

  // Keep the latest data in refs so the map's one-time "load" handler (and any
  // other stale closure) always applies the current routes instead of the
  // empty collections captured on the first render.
  const geojsonRef = useRef(geojson);
  geojsonRef.current = geojson;
  const routeGeojsonRef = useRef(routeGeojson);
  routeGeojsonRef.current = routeGeojson;

  // Coverage is derived from the full route set (not the animated reveal) so
  // the grid is stable while the routes draw in.
  const coverageCells = useMemo(() => {
    if (viewMode !== "coverage") return new Map<string, CoverageCell>();
    return buildCoverageCells(routes);
  }, [routes, viewMode]);

  const coverageGeojson = useMemo<GeoJSON.FeatureCollection<GeoJSON.Polygon>>(() => {
    const features: GeoJSON.Feature<GeoJSON.Polygon>[] = [];
    for (const cell of coverageCells.values()) {
      const [minLon, minLat, maxLon, maxLat] = cell.bounds;
      features.push({
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[
            [minLon, minLat],
            [maxLon, minLat],
            [maxLon, maxLat],
            [minLon, maxLat],
            [minLon, minLat],
          ]],
        },
        properties: { key: cell.key, count: cell.count },
      });
    }
    return { type: "FeatureCollection", features };
  }, [coverageCells]);

  const highlightGeojson = useMemo<GeoJSON.FeatureCollection<GeoJSON.LineString>>(() => {
    if (highlightedActivityId == null) {
      return { type: "FeatureCollection", features: [] };
    }
    const route = routes.find((item) => item.id === highlightedActivityId);
    if (!route || route.coordinates.length < 2) {
      return { type: "FeatureCollection", features: [] };
    }
    return {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: { type: "LineString", coordinates: route.coordinates },
        properties: { id: route.id },
      }],
    };
  }, [highlightedActivityId, routes]);

  const coverageCellsRef = useRef(coverageCells);
  coverageCellsRef.current = coverageCells;
  const coverageGeojsonRef = useRef(coverageGeojson);
  coverageGeojsonRef.current = coverageGeojson;
  const highlightGeojsonRef = useRef(highlightGeojson);
  highlightGeojsonRef.current = highlightGeojson;

  const selectedCellActivities = useMemo(() => {
    if (!selectedCell) return [] as Activity[];
    const byId = new Map(activities.map((activity) => [activity.id, activity]));
    return selectedCell.activityIds
      .map((id) => byId.get(id))
      .filter((activity): activity is Activity => Boolean(activity))
      .sort((a, b) => Date.parse(b.start_ts_utc) - Date.parse(a.start_ts_utc));
  }, [selectedCell, activities]);

  handleCoverageClickRef.current = (key: string) => {
    const cell = coverageCellsRef.current.get(key);
    if (!cell) return;

    setSelectedCell(cell);
    setSelectedLocation(null);
    setLocationLoading(true);
    setHighlightedActivityId(null);
    const requestId = ++locationRequestRef.current;

    void api.reverseGeocode(cell.center[1], cell.center[0])
      .then((result) => {
        if (locationRequestRef.current !== requestId) return;
        if (!result) {
          setSelectedLocation(null);
          return;
        }
        const parts = [result.name, result.admin1]
          .map((part) => part?.trim())
          .filter((part): part is string => Boolean(part));
        setSelectedLocation(parts.length > 0 ? parts.join(", ") : null);
      })
      .catch(() => {
        if (locationRequestRef.current === requestId) setSelectedLocation(null);
      })
      .finally(() => {
        if (locationRequestRef.current === requestId) setLocationLoading(false);
      });
  };

  // Fetch the actual GPS tracks for the filtered activities in a single bulk
  // request. Results are cached per activity so toggling views or changing
  // filters does not refetch tracks we already have.
  useEffect(() => {
    if (viewMode === "density") return;
    let cancelled = false;
    const cache = routeCacheRef.current;
    hasFitRoutesRef.current = false;

    const candidates = activities
      .filter((a) => typeof a.start_latitude === "number" && typeof a.start_longitude === "number")
      .slice()
      // Chronological order so the draw-in animation follows when runs happened.
      .sort((a, b) => Date.parse(a.start_ts_utc) - Date.parse(b.start_ts_utc))
      .slice(0, MAX_ROUTE_ACTIVITIES);

    const publish = () => {
      if (cancelled) return;
      setRoutes(
        candidates
          .map((a) => cache.get(a.id))
          .filter((route): route is RouteLine => Boolean(route) && route!.coordinates.length >= 2),
      );
    };

    const missing = candidates.filter((a) => !cache.has(a.id));
    if (missing.length === 0) {
      publish();
      setRoutesLoading(false);
      return;
    }

    setRoutesLoading(true);
    void (async () => {
      try {
        const fetched = await api.getOverviewRoutes(
          missing.map((a) => a.id),
          ROUTE_RESOLUTION_MS,
          MAX_ROUTE_ACTIVITIES,
        );
        if (cancelled) return;
        for (const route of fetched) {
          cache.set(route.id, {
            id: route.id,
            name: route.name,
            sport: route.sport,
            start_ts_utc: route.start_ts_utc,
            color: colorForSport(route.sport || ""),
            coordinates: route.coordinates,
          });
        }
        // Cache empty results so activities without a usable track are not
        // requested again on the next filter change.
        for (const activity of missing) {
          if (!cache.has(activity.id)) {
            cache.set(activity.id, {
              id: activity.id,
              name: activity.activity_name || activity.file_name,
              sport: activity.sport || "",
              start_ts_utc: activity.start_ts_utc,
              color: colorForSport(activity.sport || ""),
              coordinates: [],
            });
          }
        }
      } catch {
        // Keep whatever is already cached; the map still renders partial data.
      } finally {
        if (!cancelled) {
          publish();
          setRoutesLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [viewMode, activities]);

  // Draw the routes in chronological order over a few seconds, mirroring the
  // progressive reveal used by the individual activity GPS route card.
  const startReveal = useCallback(() => {
    if (revealFrameRef.current !== null) {
      cancelAnimationFrame(revealFrameRef.current);
      revealFrameRef.current = null;
    }

    const full = routesRef.current;
    if (!full.length) {
      setRevealedRoutes([]);
      setIsRevealing(false);
      return;
    }

    const totalPoints = full.reduce((sum, route) => sum + route.coordinates.length, 0);
    if (totalPoints === 0) {
      setRevealedRoutes([]);
      setIsRevealing(false);
      return;
    }

    setIsRevealing(true);
    const startedAt = performance.now();
    revealLastUpdateRef.current = 0;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / REVEAL_DURATION_MS);
      // Throttle React updates to ~20fps; a five-second fill does not need
      // 60fps and this keeps the rest of the dashboard responsive.
      if (progress < 1 && now - revealLastUpdateRef.current < 50) {
        revealFrameRef.current = requestAnimationFrame(tick);
        return;
      }
      revealLastUpdateRef.current = now;

      const target = Math.floor(progress * totalPoints);
      const revealed: RouteLine[] = [];
      let consumed = 0;
      for (const route of full) {
        if (consumed >= target) break;
        const remaining = target - consumed;
        if (remaining >= route.coordinates.length) {
          revealed.push(route);
        } else if (remaining >= 2) {
          revealed.push({ ...route, coordinates: route.coordinates.slice(0, remaining) });
        }
        consumed += route.coordinates.length;
      }

      setRevealedRoutes(revealed);

      if (progress < 1) {
        revealFrameRef.current = requestAnimationFrame(tick);
      } else {
        revealFrameRef.current = null;
        setRevealedRoutes(full);
        setIsRevealing(false);
      }
    };

    revealFrameRef.current = requestAnimationFrame(tick);
  }, []);

  // Replay the draw-in whenever the route set changes or the user switches
  // back to a route-based view.
  useEffect(() => {
    if (viewMode === "density") return;
    if (routes.length === 0) {
      setRevealedRoutes([]);
      return;
    }
    startReveal();
    return () => {
      if (revealFrameRef.current !== null) {
        cancelAnimationFrame(revealFrameRef.current);
        revealFrameRef.current = null;
      }
    };
  }, [routes, viewMode, startReveal]);

  // Keep the open coverage panel in sync when the underlying data changes.
  useEffect(() => {
    if (!selectedCell) return;
    const next = coverageCells.get(selectedCell.key);
    if (!next) {
      setSelectedCell(null);
      setSelectedLocation(null);
      setLocationLoading(false);
    } else if (next !== selectedCell) {
      setSelectedCell(next);
    }
  }, [coverageCells, selectedCell]);

  // Clear coverage-only UI when leaving the coverage view.
  useEffect(() => {
    if (viewMode === "coverage") return;
    setSelectedCell(null);
    setSelectedLocation(null);
    setLocationLoading(false);
    setHighlightedActivityId(null);
  }, [viewMode]);

  // Ignore any in-flight reverse-geocode response after unmount.
  useEffect(() => {
    return () => {
      locationRequestRef.current += 1;
    };
  }, []);

  function applyViewMode(map: maplibregl.Map) {
    const mode = viewModeRef.current;
    const routesVisible = mode === "routes" || mode === "coverage";
    const coverageVisible = mode === "coverage";

    if (map.getLayer(ROUTE_LAYER_ID)) {
      map.setLayoutProperty(ROUTE_LAYER_ID, "visibility", routesVisible ? "visible" : "none");
    }
    for (const id of [HEAT_LAYER_ID, CLUSTER_LAYER_ID, CLUSTER_LABEL_LAYER_ID, POINT_LAYER_ID]) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, "visibility", mode === "density" ? "visible" : "none");
      }
    }
    if (map.getLayer(COVERAGE_LAYER_ID)) {
      map.setLayoutProperty(COVERAGE_LAYER_ID, "visibility", coverageVisible ? "visible" : "none");
    }
    if (map.getLayer(HIGHLIGHT_LAYER_ID)) {
      map.setLayoutProperty(HIGHLIGHT_LAYER_ID, "visibility", coverageVisible ? "visible" : "none");
    }
  }

  function ensureSourcesAndLayers(map: maplibregl.Map) {
    const heatSrc = map.getSource(HEAT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    const clusterSrc = map.getSource(CLUSTER_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    const routeSrc = map.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    const coverageSrc = map.getSource(COVERAGE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    const highlightSrc = map.getSource(HIGHLIGHT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    const currentGeojson = geojsonRef.current;
    const currentRouteGeojson = routeGeojsonRef.current;
    const currentCoverageGeojson = coverageGeojsonRef.current;
    const currentHighlightGeojson = highlightGeojsonRef.current;

    if (routeSrc) {
      routeSrc.setData(currentRouteGeojson);
    } else {
      map.addSource(ROUTE_SOURCE_ID, { type: "geojson", data: currentRouteGeojson });
    }

    if (!map.getLayer(ROUTE_LAYER_ID)) {
      map.addLayer({
        id: ROUTE_LAYER_ID,
        type: "line",
        source: ROUTE_SOURCE_ID,
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": ["coalesce", ["get", "color"], "#22d3ee"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 2, 1.2, 10, 2.2, 16, 3.4],
          "line-opacity": 0.55,
        },
      });
    }

    if (coverageSrc) {
      coverageSrc.setData(currentCoverageGeojson);
    } else {
      map.addSource(COVERAGE_SOURCE_ID, { type: "geojson", data: currentCoverageGeojson });
    }

    if (!map.getLayer(COVERAGE_LAYER_ID)) {
      map.addLayer({
        id: COVERAGE_LAYER_ID,
        type: "fill",
        source: COVERAGE_SOURCE_ID,
        paint: {
          "fill-color": [
            "interpolate",
            ["linear"],
            ["get", "count"],
            1,
            "#38bdf8",
            3,
            "#22d3ee",
            6,
            "#34d399",
            10,
            "#fbbf24",
            20,
            "#f97316",
            40,
            "#ef4444",
          ],
          "fill-opacity": 0.55,
          "fill-outline-color": "rgba(255,255,255,0.18)",
        },
      });
    }

    if (highlightSrc) {
      highlightSrc.setData(currentHighlightGeojson);
    } else {
      map.addSource(HIGHLIGHT_SOURCE_ID, { type: "geojson", data: currentHighlightGeojson });
    }

    if (!map.getLayer(HIGHLIGHT_LAYER_ID)) {
      map.addLayer({
        id: HIGHLIGHT_LAYER_ID,
        type: "line",
        source: HIGHLIGHT_SOURCE_ID,
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": "#facc15",
          "line-width": 5,
          "line-opacity": 0.95,
        },
      });
    }

    if (heatSrc) {
      heatSrc.setData(currentGeojson);
    } else {
      map.addSource(HEAT_SOURCE_ID, { type: "geojson", data: currentGeojson });
    }

    if (clusterSrc) {
      clusterSrc.setData(currentGeojson);
    } else {
      map.addSource(CLUSTER_SOURCE_ID, {
        type: "geojson",
        data: currentGeojson,
        cluster: true,
        clusterRadius: 38,
        clusterMaxZoom: 11,
      });
    }

    if (!map.getLayer(HEAT_LAYER_ID)) {
      map.addLayer({
        id: HEAT_LAYER_ID,
        type: "heatmap",
        source: HEAT_SOURCE_ID,
        maxzoom: 11,
        paint: {
          "heatmap-weight": 1,
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 0.45, 11, 1.1],
          "heatmap-color": [
            "interpolate",
            ["linear"],
            ["heatmap-density"],
            0,
            "rgba(0,0,0,0)",
            0.2,
            "rgba(56, 189, 248, 0.12)",
            0.45,
            "rgba(14, 165, 233, 0.2)",
            0.7,
            "rgba(6, 182, 212, 0.3)",
            1,
            "rgba(8, 145, 178, 0.4)",
          ],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 4, 11, 14],
          "heatmap-opacity": 0.7,
        },
      });
    }

    if (!map.getLayer(CLUSTER_LAYER_ID)) {
      map.addLayer({
        id: CLUSTER_LAYER_ID,
        type: "circle",
        source: CLUSTER_SOURCE_ID,
        maxzoom: 11,
        filter: ["has", "point_count"],
        paint: {
          "circle-color": [
            "interpolate",
            ["linear"],
            ["coalesce", ["ln", ["+", ["get", "point_count"], 1]], 0],
            0,
            "rgba(192, 38, 211, 0.72)",
            2,
            "rgba(168, 85, 247, 0.80)",
            4,
            "rgba(147, 51, 234, 0.88)",
          ],
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            0,
            ["step", ["get", "point_count"], 4, 25, 5, 80, 7.2],
            11,
            ["step", ["get", "point_count"], 6, 25, 7.5, 80, 10.8],
          ],
          "circle-opacity": 0.84,
          "circle-blur": 0.45,
          "circle-stroke-width": 0.6,
          "circle-stroke-color": "rgba(255,255,255,0.58)",
        },
      });
    }

    if (!map.getLayer(CLUSTER_LABEL_LAYER_ID)) {
      map.addLayer({
        id: CLUSTER_LABEL_LAYER_ID,
        type: "symbol",
        source: CLUSTER_SOURCE_ID,
        maxzoom: 11,
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-size": 11,
          "text-font": ["Open Sans Bold"],
        },
        paint: {
          "text-color": "#ffffff",
        },
      });
    }

    if (!map.getLayer(POINT_LAYER_ID)) {
      map.addLayer({
        id: POINT_LAYER_ID,
        type: "circle",
        source: CLUSTER_SOURCE_ID,
        minzoom: 10,
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2, 16, 6],
          "circle-color": "#c026d3",
          "circle-opacity": 0.35,
        },
      });
    }

    applyViewMode(map);
  }

  function fitToData(map: maplibregl.Map) {
    const coords: [number, number][] = [];
    if (viewMode !== "density") {
      for (const route of routes) coords.push(...route.coordinates);
    } else {
      for (const feature of geojson.features) {
        coords.push(feature.geometry.coordinates as [number, number]);
      }
    }
    if (!coords.length) return;
    const bounds = coords.reduce(
      (b, coord) => b.extend(coord),
      new maplibregl.LngLatBounds(coords[0], coords[0]),
    );
    map.fitBounds(bounds, { padding: 48, maxZoom: 13, duration: 650 });
  }

  const fitRef = useRef<() => void>(() => {});
  fitRef.current = () => {
    const map = mapRef.current;
    if (map) fitToData(map);
  };

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: styleFromMap(mapStyle, theme),
      center: [0, 0],
      zoom: 2,
      minZoom: 2,
      cooperativeGestures: true,
    });
    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

    map.on("load", () => {
      ensureSourcesAndLayers(map);
      fitRef.current();
    });

    map.on("click", CLUSTER_LAYER_ID, (e) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const clusterId = feature.properties?.cluster_id;
      const source = map.getSource(CLUSTER_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (!source || clusterId == null) return;
      void source.getClusterExpansionZoom(clusterId)
        .then((zoom) => {
          map.easeTo({ center: (feature.geometry as GeoJSON.Point).coordinates as [number, number], zoom, duration: 450 });
        })
        .catch(() => {
          // Ignore expansion errors for stale cluster ids.
        });
    });

    map.on("click", ROUTE_LAYER_ID, (e) => {
      // In coverage mode the grid owns clicks; the panel is the way to open a
      // run so a cell click does not also jump to the individual view.
      if (viewModeRef.current !== "routes") return;
      const feature = e.features?.[0];
      const id = Number(feature?.properties?.id);
      if (!Number.isFinite(id)) return;
      const activity = activitiesRef.current.find((a) => a.id === id);
      if (activity) onSelectActivityRef.current?.(activity);
    });

    map.on("click", COVERAGE_LAYER_ID, (e) => {
      const key = e.features?.[0]?.properties?.key;
      if (key != null) handleCoverageClickRef.current(String(key));
    });

    map.on("mouseenter", ROUTE_LAYER_ID, () => {
      if (viewModeRef.current !== "routes") return;
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", ROUTE_LAYER_ID, () => {
      if (viewModeRef.current !== "routes") return;
      map.getCanvas().style.cursor = "";
    });
    map.on("mouseenter", COVERAGE_LAYER_ID, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", COVERAGE_LAYER_ID, () => {
      map.getCanvas().style.cursor = "";
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    map.setStyle(styleFromMap(mapStyle, theme));
    const onIdle = () => {
      map.off("idle", onIdle);
      ensureSourcesAndLayers(map);
    };
    map.on("idle", onIdle);

    return () => {
      map.off("idle", onIdle);
    };
  }, [mapStyle, theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (map.isStyleLoaded()) {
      ensureSourcesAndLayers(map);
    } else {
      const onIdle = () => {
        map.off("idle", onIdle);
        ensureSourcesAndLayers(map);
      };
      map.on("idle", onIdle);
      return () => {
        map.off("idle", onIdle);
      };
    }
  }, [geojson, routeGeojson, coverageGeojson, highlightGeojson, viewMode]);

  // Fit once per activity set when routes first become available.
  useEffect(() => {
    if (viewMode === "density" || routes.length === 0 || hasFitRoutesRef.current) return;
    hasFitRoutesRef.current = true;
    fitRef.current();
  }, [routes, viewMode]);

  // Refit when the user switches back to a route-based view.
  useEffect(() => {
    if (viewMode !== "density" && routes.length > 0) fitRef.current();
  }, [viewMode]);

  // The footer content changes between view modes, which can slightly change
  // the map's available height. Resize after the layout settles.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const frame = requestAnimationFrame(() => map.resize());
    return () => cancelAnimationFrame(frame);
  }, [viewMode]);

  // Keep the map canvas in sync when the panel enters/leaves fullscreen, lock
  // background scrolling, and allow Escape to exit.
  useEffect(() => {
    const map = mapRef.current;
    document.body.classList.toggle("map-fullscreen-open", isFullscreen);
    const frame = requestAnimationFrame(() => map?.resize());
    // A second pass after the layout settles avoids a half-sized canvas on
    // some browsers when toggling fixed positioning.
    const timer = window.setTimeout(() => map?.resize(), 200);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsFullscreen(false);
    };
    if (isFullscreen) window.addEventListener("keydown", onKeyDown);

    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("map-fullscreen-open");
    };
  }, [isFullscreen]);

  return (
    <div className={`panel overview-location-panel${isFullscreen ? " map-fullscreen" : ""}`}>
      <div className="map-header" style={{ marginBottom: "0.6rem" }}>
        <div>
          <h3 style={{ marginBottom: "0.32rem" }}>{t("map.exploredLocations")}</h3>
          <p className="panel-subtitle">
            {viewMode === "routes"
              ? t("map.subtitleRoutes")
              : viewMode === "coverage"
                ? t("map.subtitleCoverage")
                : t("map.subtitle")}
          </p>
        </div>
        <div className="map-controls">
          <div className="map-view-toggle" role="group" aria-label={t("map.viewMode")}>
            <button
              type="button"
              className={viewMode === "routes" ? "active" : ""}
              onClick={() => setViewMode("routes")}
            >
              {t("map.routes")}
            </button>
            <button
              type="button"
              className={viewMode === "coverage" ? "active" : ""}
              onClick={() => setViewMode("coverage")}
            >
              {t("map.coverage")}
            </button>
            <button
              type="button"
              className={viewMode === "density" ? "active" : ""}
              onClick={() => setViewMode("density")}
            >
              {t("map.density")}
            </button>
          </div>
          <label className="map-control">
            <span className="small">{t("map.style")}</span>
            <select value={selectedStyle} onChange={(e) => setMapStyle(e.target.value as MapStyle)}>
              {Object.entries(BASEMAPS).map(([value, info]) => (
                <option key={value} value={value}>{info.label}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="icon-btn map-fullscreen-btn"
            onClick={() => setIsFullscreen((value) => !value)}
            title={isFullscreen ? t("map.exitFullscreen") : t("map.fullscreen")}
            aria-label={isFullscreen ? t("map.exitFullscreen") : t("map.fullscreen")}
          >
            {isFullscreen ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3v3a2 2 0 0 1-2 2H3" />
                <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
                <path d="M3 16h3a2 2 0 0 1 2 2v3" />
                <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3H5a2 2 0 0 0-2 2v3" />
                <path d="M16 3h3a2 2 0 0 1 2 2v3" />
                <path d="M3 16v3a2 2 0 0 0 2 2h3" />
                <path d="M21 16v3a2 2 0 0 1-2 2h-3" />
              </svg>
            )}
          </button>
        </div>
      </div>

      <div className="overview-map-wrap">
        <div className="overview-map-canvas" ref={mapContainerRef} />

        {viewMode === "coverage" && selectedCell && (
          <div className="coverage-panel" role="dialog" aria-label={t("map.coveragePanelTitle")}>
            <div className="coverage-panel-header">
              <div className="coverage-panel-heading">
                <div className="coverage-panel-title">
                  {locationLoading
                    ? t("map.coverageLoadingLocation")
                    : selectedLocation || t("map.coverageUnknownLocation")}
                </div>
                <div className="coverage-panel-subtitle">
                  {t("map.coverageCellRuns", { count: selectedCell.count })}
                </div>
              </div>
              <button
                type="button"
                className="icon-btn coverage-panel-close"
                onClick={() => {
                  setSelectedCell(null);
                  setSelectedLocation(null);
                  setHighlightedActivityId(null);
                }}
                aria-label={t("map.coverageClose")}
                title={t("map.coverageClose")}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="coverage-panel-stats">
              <div>
                <span>{t("map.coverageFirstVisit")}</span>
                <strong>{formatVisitDate(selectedCell.firstTs)}</strong>
              </div>
              <div>
                <span>{t("map.coverageLastVisit")}</span>
                <strong>{formatVisitDate(selectedCell.lastTs)}</strong>
              </div>
            </div>

            <div className="coverage-panel-list-title">{t("map.coverageRunList")}</div>
            <div className="coverage-run-list">
              {selectedCellActivities.map((activity) => (
                <button
                  key={activity.id}
                  type="button"
                  className={`coverage-run-item${highlightedActivityId === activity.id ? " active" : ""}`}
                  onMouseEnter={() => setHighlightedActivityId(activity.id)}
                  onMouseLeave={() => setHighlightedActivityId((id) => (id === activity.id ? null : id))}
                  onFocus={() => setHighlightedActivityId(activity.id)}
                  onBlur={() => setHighlightedActivityId((id) => (id === activity.id ? null : id))}
                  onClick={() => onSelectActivity?.(activity)}
                >
                  <span className="coverage-run-date">{formatVisitDate(Date.parse(activity.start_ts_utc))}</span>
                  <span className="coverage-run-name">{activity.activity_name || activity.file_name}</span>
                  <span className="coverage-run-distance">
                    {(activity.distance_m / distanceDivisor(distanceUnit)).toFixed(2)} {distanceLabel(distanceUnit)}
                  </span>
                </button>
              ))}
              {selectedCellActivities.length === 0 && (
                <div className="coverage-run-empty">{t("map.coverageNoRuns")}</div>
              )}
            </div>

            <div className="coverage-panel-hint">{t("map.coverageHint")}</div>
          </div>
        )}
      </div>

      <div className="map-footer-actions">
        {viewMode !== "density" && (
          <span className="small map-route-status">
            {routesLoading
              ? t("map.loadingRoutes")
              : isRevealing
                ? t("map.drawingRoutes", { count: routes.length })
                : t("map.routesLoaded", { count: routes.length })}
          </span>
        )}
        {viewMode === "coverage" && (
          <div className="coverage-legend" aria-hidden="true">
            <span>{t("map.coverageFewer")}</span>
            <div className="coverage-legend-bar" />
            <span>{t("map.coverageMore")}</span>
          </div>
        )}
        {viewMode !== "density" && (
          <button
            className="btn-outline-secondary"
            onClick={startReveal}
            disabled={routes.length === 0 || isRevealing}
          >
            {t("map.replay")}
          </button>
        )}
        <button className="btn-outline-secondary" onClick={() => fitRef.current()}>
          {t("map.resetZoom")}
        </button>
      </div>
    </div>
  );
}

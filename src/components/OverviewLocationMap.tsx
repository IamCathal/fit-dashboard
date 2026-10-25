import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import type { Activity, RecordPoint } from "../types";
import type { MapStyle } from "../stores/settingsStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useTranslation } from "../lib/i18n";
import { api } from "../lib/api";

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
  color: string;
  coordinates: [number, number][];
};

type ViewMode = "routes" | "density";

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
const HEAT_LAYER_ID = "overview-heat-layer";
const CLUSTER_LAYER_ID = "overview-cluster-layer";
const CLUSTER_LABEL_LAYER_ID = "overview-cluster-label-layer";
const POINT_LAYER_ID = "overview-point-layer";
const ROUTE_LAYER_ID = "overview-route-layer";

/** Coarse downsampling is plenty for a whole-history route overlay. */
const ROUTE_RESOLUTION_MS = 60_000;
/** Guard rail so a very large history does not fire unlimited requests. */
const MAX_ROUTE_ACTIVITIES = 400;
const ROUTE_FETCH_CONCURRENCY = 6;

export function OverviewLocationMap({ records, activities, mapStyle, setMapStyle, onSelectActivity }: Props) {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const theme = useSettingsStore((s) => s.theme);
  const { t } = useTranslation();
  const selectedStyle = mapStyle === "default" ? theme : mapStyle;

  const [viewMode, setViewMode] = useState<ViewMode>("routes");
  const [routes, setRoutes] = useState<RouteLine[]>([]);
  const [routesLoading, setRoutesLoading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const routeCacheRef = useRef<Map<number, RouteLine>>(new Map());
  const activitiesRef = useRef(activities);
  activitiesRef.current = activities;
  const onSelectActivityRef = useRef(onSelectActivity);
  onSelectActivityRef.current = onSelectActivity;
  const hasFitRoutesRef = useRef(false);
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;

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
    const features: GeoJSON.Feature<GeoJSON.LineString>[] = routes.map((route) => ({
      type: "Feature",
      geometry: { type: "LineString", coordinates: route.coordinates },
      properties: { id: route.id, name: route.name, sport: route.sport, color: route.color },
    }));
    return { type: "FeatureCollection", features };
  }, [routes]);

  // Keep the latest data in refs so the map's one-time "load" handler (and any
  // other stale closure) always applies the current routes instead of the
  // empty collections captured on the first render.
  const geojsonRef = useRef(geojson);
  geojsonRef.current = geojson;
  const routeGeojsonRef = useRef(routeGeojson);
  routeGeojsonRef.current = routeGeojson;

  // Lazily fetch the actual GPS tracks for the filtered activities. Results are
  // cached per activity so toggling between views does not refetch.
  useEffect(() => {
    if (viewMode !== "routes") return;
    let cancelled = false;
    const cache = routeCacheRef.current;
    hasFitRoutesRef.current = false;

    const candidates = activities
      .filter((a) => typeof a.start_latitude === "number" && typeof a.start_longitude === "number")
      .slice()
      .sort((a, b) => Date.parse(b.start_ts_utc) - Date.parse(a.start_ts_utc))
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
      let index = 0;
      const worker = async () => {
        while (!cancelled && index < missing.length) {
          const activity = missing[index++];
          let route: RouteLine | null = null;
          try {
            const points = await api.getRecords(activity.id, ROUTE_RESOLUTION_MS);
            const coordinates = points
              .filter((p) => typeof p.latitude === "number" && typeof p.longitude === "number")
              .map((p) => [p.longitude as number, p.latitude as number] as [number, number]);
            route = {
              id: activity.id,
              name: activity.activity_name || activity.file_name,
              sport: activity.sport || "",
              color: colorForSport(activity.sport || ""),
              coordinates,
            };
          } catch {
            route = null;
          }
          // Cache even empty results so a failed/empty activity is not retried.
          cache.set(
            activity.id,
            route ?? {
              id: activity.id,
              name: activity.activity_name || activity.file_name,
              sport: activity.sport || "",
              color: colorForSport(activity.sport || ""),
              coordinates: [],
            },
          );
          publish();
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(ROUTE_FETCH_CONCURRENCY, missing.length) }, () => worker()),
      );
      if (!cancelled) setRoutesLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [viewMode, activities]);

  function applyViewMode(map: maplibregl.Map) {
    const routesVisible = viewModeRef.current === "routes";
    if (map.getLayer(ROUTE_LAYER_ID)) {
      map.setLayoutProperty(ROUTE_LAYER_ID, "visibility", routesVisible ? "visible" : "none");
    }
    for (const id of [HEAT_LAYER_ID, CLUSTER_LAYER_ID, CLUSTER_LABEL_LAYER_ID, POINT_LAYER_ID]) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, "visibility", routesVisible ? "none" : "visible");
      }
    }
  }

  function ensureSourcesAndLayers(map: maplibregl.Map) {
    const heatSrc = map.getSource(HEAT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    const clusterSrc = map.getSource(CLUSTER_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    const routeSrc = map.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    const currentGeojson = geojsonRef.current;
    const currentRouteGeojson = routeGeojsonRef.current;

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
    if (viewMode === "routes") {
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
      const feature = e.features?.[0];
      const id = Number(feature?.properties?.id);
      if (!Number.isFinite(id)) return;
      const activity = activitiesRef.current.find((a) => a.id === id);
      if (activity) onSelectActivityRef.current?.(activity);
    });

    map.on("mouseenter", ROUTE_LAYER_ID, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", ROUTE_LAYER_ID, () => {
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
  }, [geojson, routeGeojson, viewMode]);

  // Fit once per activity set when routes first become available.
  useEffect(() => {
    if (viewMode !== "routes" || routes.length === 0 || hasFitRoutesRef.current) return;
    hasFitRoutesRef.current = true;
    fitRef.current();
  }, [routes, viewMode]);

  // Refit when the user switches back to the routes view.
  useEffect(() => {
    if (viewMode === "routes" && routes.length > 0) fitRef.current();
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
            {viewMode === "routes" ? t("map.subtitleRoutes") : t("map.subtitle")}
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

      <div className="overview-map-canvas" ref={mapContainerRef} />

      <div className="map-footer-actions">
        {viewMode === "routes" && (
          <span className="small map-route-status">
            {routesLoading
              ? t("map.loadingRoutes")
              : t("map.routesLoaded", { count: routes.length })}
          </span>
        )}
        <button className="btn-outline-secondary" onClick={() => fitRef.current()}>
          {t("map.resetZoom")}
        </button>
      </div>
    </div>
  );
}

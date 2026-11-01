import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
// Vite bundles the main module but not MapLibre's separate worker file. Load it ourselves and
// hand MapLibre a blob: URL so the worker also starts inside sandboxed (opaque-origin) previews,
// where a same-origin script URL is rejected.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
const workerReady: Promise<void> = (async () => {
  try {
    const res = await fetch(maplibreWorkerUrl);
    if (!res.ok) throw new Error(`worker fetch ${res.status}`);
    // The worker ships as an ES module. Module workers from blob: URLs are rejected in opaque
    // origins, so strip the trailing export and run it as a classic worker instead.
    const code = (await res.text()).replace(/export\s*\{[^}]*\};?/g, "").replace(/\/\/# sourceMappingURL=.*$/m, "");
    // MapLibre only spawns a classic worker when the URL ends in ".cjs"; the fragment satisfies that.
    const blobUrl = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    maplibregl.setWorkerUrl(`${blobUrl}#maplibre-worker.cjs`);
  } catch {
    maplibregl.setWorkerUrl(maplibreWorkerUrl);
  }
})();
import type { Map as MLMap, LngLatBoundsLike, MapLayerMouseEvent, GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Earthquake, DartStation, Zone } from "@shared/schema";
import type { Lang } from "@/lib/i18n";
import { t, fmtLocal, relTime, PANAMA_TZ, LOCALE } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Maximize2, Minimize2, LocateFixed } from "lucide-react";

const STYLE = "https://tiles.openfreemap.org/styles/positron";
const PANAMA_BOUNDS: LngLatBoundsLike = [
  [-84.5, 5.0],
  [-76.0, 11.5],
];

/* ------------------------------------------------------------------ */
/* Time ranges                                                         */
/* ------------------------------------------------------------------ */

export type RangeKey = "latest" | "24h" | "72h" | "7d" | "30d" | "1y";
export const RANGES: { key: RangeKey; hours: number }[] = [
  { key: "24h", hours: 24 },
  { key: "72h", hours: 72 },
  { key: "7d", hours: 24 * 7 },
  { key: "30d", hours: 24 * 30 },
  { key: "1y", hours: 24 * 365 },
];
// "latest" is not a time window: the page passes just the most recent event, whatever its age.
export const rangeHours = (k: RangeKey) => (k === "latest" ? 24 * 365 : (RANGES.find((r) => r.key === k)?.hours ?? 24));

// Age colours follow the USGS "Latest Earthquakes" convention: red = past hour,
// orange = past day, yellow = past week, pale = older. Readers already know it.
const AGE_COLORS = {
  hour: "#c0392b",
  day: "#e67e22",
  week: "#f1c40f",
  month: "#9fb6c6",
  older: "#b9c9d6",
};

interface Props {
  quakes: Earthquake[]; // already filtered to the selected range
  range: RangeKey;
  onRangeChange: (r: RangeKey) => void;
  darts: DartStation[];
  zones: Zone[];
  selectedZone: Zone;
  lang: Lang;
}

/* ------------------------------------------------------------------ */
/* GeoJSON builders                                                    */
/* ------------------------------------------------------------------ */

function labelFor(q: Earthquake, range: RangeKey, lang: Lang, now: number): string {
  const mag = q.mag !== null ? `M${q.mag.toFixed(1)}` : "M?";
  const d = new Date(q.time);
  if (range === "latest") {
    // "M3.7 · 1 nov 02:55"
    const dt = new Intl.DateTimeFormat(LOCALE[lang], { timeZone: PANAMA_TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
    return `${mag} · ${dt}`;
  }
  if (range === "24h") {
    // Within a day the clock time is the most useful cue: "M3.5 · 14:51"
    const hm = new Intl.DateTimeFormat(LOCALE[lang], { timeZone: PANAMA_TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
    return `${mag} · ${hm}`;
  }
  if (range === "72h") {
    // "M3.5 · sáb 14:51"
    const wd = new Intl.DateTimeFormat(LOCALE[lang], { timeZone: PANAMA_TZ, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
    return `${mag} · ${wd}`;
  }
  if (range === "7d" || range === "30d") {
    const md = new Intl.DateTimeFormat(LOCALE[lang], { timeZone: PANAMA_TZ, day: "numeric", month: "short" }).format(d);
    return `${mag} · ${md}`;
  }
  const my = new Intl.DateTimeFormat(LOCALE[lang], { timeZone: PANAMA_TZ, month: "short", year: "numeric" }).format(d);
  void now;
  return `${mag} · ${my}`;
}

function quakeFC(quakes: Earthquake[], range: RangeKey, lang: Lang, now: number) {
  const newestId = quakes.reduce<Earthquake | null>((a, q) => (a === null || q.time > a.time ? q : a), null)?.id;
  // For longer ranges only the larger events get a label; the rest stay as dots. MapLibre hides
  // colliding labels automatically, and sortKey makes the big ones win.
  const labelMin = range === "24h" || range === "latest" ? -Infinity : range === "72h" ? 3.0 : range === "7d" ? 4.0 : range === "30d" ? 4.5 : 5.0;
  const isLabelled = (q: Earthquake) => (q.mag ?? 0) >= labelMin || q.id === newestId;
  return {
    type: "FeatureCollection" as const,
    features: quakes
      .filter((q) => q.mag !== null)
      .map((q) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [q.lon, q.lat] },
        properties: {
          id: q.id,
          mag: q.mag,
          place: q.place,
          time: q.time,
          depth: q.depthKm,
          ageH: (now - q.time) / 3600_000,
          url: q.url,
          source: q.source,
          label: isLabelled(q) ? labelFor(q, range, lang, now) : "",
          newest: q.id === newestId ? 1 : 0,
          major: (q.mag ?? 0) >= MAJOR_MAG ? 1 : 0,
          // Lower sorts first. The newest quake always keeps its label; then bigger magnitudes win.
          sortKey: q.id === newestId ? -100 : -(q.mag ?? 0),
        },
      })),
  };
}

function dartFC(darts: DartStation[]) {
  return {
    type: "FeatureCollection" as const,
    features: darts.map((d) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [d.lon, d.lat] },
      properties: { id: d.id, name: d.name, status: d.status, eventMode: d.eventMode },
    })),
  };
}

function zoneFC(zones: Zone[], selected: string) {
  return {
    type: "FeatureCollection" as const,
    features: zones
      .filter((z) => z.id === selected)
      .map((z) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [z.lon, z.lat] },
        properties: { id: z.id, name: z.name },
      })),
  };
}

// Significant quakes are never swallowed by a cluster: they stay as individual, labelled circles.
const MAJOR_MAG = 5.5;

function quakeHtml(p: { mag: number; time: number; place: string; depth: number | null; source: string }, l: Lang): string {
  const st = t(l);
  const time = Number(p.time);
  const depth = Number(p.depth);
  return `<div style="font-size:13px;line-height:1.35">
    <div style="font-size:15px"><b>M ${Number(p.mag).toFixed(1)}</b> <span style="color:#5b6b7a">· ${relTime(time, l)}</span></div>
    <div>${p.place}</div>
    <div style="color:#5b6b7a">${fmtLocal(time, l, { year: "numeric" })} (Panamá)${Number.isFinite(depth) ? ` · ${depth.toFixed(0)} km` : ""}</div>
    <div style="color:#5b6b7a;font-size:11px">${st.sourceLabel}: ${p.source}</div>
  </div>`;
}

const AGE_COLOR_EXPR: any = ["step", ["get", "ageH"], AGE_COLORS.hour, 1, AGE_COLORS.day, 24, AGE_COLORS.week, 168, AGE_COLORS.month, 720, AGE_COLORS.older];
const MAG_RADIUS_EXPR: any = ["interpolate", ["linear"], ["get", "mag"], 2, 4, 3, 6, 4, 9, 5, 13, 6, 18, 7, 25, 8, 32];

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function MapView({ quakes, range, onRangeChange, darts, zones, selectedZone, lang }: Props) {
  const s = t(lang);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const [ready, setReady] = useState(false);
  const [wide, setWide] = useState(false);
  const [legendOpen, setLegendOpen] = useState<boolean>(() => (typeof window === "undefined" ? true : window.innerWidth >= 640));
  const langRef = useRef(lang);
  langRef.current = lang;

  const clustered = range === "30d" || range === "1y";
  const newest = useMemo(() => quakes.reduce<Earthquake | null>((a, q) => (a === null || q.time > a.time ? q : a), null), [quakes]);
  const strongest = useMemo(() => quakes.reduce<Earthquake | null>((a, q) => (a === null || (q.mag ?? 0) > (a.mag ?? 0) ? q : a), null), [quakes]);

  // init
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;
    let created: MLMap | null = null;
    workerReady.then(() => {
      if (cancelled || !containerRef.current) return;
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: STYLE,
        bounds: PANAMA_BOUNDS,
        fitBoundsOptions: { padding: 24 },
        attributionControl: { compact: true },
        cooperativeGestures: true,
      });
      created = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.on("load", () => {
        const empty = { type: "FeatureCollection" as const, features: [] as any[] };
        // Two sources carry the same data: one plain (short ranges) and one clustered (30 d / 1 y),
        // where hundreds of aftershocks would otherwise paint the Azuero peninsula solid.
        map.addSource("quakes", { type: "geojson", data: empty });
        map.addSource("quakes-c", { type: "geojson", data: empty, cluster: true, clusterRadius: 34, clusterMaxZoom: 9 });
        map.addSource("darts", { type: "geojson", data: dartFC([]) });
        map.addSource("zones", { type: "geojson", data: zoneFC([], "") });

        const circlePaint: any = {
          "circle-radius": MAG_RADIUS_EXPR,
          "circle-color": AGE_COLOR_EXPR,
          "circle-opacity": 0.85,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.2,
        };

        // --- clustered layers (30 d / 1 y) ---
        map.addLayer({
          id: "cluster-circle",
          type: "circle",
          source: "quakes-c",
          filter: ["has", "point_count"],
          paint: {
            "circle-radius": ["step", ["get", "point_count"], 14, 10, 18, 50, 23, 200, 29],
            "circle-color": "#7a93a8",
            "circle-opacity": 0.85,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
          },
        });
        map.addLayer({
          id: "cluster-count",
          type: "symbol",
          source: "quakes-c",
          filter: ["has", "point_count"],
          layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Bold"], "text-size": 12, "text-allow-overlap": true },
          paint: { "text-color": "#ffffff" },
        });
        map.addLayer({ id: "cluster-single", type: "circle", source: "quakes-c", filter: ["!", ["has", "point_count"]], layout: { "circle-sort-key": ["get", "sortKey"] }, paint: circlePaint });
        map.addLayer({
          id: "cluster-single-label",
          type: "symbol",
          source: "quakes-c",
          filter: ["all", ["!", ["has", "point_count"]], ["!=", ["get", "label"], ""]],
          layout: {
            "text-field": ["get", "label"],
            "text-font": ["Noto Sans Bold"],
            "text-size": 12,
            "text-anchor": "top",
            "text-variable-anchor": ["top", "bottom", "left", "right"],
            "text-radial-offset": ["interpolate", ["linear"], ["get", "mag"], 2, 0.7, 5, 1.2, 7, 1.9],
            "text-justify": "auto",
            "symbol-sort-key": ["get", "sortKey"],
          },
          paint: { "text-color": "#1b2a38", "text-halo-color": "#ffffff", "text-halo-width": 1.6 },
        });

        // --- plain layers (24 h / 72 h / 7 d; also M5.5+ in clustered ranges, drawn on top) ---
        map.addLayer({
          id: "quakes-newest-ring",
          type: "circle",
          source: "quakes",
          filter: ["==", ["get", "newest"], 1],
          paint: {
            "circle-radius": ["+", MAG_RADIUS_EXPR, 7],
            "circle-color": "rgba(0,0,0,0)",
            "circle-stroke-color": "#1b2a38",
            "circle-stroke-width": 2,
            "circle-stroke-opacity": 0.9,
          },
        });
        map.addLayer({ id: "quakes-circle", type: "circle", source: "quakes", layout: { "circle-sort-key": ["get", "sortKey"] }, paint: circlePaint });
        map.addLayer({
          id: "quakes-label",
          type: "symbol",
          source: "quakes",
          filter: ["!=", ["get", "label"], ""],
          layout: {
            "text-field": ["get", "label"],
            "text-font": ["Noto Sans Bold"],
            "text-size": 12,
            "text-offset": [0, 0.9],
            "text-anchor": "top",
            "text-variable-anchor": ["top", "bottom", "left", "right"],
            "text-radial-offset": ["interpolate", ["linear"], ["get", "mag"], 2, 0.7, 5, 1.2, 7, 1.9],
            "text-justify": "auto",
            "symbol-sort-key": ["get", "sortKey"],
            "text-allow-overlap": false,
            "text-ignore-placement": false,
          },
          paint: { "text-color": "#1b2a38", "text-halo-color": "#ffffff", "text-halo-width": 1.6 },
        });

        // --- context layers ---
        map.addLayer({
          id: "zones-circle",
          type: "circle",
          source: "zones",
          paint: { "circle-radius": 6, "circle-color": "#0f4c6e", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 },
        });
        map.addLayer({
          id: "zones-label",
          type: "symbol",
          source: "zones",
          layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"], "text-size": 12, "text-offset": [0, 1.0], "text-anchor": "top" },
          paint: { "text-color": "#0f4c6e", "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
        });
        map.addLayer({
          id: "darts-circle",
          type: "circle",
          source: "darts",
          layout: { visibility: "none" },
          paint: {
            "circle-radius": 7,
            "circle-color": ["match", ["get", "status"], "reporting", "#1f6f4a", "offline", "#7a8794", "#7a8794"],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
          },
        });
        map.addLayer({
          id: "darts-label",
          type: "symbol",
          source: "darts",
          layout: { visibility: "none", "text-field": ["concat", "DART ", ["get", "id"]], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, 1.0], "text-anchor": "top" },
          paint: { "text-color": "#1b2a38", "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
        });

        const popup = new maplibregl.Popup({ closeButton: false, maxWidth: "280px" });
        popupRef.current = popup;
        const showQuake = (e: MapLayerMouseEvent) => {
          const f = e.features?.[0];
          if (!f) return;
          popup
            .setLngLat((f.geometry as any).coordinates)
            .setHTML(quakeHtml(f.properties as any, langRef.current))
            .addTo(map);
        };
        map.on("click", "quakes-circle", showQuake);
        map.on("click", "cluster-single", showQuake);
        map.on("click", "cluster-circle", async (e: MapLayerMouseEvent) => {
          const f = e.features?.[0];
          if (!f) return;
          const src = map.getSource("quakes-c") as GeoJSONSource;
          const zoom = await src.getClusterExpansionZoom((f.properties as any).cluster_id);
          map.easeTo({ center: (f.geometry as any).coordinates, zoom: Math.min(zoom, 11) });
        });
        map.on("click", "darts-circle", (e: MapLayerMouseEvent) => {
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties as any;
          const st = t(langRef.current);
          const status = p.status === "reporting" ? st.buoyReporting : p.status === "offline" ? st.buoyOffline : st.buoyUnknown;
          popup
            .setLngLat((f.geometry as any).coordinates)
            .setHTML(`<div><b>DART ${p.id}</b><br/>${p.name}<br/><span style="color:#5b6b7a">${status}</span></div>`)
            .addTo(map);
        });
        for (const id of ["quakes-circle", "cluster-single", "cluster-circle", "darts-circle"]) {
          map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
          map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
        }
        setReady(true);
      });
      mapRef.current = map;
    });
    return () => {
      cancelled = true;
      created?.remove();
      mapRef.current = null;
    };
  }, []);

  // quake data + range
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const fc = quakeFC(quakes, range, lang, Date.now());
    const empty = { type: "FeatureCollection" as const, features: [] as any[] };
    if (clustered) {
      const majors = { ...fc, features: fc.features.filter((f) => f.properties.major === 1) };
      const rest = { ...fc, features: fc.features.filter((f) => f.properties.major !== 1) };
      (map.getSource("quakes") as GeoJSONSource)?.setData(majors);
      (map.getSource("quakes-c") as GeoJSONSource)?.setData(rest);
    } else {
      (map.getSource("quakes") as GeoJSONSource)?.setData(fc);
      (map.getSource("quakes-c") as GeoJSONSource)?.setData(empty);
    }
  }, [quakes, range, lang, ready, clustered]);

  // Zoom to the activity when the range changes (and once when data first arrives). Routine
  // refreshes never move the map, so a user who has panned is not interrupted.
  const fittedRef = useRef<string>("");
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || wide || !quakes.length) return;
    if (range === "latest") {
      const q = newest!;
      const key = `latest:${q.id}:${lang}`;
      if (fittedRef.current === key) return;
      fittedRef.current = key;
      map.flyTo({ center: [q.lon, q.lat], zoom: Math.max(map.getZoom(), 8.3), duration: 900 });
      popupRef.current
        ?.setLngLat([q.lon, q.lat])
        .setHTML(quakeHtml({ mag: q.mag ?? 0, time: q.time, place: q.place, depth: q.depthKm, source: q.source }, lang))
        .addTo(map);
      return;
    }
    popupRef.current?.remove();
    const key = `${range}:${selectedZone.id}`;
    if (fittedRef.current === key) return;
    fittedRef.current = key;
    // Frame Panama's own events (plus the selected coast); far-off regional events still draw but do not pull the view away.
    const b = new maplibregl.LngLatBounds();
    const local = quakes.filter((q) => q.lat >= 6.5 && q.lat <= 10.5 && q.lon >= -84 && q.lon <= -76.5);
    for (const q of local.length ? local : quakes) b.extend([q.lon, q.lat]);
    b.extend([selectedZone.lon, selectedZone.lat]);
    const small = map.getContainer().clientWidth < 640;
    map.fitBounds(b, { padding: small ? { top: 40, bottom: 56, left: 48, right: 48 } : { top: 56, bottom: 150, left: 60, right: 60 }, maxZoom: 9, duration: 700 });
  }, [quakes, range, ready, wide, selectedZone, newest, lang]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("darts") as GeoJSONSource)?.setData(dartFC(darts));
  }, [darts, ready]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("zones") as GeoJSONSource)?.setData(zoneFC(zones, selectedZone.id));
  }, [zones, selectedZone, ready]);

  // extent toggle: the DART view widens the map and reveals the buoys; the Panamá view hides them
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const id of ["darts-circle", "darts-label"]) map.setLayoutProperty(id, "visibility", wide ? "visible" : "none");
    if (wide) {
      const b = new maplibregl.LngLatBounds();
      for (const d of darts) b.extend([d.lon, d.lat]);
      for (const z of zones) b.extend([z.lon, z.lat]);
      map.fitBounds(b, { padding: 40, duration: 700 });
    } else {
      map.fitBounds(PANAMA_BOUNDS, { padding: 24, duration: 700 });
    }
  }, [wide, ready, darts.length, zones.length]);

  const hours = rangeHours(range);
  const legendRows: { color: string; label: string }[] = [];
  if (range !== "latest") {
    legendRows.push({ color: AGE_COLORS.hour, label: s.mapAge.hour });
    legendRows.push({ color: AGE_COLORS.day, label: s.mapAge.day });
    if (hours > 24) legendRows.push({ color: AGE_COLORS.week, label: s.mapAge.week });
    if (hours > 168) legendRows.push({ color: AGE_COLORS.month, label: s.mapAge.month });
    if (hours > 720) legendRows.push({ color: AGE_COLORS.older, label: s.mapAge.older });
  }

  return (
    <div className="flex h-full w-full flex-col">
      {/* Header: range selector + summary */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-card-border px-3 py-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-tight" data-testid="text-map-title">
            {s.mapTitle}
          </div>
          <div className="num text-xs text-muted-foreground" data-testid="text-map-summary">
            {quakes.length === 0
              ? s.mapNone
              : range === "latest" && newest
                ? `M${newest.mag?.toFixed(1)} · ${newest.place} · ${relTime(newest.time, lang)}`
                : `${quakes.length} ${quakes.length === 1 ? s.mapQuakeOne : s.mapQuakeMany} · ${s.mapNewest} ${newest ? relTime(newest.time, lang) : "—"}${strongest && quakes.length > 1 ? ` · ${s.mapStrongest} M${strongest.mag?.toFixed(1)}` : ""}`}
          </div>
        </div>
        <div className="inline-flex rounded-md border border-card-border bg-muted/40 p-0.5" role="tablist" aria-label={s.mapRange} data-testid="map-range">
          <button
            type="button"
            role="tab"
            aria-selected={range === "latest"}
            onClick={() => onRangeChange("latest")}
            title={s.mapLatestHint}
            className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-1 text-xs font-medium transition-colors sm:px-2.5 ${range === "latest" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            data-testid="button-range-latest"
          >
            <LocateFixed className="h-3.5 w-3.5 shrink-0" />
            {s.ranges.latest}
          </button>
          <span className="mx-0.5 my-1 w-px bg-card-border" aria-hidden="true" />
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              role="tab"
              aria-selected={range === r.key}
              onClick={() => onRangeChange(r.key)}
              className={`whitespace-nowrap rounded px-2 py-1 text-xs font-medium transition-colors sm:px-2.5 ${range === r.key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              data-testid={`button-range-${r.key}`}
            >
              <span className="sm:hidden">{s.rangesShort[r.key]}</span>
              <span className="hidden sm:inline">{s.ranges[r.key]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="h-full w-full" data-testid="map-canvas" />

        {quakes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4">
            <div className="pointer-events-auto rounded-md border border-card-border bg-card/95 px-4 py-3 text-center text-sm shadow-sm">
              <div className="font-medium">{s.mapNone}</div>
              <div className="mt-1 text-xs text-muted-foreground">{s.mapNoneHint}</div>
            </div>
          </div>
        )}

        <div className="pointer-events-none absolute left-0 top-0 z-10 p-2">
          <Button size="sm" variant="outline" className="pointer-events-auto bg-card/95" onClick={() => setWide((w) => !w)} data-testid="button-map-extent">
            {wide ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            <span className="ml-1.5">{wide ? "Panamá" : "DART"}</span>
          </Button>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-2 p-2 pb-7">
          {!legendOpen ? (
            <button type="button" onClick={() => setLegendOpen(true)} className="pointer-events-auto rounded-md border border-card-border bg-card/95 px-2.5 py-1 text-xs font-medium text-foreground shadow-sm" data-testid="button-legend-open">
              {s.mapLegend.show}
            </button>
          ) : (
          <div className="pointer-events-auto rounded-md border border-card-border bg-card/95 px-2.5 py-2 text-xs leading-5 text-muted-foreground backdrop-blur-xs" data-testid="map-legend">
            <div className="mb-0.5 flex items-center justify-between gap-3 font-medium text-foreground">
              {range === "latest" ? s.mapLegend.show : s.mapLegend.age}
              <button type="button" onClick={() => setLegendOpen(false)} className="text-[11px] font-normal text-muted-foreground hover:text-foreground sm:hidden" data-testid="button-legend-close">
                {s.mapLegend.hide}
              </button>
            </div>
            {legendRows.map((r) => (
              <div key={r.label} className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full border border-white" style={{ background: r.color }} /> {r.label}
              </div>
            ))}
            <div className="mt-1.5 flex items-center gap-2">
              <span className="inline-flex items-end gap-1">
                <span className="inline-block rounded-full bg-[#9fb6c6]" style={{ width: 6, height: 6 }} />
                <span className="inline-block rounded-full bg-[#9fb6c6]" style={{ width: 11, height: 11 }} />
                <span className="inline-block rounded-full bg-[#9fb6c6]" style={{ width: 17, height: 17 }} />
              </span>
              {s.mapLegend.size}
            </div>
            {clustered && (
              <div className="flex items-center gap-2">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#7a93a8] text-[9px] font-bold text-white">12</span> {s.mapLegend.cluster}
              </div>
            )}
            {!clustered && (
              <div className="flex items-center gap-2">
                <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-[#1b2a38]" /> {s.mapLegend.newest}
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-full border-2 border-white" style={{ background: "#0f4c6e" }} /> {s.mapLegend.zone}
            </div>
            {wide && (
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full border-2 border-white" style={{ background: "#1f6f4a" }} /> {s.mapLegend.dart}
              </div>
            )}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}

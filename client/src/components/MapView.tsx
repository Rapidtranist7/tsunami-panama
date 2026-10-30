import { useEffect, useRef, useState } from "react";
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
import type {
  Map as MLMap,
  LngLatBoundsLike,
  MapLayerMouseEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Earthquake, DartStation, Zone } from "@shared/schema";
import type { Lang } from "@/lib/i18n";
import { t, fmtLocal } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Maximize2, Minimize2 } from "lucide-react";

const STYLE = "https://tiles.openfreemap.org/styles/positron";
const PANAMA_BOUNDS: LngLatBoundsLike = [
  [-84.5, 5.0],
  [-76.0, 11.5],
];

interface Props {
  quakes: Earthquake[];
  darts: DartStation[];
  zones: Zone[];
  selectedZone: Zone;
  lang: Lang;
}

function quakeFC(quakes: Earthquake[], now: number) {
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
      properties: {
        id: d.id,
        name: d.name,
        status: d.status,
        eventMode: d.eventMode,
      },
    })),
  };
}

function zoneFC(zones: Zone[], selected: string) {
  return {
    type: "FeatureCollection" as const,
    features: zones.map((z) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [z.lon, z.lat] },
      properties: {
        id: z.id,
        name: z.name,
        selected: z.id === selected ? 1 : 0,
      },
    })),
  };
}

export default function MapView({
  quakes,
  darts,
  zones,
  selectedZone,
  lang,
}: Props) {
  const s = t(lang);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [wide, setWide] = useState(false);
  const langRef = useRef(lang);
  langRef.current = lang;

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
      map.addControl(
        new maplibregl.NavigationControl({ showCompass: false }),
        "top-right",
      );
      map.on("load", () => {
        map.addSource("quakes", {
          type: "geojson",
          data: quakeFC([], Date.now()),
        });
        map.addSource("darts", { type: "geojson", data: dartFC([]) });
        map.addSource("zones", { type: "geojson", data: zoneFC([], "") });

        map.addLayer({
          id: "quakes-circle",
          type: "circle",
          source: "quakes",
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["get", "mag"],
              2.5,
              4,
              4,
              6,
              5,
              9,
              6,
              13,
              7,
              19,
              8,
              26,
            ],
            "circle-color": [
              "step",
              ["get", "ageH"],
              "#b7322a",
              24,
              "#c47a12",
              168,
              "#6f93ad",
            ],
            "circle-opacity": 0.72,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 1.2,
          },
        });
        map.addLayer({
          id: "zones-circle",
          type: "circle",
          source: "zones",
          paint: {
            "circle-radius": ["case", ["==", ["get", "selected"], 1], 7, 4],
            "circle-color": [
              "case",
              ["==", ["get", "selected"], 1],
              "#0f4c6e",
              "#ffffff",
            ],
            "circle-stroke-color": "#0f4c6e",
            "circle-stroke-width": 2,
          },
        });
        map.addLayer({
          id: "zones-label",
          type: "symbol",
          source: "zones",
          filter: ["==", ["get", "selected"], 1],
          layout: {
            "text-field": ["get", "name"],
            "text-font": ["Noto Sans Bold"],
            "text-size": 12,
            "text-offset": [0, 1.1],
            "text-anchor": "top",
          },
          paint: {
            "text-color": "#0f4c6e",
            "text-halo-color": "#ffffff",
            "text-halo-width": 1.5,
          },
        });
        map.addLayer({
          id: "darts-circle",
          type: "circle",
          source: "darts",
          paint: {
            "circle-radius": 7,
            "circle-color": [
              "match",
              ["get", "status"],
              "reporting",
              "#1f6f4a",
              "offline",
              "#7a8794",
              "#7a8794",
            ],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
          },
        });
        map.addLayer({
          id: "darts-label",
          type: "symbol",
          source: "darts",
          layout: {
            "text-field": ["concat", "DART ", ["get", "id"]],
            "text-font": ["Noto Sans Regular"],
            "text-size": 11,
            "text-offset": [0, 1.0],
            "text-anchor": "top",
          },
          paint: {
            "text-color": "#1b2a38",
            "text-halo-color": "#ffffff",
            "text-halo-width": 1.5,
          },
        });

        const popup = new maplibregl.Popup({
          closeButton: false,
          maxWidth: "260px",
        });
        map.on("click", "quakes-circle", (e: MapLayerMouseEvent) => {
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties as any;
          const l = langRef.current;
          popup
            .setLngLat((f.geometry as any).coordinates)
            .setHTML(
              `<div><b>M ${Number(p.mag).toFixed(1)}</b> · ${Number(p.depth).toFixed(0)} km<br/>${p.place}<br/><span style="color:#5b6b7a">${fmtLocal(Number(p.time), l, { year: "numeric" })} (Panamá)</span></div>`,
            )
            .addTo(map);
        });
        map.on("click", "darts-circle", (e: MapLayerMouseEvent) => {
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties as any;
          const l = langRef.current;
          const st = t(l);
          const status =
            p.status === "reporting"
              ? st.buoyReporting
              : p.status === "offline"
                ? st.buoyOffline
                : st.buoyUnknown;
          popup
            .setLngLat((f.geometry as any).coordinates)
            .setHTML(
              `<div><b>DART ${p.id}</b><br/>${p.name}<br/><span style="color:#5b6b7a">${status}</span></div>`,
            )
            .addTo(map);
        });
        for (const id of ["quakes-circle", "darts-circle"]) {
          map.on(
            "mouseenter",
            id,
            () => (map.getCanvas().style.cursor = "pointer"),
          );
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

  // data updates
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("quakes") as maplibregl.GeoJSONSource)?.setData(
      quakeFC(quakes, Date.now()),
    );
  }, [quakes, ready]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("darts") as maplibregl.GeoJSONSource)?.setData(
      dartFC(darts),
    );
  }, [darts, ready]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("zones") as maplibregl.GeoJSONSource)?.setData(
      zoneFC(zones, selectedZone.id),
    );
  }, [zones, selectedZone, ready]);

  // extent toggle
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (wide) {
      const b = new maplibregl.LngLatBounds();
      for (const d of darts) b.extend([d.lon, d.lat]);
      for (const z of zones) b.extend([z.lon, z.lat]);
      map.fitBounds(b, { padding: 40, duration: 700 });
    } else {
      map.fitBounds(PANAMA_BOUNDS, { padding: 24, duration: 700 });
    }
  }, [wide, ready, darts.length, zones.length]);

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        className="h-full w-full"
        data-testid="map-canvas"
      />
      <div className="pointer-events-none absolute left-0 top-0 z-10 p-2">
        <Button
          size="sm"
          variant="outline"
          className="pointer-events-auto bg-card/95"
          onClick={() => setWide((w) => !w)}
          data-testid="button-map-extent"
        >
          {wide ? (
            <Minimize2 className="h-4 w-4" />
          ) : (
            <Maximize2 className="h-4 w-4" />
          )}
          <span className="ml-1.5">{wide ? "Panamá" : "DART"}</span>
        </Button>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-2 p-2 pb-7">
        <div
          className="pointer-events-auto rounded-md border border-card-border bg-card/95 px-2.5 py-2 text-xs leading-5 text-muted-foreground backdrop-blur-xs"
          data-testid="map-legend"
        >
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ background: "#b7322a" }}
            />{" "}
            {s.mapLegend.recent}
          </div>
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ background: "#6f93ad" }}
            />{" "}
            {s.mapLegend.quake}
          </div>
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-full border-2 border-white"
              style={{ background: "#1f6f4a" }}
            />{" "}
            {s.mapLegend.dart}
          </div>
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-full border-2"
              style={{ background: "#0f4c6e", borderColor: "#0f4c6e" }}
            />{" "}
            {s.mapLegend.zone}
          </div>
        </div>
      </div>
    </div>
  );
}

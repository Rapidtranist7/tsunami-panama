import type {
  Earthquake,
  EarthquakesResponse,
  DartReading,
  DartStation,
  DartResponse,
  PtwcProduct,
  PtwcEta,
  TsunamiResponse,
  ThreatLevel,
  Coast,
} from "../shared/schema";
import { storage } from "./store";

const UA = "TsunamiPanama/0.1 (public-safety prototype; contact via app)";

async function fetchText(url: string, timeoutMs = 15000): Promise<{ ok: boolean; status: number; text: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "*/*" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = res.ok ? await res.text() : "";
  return { ok: res.ok, status: res.status, text };
}

/* ---------- tiny TTL cache ---------- */
const cache = new Map<string, { exp: number; value: unknown }>();
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.value as T;
  const value = await fn();
  cache.set(key, { exp: Date.now() + ttlMs, value });
  return value;
}

/* =====================================================================
 * Earthquakes — three agencies, merged
 *
 *  1. IGC-UP  Instituto de Geociencias, Universidad de Panamá. The national
 *             seismic network. Its public page lists every located event in
 *             and around Panama for the last ~7 days (typically M2.5+), with
 *             PRELIMINAR (automatic) / REVISADO (analyst-reviewed) status.
 *             This is what SINAPROC and Panamanian media quote.
 *  2. USGS    NEIC global catalog. Reliable, but for Panama it only carries
 *             roughly M4.5+ (sometimes M4+), so it misses most of the
 *             aftershock activity the national network records.
 *  3. EMSC    Euro-Med Seismological Centre. Relays IGC, OVSICORI-UNA and
 *             UCR (Costa Rica) solutions through a standard FDSN API — used
 *             as a backup when the IGC page is unreachable and to cover the
 *             border region.
 * ===================================================================== */

const USGS = "https://earthquake.usgs.gov/fdsnws/event/1/query";
const EMSC = "https://www.seismicportal.eu/fdsnws/event/1/query";
const IGC_PAGE = "https://sismosgeociencias.up.ac.pa/";

// Panama and adjacent Pacific / Caribbean waters
const REGION = { minlatitude: 4.5, maxlatitude: 12, minlongitude: -85.5, maxlongitude: -76 };
const PANAMA = { minlatitude: 6.5, maxlatitude: 10.5, minlongitude: -84, maxlongitude: -76.5 };

function toEq(f: any): Earthquake {
  const p = f.properties ?? {};
  const c = f.geometry?.coordinates ?? [null, null, null];
  return {
    id: f.id,
    mag: typeof p.mag === "number" ? p.mag : null,
    magType: p.magType ?? null,
    place: p.place ?? "",
    time: p.time,
    updated: p.updated,
    lon: c[0],
    lat: c[1],
    depthKm: typeof c[2] === "number" ? c[2] : null,
    tsunamiFlag: p.tsunami === 1,
    url: p.url,
    status: p.status ?? "automatic",
    source: "USGS",
    alsoReportedBy: [],
  };
}

async function usgsQuery(params: Record<string, string | number>): Promise<Earthquake[]> {
  const qs = new URLSearchParams({ format: "geojson", orderby: "time", ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
  const r = await fetchText(`${USGS}?${qs}`, 20000);
  if (!r.ok) throw new Error(`USGS ${r.status}`);
  const json = JSON.parse(r.text);
  return (json.features ?? []).map(toEq);
}

/* ---------- EMSC (FDSN event service, JSON) ---------- */

function emscToEq(f: any): Earthquake {
  const p = f.properties ?? {};
  const c = f.geometry?.coordinates ?? [p.lon, p.lat, p.depth];
  const auth = String(p.auth ?? "EMSC").toUpperCase();
  const time = Date.parse(p.time);
  const updated = p.lastupdate ? Date.parse(p.lastupdate) : time;
  const region = String(p.flynn_region ?? "")
    .toLowerCase()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
  return {
    id: `emsc-${p.source_id ?? p.unid ?? f.id}`,
    mag: typeof p.mag === "number" ? p.mag : null,
    magType: p.magtype ?? null,
    place: region,
    time,
    updated,
    lon: c[0],
    lat: c[1],
    depthKm: typeof p.depth === "number" ? p.depth : typeof c[2] === "number" ? Math.abs(c[2]) : null,
    tsunamiFlag: false,
    url: p.source_id ? `https://www.emsc-csem.org/Earthquake_information/earthquake.php?id=${p.source_id}` : "https://www.emsc-csem.org/",
    status: "automatic",
    source: `EMSC/${auth}`,
    alsoReportedBy: [],
  };
}

async function emscQuery(params: Record<string, string | number>): Promise<Earthquake[]> {
  // EMSC uses minlat/maxlat/minlon/maxlon and start/end rather than the USGS spellings.
  const map: Record<string, string> = { minlatitude: "minlat", maxlatitude: "maxlat", minlongitude: "minlon", maxlongitude: "maxlon", starttime: "start", endtime: "end", minmagnitude: "minmag" };
  const qs = new URLSearchParams({ format: "json", limit: "1000" });
  for (const [k, v] of Object.entries(params)) qs.set(map[k] ?? k, String(v));
  const r = await fetchText(`${EMSC}?${qs}`, 20000);
  if (r.status === 204) return [];
  if (!r.ok) throw new Error(`EMSC ${r.status}`);
  const json = JSON.parse(r.text);
  return (json.features ?? []).map(emscToEq).filter((e: Earthquake) => Number.isFinite(e.time));
}

/* ---------- IGC-UP (Instituto de Geociencias, Universidad de Panamá) ---------- */

const PANAMA_UTC_OFFSET_H = 5; // Panama is UTC-5 all year (no DST)

/** "2026-10-31" + "10:50:19AM" (Panama local) -> epoch ms */
function igcLocalToEpoch(date: string, hms: string): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const t = /^(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i.exec(hms.trim());
  if (!d || !t) return null;
  let h = parseInt(t[1], 10) % 12;
  if (t[4].toUpperCase() === "PM") h += 12;
  return Date.UTC(+d[1], +d[2] - 1, +d[3], h + PANAMA_UTC_OFFSET_H, +t[2], +t[3]);
}

const stripTags = (x: string) => x.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/**
 * Parse the IGC-UP "últimos sismos" table. Each event appears in several
 * layout variants of the page (desktop table + mobile cards), so rows are
 * de-duplicated on date+time+position.
 */
function parseIgc(html: string): Earthquake[] {
  const out = new Map<string, Earthquake>();
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    const cells = Array.from(m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((c) => c[1]);
    if (cells.length < 8) continue;
    const [estado, fecha, hora, latS, lonS, profS, magS, regionS] = cells.map(stripTags);
    const lat = parseFloat(latS);
    const lon = parseFloat(lonS);
    const time = igcLocalToEpoch(fecha, hora);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || time === null) continue;
    const depth = parseFloat(profS);
    const mag = parseFloat(magS);
    const href = /href="([^"]*ultimosismo\.html[^"]*)"/i.exec(m[1])?.[1];
    const url = href ? new URL(href.replace(/&amp;/g, "&"), IGC_PAGE).toString() : IGC_PAGE;
    const key = `${fecha}T${hora}@${lat.toFixed(3)},${lon.toFixed(3)}`;
    if (out.has(key)) continue;
    out.set(key, {
      id: `igc-${fecha}-${hora.replace(/[^0-9]/g, "")}-${lat.toFixed(3)}-${lon.toFixed(3)}`,
      mag: Number.isFinite(mag) ? mag : null,
      magType: "M",
      place: regionS.replace(/^Localizado en\s+/i, ""),
      time,
      updated: time,
      lat,
      lon,
      depthKm: Number.isFinite(depth) ? depth : null,
      tsunamiFlag: false,
      url,
      status: /REVISADO/i.test(estado) ? "reviewed" : "automatic",
      source: "IGC-UP",
      alsoReportedBy: [],
    });
  }
  return Array.from(out.values());
}

async function igcQuery(): Promise<Earthquake[]> {
  const r = await fetchText(IGC_PAGE, 25000);
  if (!r.ok) throw new Error(`IGC-UP ${r.status}`);
  const rows = parseIgc(r.text);
  if (!rows.length) throw new Error("IGC-UP page returned no events (layout changed?)");
  return rows;
}

/* ---------- cross-agency merge ---------- */

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Two agencies' solutions describe the same earthquake if origin times are within 45 s and epicentres within 100 km.
// (Cross-agency differences are normally a few seconds and a few tens of km; aftershocks in a busy
// sequence are rarely closer than that in both time and space.)
const SAME_EVENT_SECONDS = 45;
const SAME_EVENT_KM = 100;

const agencyOf = (e: Earthquake) => e.source.split("/")[0];

/**
 * Remove repeats inside a single agency's feed: identical ids (the same USGS event
 * returned by two queries) or the same row rendered twice on the IGC page
 * (origin time within 2 s and epicentre within 5 km). Reviewed solutions win.
 */
function dedupeWithinAgency(rows: Earthquake[]): Earthquake[] {
  const ordered = [...rows].sort((a, b) => (a.status === "reviewed" ? -1 : 1) - (b.status === "reviewed" ? -1 : 1));
  const out: Earthquake[] = [];
  const ids = new Set<string>();
  for (const e of ordered) {
    if (ids.has(e.id)) continue;
    if (out.some((m) => agencyOf(m) === agencyOf(e) && Math.abs(m.time - e.time) <= 2000 && haversineKm(m.lat, m.lon, e.lat, e.lon) <= 5)) continue;
    ids.add(e.id);
    out.push(e);
  }
  return out;
}

function describe(e: Earthquake): string {
  return `${e.source} ${e.mag !== null ? `M${e.mag.toFixed(1)}` : "M?"}${e.magType && e.magType !== "M" ? ` ${e.magType}` : ""}`;
}

/**
 * Merge solutions from several agencies. `groups` are in priority order: the
 * first agency that located an event provides the displayed solution, later
 * ones are recorded in `alsoReportedBy`. A USGS tsunami flag is preserved
 * whichever solution wins.
 */
function mergeAgencies(groups: Earthquake[][]): Earthquake[] {
  const merged: Earthquake[] = [];
  for (const group of groups) {
    for (const e of dedupeWithinAgency(group)) {
      // Only match against solutions from *other* agencies: one agency never lists the same quake twice
      // (after dedupeWithinAgency), so two of its entries close together are two different shocks.
      const dup = merged.find((m) => agencyOf(m) !== agencyOf(e) && !m.alsoReportedBy.some((x) => x.startsWith(agencyOf(e))) && Math.abs(m.time - e.time) <= SAME_EVENT_SECONDS * 1000 && haversineKm(m.lat, m.lon, e.lat, e.lon) <= SAME_EVENT_KM);
      if (dup) {
        if (!dup.alsoReportedBy.includes(describe(e))) dup.alsoReportedBy.push(describe(e));
        if (e.tsunamiFlag) dup.tsunamiFlag = true;
        if (e.updated > dup.updated) dup.updated = e.updated;
      } else {
        merged.push({ ...e, alsoReportedBy: [...e.alsoReportedBy] });
      }
    }
  }
  merged.sort((a, b) => b.time - a.time);
  return merged;
}

async function settle(name: string, p: Promise<Earthquake[]>): Promise<{ status: { name: string; ok: boolean; count: number; error?: string }; rows: Earthquake[] }> {
  try {
    const rows = await p;
    return { status: { name, ok: true, count: rows.length }, rows };
  } catch (err: any) {
    return { status: { name, ok: false, count: 0, error: err?.message ?? String(err) }, rows: [] };
  }
}

export async function getEarthquakes(): Promise<EarthquakesResponse> {
  return cached("eq", 60_000, async () => {
    const now = new Date();
    const d30 = new Date(now.getTime() - 30 * 86400_000).toISOString();
    const d7 = new Date(now.getTime() - 7 * 86400_000).toISOString();
    const out: EarthquakesResponse = { fetchedAt: now.toISOString(), source: "IGC-UP + USGS + EMSC", feeds: [], regional: [], farField: [] };

    const d365 = new Date(now.getTime() - 365 * 86400_000).toISOString();
    const [igc, usgsWide, usgsTight, usgsFar, emscWide, emscTight, usgsYear] = await Promise.all([
      settle("IGC-UP", igcQuery()),
      settle("USGS (region, 30 d, M4+)", usgsQuery({ ...REGION, starttime: d30, minmagnitude: 4.0, limit: 500 })),
      settle("USGS (Panama, 7 d, M2.5+)", usgsQuery({ ...PANAMA, starttime: d7, minmagnitude: 2.5, limit: 500 })),
      settle("USGS (world, 7 d, M6.5+)", usgsQuery({ starttime: d7, minmagnitude: 6.5, limit: 100 })),
      settle("EMSC (region, 30 d, M4+)", emscQuery({ ...REGION, starttime: d30, minmagnitude: 4.0 })),
      settle("EMSC (Panama, 7 d, all)", emscQuery({ ...PANAMA, starttime: d7 })),
      // One-year context for the map's "1 year" range. Refreshed every 15 min; USGS caches long searches anyway.
      settle("USGS (region, 1 y, M4.5+)", cached("eq-year", 15 * 60_000, () => usgsQuery({ ...REGION, starttime: d365, endtime: d30, minmagnitude: 4.5, limit: 2000 }))),
    ]);
    out.feeds = [igc.status, usgsWide.status, usgsTight.status, usgsFar.status, emscWide.status, emscTight.status, usgsYear.status];

    // Drop IGC rows outside the regional box (it also lists teleseisms felt in Panama).
    const igcRegional = igc.rows.filter((e) => e.lat >= REGION.minlatitude && e.lat <= REGION.maxlatitude && e.lon >= REGION.minlongitude && e.lon <= REGION.maxlongitude);

    out.regional = mergeAgencies([igcRegional, [...usgsWide.rows, ...usgsTight.rows, ...usgsYear.rows], [...emscWide.rows, ...emscTight.rows]]);

    const regionalKeys = out.regional;
    out.farField = usgsFar.rows
      .filter((e) => !regionalKeys.some((m) => Math.abs(m.time - e.time) <= SAME_EVENT_SECONDS * 1000 && haversineKm(m.lat, m.lon, e.lat, e.lon) <= SAME_EVENT_KM))
      .sort((a, b) => b.time - a.time);

    if (!out.feeds.some((f) => f.ok)) out.error = out.feeds.map((f) => `${f.name}: ${f.error}`).join("; ");
    else if (!igc.status.ok) out.error = `IGC-UP: ${igc.status.error}`;
    return out;
  });
}

/* =====================================================================
 * NOAA / NDBC DART buoys
 * ===================================================================== */

// Metadata from the NDBC DART station listing (https://www.ndbc.noaa.gov/dart_stations.php)
const DART_STATIONS: Array<Pick<DartStation, "id" | "name" | "coast" | "lat" | "lon" | "depthM">> = [
  { id: "32411", name: "West Panama — 710 NM WSW of Panama City", coast: "pacific", lat: 4.979, lon: -90.793, depthM: 3262 },
  { id: "32413", name: "1000 NM WNW of Lima, Peru", coast: "pacific", lat: -7.40667, lon: -93.51722, depthM: 4018 },
  { id: "43413", name: "360 NM SSW of Acapulco, Mexico", coast: "pacific", lat: 11.005, lon: -100.09667, depthM: 3741 },
  { id: "42407", name: "230 NM S of San Juan, Puerto Rico", coast: "caribbean", lat: 15.29333, lon: -68.18833, depthM: 4500 },
];

function parseDart(text: string): DartReading[] {
  const rows: DartReading[] = [];
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const p = line.trim().split(/\s+/);
    if (p.length < 8) continue;
    const [yy, mo, dd, hh, mi, ss, t, h] = p;
    const ts = Date.UTC(+yy, +mo - 1, +dd, +hh, +mi, +ss);
    const height = parseFloat(h);
    if (!Number.isFinite(height) || height > 9000) continue;
    rows.push({ t: ts, height, mode: parseInt(t, 10) });
  }
  rows.sort((a, b) => a.t - b.t);
  return rows;
}

async function getStationNotes(): Promise<Map<string, string>> {
  return cached("ndbc-notes", 6 * 3600_000, async () => {
    const map = new Map<string, string>();
    try {
      const r = await fetchText("https://www.ndbc.noaa.gov/data/stations/station_table.txt", 30000);
      if (!r.ok) return map;
      // Rows are pipe-delimited; multi-line notes continue until the next station row.
      const lines = r.text.split("\n");
      let current: string | null = null;
      let note = "";
      const flush = () => {
        if (current && note.trim()) map.set(current, note.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
      };
      for (const line of lines) {
        if (/^\d{5}\|/.test(line) || /^[A-Z0-9]{5}\|/.test(line)) {
          flush();
          const cols = line.split("|");
          current = cols[0];
          note = cols[8] ?? "";
        } else if (current) {
          note += " " + line;
        }
      }
      flush();
    } catch {
      /* notes are optional */
    }
    return map;
  });
}

export async function getDart(): Promise<DartResponse> {
  return cached("dart", 5 * 60_000, async () => {
    const notes = await getStationNotes();
    const now = Date.now();
    const stations = await Promise.all(
      DART_STATIONS.map(async (meta): Promise<DartStation> => {
        const dataUrl = `https://www.ndbc.noaa.gov/data/realtime2/${meta.id}.dart`;
        const base: DartStation = {
          ...meta,
          status: "unknown",
          statusNote: notes.get(meta.id) ?? null,
          latest: null,
          eventMode: false,
          series: [],
          dataAgeMinutes: null,
          pageUrl: `https://www.ndbc.noaa.gov/station_page.php?station=${meta.id}`,
          dataUrl,
        };
        try {
          const r = await fetchText(dataUrl, 20000);
          if (r.status === 404) return { ...base, status: "offline" };
          if (!r.ok) return { ...base, error: `NDBC ${r.status}` };
          const all = parseDart(r.text);
          const series = all.filter((x) => x.t >= now - 24 * 3600_000);
          const latest = all.length ? all[all.length - 1] : null;
          const ageMin = latest ? Math.round((now - latest.t) / 60000) : null;
          return {
            ...base,
            status: latest && ageMin !== null && ageMin < 9 * 60 ? "reporting" : "offline",
            latest,
            eventMode: series.some((x) => x.mode === 2 || x.mode === 3),
            series,
            dataAgeMinutes: ageMin,
          };
        } catch (err: any) {
          return { ...base, error: err?.message ?? String(err) };
        }
      }),
    );
    return { fetchedAt: new Date(now).toISOString(), source: "https://www.ndbc.noaa.gov/dart.shtml", stations };
  });
}

/* =====================================================================
 * NOAA Pacific Tsunami Warning Center (PTWC) products
 *   WEPA40 — Pacific Ocean international threat/information messages
 *   WECA40 — Caribbean international threat/information messages
 * ===================================================================== */

const TG = "https://www.tsunami.gov";
const PRODUCTS: Array<{ wmoId: string; basin: Coast }> = [
  { wmoId: "WEPA40", basin: "pacific" },
  { wmoId: "WECA40", basin: "caribbean" },
];

function parseJsVar(text: string): any {
  const i = text.indexOf("{");
  const j = text.lastIndexOf("}");
  if (i < 0 || j < 0) throw new Error("no JSON object in product file");
  return JSON.parse(text.slice(i, j + 1));
}

function parseEtas(bulletin: string): PtwcEta[] {
  const etas: PtwcEta[] = [];
  const re = /^\s+(.+?)\s{2,}PANAMA\s+([\d.]+)([NS])\s+([\d.]+)([EW])\s+(\d{2})(\d{2})\s+(\d{2})\/(\d{2})\s*$/gm;
  const year = new Date().getUTCFullYear();
  let m: RegExpExecArray | null;
  while ((m = re.exec(bulletin))) {
    const lat = parseFloat(m[2]) * (m[3] === "S" ? -1 : 1);
    const lon = parseFloat(m[4]) * (m[5] === "W" ? -1 : 1);
    const iso = new Date(Date.UTC(year, +m[8] - 1, +m[9], +m[6], +m[7])).toISOString();
    etas.push({ location: m[1].trim(), lat, lon, etaUtc: iso });
  }
  return etas;
}

function levelFromCategory(cat: string | null, isFinal: boolean): ThreatLevel {
  if (isFinal || !cat) return "none";
  const c = cat.toLowerCase();
  if (c.includes("information") || c.includes("less than 0.3") || c.includes("<0.3")) return "none";
  if (c.includes("0.3-1") || c.includes("0.3 - 1")) return "advisory";
  if (c.includes("1-3") || c.includes(">3") || c.includes("3 meters") || c.includes("warning") || c.includes("potential threat")) return "warning";
  return "advisory";
}

/** Headline line of a PTWC text bulletin, e.g. "...PTWC TSUNAMI THREAT MESSAGE..." */
function headlineFromBulletin(text: string): string | null {
  const m = text.match(/^\s*\.\.\.(.+?)\.\.\.\s*$/m);
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

async function fetchProduct(wmoId: string, basin: Coast): Promise<PtwcProduct> {
  const r = await fetchText(`${TG}/events/js/PHEB${wmoId}.js`, 15000);
  if (!r.ok) throw new Error(`${wmoId}: tsunami.gov ${r.status}`);
  const j = parseJsVar(r.text);
  const eventDir: string = j.eventDir ?? "";
  const bulletinUrl = `${TG}${eventDir}${wmoId}.txt`;
  const areas: any[] = (j.alerts?.areaList ?? []).flat();
  const pan = areas.find((a) => String(a?.zone ?? "").toLowerCase() === "panama");
  const headlineRaw: string = (j.segments?.[0]?.headline ?? pan?.headLine ?? "") as string;
  const headline = headlineRaw.replace(/&lt;!\[CDATA\[|\]\]&gt;|<!\[CDATA\[|\]\]>/g, "").replace(/\.{3}/g, " ").replace(/\s+/g, " ").trim();
  const segCat: string = j.segments?.[0]?.category ?? "";
  const isInformation = /information/i.test(segCat) || /information/i.test(headline);
  const isFinal = /final/i.test(headline);

  // The bulletin text carries the ETA table and the authoritative headline.
  let etas: PtwcEta[] = [];
  let finalFromText = isFinal;
  let headlineText = headline;
  try {
    const b = await fetchText(bulletinUrl, 15000);
    if (b.ok) {
      etas = parseEtas(b.text);
      if (/FINAL TSUNAMI THREAT MESSAGE/i.test(b.text)) finalFromText = true;
      const h = headlineFromBulletin(b.text);
      if (h) headlineText = h;
    }
  } catch {
    /* ETA table optional */
  }

  const issuedAt = new Date(j.bulletinIssueTime).toISOString();
  const ageMinutes = Math.round((Date.now() - new Date(issuedAt).getTime()) / 60000);
  const panamaCategory: string | null = pan?.category ?? null;
  let level = levelFromCategory(panamaCategory, finalFromText);
  const stale = level !== "none" && ageMinutes > 24 * 60;
  if (stale) level = "unknown";

  return {
    wmoId,
    basin,
    twcEventId: String(j.twcEventID ?? ""),
    bulletinNr: parseInt(j.bulletinNr ?? "0", 10),
    issuedAt,
    originTime: j.originTime ? new Date(j.originTime).toISOString() : null,
    magnitude: typeof j.eventMagnitude === "number" ? j.eventMagnitude : null,
    magType: j.eventMagnitudeType ?? null,
    depthKm: typeof j.eventDepth === "number" ? j.eventDepth : null,
    lat: typeof j.eventLat === "number" ? j.eventLat : null,
    lon: typeof j.eventLon === "number" ? j.eventLon : null,
    location: j.quakeLocation ?? "",
    headline: headlineText || (isInformation ? "TSUNAMI INFORMATION STATEMENT" : "TSUNAMI MESSAGE"),
    panamaCategory,
    namesPanama: Boolean(pan),
    isFinal: finalFromText,
    isInformation,
    bulletinUrl,
    etas,
    ageMinutes,
    level,
    stale,
  };
}

async function recordProduct(p: PtwcProduct) {
  if (!p.twcEventId) return;
  await storage.upsertMessage({
    id: `${p.twcEventId}-${p.wmoId}-${p.bulletinNr}`,
    twcEventId: p.twcEventId,
    wmoId: p.wmoId,
    bulletinNr: p.bulletinNr,
    issuedAt: p.issuedAt,
    originTime: p.originTime,
    magnitude: p.magnitude,
    magType: p.magType,
    depthKm: p.depthKm,
    lat: p.lat,
    lon: p.lon,
    location: p.location,
    headline: p.headline,
    panamaCategory: p.panamaCategory,
    isFinal: p.isFinal,
    bulletinUrl: p.bulletinUrl,
    etasJson: JSON.stringify(p.etas),
  });
}

export async function getTsunami(): Promise<TsunamiResponse> {
  return cached("tsu", 60_000, async () => {
    const out: TsunamiResponse = {
      fetchedAt: new Date().toISOString(),
      source: `${TG}/`,
      pacific: null,
      caribbean: null,
      latestAny: null,
      errors: [],
    };
    const results = await Promise.allSettled(PRODUCTS.map((p) => fetchProduct(p.wmoId, p.basin)));
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        if (PRODUCTS[i].basin === "pacific") out.pacific = r.value;
        else out.caribbean = r.value;
        recordProduct(r.value).catch(() => {});
      } else {
        out.errors.push(String(r.reason?.message ?? r.reason));
      }
    });
    try {
      const atom = await fetchText(`${TG}/events/xml/PHEBAtom.xml`, 15000);
      if (atom.ok) {
        const entry = atom.text.match(/<entry>([\s\S]*?)<\/entry>/)?.[1] ?? "";
        const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? "";
        const updated = entry.match(/<updated>([^<]+)<\/updated>/)?.[1] ?? "";
        const url = entry.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/)?.[1] ?? `${TG}/`;
        if (title) out.latestAny = { title, updated, url };
      }
    } catch (err: any) {
      out.errors.push(`Atom: ${err?.message ?? err}`);
    }
    return out;
  });
}

/**
 * Backfill the archive for a known past event (every bulletin of one
 * product). Used once at startup for recent Panama-relevant events so the
 * history view is not empty on first run.
 */
export async function backfillEvent(datePath: string, twcEventId: string, wmoId: string, basin: Coast) {
  for (let n = 1; n <= 12; n++) {
    const dir = `/events/PHEB/${datePath}/${twcEventId}/${n}/${wmoId}/`;
    const r = await fetchText(`${TG}${dir}PHEB.json`, 15000).catch(() => ({ ok: false, status: 0, text: "" }));
    if (!r.ok) break;
    try {
      const j = parseJsVar(r.text);
      const bulletinUrl = `${TG}${dir}${wmoId}.txt`;
      const areas: any[] = (j.alerts?.areaList ?? []).flat();
      const pan = areas.find((a) => String(a?.zone ?? "").toLowerCase() === "panama");
      let headline = String(j.segments?.[0]?.headline ?? pan?.headLine ?? "")
        .replace(/&lt;!\[CDATA\[|\]\]&gt;|<!\[CDATA\[|\]\]>/g, "")
        .replace(/\.{3}/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      let etas: PtwcEta[] = [];
      let isFinal = /final/i.test(headline);
      const b = await fetchText(bulletinUrl, 15000).catch(() => ({ ok: false, status: 0, text: "" }));
      if (b.ok) {
        etas = parseEtas(b.text);
        if (/FINAL TSUNAMI THREAT MESSAGE/i.test(b.text)) isFinal = true;
        const h = headlineFromBulletin(b.text);
        if (h) headline = h;
      }
      await storage.upsertMessage({
        id: `${twcEventId}-${wmoId}-${n}`,
        twcEventId,
        wmoId,
        bulletinNr: n,
        issuedAt: new Date(j.bulletinIssueTime).toISOString(),
        originTime: j.originTime ? new Date(j.originTime).toISOString() : null,
        magnitude: typeof j.eventMagnitude === "number" ? j.eventMagnitude : null,
        magType: j.eventMagnitudeType ?? null,
        depthKm: typeof j.eventDepth === "number" ? j.eventDepth : null,
        lat: typeof j.eventLat === "number" ? j.eventLat : null,
        lon: typeof j.eventLon === "number" ? j.eventLon : null,
        location: j.quakeLocation ?? "",
        headline: headline || (String(j.segments?.[0]?.category ?? "").match(/information/i) ? "TSUNAMI INFORMATION STATEMENT" : "TSUNAMI MESSAGE"),
        panamaCategory: pan?.category ?? null,
        isFinal,
        bulletinUrl,
        etasJson: JSON.stringify(etas),
      });
    } catch {
      /* skip malformed bulletin */
    }
  }
  void basin;
}

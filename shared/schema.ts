import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import type * as z from "zod/mini";

/**
 * Persistent log of PTWC bulletins seen by the server poller.
 * tsunami.gov only exposes the *latest* message per product, so the
 * server records each new bulletin it observes to build a history.
 */
export const tsunamiMessages = sqliteTable("tsunami_messages", {
  id: text("id").primaryKey(), // `${twcEventId}-${wmoId}-${bulletinNr}`
  twcEventId: text("twc_event_id").notNull(),
  wmoId: text("wmo_id").notNull(), // WEPA40 (Pacific), WECA40 (Caribbean)
  bulletinNr: integer("bulletin_nr").notNull(),
  issuedAt: text("issued_at").notNull(), // ISO-8601 UTC
  originTime: text("origin_time"),
  magnitude: real("magnitude"),
  magType: text("mag_type"),
  depthKm: real("depth_km"),
  lat: real("lat"),
  lon: real("lon"),
  location: text("location"),
  headline: text("headline"),
  panamaCategory: text("panama_category"), // e.g. "1-3 meters", null if Panama not named
  isFinal: integer("is_final", { mode: "boolean" }).notNull().default(false),
  bulletinUrl: text("bulletin_url").notNull(),
  etasJson: text("etas_json"), // JSON array of {location, lat, lon, etaUtc}
});

export const insertTsunamiMessageSchema = createInsertSchema(tsunamiMessages);
export type InsertTsunamiMessage = z.infer<typeof insertTsunamiMessageSchema>;
export type TsunamiMessage = typeof tsunamiMessages.$inferSelect;

/* ---------- Non-persisted API types ---------- */

export type Coast = "pacific" | "caribbean";

export interface Zone {
  id: string;
  name: string;
  province: string;
  coast: Coast;
  lat: number;
  lon: number;
  nearestDart: string;
}

export interface Earthquake {
  id: string;
  mag: number | null;
  magType: string | null;
  place: string;
  time: number; // epoch ms
  updated: number;
  lat: number;
  lon: number;
  depthKm: number | null;
  tsunamiFlag: boolean;
  url: string;
  status: string; // "automatic" | "reviewed" (IGC PRELIMINAR / REVISADO map onto these)
  /** Agency whose solution is shown: "IGC-UP" (Instituto de Geociencias, Universidad de Panamá), "USGS", or "EMSC/<contributor>". */
  source: string;
  /** Other agencies that located the same event, with their magnitude, e.g. "USGS M5.2 mww". */
  alsoReportedBy: string[];
}

export interface FeedStatus {
  name: string;
  ok: boolean;
  count: number;
  error?: string;
}

export interface EarthquakesResponse {
  fetchedAt: string;
  source: string;
  feeds: FeedStatus[];
  regional: Earthquake[]; // Panama + adjacent waters: IGC-UP 7-day national catalog, USGS/EMSC 30-day M4+ regional, USGS 1-year M4.5+ regional
  farField: Earthquake[]; // M6.5+ worldwide, last 7 days
  error?: string;
}

export interface DartReading {
  t: number; // epoch ms
  height: number; // metres (water column height)
  mode: number; // 1 = 15-min standard, 2 = 1-min, 3 = 15-sec (event mode)
}

export interface DartStation {
  id: string;
  name: string;
  coast: Coast;
  lat: number;
  lon: number;
  depthM: number;
  status: "reporting" | "offline" | "unknown";
  statusNote: string | null; // NDBC station note, e.g. adrift
  latest: DartReading | null;
  eventMode: boolean; // any reading in last 24h with mode 2 or 3
  series: DartReading[]; // last 24h, oldest first
  dataAgeMinutes: number | null;
  pageUrl: string;
  dataUrl: string;
  error?: string;
}

export interface DartResponse {
  fetchedAt: string;
  source: string;
  stations: DartStation[];
}

export type ThreatLevel = "none" | "advisory" | "warning" | "unknown";

export interface PtwcEta {
  location: string;
  lat: number;
  lon: number;
  etaUtc: string; // ISO
}

export interface PtwcProduct {
  wmoId: string;
  basin: Coast;
  twcEventId: string;
  bulletinNr: number;
  issuedAt: string;
  originTime: string | null;
  magnitude: number | null;
  magType: string | null;
  depthKm: number | null;
  lat: number | null;
  lon: number | null;
  location: string;
  headline: string;
  panamaCategory: string | null;
  namesPanama: boolean;
  isFinal: boolean;
  isInformation: boolean;
  bulletinUrl: string;
  etas: PtwcEta[]; // Panama ETA points, if any
  ageMinutes: number;
  level: ThreatLevel; // derived for Panama from this product alone
  stale: boolean; // threat message > 24h old without a final
}

export interface TsunamiResponse {
  fetchedAt: string;
  source: string;
  pacific: PtwcProduct | null;
  caribbean: PtwcProduct | null;
  latestAny: { title: string; updated: string; url: string } | null;
  errors: string[];
}

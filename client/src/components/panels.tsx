import { useMemo, useState } from "react";
import type { Earthquake, DartStation, PtwcProduct, ThreatLevel, TsunamiMessage, Zone } from "@shared/schema";
import type { Lang } from "@/lib/i18n";
import { t, fmtLocal, fmtUtc, relTime } from "@/lib/i18n";
import { haversineKm } from "@/lib/zones";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink, ShieldAlert, ShieldCheck, AlertTriangle, HelpCircle, Waves, Radio } from "lucide-react";
import { LineChart, Line, YAxis, ResponsiveContainer, Tooltip } from "recharts";

/* ------------------------------------------------------------------ */
/* Status banner                                                       */
/* ------------------------------------------------------------------ */

const ICON: Record<ThreatLevel, typeof ShieldCheck> = {
  none: ShieldCheck,
  advisory: AlertTriangle,
  warning: ShieldAlert,
  unknown: HelpCircle,
};

export function StatusBanner({
  level,
  product,
  zone,
  lang,
  error,
  fetchedAt,
}: {
  level: ThreatLevel;
  product: PtwcProduct | null;
  zone: Zone;
  lang: Lang;
  error: string | null;
  fetchedAt: string | null;
}) {
  const s = t(lang);
  const Icon = ICON[level];
  const nearestEta = useMemo(() => {
    if (!product?.etas?.length) return null;
    return product.etas
      .map((e) => ({ ...e, km: haversineKm(zone.lat, zone.lon, e.lat, e.lon) }))
      .sort((a, b) => a.km - b.km)[0];
  }, [product, zone]);

  return (
    <section className={`status-${level} rounded-xl p-5 sm:p-6`} data-testid={`status-banner-${level}`} aria-live="polite">
      <div className="flex items-start gap-4">
        <div className="mt-0.5 shrink-0 rounded-full bg-white/15 p-2.5">
          <Icon className="h-7 w-7" aria-hidden />
        </div>
        <div className="flex-1">
          <p className="text-xs font-medium uppercase tracking-wider opacity-80">
            {zone.name} · {zone.coast === "pacific" ? s.pacific : s.caribbean}
          </p>
          <h2 className="mt-1 text-xl font-semibold leading-tight" data-testid="text-status-title">
            {s.status[level]}
          </h2>
          <p className="mt-2 max-w-prose text-sm leading-6 opacity-95" data-testid="text-status-detail">
            {product?.stale && level === "unknown" ? s.staleThreat : error && level === "unknown" ? `${s.statusDetail.unknown} (${s.feedError}: ${error})` : s.statusDetail[level]}
          </p>
          {product?.namesPanama && product.isFinal && (
            <p className="mt-2 text-sm font-medium opacity-95">{s.finalMsg}</p>
          )}
          {nearestEta && level !== "none" && (
            <p className="mt-2 text-sm opacity-95">
              {s.nearestEta}: <span className="font-semibold">{nearestEta.location}</span> · {fmtLocal(nearestEta.etaUtc, lang)} (Panamá) · {Math.round(nearestEta.km)} {s.km}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs opacity-85">
            {product && (
              <span className="label-wrap">
                {s.ptwcMessage} ({product.basin === "pacific" ? s.pacific : s.caribbean}): {product.location} · {fmtLocal(product.issuedAt, lang, { year: "numeric" })} · {relTime(product.issuedAt, lang)}
              </span>
            )}
            {fetchedAt && (
              <span>
                {s.updated}: {fmtLocal(fetchedAt, lang, { second: "2-digit" })}
              </span>
            )}
          </div>
        </div>
      </div>
      <p className="mt-4 border-t border-white/20 pt-3 text-xs leading-5 opacity-90">{s.nationalAuthority}</p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* PTWC message card                                                   */
/* ------------------------------------------------------------------ */

export function PtwcCard({ product, lang, loading }: { product: PtwcProduct | null; lang: Lang; loading: boolean }) {
  const s = t(lang);
  if (loading && !product) return <CardSkeleton rows={4} />;
  if (!product)
    return (
      <Card className="p-4">
        <SectionTitle>{s.ptwcMessage}</SectionTitle>
        <p className="mt-2 text-sm text-muted-foreground">{s.feedError}</p>
      </Card>
    );
  const soft = `status-${product.level}-soft`;
  return (
    <Card className="p-4" data-testid={`card-ptwc-${product.basin}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <SectionTitle>{s.ptwcMessage}</SectionTitle>
          <p className="text-xs text-muted-foreground">{s.ptwcBasin[product.basin]}</p>
        </div>
        <Badge variant="outline" className={`${soft} max-w-[55%] whitespace-normal border-0 text-right text-xs leading-4`}>{product.namesPanama ? product.panamaCategory ?? "—" : s.notNamed}</Badge>
      </div>
      <p className="mt-3 text-sm font-semibold" data-testid="text-ptwc-headline">{product.headline} #{product.bulletinNr}</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{s.magnitude}</dt>
        <dd className="num">{product.magnitude !== null ? `${product.magnitude.toFixed(1)} ${product.magType ?? ""}` : "—"}</dd>
        <dt className="text-muted-foreground">{s.depth}</dt>
        <dd className="num">{product.depthKm !== null ? `${product.depthKm} km` : "—"}</dd>
        <dt className="text-muted-foreground">{lang === "es" ? "Ubicación" : "Location"}</dt>
        <dd className="label-wrap">{product.location}</dd>
        <dt className="text-muted-foreground">{s.issued}</dt>
        <dd className="num text-xs sm:text-sm">{fmtUtc(product.issuedAt)}</dd>
      </dl>
      {product.etas.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-muted-foreground">{s.etas}</p>
          <ul className="mt-1 grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
            {product.etas.map((e) => (
              <li key={e.location} className="flex justify-between gap-2 rounded-md bg-muted px-2 py-1">
                <span>{e.location}</span>
                <span className="num text-muted-foreground">{fmtLocal(e.etaUtc, lang)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <a href={product.bulletinUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline" data-testid="link-bulletin">
        {s.bulletin} <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Earthquake cards                                                    */
/* ------------------------------------------------------------------ */

function magClass(m: number | null) {
  if (m === null) return "bg-muted text-foreground";
  if (m >= 7) return "status-warning";
  if (m >= 6) return "bg-[hsl(14_80%_45%)] text-white";
  if (m >= 5) return "status-advisory";
  if (m >= 4) return "bg-[hsl(203_60%_40%)] text-white";
  return "bg-secondary text-foreground";
}

export function QuakeCard({ title, help, quake, zone, lang, loading, error }: { title: string; help?: string; quake: Earthquake | null; zone: Zone; lang: Lang; loading: boolean; error?: string }) {
  const s = t(lang);
  if (loading && !quake) return <CardSkeleton rows={3} />;
  return (
    <Card className="p-4" data-testid={`card-quake-${title.replace(/\s+/g, "-").toLowerCase()}`}>
      <SectionTitle>{title}</SectionTitle>
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
      {!quake ? (
        <p className="mt-3 text-sm text-muted-foreground">{error ? `${s.feedError}: ${error}` : "—"}</p>
      ) : (
        <div className="mt-3 flex items-start gap-4">
          <div className={`num flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-lg ${magClass(quake.mag)}`} data-testid="text-quake-mag">
            <span className="text-xl font-semibold leading-none">{quake.mag?.toFixed(1) ?? "—"}</span>
            <span className="mt-1 text-[11px] uppercase opacity-80">{quake.magType ?? "M"}</span>
          </div>
          <div className="flex-1 text-sm">
            <p className="font-semibold leading-snug label-wrap" data-testid="text-quake-place">{quake.place}</p>
            <p className="mt-1 text-muted-foreground">
              {fmtLocal(quake.time, lang, { year: "numeric" })} (Panamá) · {relTime(quake.time, lang)}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-muted-foreground sm:text-sm">
              <span>{s.depth}</span>
              <span className="num text-foreground">{quake.depthKm !== null ? `${quake.depthKm.toFixed(0)} km` : "—"}</span>
              <span className="label-wrap">{s.distance} {zone.name}</span>
              <span className="num text-foreground">{Math.round(haversineKm(zone.lat, zone.lon, quake.lat, quake.lon))} {s.km}</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground" data-testid="text-quake-source">
              {s.sourceLabel}: <span className="text-foreground">{quake.source}</span> · {quake.status === "reviewed" ? s.reviewed : s.preliminary}
              {quake.alsoReportedBy.length > 0 && (
                <>
                  {" "}· {s.alsoReported} {quake.alsoReportedBy.join(", ")}
                </>
              )}
            </p>
            {quake.tsunamiFlag && (
              <p className="mt-2 inline-flex items-center gap-1 rounded-md status-advisory-soft px-2 py-0.5 text-xs font-medium">
                <Waves className="h-3.5 w-3.5" /> {s.tsunamiFlagged}
              </p>
            )}
            <a href={quake.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline" data-testid="link-usgs">
              {s.usgsPage} <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* DART buoy panel                                                     */
/* ------------------------------------------------------------------ */

function ageLabel(min: number | null, lang: Lang) {
  const s = t(lang);
  if (min === null) return "—";
  if (min < 60) return s.dataAge.replace("{n}", String(min));
  return s.dataAgeH.replace("{h}", String(Math.floor(min / 60))).replace("{m}", String(min % 60));
}

export function DartCard({ station, lang, highlight }: { station: DartStation; lang: Lang; highlight: boolean }) {
  const s = t(lang);
  const data = station.series.map((r) => ({ t: r.t, h: r.height }));
  const heights = data.map((d) => d.h);
  const min = heights.length ? Math.min(...heights) : 0;
  const max = heights.length ? Math.max(...heights) : 0;
  const pad = Math.max(0.05, (max - min) * 0.15);
  const statusLabel = station.status === "reporting" ? s.buoyReporting : station.status === "offline" ? s.buoyOffline : s.buoyUnknown;
  const statusClass = station.status === "reporting" ? "status-none-soft" : "status-unknown-soft";

  return (
    <Card className={`p-4 ${highlight ? "ring-2 ring-primary/50" : ""}`} data-testid={`card-dart-${station.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="num text-sm font-semibold">DART {station.id}</p>
          <p className="text-xs leading-5 text-muted-foreground label-wrap">{station.name}</p>
          <p className="num text-xs text-muted-foreground">
            {Math.abs(station.lat).toFixed(2)}°{station.lat < 0 ? "S" : "N"} {Math.abs(station.lon).toFixed(2)}°W · {station.depthM} m
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge variant="outline" className={`${statusClass} border-0`} data-testid={`status-dart-${station.id}`}>
            {station.status === "reporting" && <span className="pulse-dot mr-1.5 inline-block h-2 w-2 rounded-full bg-current" />}
            {statusLabel}
          </Badge>
          {station.status === "reporting" && (
            <Badge variant="outline" className={station.eventMode ? "status-warning-soft border-0" : "border-0 bg-muted text-muted-foreground"}>
              <Radio className="mr-1 h-3 w-3" /> {station.eventMode ? s.eventMode : s.standardMode}
            </Badge>
          )}
        </div>
      </div>

      {highlight && <p className="mt-2 text-xs font-medium text-primary">{s.nearestBuoy}</p>}

      {station.status === "reporting" && station.latest ? (
        <>
          <div className="mt-3 flex items-end justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">{s.waterColumn}</p>
              <p className="num whitespace-nowrap text-lg font-semibold leading-tight" data-testid={`text-dart-height-${station.id}`}>
                {station.latest.height.toFixed(3)}<span className="ml-1 text-sm font-normal text-muted-foreground">m</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">{s.lastReading}</p>
              <p className="num text-sm">{fmtUtc(station.latest.t)}</p>
              <p className="text-xs text-muted-foreground">{ageLabel(station.dataAgeMinutes, lang)}</p>
            </div>
          </div>
          <div className="mt-2 h-16 w-full" aria-label="24h water-column series">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                <YAxis domain={[min - pad, max + pad]} hide />
                <Tooltip
                  cursor={{ stroke: "hsl(var(--border))" }}
                  contentStyle={{ fontSize: 12, borderRadius: 8, fontFamily: "var(--font-mono)" }}
                  formatter={(v: number) => [`${v.toFixed(3)} m`, ""]}
                  labelFormatter={(l: number) => fmtUtc(l)}
                />
                <Line type="monotone" dataKey="h" stroke="hsl(var(--primary))" strokeWidth={1.6} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{lang === "es" ? "Últimas 24 h · la variación visible es la marea" : "Last 24 h · the visible variation is the tide"}</p>
        </>
      ) : (
        <p className="mt-3 rounded-md bg-muted p-2.5 text-xs leading-5 text-muted-foreground label-wrap" data-testid={`text-dart-note-${station.id}`}>
          {station.statusNote ?? station.error ?? (lang === "es" ? "NDBC no publica datos en tiempo real para esta estación." : "NDBC is not publishing real-time data for this station.")}
        </p>
      )}
      <a href={station.pageUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline" data-testid={`link-ndbc-${station.id}`}>
        {s.ndbcPage} <ExternalLink className="h-3 w-3" />
      </a>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */

export function QuakeTable({ quakes, zone, lang, loading, rangeLabel }: { quakes: Earthquake[]; zone: Zone; lang: Lang; loading: boolean; rangeLabel?: string }) {
  const s = t(lang);
  const [all, setAll] = useState(false);
  const rows = all ? quakes : quakes.slice(0, 12);
  if (loading && !quakes.length) return <CardSkeleton rows={6} />;
  return (
    <Card className="overflow-hidden" data-testid="table-quakes">
      <div className="flex items-start justify-between gap-3 p-4 pb-2">
        <div>
          <SectionTitle>
            {s.recentQuakes}
            {rangeLabel ? <span className="ml-1.5 font-normal text-muted-foreground">· {rangeLabel}</span> : null}
          </SectionTitle>
          <p className="text-xs text-muted-foreground">{s.recentQuakesHelp}</p>
        </div>
        <span className="num text-xs text-muted-foreground">{quakes.length}</span>
      </div>
      {quakes.length === 0 && <p className="px-4 pb-4 text-sm text-muted-foreground">{s.mapNone}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-sm">
          <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">M</th>
              <th className="px-2 py-2 font-medium">{lang === "es" ? "Lugar" : "Place"}</th>
              <th className="px-2 py-2 font-medium">{s.depth}</th>
              <th className="px-2 py-2 font-medium whitespace-nowrap">{zone.name}</th>
              <th className="px-2 py-2 font-medium">{s.time}</th>
              <th className="px-4 py-2 font-medium">{s.sourceLabel}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((q) => (
              <tr key={q.id} className="border-t border-card-border" data-testid={`row-quake-${q.id}`}>
                <td className="px-4 py-2">
                  <span className={`num inline-block min-w-[2.6rem] rounded px-1.5 py-0.5 text-center text-xs font-semibold ${magClass(q.mag)}`}>{q.mag?.toFixed(1) ?? "—"}</span>
                </td>
                <td className="min-w-[160px] px-2 py-2">
                  <a href={q.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{q.place}</a>
                  {q.tsunamiFlag && <Waves className="ml-1 inline h-3.5 w-3.5 text-[hsl(var(--status-advisory))]" aria-label={s.tsunamiFlagged} />}
                </td>
                <td className="num whitespace-nowrap px-2 py-2 text-muted-foreground">{q.depthKm !== null ? `${q.depthKm.toFixed(0)} km` : "—"}</td>
                <td className="num whitespace-nowrap px-2 py-2 text-muted-foreground">{Math.round(haversineKm(zone.lat, zone.lon, q.lat, q.lon))} km</td>
                <td className="num whitespace-nowrap px-2 py-2 text-muted-foreground">{fmtLocal(q.time, lang)}</td>
                <td className="whitespace-nowrap px-4 py-2 text-xs text-muted-foreground" title={q.alsoReportedBy.length ? `${s.alsoReported} ${q.alsoReportedBy.join(", ")}` : undefined}>
                  {q.source.replace(/^EMSC\//, "")}
                  {q.status === "reviewed" ? "" : "*"}
                  {q.alsoReportedBy.length > 0 && <span className="ml-1 rounded bg-muted px-1 text-[10px]">+{q.alsoReportedBy.length}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-4 pb-2 pt-1 text-[11px] text-muted-foreground">
        {lang === "es" ? "* solución preliminar (automática). +n = número de otras agencias que localizaron el mismo evento." : "* preliminary (automatic) solution. +n = other agencies that located the same event."}
      </p>
      {quakes.length > 12 && (
        <div className="border-t border-card-border p-2 text-center">
          <Button variant="ghost" size="sm" onClick={() => setAll((a) => !a)} data-testid="button-toggle-quakes">
            {all ? s.showLess : `${s.showAll} (${quakes.length})`}
          </Button>
        </div>
      )}
    </Card>
  );
}

export function HistoryTable({ messages, lang, loading }: { messages: TsunamiMessage[]; lang: Lang; loading: boolean }) {
  const s = t(lang);
  if (loading && !messages.length) return <CardSkeleton rows={4} />;
  return (
    <Card className="overflow-hidden" data-testid="table-history">
      <div className="p-4 pb-2">
        <SectionTitle>{s.history}</SectionTitle>
        <p className="text-xs text-muted-foreground">{s.historyHelp}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">{s.colTime}</th>
              <th className="px-2 py-2 font-medium">{s.colEvent}</th>
              <th className="px-2 py-2 font-medium">{s.colMsg}</th>
              <th className="px-4 py-2 font-medium">{s.colPanama}</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((m) => {
              const pan = m.panamaCategory ? (m.isFinal ? s.finalMsg : m.panamaCategory) : m.isFinal && m.location?.includes("PANAMA") ? s.finalMsg : "—";
              const cls = m.panamaCategory && !m.isFinal ? "status-warning-soft" : "bg-muted text-muted-foreground";
              return (
                <tr key={m.id} className="border-t border-card-border" data-testid={`row-history-${m.id}`}>
                  <td className="num whitespace-nowrap px-4 py-2 text-muted-foreground">{fmtUtc(m.issuedAt).replace(" UTC", "")}</td>
                  <td className="px-2 py-2 label-wrap">
                    <span className="num font-semibold">{m.magnitude?.toFixed(1) ?? "—"}</span> {m.location}
                    <span className="block whitespace-nowrap text-xs text-muted-foreground">{m.wmoId === "WEPA40" ? s.pacific : m.wmoId === "WECA40" ? s.caribbean : m.wmoId}</span>
                  </td>
                  <td className="px-2 py-2 label-wrap">
                    <a href={m.bulletinUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                      {m.headline} #{m.bulletinNr}
                    </a>
                  </td>
                  <td className="px-4 py-2">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>{pan}</span>
                  </td>
                </tr>
              );
            })}
            {!messages.length && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-sm text-muted-foreground">—</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Bits                                                                */
/* ------------------------------------------------------------------ */

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-base font-semibold leading-tight">{children}</h3>;
}

export function CardSkeleton({ rows }: { rows: number }) {
  return (
    <Card className="p-4">
      <Skeleton className="h-4 w-40" />
      <div className="mt-3 space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-full" style={{ width: `${90 - i * 12}%` }} />
        ))}
      </div>
    </Card>
  );
}

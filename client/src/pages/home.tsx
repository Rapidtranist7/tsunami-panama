import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EarthquakesResponse, DartResponse, TsunamiResponse, TsunamiMessage, ThreatLevel } from "@shared/schema";
import { ZONES } from "@/lib/zones";
import { t, fmtLocal, type Lang } from "@/lib/i18n";
import MapView, { rangeHours, type RangeKey } from "@/components/MapView";
import { StatusBanner, PtwcCard, QuakeCard, DartCard, QuakeTable, HistoryTable, SectionTitle } from "@/components/panels";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { RefreshCw, Languages, ExternalLink, Waves } from "lucide-react";

const POLL_MS = 60_000;

const SOURCES = [
  { name: "NOAA Tsunami Warning Centers (PTWC)", url: "https://www.tsunami.gov/" },
  { name: "NOAA NDBC — DART buoys", url: "https://www.ndbc.noaa.gov/dart.shtml" },
  { name: "USGS Earthquake Hazards Program", url: "https://earthquake.usgs.gov/earthquakes/map/" },
  { name: "SINAPROC Panamá", url: "https://www.sinaproc.gob.pa/" },
  { name: "Instituto de Geociencias — Universidad de Panamá (IGC-UP)", url: "https://sismosgeociencias.up.ac.pa/" },
  { name: "EMSC — Euro-Mediterranean Seismological Centre", url: "https://www.emsc-csem.org/" },
  { name: "SismoLive Panamá", url: "https://sismolive.mupa.gob.pa/" },
];

export default function Home() {
  const [lang, setLang] = useState<Lang>("en");
  const [zoneId, setZoneId] = useState<string>(ZONES[0].id);
  const zone = useMemo(() => ZONES.find((z) => z.id === zoneId) ?? ZONES[0], [zoneId]);
  const s = t(lang);
  const { toast } = useToast();

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const tsunami = useQuery<TsunamiResponse>({ queryKey: ["/api/tsunami"], refetchInterval: POLL_MS, staleTime: 30_000 });
  const quakes = useQuery<EarthquakesResponse>({ queryKey: ["/api/earthquakes"], refetchInterval: POLL_MS, staleTime: 30_000 });
  const dart = useQuery<DartResponse>({ queryKey: ["/api/dart"], refetchInterval: 5 * 60_000, staleTime: 60_000 });
  const history = useQuery<TsunamiMessage[]>({ queryKey: ["/api/tsunami/history"], refetchInterval: 5 * 60_000, staleTime: 60_000 });

  const product = tsunami.data ? (zone.coast === "pacific" ? tsunami.data.pacific : tsunami.data.caribbean) : null;
  const level: ThreatLevel = tsunami.isError || !tsunami.data || !product ? "unknown" : product.level;
  const statusError = tsunami.isError ? (tsunami.error as Error).message : tsunami.data?.errors?.[0] ?? null;

  // In-app notification when a new PTWC bulletin appears in either basin.
  // Tracked per basin so switching zones never triggers a toast; only recent bulletins notify.
  const lastSeen = useRef<Record<string, string>>({});
  useEffect(() => {
    if (!tsunami.data) return;
    for (const p of [tsunami.data.pacific, tsunami.data.caribbean]) {
      if (!p) continue;
      const key = `${p.twcEventId}-${p.wmoId}-${p.bulletinNr}`;
      const prev = lastSeen.current[p.wmoId];
      const recent = Date.now() - new Date(p.issuedAt).getTime() < 24 * 3600_000;
      if (prev && prev !== key && recent) {
        toast({ title: s.newBulletin, description: `${p.headline} #${p.bulletinNr} · ${p.location}` });
      }
      lastSeen.current[p.wmoId] = key;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tsunami.data?.pacific?.twcEventId, tsunami.data?.pacific?.bulletinNr, tsunami.data?.caribbean?.twcEventId, tsunami.data?.caribbean?.bulletinNr]);

  const regional = quakes.data?.regional ?? [];
  const latest = regional[0] ?? null;
  // Map / table time range. 24 h is the default: that is what people check after feeling a shake.
  const [range, setRange] = useState<RangeKey>(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem("tp.range") : null;
    return saved === "24h" || saved === "72h" || saved === "7d" || saved === "30d" || saved === "1y" ? saved : "24h";
  });
  const changeRange = (r: RangeKey) => {
    setRange(r);
    try {
      localStorage.setItem("tp.range", r);
    } catch {
      /* private mode */
    }
  };
  const rangeStart = (quakes.dataUpdatedAt || Date.now()) - rangeHours(range) * 3600_000;
  const inRange = useMemo(() => regional.filter((q) => q.time >= rangeStart), [regional, rangeStart]);
  const strongest = useMemo(() => (regional.length ? [...regional].sort((a, b) => (b.mag ?? 0) - (a.mag ?? 0))[0] : null), [regional]);
  const stations = dart.data?.stations ?? [];
  const coastStations = stations.filter((d) => d.coast === zone.coast);
  const otherStations = stations.filter((d) => d.coast !== zone.coast);

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/tsunami"] });
    queryClient.invalidateQueries({ queryKey: ["/api/earthquakes"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dart"] });
    queryClient.invalidateQueries({ queryKey: ["/api/tsunami/history"] });
  };
  const fetching = tsunami.isFetching || quakes.isFetching || dart.isFetching;
  const lastUpdated = tsunami.data?.fetchedAt ?? null;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground" aria-hidden>
            <Waves className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold leading-tight sm:text-lg">{s.appName}</h1>
            <p className="hidden truncate text-xs text-muted-foreground sm:block">{s.tagline}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="num hidden text-xs text-muted-foreground md:inline" data-testid="text-last-updated">
              {fetching ? s.updating : lastUpdated ? `${s.updated} ${fmtLocal(lastUpdated, lang, { second: "2-digit" })}` : ""}
            </span>
            <Button variant="ghost" size="icon" onClick={refreshAll} aria-label={s.refresh} data-testid="button-refresh">
              <RefreshCw className={`h-4 w-4 ${fetching ? "animate-spin" : ""}`} />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setLang((l) => { const n = l === "es" ? "en" : "es"; document.documentElement.lang = n; return n; })} data-testid="button-language">
              <Languages className="mr-1.5 h-4 w-4" /> {s.language}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-4 py-5 sm:px-6">
        {/* Zone selector */}
        <section className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <label htmlFor="zone" className="text-sm font-semibold">{s.zone}</label>
            <p className="text-xs text-muted-foreground">{s.zoneHelp}</p>
          </div>
          <Select value={zoneId} onValueChange={setZoneId}>
            <SelectTrigger id="zone" className="w-full sm:w-72" data-testid="select-zone">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>{s.pacific}</SelectLabel>
                {ZONES.filter((z) => z.coast === "pacific").map((z) => (
                  <SelectItem key={z.id} value={z.id} data-testid={`option-zone-${z.id}`}>
                    {z.name} <span className="text-muted-foreground">· {z.province}</span>
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel>{s.caribbean}</SelectLabel>
                {ZONES.filter((z) => z.coast === "caribbean").map((z) => (
                  <SelectItem key={z.id} value={z.id} data-testid={`option-zone-${z.id}`}>
                    {z.name} <span className="text-muted-foreground">· {z.province}</span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </section>

        <StatusBanner level={level} product={product} zone={zone} lang={lang} error={statusError} fetchedAt={lastUpdated} />

        {/* Map + key cards */}
        <section className="grid gap-4 lg:grid-cols-5">
          <Card className="overflow-hidden lg:col-span-3" data-testid="card-map">
            <div className="h-[520px] sm:h-[560px] lg:h-full lg:min-h-[560px]">
              <MapView quakes={inRange} range={range} onRangeChange={changeRange} darts={stations} zones={ZONES} selectedZone={zone} lang={lang} />
            </div>
          </Card>
          <div className="space-y-4 lg:col-span-2">
            <QuakeCard title={s.lastQuake} help={s.lastQuakeHelp} quake={latest} zone={zone} lang={lang} loading={quakes.isLoading} error={quakes.data?.error ?? (quakes.error as Error | null)?.message} />
            <QuakeCard title={s.strongest30} quake={strongest} zone={zone} lang={lang} loading={quakes.isLoading} />
            <p className="px-1 text-xs leading-5 text-muted-foreground">{s.magnitudeNote}</p>
            <PtwcCard product={product} lang={lang} loading={tsunami.isLoading} />
          </div>
        </section>

        {/* DART buoys */}
        <section>
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold leading-tight">{s.buoys}</h2>
              <p className="text-xs text-muted-foreground">{s.buoysHelp}</p>
            </div>
            <a href="https://www.ndbc.noaa.gov/dart.shtml" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              NDBC DART <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          {dart.isLoading && !stations.length ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Card key={i} className="h-44 animate-pulse bg-muted/50" />
              ))}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[...coastStations, ...otherStations].map((st) => (
                <DartCard key={st.id} station={st} lang={lang} highlight={st.id === zone.nearestDart} />
              ))}
            </div>
          )}
          <p className="mt-2 px-1 text-xs leading-5 text-muted-foreground">{s.standardModeNote}</p>
        </section>

        {/* Tables */}
        <section className="grid gap-4 lg:grid-cols-2">
          <QuakeTable quakes={inRange} zone={zone} lang={lang} loading={quakes.isLoading} rangeLabel={s.rangeLabel[range]} />
          <div className="space-y-4">
            <HistoryTable messages={history.data ?? []} lang={lang} loading={history.isLoading} />
            <Card className="p-4" data-testid="card-farfield">
              <SectionTitle>{s.farField}</SectionTitle>
              {quakes.data?.farField?.length ? (
                <ul className="mt-2 divide-y divide-card-border text-sm">
                  {quakes.data.farField.map((q) => (
                    <li key={q.id} className="flex items-center justify-between gap-3 py-1.5">
                      <a href={q.url} target="_blank" rel="noopener noreferrer" className="label-wrap hover:underline">
                        <span className="num font-semibold">M {q.mag?.toFixed(1)}</span> {q.place}
                      </a>
                      <span className="num shrink-0 text-xs text-muted-foreground">{fmtLocal(q.time, lang)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">{s.noFarField}</p>
              )}
            </Card>
          </div>
        </section>

        {/* Sources + disclaimer */}
        <footer className="rounded-xl border border-border bg-card p-4 sm:p-5">
          <h2 className="text-sm font-semibold">{s.sources}</h2>
          <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
            {SOURCES.map((src) => (
              <li key={src.url}>
                <a href={src.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                  {src.name} <ExternalLink className="h-3 w-3" />
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">{s.disclaimer}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {lang === "es" ? "Mapa: © OpenFreeMap · © OpenMapTiles · datos © OpenStreetMap." : "Map: © OpenFreeMap · © OpenMapTiles · data © OpenStreetMap contributors."}
          </p>
        </footer>
      </main>
    </div>
  );
}

import { setStorage, storage } from "../../server/store";
import { getEarthquakes, getDart, getTsunami, backfillEvent } from "../../server/feeds";
import { createStorage } from "./blob-storage";

let initialised = false;
function init() {
  if (initialised) return;
  initialised = true;
  setStorage(createStorage());
}

/** Seed the archive with the 9 Oct 2026 Panama event the first time the archive is read. */
let backfilled: Promise<void> | null = null;
async function ensureBackfill() {
  if (!backfilled) {
    backfilled = (async () => {
      const existing = await storage.getMessage("26282000-WEPA40-1").catch(() => undefined);
      if (!existing) await backfillEvent("2026/10/09", "26282000", "WEPA40", "pacific");
    })().catch(() => {
      backfilled = null;
    });
  }
  return backfilled;
}

const json = (body: unknown, status = 200, maxAge = 60) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=0, s-maxage=${maxAge}, stale-while-revalidate=120`,
      "access-control-allow-origin": "*",
    },
  });

export async function handleApi(pathname: string): Promise<Response> {
  init();
  const path = pathname.replace(/\/+$/, "");
  try {
    switch (path) {
      case "/api/earthquakes":
        return json(await getEarthquakes(), 200, 60);
      case "/api/dart":
        return json(await getDart(), 200, 120);
      case "/api/tsunami":
        return json(await getTsunami(), 200, 30);
      case "/api/tsunami/history": {
        await ensureBackfill();
        await getTsunami().catch(() => {});
        return json(await storage.listMessages(60), 200, 60);
      }
      case "/api/health":
        return json({ ok: true, time: new Date().toISOString() }, 200, 0);
      default:
        return json({ error: "Not found" }, 404, 0);
    }
  } catch (err: any) {
    return json({ error: err?.message ?? String(err) }, 502, 0);
  }
}

/** Used by the scheduled poller to keep the archive growing with no visitors. */
export async function pollOnce() {
  init();
  await ensureBackfill();
  await getTsunami();
}

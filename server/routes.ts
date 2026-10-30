import type { Express } from "express";
import type { Server } from "node:http";
import { storage } from "./storage";
import { getEarthquakes, getDart, getTsunami, backfillEvent } from "./feeds";

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  app.get("/api/earthquakes", async (_req, res) => {
    try {
      res.json(await getEarthquakes());
    } catch (err: any) {
      res.status(502).json({ error: err?.message ?? String(err) });
    }
  });

  app.get("/api/dart", async (_req, res) => {
    try {
      res.json(await getDart());
    } catch (err: any) {
      res.status(502).json({ error: err?.message ?? String(err) });
    }
  });

  app.get("/api/tsunami", async (_req, res) => {
    try {
      res.json(await getTsunami());
    } catch (err: any) {
      res.status(502).json({ error: err?.message ?? String(err) });
    }
  });

  app.get("/api/tsunami/history", async (_req, res) => {
    try {
      res.json(await storage.listMessages(60));
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? String(err) });
    }
  });

  // Background poller: keeps the PTWC archive growing even with no visitors.
  const poll = () => getTsunami().catch(() => {});
  poll();
  setInterval(poll, 60_000);

  // One-time backfill of the recent Panama event (9 Oct 2026, PTWC event 26282000, WEPA40).
  backfillEvent("2026/10/09", "26282000", "WEPA40", "pacific").catch(() => {});

  return httpServer;
}

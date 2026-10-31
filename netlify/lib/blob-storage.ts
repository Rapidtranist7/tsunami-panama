import { getStore } from "@netlify/blobs";
import type { TsunamiMessage, InsertTsunamiMessage } from "../../shared/schema";
import { type IStorage, MemoryStorage, toMessage } from "../../server/store";

const KEY = "messages";

/**
 * PTWC message archive persisted in Netlify Blobs as one small JSON document
 * (a few dozen bulletins). Falls back to memory when Blobs is unavailable
 * (e.g. running the handler outside Netlify).
 */
export class BlobStorage implements IStorage {
  private store = getStore({ name: "ptwc-archive", consistency: "strong" });
  private cache: Record<string, TsunamiMessage> | null = null;

  private async load(): Promise<Record<string, TsunamiMessage>> {
    if (this.cache) return this.cache;
    const data = (await this.store.get(KEY, { type: "json" })) as Record<string, TsunamiMessage> | null;
    this.cache = data ?? {};
    return this.cache;
  }

  async getMessage(id: string) {
    return (await this.load())[id];
  }

  async listMessages(limit: number) {
    const all = await this.load();
    return Object.values(all)
      .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
      .slice(0, limit);
  }

  async upsertMessage(msg: InsertTsunamiMessage) {
    const all = await this.load();
    const m = toMessage(msg);
    const prev = all[m.id];
    all[m.id] = m;
    if (JSON.stringify(prev) !== JSON.stringify(m)) {
      await this.store.setJSON(KEY, all);
    }
    return m;
  }
}

/** Pick Blobs when running on Netlify, memory otherwise. */
export function createStorage(): IStorage {
  try {
    const s = new BlobStorage();
    return s;
  } catch {
    return new MemoryStorage();
  }
}

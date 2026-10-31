import type { TsunamiMessage, InsertTsunamiMessage } from "../shared/schema";

/**
 * Storage abstraction for the PTWC message archive.
 * - Express/SQLite build registers DatabaseStorage (server/storage.ts).
 * - Netlify build registers BlobStorage (netlify/lib/blob-storage.ts).
 * - Until something is registered, an in-memory store is used.
 */
export interface IStorage {
  getMessage(id: string): Promise<TsunamiMessage | undefined>;
  listMessages(limit: number): Promise<TsunamiMessage[]>;
  upsertMessage(msg: InsertTsunamiMessage): Promise<TsunamiMessage>;
}

export function toMessage(msg: InsertTsunamiMessage): TsunamiMessage {
  return {
    originTime: null,
    magnitude: null,
    magType: null,
    depthKm: null,
    lat: null,
    lon: null,
    location: null,
    headline: null,
    panamaCategory: null,
    etasJson: null,
    ...msg,
    isFinal: Boolean(msg.isFinal),
  } as TsunamiMessage;
}

export class MemoryStorage implements IStorage {
  private map = new Map<string, TsunamiMessage>();
  async getMessage(id: string) {
    return this.map.get(id);
  }
  async listMessages(limit: number) {
    return Array.from(this.map.values()).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)).slice(0, limit);
  }
  async upsertMessage(msg: InsertTsunamiMessage) {
    const m = toMessage(msg);
    this.map.set(m.id, m);
    return m;
  }
}

let current: IStorage = new MemoryStorage();

export function setStorage(s: IStorage) {
  current = s;
}

export const storage: IStorage = {
  getMessage: (id) => current.getMessage(id),
  listMessages: (limit) => current.listMessages(limit),
  upsertMessage: (msg) => current.upsertMessage(msg),
};

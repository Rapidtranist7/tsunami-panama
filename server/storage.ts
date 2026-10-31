import { tsunamiMessages } from "../shared/schema";
import type { TsunamiMessage, InsertTsunamiMessage } from "../shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { desc, eq } from "drizzle-orm";
import { setStorage, type IStorage } from "./store";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");
sqlite.exec(`CREATE TABLE IF NOT EXISTS tsunami_messages (
  id TEXT PRIMARY KEY,
  twc_event_id TEXT NOT NULL,
  wmo_id TEXT NOT NULL,
  bulletin_nr INTEGER NOT NULL,
  issued_at TEXT NOT NULL,
  origin_time TEXT,
  magnitude REAL,
  mag_type TEXT,
  depth_km REAL,
  lat REAL,
  lon REAL,
  location TEXT,
  headline TEXT,
  panama_category TEXT,
  is_final INTEGER NOT NULL DEFAULT 0,
  bulletin_url TEXT NOT NULL,
  etas_json TEXT
)`);

export const db = drizzle(sqlite);

export class DatabaseStorage implements IStorage {
  async getMessage(id: string) {
    return db.select().from(tsunamiMessages).where(eq(tsunamiMessages.id, id)).get();
  }
  async listMessages(limit: number) {
    return db
      .select()
      .from(tsunamiMessages)
      .orderBy(desc(tsunamiMessages.issuedAt))
      .limit(limit)
      .all();
  }
  async upsertMessage(msg: InsertTsunamiMessage) {
    return db
      .insert(tsunamiMessages)
      .values(msg)
      .onConflictDoUpdate({ target: tsunamiMessages.id, set: msg })
      .returning()
      .get();
  }
}

export const storage = new DatabaseStorage();
setStorage(storage);

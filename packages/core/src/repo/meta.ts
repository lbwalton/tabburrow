import type { BurrowDB } from "../db";
import { getDB } from "../db";

// Meta is a flat key/value store (lastUsedCollectionId, sync cursor, deviceId, ...).
// Local-only: never enqueues PendingOps.

export async function getMeta(key: string, db: BurrowDB = getDB()): Promise<string | null> {
  const row = await db.meta.get(key);
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string, db: BurrowDB = getDB()): Promise<void> {
  await db.meta.put({ key, value });
}

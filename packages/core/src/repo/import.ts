import type { BurrowDB } from "../db";
import { getDB } from "../db";
import type { Collection, Link, SessionSnapshot } from "../types";
import { enqueueOp } from "./op-queue";

export interface ImportPayload {
  collections: Collection[];
  links: Link[];
  sessions: SessionSnapshot[];
}

export interface ImportResult {
  collections: number;
  links: number;
  sessions: number;
}

/**
 * ID-preserving upsert of a full TabBurrow export (see apps/extension's
 * lib/exporter.ts / lib/importers.ts for the on-disk JSON shape + version
 * check — this function trusts its caller to have already validated that).
 *
 * A single transaction: collections and links are `bulkPut` (Dexie's `put`
 * is a full-row replace keyed by `id`, so a row whose id already exists is
 * upserted in place rather than duplicated — including "un-tombstoning" it
 * if the existing row was soft-deleted and the imported one has
 * `deletedAt: null`, which is exactly what re-importing an older export
 * over a since-edited profile should do) with `updatedAt` stamped to the
 * import time, then a PendingOp is enqueued per row (imported data is dirty
 * and needs to sync out, same as any other write). Sessions are `bulkPut`
 * WITHOUT enqueuing PendingOps — sessions are local-only, never synced (see
 * repo/sessions.ts's file-level comment).
 */
export async function importData(
  data: ImportPayload,
  db: BurrowDB = getDB(),
): Promise<ImportResult> {
  return db.transaction("rw", db.collections, db.links, db.sessions, db.pendingOps, async () => {
    const now = Date.now();
    const collections = data.collections.map((c) => ({ ...c, updatedAt: now }));
    const links = data.links.map((l) => ({ ...l, updatedAt: now }));

    await db.collections.bulkPut(collections);
    await db.links.bulkPut(links);
    await db.sessions.bulkPut(data.sessions);

    for (const c of collections) await enqueueOp(db, "collections", c.id);
    for (const l of links) await enqueueOp(db, "links", l.id);

    return { collections: collections.length, links: links.length, sessions: data.sessions.length };
  });
}

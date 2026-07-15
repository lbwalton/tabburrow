import type { BurrowDB } from "../db";
import type { PendingOp } from "../types";

/**
 * Enqueues a PendingOp for `table`/`rowId`, unless one is already queued for
 * that exact table+rowId. The outbox only needs to know a row is dirty, not
 * how many times it changed since the last sync flush — so repeated
 * mutations of the same row between flushes collapse to a single op.
 *
 * Callers must invoke this from inside a Dexie `db.transaction("rw", ...)`
 * that includes `db.pendingOps`, so the existence check and the insert are
 * atomic with the row mutation they're paired with.
 */
export async function enqueueOp(
  db: BurrowDB,
  table: PendingOp["table"],
  rowId: string,
): Promise<void> {
  const existing = await db.pendingOps
    .where("rowId")
    .equals(rowId)
    .filter((op) => op.table === table)
    .first();
  if (existing) return;
  await db.pendingOps.add({ table, rowId, queuedAt: Date.now() });
}

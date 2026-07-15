import type { BurrowDB } from "../db";
import { getDB } from "../db";
import type { Collection, Link, PendingOp } from "../types";
import { getMeta, setMeta } from "../repo/meta";
import { mergeRow } from "./merge";
import type { SyncTransport } from "./types";

/** Rows per `pushCollections`/`pushLinks` call — keeps payloads bounded. */
const PUSH_BATCH_SIZE = 500;

/**
 * Returns this device's persisted id, generating and storing one via
 * `crypto.randomUUID()` on first call. Meta key `"deviceId"`.
 *
 * Rows do not carry a `deviceId` in v1 — the `updatedAt` tie + tombstone
 * rule in `mergeRow` is enough to make conflict resolution deterministic
 * without it. T18's transport stamps this into its own request metadata.
 */
export async function ensureDeviceId(db: BurrowDB = getDB()): Promise<string> {
  const existing = await getMeta("deviceId", db);
  if (existing) return existing;
  const id = crypto.randomUUID();
  await setMeta("deviceId", id, db);
  return id;
}

/**
 * Module-level (not per-instance) in-flight guard: at most one `syncOnce()`
 * runs at a time across every `SyncEngine` in this process, no matter how
 * many instances exist or how many call it concurrently. A second call made
 * while one is running is handed back the SAME promise instead of starting
 * a second flush+pull cycle against the same underlying db.
 */
let inFlightSync: Promise<{ pushed: number; pulled: number }> | null = null;

export class SyncEngine {
  constructor(
    private readonly db: BurrowDB,
    private readonly transport: SyncTransport,
  ) {}

  /**
   * One sync cycle, in this exact order:
   *
   *  1. FLUSH — drain `pendingOps`, pushing their rows in batches of
   *     `PUSH_BATCH_SIZE`; each op is deleted only once its batch's push
   *     resolves, so a failed push leaves it (and everything queued behind
   *     it) intact for retry.
   *  2. PULL — fetch everything since the stored cursor, `mergeRow` each
   *     remote row against local, and write only the winners that changed —
   *     directly via `bulkPut`, never through the repos, so pull-applied
   *     writes don't re-enqueue `pendingOps` and echo back out.
   *  3. CURSOR — advance the stored cursor to the server's clock, but ONLY
   *     if both phases above succeeded. A throw from either phase leaves
   *     the cursor where it was, so the next call resumes from the same
   *     point (whatever the flush already pushed stays pushed either way —
   *     its ops are already gone).
   */
  syncOnce(): Promise<{ pushed: number; pulled: number }> {
    if (inFlightSync) return inFlightSync;

    const run = this.runSyncOnce();
    inFlightSync = run;
    const clear = () => {
      if (inFlightSync === run) inFlightSync = null;
    };
    // .then(clear, clear) — not .finally(clear) — so this discarded derived
    // promise resolves (rather than re-rejecting into an unhandled
    // rejection) when `run` fails; the caller still observes the failure
    // through the returned `run` itself.
    run.then(clear, clear);

    return run;
  }

  private async runSyncOnce(): Promise<{ pushed: number; pulled: number }> {
    const pushed = await flush(this.db, this.transport);
    const cursor = await currentCursor(this.db);
    const { pulled, serverNow } = await pullAndMerge(this.db, this.transport, cursor);
    await setMeta("syncCursor", String(serverNow), this.db);
    return { pushed, pulled };
  }

  /**
   * First-sign-in bootstrap: pushes every local row (live and tombstoned
   * alike) regardless of whether it has a `pendingOps` entry, clears the
   * `pendingOps` that were covered by that push (they're now redundant —
   * anything else stays queued for the next flush), then runs a full pull
   * from cursor 0 and advances the cursor. Returns the number of rows
   * pushed.
   */
  async initialUpload(): Promise<number> {
    const [collections, links] = await Promise.all([
      this.db.collections.toArray(),
      this.db.links.toArray(),
    ]);

    await pushInBatches((rows) => this.transport.pushCollections(rows), collections);
    await pushInBatches((rows) => this.transport.pushLinks(rows), links);

    const collectionIds = new Set(collections.map((c) => c.id));
    const linkIds = new Set(links.map((l) => l.id));
    await this.db.pendingOps
      .filter(
        (op) =>
          (op.table === "collections" && collectionIds.has(op.rowId)) ||
          (op.table === "links" && linkIds.has(op.rowId)),
      )
      .delete();

    const { serverNow } = await pullAndMerge(this.db, this.transport, 0);
    await setMeta("syncCursor", String(serverNow), this.db);

    return collections.length + links.length;
  }
}

async function currentCursor(db: BurrowDB): Promise<number> {
  const stored = await getMeta("syncCursor", db);
  return stored ? Number(stored) : 0;
}

async function pushInBatches<T>(
  pushFn: (rows: T[]) => Promise<void>,
  rows: T[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += PUSH_BATCH_SIZE) {
    await pushFn(rows.slice(i, i + PUSH_BATCH_SIZE));
  }
}

async function flush(db: BurrowDB, transport: SyncTransport): Promise<number> {
  const collectionsPushed = await flushTable(db, transport, "collections");
  const linksPushed = await flushTable(db, transport, "links");
  return collectionsPushed + linksPushed;
}

/**
 * Drains every queued `PendingOp` for one table, pushing rows in batches of
 * `PUSH_BATCH_SIZE`. A queued row that's gone hard-absent (no repo path
 * produces this today — rows are only ever tombstoned — but a op can still
 * outlive its row, e.g. via a direct db write) has nothing to push, so its
 * op is deleted immediately rather than retried forever. Ops for rows that
 * WERE pushed are deleted only after that batch's push call resolves, so a
 * failing push leaves them (and every later batch) queued for retry.
 */
async function flushTable(
  db: BurrowDB,
  transport: SyncTransport,
  table: PendingOp["table"],
): Promise<number> {
  const ops = await db.pendingOps.where("table").equals(table).toArray();
  if (ops.length === 0) return 0;

  let pushed = 0;
  for (let i = 0; i < ops.length; i += PUSH_BATCH_SIZE) {
    const batch = ops.slice(i, i + PUSH_BATCH_SIZE);
    const rows: (Collection | Link)[] = [];
    const rowfulOpIds: number[] = [];
    const staleOpIds: number[] = [];

    for (const op of batch) {
      const row =
        table === "collections" ? await db.collections.get(op.rowId) : await db.links.get(op.rowId);
      if (row) {
        rows.push(row);
        rowfulOpIds.push(op.id!);
      } else {
        staleOpIds.push(op.id!);
      }
    }

    if (staleOpIds.length > 0) await db.pendingOps.bulkDelete(staleOpIds);
    if (rows.length === 0) continue;

    if (table === "collections") {
      await transport.pushCollections(rows as Collection[]);
    } else {
      await transport.pushLinks(rows as Link[]);
    }
    await db.pendingOps.bulkDelete(rowfulOpIds);
    pushed += rows.length;
  }

  return pushed;
}

/**
 * Fetches everything since `cursor`, resolves each remote row against local
 * via `mergeRow`, and `bulkPut`s only the winners that changed — directly on
 * the Dexie tables, inside one transaction, never through the repos (so this
 * never enqueues a `PendingOp` and echoes the write back out on the next
 * flush). Returns how many rows were actually written, not how many were
 * received.
 */
async function pullAndMerge(
  db: BurrowDB,
  transport: SyncTransport,
  cursor: number,
): Promise<{ pulled: number; serverNow: number }> {
  const { collections, links, serverNow } = await transport.pullSince(cursor);

  let pulled = 0;
  await db.transaction("rw", db.collections, db.links, async () => {
    const collectionWinners: Collection[] = [];
    for (const remote of collections) {
      const local = await db.collections.get(remote.id);
      const { winner, changed } = mergeRow(local, remote);
      if (changed) collectionWinners.push(winner);
    }
    if (collectionWinners.length > 0) await db.collections.bulkPut(collectionWinners);

    const linkWinners: Link[] = [];
    for (const remote of links) {
      const local = await db.links.get(remote.id);
      const { winner, changed } = mergeRow(local, remote);
      if (changed) linkWinners.push(winner);
    }
    if (linkWinners.length > 0) await db.links.bulkPut(linkWinners);

    pulled = collectionWinners.length + linkWinners.length;
  });

  return { pulled, serverNow };
}

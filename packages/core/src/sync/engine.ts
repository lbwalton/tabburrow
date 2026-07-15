import type { Table } from "dexie";
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
 * Module-level (not per-instance) overlap guard: at most one engine
 * operation — a `syncOnce()` cycle OR an `initialUpload()` bootstrap — runs
 * at a time across every `SyncEngine` in this process, no matter how many
 * instances exist or how many call concurrently.
 *
 * Two pieces:
 *  - `inFlightSync` coalesces concurrent `syncOnce()` calls: a call made
 *    while a cycle is pending is handed back the SAME promise. It is armed
 *    synchronously, before any `await`, so even two back-to-back
 *    un-awaited calls share one promise.
 *  - `opChainTail` serializes everything: each new operation starts only
 *    after the previous one settles. In particular, a `syncOnce()`
 *    arriving while an `initialUpload()` bootstrap is in flight is neither
 *    dropped nor run concurrently — it runs immediately after the
 *    bootstrap completes (so it observes the bootstrap's cursor and its
 *    cleared ops). The chain itself never rejects; failures are observed
 *    on each operation's own returned promise.
 */
let inFlightSync: Promise<{ pushed: number; pulled: number }> | null = null;
let opChainTail: Promise<unknown> = Promise.resolve();

function noop(): void {}

function chainEngineOp<T>(op: () => Promise<T>): Promise<T> {
  const run = opChainTail.then(op);
  // Park a handled, always-fulfilled derivative as the new tail so a failed
  // operation can't poison the chain or surface as an unhandled rejection
  // there — the caller still sees the failure through `run` itself.
  opChainTail = run.then(noop, noop);
  return run;
}

export class SyncEngine {
  constructor(
    private readonly db: BurrowDB,
    private readonly transport: SyncTransport,
  ) {}

  /**
   * One sync cycle, in this exact order:
   *
   *  1. FLUSH — drain `pendingOps`, pushing their rows in batches of
   *     `PUSH_BATCH_SIZE`. An op is deleted only once its batch's push
   *     resolves AND its row's `updatedAt` still equals the snapshot that
   *     went over the wire (see `deleteFlushedOps` — the op queue dedupes
   *     per row, so an edit landing mid-push must keep its op or it would
   *     never upload). A failed push leaves its batch's ops and every later
   *     batch's ops intact for retry.
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

    const run = chainEngineOp(() => this.runSyncOnce());
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
   * `pendingOps` covered by that push (same conditional rule as the flush:
   * an op survives if its row was edited past the pushed snapshot while the
   * push was in flight — and ops for rows NOT covered by the push stay
   * queued regardless), then runs a full pull from cursor 0 and advances
   * the cursor. Returns the number of rows pushed.
   *
   * Serialized through the same module-level guard as `syncOnce()`: a
   * bootstrap waits for any in-flight cycle, and a `syncOnce()` arriving
   * mid-bootstrap runs only after the bootstrap completes.
   */
  initialUpload(): Promise<number> {
    return chainEngineOp(() => this.runInitialUpload());
  }

  private async runInitialUpload(): Promise<number> {
    const [collections, links] = await Promise.all([
      this.db.collections.toArray(),
      this.db.links.toArray(),
    ]);

    await pushInBatches((rows) => this.transport.pushCollections(rows), collections);
    await pushInBatches((rows) => this.transport.pushLinks(rows), links);

    // Clear the ops covered by the push — conditionally, keyed on the
    // updatedAt snapshot each row had when it went over the wire, so an
    // edit made during the (long) bootstrap push keeps its op queued.
    const pushedCollections = new Map(collections.map((c) => [c.id, c.updatedAt]));
    const pushedLinks = new Map(links.map((l) => [l.id, l.updatedAt]));
    const ops = await this.db.pendingOps.toArray();
    const covered = (table: PendingOp["table"], snapshots: Map<string, number>): PushedSnapshot[] =>
      ops
        .filter((op) => op.table === table && snapshots.has(op.rowId))
        .map((op) => ({ opId: op.id!, rowId: op.rowId, updatedAt: snapshots.get(op.rowId)! }));
    await deleteFlushedOps(this.db, "collections", covered("collections", pushedCollections));
    await deleteFlushedOps(this.db, "links", covered("links", pushedLinks));

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

/** What went over the wire for one op: enough to tell if the row moved on. */
interface PushedSnapshot {
  opId: number;
  rowId: string;
  updatedAt: number;
}

/**
 * Deletes the given ops ONLY where the row's CURRENT `updatedAt` still
 * equals the snapshot that was pushed. The re-read and the delete share one
 * rw-transaction over the row table + `pendingOps`, so no repo mutation can
 * slip between the check and the delete (Dexie rw-transactions on
 * overlapping stores serialize against the repos' own transactions).
 *
 * Why conditional: the op queue DEDUPES per (table,rowId), so an edit made
 * while the push round-trip was in flight did NOT enqueue a second op — the
 * op passed in here is the only thing covering that edit. Deleting it
 * unconditionally would strand the edit locally until some future unrelated
 * write of the same row (permanent loss if the device never writes again).
 * An op whose row moved past the pushed snapshot therefore survives, and
 * the next flush re-pushes the newer version. A row that vanished entirely
 * has nothing left to upload, so its op is deleted.
 */
async function deleteFlushedOps(
  db: BurrowDB,
  table: PendingOp["table"],
  pushed: PushedSnapshot[],
): Promise<void> {
  if (pushed.length === 0) return;
  const rowTable: Table<Collection | Link, string> =
    table === "collections" ? db.collections : db.links;
  await db.transaction("rw", rowTable, db.pendingOps, async () => {
    const current = await rowTable.bulkGet(pushed.map((s) => s.rowId));
    const deletable: number[] = [];
    pushed.forEach((snapshot, i) => {
      const row = current[i];
      if (!row || row.updatedAt === snapshot.updatedAt) deletable.push(snapshot.opId);
    });
    if (deletable.length > 0) await db.pendingOps.bulkDelete(deletable);
  });
}

/**
 * Drains every queued `PendingOp` for one table, pushing rows in batches of
 * `PUSH_BATCH_SIZE` (row loads are one `bulkGet` per batch). A queued row
 * that's gone hard-absent (no repo path produces this today — rows are only
 * ever tombstoned — but an op can still outlive its row, e.g. via a direct
 * db write) has nothing to push, so its op is deleted immediately rather
 * than retried forever. Ops for rows that WERE pushed are deleted only
 * after that batch's push call resolves — and even then only if the row
 * hasn't been edited past the pushed snapshot in the meantime (see
 * `deleteFlushedOps`) — so a failing push leaves its ops (and every later
 * batch) queued for retry, and a mid-push edit is never silently dropped.
 */
async function flushTable(
  db: BurrowDB,
  transport: SyncTransport,
  table: PendingOp["table"],
): Promise<number> {
  const ops = await db.pendingOps.where("table").equals(table).toArray();
  if (ops.length === 0) return 0;

  const rowTable: Table<Collection | Link, string> =
    table === "collections" ? db.collections : db.links;

  let pushed = 0;
  for (let i = 0; i < ops.length; i += PUSH_BATCH_SIZE) {
    const batch = ops.slice(i, i + PUSH_BATCH_SIZE);
    const rows = await rowTable.bulkGet(batch.map((op) => op.rowId));

    const entries: PushedSnapshot[] = [];
    const pushRows: (Collection | Link)[] = [];
    const staleOpIds: number[] = [];
    batch.forEach((op, idx) => {
      const row = rows[idx];
      if (row) {
        entries.push({ opId: op.id!, rowId: row.id, updatedAt: row.updatedAt });
        pushRows.push(row);
      } else {
        staleOpIds.push(op.id!);
      }
    });

    if (staleOpIds.length > 0) await db.pendingOps.bulkDelete(staleOpIds);
    if (pushRows.length === 0) continue;

    if (table === "collections") {
      await transport.pushCollections(pushRows as Collection[]);
    } else {
      await transport.pushLinks(pushRows as Link[]);
    }
    await deleteFlushedOps(db, table, entries);
    pushed += pushRows.length;
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

import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BurrowDB } from "../src/db";
import type { Collection, Link, PendingOp } from "../src/types";
import { createCollection, softDeleteCollection } from "../src/repo/collections";
import { saveTabs, softDeleteLinks } from "../src/repo/links";
import { getMeta, setMeta } from "../src/repo/meta";
import { mergeRow } from "../src/sync/merge";
import { SyncEngine, ensureDeviceId } from "../src/sync/engine";
import type { SyncTransport } from "../src/sync/types";

let db: BurrowDB;

beforeEach(async () => {
  try {
    await indexedDB.deleteDatabase("tabburrow");
  } catch {
    // ignore: database might not exist yet
  }
  db = new BurrowDB();
  await db.open();
});

afterEach(async () => {
  db.close();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeCollection(overrides: Partial<Collection> = {}): Collection {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name: "C",
    accent: null,
    position: "a0",
    isShared: false,
    shareSlug: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

function makeLink(overrides: Partial<Link> = {}): Link {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    collectionId: crypto.randomUUID(),
    url: "https://example.com",
    title: "Example",
    faviconUrl: null,
    note: null,
    tags: [],
    position: "a0",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

/** Plain-object fake transport: in-memory call recording, scriptable responses/throws. */
interface FakeTransport extends SyncTransport {
  pushCollectionsCalls: Collection[][];
  pushLinksCalls: Link[][];
  pullCalls: number[];
  pullResponse: { collections: Collection[]; links: Link[]; serverNow: number };
  pushShouldFail: boolean;
  pullShouldFail: boolean;
}

function createFakeTransport(): FakeTransport {
  const transport: FakeTransport = {
    pushCollectionsCalls: [],
    pushLinksCalls: [],
    pullCalls: [],
    pullResponse: { collections: [], links: [], serverNow: 0 },
    pushShouldFail: false,
    pullShouldFail: false,
    async pushCollections(rows) {
      if (transport.pushShouldFail) throw new Error("push failed");
      transport.pushCollectionsCalls.push(rows);
    },
    async pushLinks(rows) {
      if (transport.pushShouldFail) throw new Error("push failed");
      transport.pushLinksCalls.push(rows);
    },
    async pullSince(cursor) {
      transport.pullCalls.push(cursor);
      if (transport.pullShouldFail) throw new Error("pull failed");
      return transport.pullResponse;
    },
  };
  return transport;
}

async function opsFor(table: PendingOp["table"], rowId: string): Promise<PendingOp[]> {
  return db.pendingOps.where("rowId").equals(rowId).filter((op) => op.table === table).toArray();
}

// ---------------------------------------------------------------------------
// mergeRow
// ---------------------------------------------------------------------------

describe("mergeRow", () => {
  it("no local row: remote wins, changed = true", () => {
    const remote = makeCollection({ updatedAt: 100 });
    const { winner, changed } = mergeRow(undefined, remote);
    expect(winner).toBe(remote);
    expect(changed).toBe(true);
  });

  it("remote strictly newer: remote wins, changed = true", () => {
    const local = makeCollection({ updatedAt: 100 });
    const remote = makeCollection({ id: local.id, updatedAt: 200 });
    const { winner, changed } = mergeRow(local, remote);
    expect(winner).toBe(remote);
    expect(changed).toBe(true);
  });

  it("local strictly newer: local wins, changed = false", () => {
    const local = makeCollection({ updatedAt: 200 });
    const remote = makeCollection({ id: local.id, updatedAt: 100 });
    const { winner, changed } = mergeRow(local, remote);
    expect(winner).toBe(local);
    expect(changed).toBe(false);
  });

  it("exact tie, local tombstoned + remote live: local (tombstone) wins", () => {
    const local = makeCollection({ updatedAt: 100, deletedAt: 100 });
    const remote = makeCollection({ id: local.id, updatedAt: 100, deletedAt: null });
    const { winner, changed } = mergeRow(local, remote);
    expect(winner).toBe(local);
    expect(changed).toBe(false);
  });

  it("exact tie, local live + remote tombstoned: remote (tombstone) wins", () => {
    const local = makeCollection({ updatedAt: 100, deletedAt: null });
    const remote = makeCollection({ id: local.id, updatedAt: 100, deletedAt: 100 });
    const { winner, changed } = mergeRow(local, remote);
    expect(winner).toBe(remote);
    expect(changed).toBe(true);
  });

  it("exact tie, both tombstoned: remote wins (deterministic)", () => {
    const local = makeCollection({ updatedAt: 100, deletedAt: 100 });
    const remote = makeCollection({ id: local.id, updatedAt: 100, deletedAt: 100 });
    const { winner, changed } = mergeRow(local, remote);
    expect(winner).toBe(remote);
    expect(changed).toBe(true);
  });

  it("exact tie, both live: remote wins (deterministic)", () => {
    const local = makeCollection({ updatedAt: 100, deletedAt: null });
    const remote = makeCollection({ id: local.id, updatedAt: 100, deletedAt: null });
    const { winner, changed } = mergeRow(local, remote);
    expect(winner).toBe(remote);
    expect(changed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SyncEngine.syncOnce — flush (push)
// ---------------------------------------------------------------------------

describe("SyncEngine.syncOnce — flush", () => {
  it("pushes pending collections and links, and clears their PendingOps", async () => {
    const c = await createCollection("C", undefined, db);
    const [link] = await saveTabs(c.id, [{ url: "https://a.com", title: "A" }], db);
    const transport = createFakeTransport();
    const engine = new SyncEngine(db, transport);

    const result = await engine.syncOnce();

    expect(result.pushed).toBe(2);
    expect(transport.pushCollectionsCalls).toEqual([[expect.objectContaining({ id: c.id })]]);
    expect(transport.pushLinksCalls).toEqual([[expect.objectContaining({ id: link!.id })]]);
    expect(await opsFor("collections", c.id)).toHaveLength(0);
    expect(await opsFor("links", link!.id)).toHaveLength(0);
  });

  it("pendingOps drained exactly once: a second syncOnce with nothing new pushes 0 rows", async () => {
    await createCollection("C", undefined, db);
    const transport = createFakeTransport();
    const engine = new SyncEngine(db, transport);

    await engine.syncOnce();
    expect(transport.pushCollectionsCalls).toHaveLength(1);

    const second = await engine.syncOnce();
    expect(second.pushed).toBe(0);
    expect(transport.pushCollectionsCalls).toHaveLength(1); // no re-push
  });

  it("skips a queued op whose row has gone hard-absent, and clears the stale op", async () => {
    const c = await createCollection("C", undefined, db);
    // Simulate a row vanishing without going through the tombstone path.
    await db.collections.delete(c.id);
    const transport = createFakeTransport();
    const engine = new SyncEngine(db, transport);

    const result = await engine.syncOnce();

    expect(result.pushed).toBe(0);
    expect(transport.pushCollectionsCalls).toEqual([]);
    expect(await opsFor("collections", c.id)).toHaveLength(0);
  });

  it("1200 pending rows push in batches of 500 (3 calls: 500, 500, 200)", async () => {
    const rows: Collection[] = [];
    const ops: Omit<PendingOp, "id">[] = [];
    for (let i = 0; i < 1200; i++) {
      const c = makeCollection({ name: `C${i}` });
      rows.push(c);
      ops.push({ table: "collections", rowId: c.id, queuedAt: Date.now() });
    }
    await db.collections.bulkAdd(rows);
    await db.pendingOps.bulkAdd(ops as PendingOp[]);

    const transport = createFakeTransport();
    const engine = new SyncEngine(db, transport);
    const result = await engine.syncOnce();

    expect(result.pushed).toBe(1200);
    expect(transport.pushCollectionsCalls).toHaveLength(3);
    expect(transport.pushCollectionsCalls.map((batch) => batch.length)).toEqual([500, 500, 200]);
  });

  it("failed push leaves pendingOps intact and the cursor unmoved", async () => {
    const c = await createCollection("C", undefined, db);
    const transport = createFakeTransport();
    transport.pushShouldFail = true;
    const engine = new SyncEngine(db, transport);

    await expect(engine.syncOnce()).rejects.toThrow("push failed");

    expect(await opsFor("collections", c.id)).toHaveLength(1);
    expect(await getMeta("syncCursor", db)).toBeNull();
    expect(transport.pullCalls).toHaveLength(0); // pull never ran
  });
});

// ---------------------------------------------------------------------------
// SyncEngine.syncOnce — pull
// ---------------------------------------------------------------------------

describe("SyncEngine.syncOnce — pull", () => {
  it("pull of an id the local db has never seen inserts cleanly", async () => {
    const remote = makeCollection({ updatedAt: 500 });
    const transport = createFakeTransport();
    transport.pullResponse = { collections: [remote], links: [], serverNow: 1000 };
    const engine = new SyncEngine(db, transport);

    const result = await engine.syncOnce();

    expect(result.pulled).toBe(1);
    expect(await db.collections.get(remote.id)).toEqual(remote);
  });

  it("remote newer overwrites local", async () => {
    const local = makeCollection({ updatedAt: 100, name: "Old" });
    await db.collections.put(local);
    const remote = makeCollection({ id: local.id, updatedAt: 200, name: "New" });
    const transport = createFakeTransport();
    transport.pullResponse = { collections: [remote], links: [], serverNow: 1000 };
    const engine = new SyncEngine(db, transport);

    const result = await engine.syncOnce();

    expect(result.pulled).toBe(1);
    expect((await db.collections.get(local.id))!.name).toBe("New");
  });

  it("echo suppression: a pulled row OLDER than local must not clobber it (local edit t=100, pull returns same row t=90)", async () => {
    const c = await createCollection("C", undefined, db); // enqueues a pendingOp
    await db.collections.update(c.id, { name: "Local edit", updatedAt: 100 });
    const staleRemote: Collection = { ...(await db.collections.get(c.id))!, name: "Stale from earlier device", updatedAt: 90 };
    const transport = createFakeTransport();
    // Pull returns the same id but an older snapshot (as if echoed back from
    // a device that hadn't caught up yet at push time).
    transport.pullResponse = { collections: [staleRemote], links: [], serverNow: 1000 };
    const engine = new SyncEngine(db, transport);

    const result = await engine.syncOnce();

    expect(result.pulled).toBe(0);
    expect((await db.collections.get(c.id))!.name).toBe("Local edit");
    expect((await db.collections.get(c.id))!.updatedAt).toBe(100);
  });

  it("tombstone beats concurrent edit, direction 1: local live + remote tombstoned at a tie deletes the local row", async () => {
    const local = makeCollection({ updatedAt: 100, deletedAt: null });
    await db.collections.put(local);
    const remote = makeCollection({ id: local.id, updatedAt: 100, deletedAt: 100 });
    const transport = createFakeTransport();
    transport.pullResponse = { collections: [remote], links: [], serverNow: 1000 };
    const engine = new SyncEngine(db, transport);

    await engine.syncOnce();

    expect((await db.collections.get(local.id))!.deletedAt).toBe(100);
  });

  it("tombstone beats concurrent edit, direction 2: local tombstoned + remote live at a tie stays deleted", async () => {
    const local = makeCollection({ updatedAt: 100, deletedAt: 100 });
    await db.collections.put(local);
    const remote = makeCollection({ id: local.id, updatedAt: 100, deletedAt: null, name: "Concurrent edit" });
    const transport = createFakeTransport();
    transport.pullResponse = { collections: [remote], links: [], serverNow: 1000 };
    const engine = new SyncEngine(db, transport);

    await engine.syncOnce();

    const row = await db.collections.get(local.id);
    expect(row!.deletedAt).toBe(100);
    expect(row!.name).not.toBe("Concurrent edit");
  });

  it("deletion never resurrects across 3 sync cycles against a stale live remote", async () => {
    const c = await createCollection("C", undefined, db);
    await softDeleteCollection(c.id, db);
    const tombstoned = (await db.collections.get(c.id))!;
    const transport = createFakeTransport();
    // An earlier/slower device keeps re-offering a stale live version.
    transport.pullResponse = {
      collections: [{ ...tombstoned, deletedAt: null, updatedAt: tombstoned.updatedAt - 10 }],
      links: [],
      serverNow: 1000,
    };
    const engine = new SyncEngine(db, transport);

    for (let i = 0; i < 3; i++) {
      await engine.syncOnce();
      expect((await db.collections.get(c.id))!.deletedAt).not.toBeNull();
    }
  });

  it("links: same merge behavior applies (remote newer overwrites local)", async () => {
    const local = makeLink({ updatedAt: 100, title: "Old" });
    await db.links.put(local);
    const remote = makeLink({ id: local.id, collectionId: local.collectionId, updatedAt: 200, title: "New" });
    const transport = createFakeTransport();
    transport.pullResponse = { collections: [], links: [remote], serverNow: 1000 };
    const engine = new SyncEngine(db, transport);

    const result = await engine.syncOnce();

    expect(result.pulled).toBe(1);
    expect((await db.links.get(local.id))!.title).toBe("New");
  });

  it("pull-applied writes do not enqueue PendingOps (no echo back on the next flush)", async () => {
    const remote = makeCollection({ updatedAt: 500 });
    const transport = createFakeTransport();
    transport.pullResponse = { collections: [remote], links: [], serverNow: 1000 };
    const engine = new SyncEngine(db, transport);

    await engine.syncOnce();

    expect(await opsFor("collections", remote.id)).toHaveLength(0);
  });

  it("cursor advances to serverNow only after a fully successful cycle, and is used as the next pull's cursor", async () => {
    const transport = createFakeTransport();
    transport.pullResponse = { collections: [], links: [], serverNow: 555 };
    const engine = new SyncEngine(db, transport);

    await engine.syncOnce();
    expect(await getMeta("syncCursor", db)).toBe("555");
    expect(transport.pullCalls).toEqual([0]); // first call defaults to 0

    transport.pullResponse = { collections: [], links: [], serverNow: 999 };
    await engine.syncOnce();
    expect(await getMeta("syncCursor", db)).toBe("999");
    expect(transport.pullCalls).toEqual([0, 555]);
  });

  it("failed pull leaves the cursor unmoved, but ops already pushed in this cycle stay deleted", async () => {
    const c = await createCollection("C", undefined, db);
    const transport = createFakeTransport();
    transport.pullShouldFail = true;
    const engine = new SyncEngine(db, transport);

    await expect(engine.syncOnce()).rejects.toThrow("pull failed");

    expect(transport.pushCollectionsCalls).toHaveLength(1); // push succeeded
    expect(await opsFor("collections", c.id)).toHaveLength(0); // op was flushed
    expect(await getMeta("syncCursor", db)).toBeNull(); // cursor never moved
  });
});

// ---------------------------------------------------------------------------
// Overlap guard
// ---------------------------------------------------------------------------

describe("SyncEngine.syncOnce — overlap guard", () => {
  it("a syncOnce() called while one is in-flight returns the SAME promise, and only one cycle runs", async () => {
    await createCollection("C", undefined, db);
    const transport = createFakeTransport();
    let resolvePull: (() => void) | undefined;
    let pullStarted!: () => void;
    const pullStartedPromise = new Promise<void>((resolve) => {
      pullStarted = resolve;
    });
    transport.pullSince = (cursor: number) => {
      transport.pullCalls.push(cursor);
      pullStarted();
      return new Promise((resolve) => {
        resolvePull = () => resolve(transport.pullResponse);
      });
    };
    const engine = new SyncEngine(db, transport);

    // The overlap guard is set synchronously inside the first call, before
    // any of the (real, IndexedDB-backed) flush work has even started — so
    // this second call, issued before either promise is awaited, must see
    // the guard already engaged and hand back the identical promise.
    const p1 = engine.syncOnce();
    const p2 = engine.syncOnce();
    expect(p1).toBe(p2);

    // Flush does real async IndexedDB work before pull begins; wait for
    // pullSince to actually be invoked rather than asserting immediately.
    await pullStartedPromise;
    expect(resolvePull).toBeDefined();
    resolvePull!();
    await p1;

    expect(transport.pullCalls).toHaveLength(1);
    expect(transport.pushCollectionsCalls).toHaveLength(1);
  });

  it("a fresh syncOnce() after the previous one settles runs a new cycle (guard is released)", async () => {
    const transport = createFakeTransport();
    const engine = new SyncEngine(db, transport);

    await engine.syncOnce();
    await engine.syncOnce();

    expect(transport.pullCalls).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// initialUpload
// ---------------------------------------------------------------------------

describe("SyncEngine.initialUpload", () => {
  it("pushes all local live+tombstoned rows even when none have PendingOps entries", async () => {
    const c1 = await createCollection("A", undefined, db);
    const c2 = await createCollection("B", undefined, db);
    await softDeleteCollection(c2.id, db);
    const [link] = await saveTabs(c1.id, [{ url: "https://a.com", title: "A" }], db);
    await db.pendingOps.clear(); // simulate these rows having no queued ops

    const transport = createFakeTransport();
    const engine = new SyncEngine(db, transport);

    const pushedCount = await engine.initialUpload();

    expect(pushedCount).toBe(3); // 2 collections + 1 link
    const pushedCollectionIds = transport.pushCollectionsCalls.flat().map((c) => c.id).sort();
    expect(pushedCollectionIds).toEqual([c1.id, c2.id].sort());
    expect(transport.pushLinksCalls.flat().map((l) => l.id)).toEqual([link!.id]);
  });

  it("clears only the PendingOps covered by the pushed rows, leaving unrelated ops alone", async () => {
    const c = await createCollection("C", undefined, db); // enqueues an op for c
    // An orphan op pointing at a row id that doesn't exist locally.
    await db.pendingOps.add({ table: "collections", rowId: "ghost-id", queuedAt: Date.now() });

    const transport = createFakeTransport();
    const engine = new SyncEngine(db, transport);
    await engine.initialUpload();

    expect(await opsFor("collections", c.id)).toHaveLength(0);
    expect(await opsFor("collections", "ghost-id")).toHaveLength(1);
  });

  it("runs a full pull from cursor 0 after pushing, and advances the cursor", async () => {
    const remote = makeCollection({ updatedAt: 500 });
    const transport = createFakeTransport();
    transport.pullResponse = { collections: [remote], links: [], serverNow: 777 };
    const engine = new SyncEngine(db, transport);

    await engine.initialUpload();

    expect(transport.pullCalls).toEqual([0]);
    expect(await db.collections.get(remote.id)).toEqual(remote);
    expect(await getMeta("syncCursor", db)).toBe("777");
  });

  it("returns 0 and still pulls when there is nothing local to push", async () => {
    const transport = createFakeTransport();
    transport.pullResponse = { collections: [], links: [], serverNow: 42 };
    const engine = new SyncEngine(db, transport);

    const pushedCount = await engine.initialUpload();

    expect(pushedCount).toBe(0);
    expect(transport.pushCollectionsCalls).toEqual([]);
    expect(transport.pushLinksCalls).toEqual([]);
    expect(transport.pullCalls).toEqual([0]);
  });
});

// ---------------------------------------------------------------------------
// ensureDeviceId
// ---------------------------------------------------------------------------

describe("ensureDeviceId", () => {
  it("generates and persists a UUID on first call, and returns the same value thereafter", async () => {
    const first = await ensureDeviceId(db);
    expect(first).toMatch(/^[0-9a-f-]{36}$/i);
    expect(await getMeta("deviceId", db)).toBe(first);

    const second = await ensureDeviceId(db);
    expect(second).toBe(first);
  });

  it("returns an already-set deviceId without generating a new one", async () => {
    await setMeta("deviceId", "fixed-device-id", db);
    expect(await ensureDeviceId(db)).toBe("fixed-device-id");
  });
});

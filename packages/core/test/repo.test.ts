import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BurrowDB } from "../src/db";
import type { Collection, Link, PendingOp, SessionSnapshot } from "../src/types";
import {
  createCollection,
  renameCollection,
  setCollectionAccent,
  setShare,
  generateShareSlug,
  moveCollection,
  softDeleteCollection,
  restoreCollection,
  listCollections,
} from "../src/repo/collections";
import {
  saveTabs,
  updateLink,
  moveLink,
  moveLinkToEnd,
  softDeleteLinks,
  restoreLinks,
  listLinks,
} from "../src/repo/links";
import {
  saveSnapshot,
  listSnapshots,
  deleteSnapshot,
  pruneAutoSnapshots,
} from "../src/repo/sessions";
import { getMeta, setMeta } from "../src/repo/meta";
import { importData } from "../src/repo/import";
import type { ImportPayload } from "../src/repo/import";

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

/** Fetches every PendingOp queued for a given table+rowId. */
async function opsFor(table: PendingOp["table"], rowId: string): Promise<PendingOp[]> {
  return db.pendingOps.where("rowId").equals(rowId).filter((op) => op.table === table).toArray();
}

describe("collections repo", () => {
  it("createCollection appends and listCollections returns rows ordered by position", async () => {
    const a = await createCollection("A", undefined, db);
    const b = await createCollection("B", undefined, db);
    const c = await createCollection("C", undefined, db);

    const list = await listCollections(db);
    expect(list.map((c) => c.id)).toEqual([a.id, b.id, c.id]);
    expect(list[0]!.position < list[1]!.position).toBe(true);
    expect(list[1]!.position < list[2]!.position).toBe(true);
  });

  it("createCollection defaults accent to null and sets isShared/shareSlug/deletedAt defaults", async () => {
    const c = await createCollection("No accent", undefined, db);
    expect(c.accent).toBeNull();
    expect(c.isShared).toBe(false);
    expect(c.shareSlug).toBeNull();
    expect(c.deletedAt).toBeNull();
    expect(c.createdAt).toBe(c.updatedAt);
  });

  it("createCollection accepts an explicit accent", async () => {
    const c = await createCollection("Accented", "#F97316", db);
    expect(c.accent).toBe("#F97316");
  });

  it("createCollection throws on empty or whitespace-only name", async () => {
    await expect(createCollection("", undefined, db)).rejects.toThrow();
    await expect(createCollection("   ", undefined, db)).rejects.toThrow();
  });

  it("renameCollection updates name and updatedAt, and enqueues a PendingOp", async () => {
    const c = await createCollection("Old", undefined, db);
    const before = await db.collections.get(c.id);
    await new Promise((r) => setTimeout(r, 2));

    await renameCollection(c.id, "New", db);

    const after = await db.collections.get(c.id);
    expect(after!.name).toBe("New");
    expect(after!.updatedAt).toBeGreaterThan(before!.updatedAt);
    expect(await opsFor("collections", c.id)).toHaveLength(1);
  });

  it("setCollectionAccent updates accent (including back to null) and enqueues a PendingOp", async () => {
    const c = await createCollection("C", "#111111", db);
    await setCollectionAccent(c.id, "#222222", db);
    expect((await db.collections.get(c.id))!.accent).toBe("#222222");

    await setCollectionAccent(c.id, null, db);
    expect((await db.collections.get(c.id))!.accent).toBeNull();
    expect((await opsFor("collections", c.id)).length).toBeGreaterThanOrEqual(1);
  });

  it("setShare turns sharing on: sets isShared/shareSlug, bumps updatedAt, and enqueues a PendingOp", async () => {
    const c = await createCollection("C", undefined, db);
    const before = await db.collections.get(c.id);
    await new Promise((r) => setTimeout(r, 2));

    const slug = generateShareSlug();
    await setShare(c.id, { isShared: true, shareSlug: slug }, db);

    const after = await db.collections.get(c.id);
    expect(after!.isShared).toBe(true);
    expect(after!.shareSlug).toBe(slug);
    expect(after!.updatedAt).toBeGreaterThan(before!.updatedAt);
    expect(await opsFor("collections", c.id)).toHaveLength(1);
  });

  it("setShare turns sharing off: clears isShared/shareSlug back to false/null and enqueues a PendingOp", async () => {
    const c = await createCollection("C", undefined, db);
    await setShare(c.id, { isShared: true, shareSlug: generateShareSlug() }, db);

    await setShare(c.id, { isShared: false, shareSlug: null }, db);

    const after = await db.collections.get(c.id);
    expect(after!.isShared).toBe(false);
    expect(after!.shareSlug).toBeNull();
    expect((await opsFor("collections", c.id)).length).toBeGreaterThanOrEqual(1);
  });

  it("setShare on a nonexistent id is a no-op: no row created, no PendingOp enqueued", async () => {
    await setShare("no-such-id", { isShared: true, shareSlug: generateShareSlug() }, db);
    expect(await db.collections.get("no-such-id")).toBeUndefined();
    expect(await opsFor("collections", "no-such-id")).toHaveLength(0);
  });

  it("generateShareSlug: 200 generated slugs all conform to the web share page's ^[a-z0-9]{10}$ alphabet/length", () => {
    // apps/web/lib/share.ts's isValidShareSlug validates incoming slugs
    // against exactly this pattern (lowercase alnum, 10 chars) — a generator
    // emitting ANY character outside the 36-char lowercase-alnum alphabet
    // (uppercase, "_", "-", ...) would produce slugs that 404 on their own
    // share page. 200 samples, not 1, to make an alphabet violation (not
    // just the length) hard to miss by chance.
    const pattern = /^[a-z0-9]{10}$/;
    for (let i = 0; i < 200; i++) {
      const slug = generateShareSlug();
      expect(slug).toMatch(pattern);
    }
  });

  it("generateShareSlug: every one of the 36 alphabet characters appears across 5000 samples (distribution sanity)", () => {
    // Catches a truncated or unreachable-character mapping the regex test
    // above can't (e.g. an off-by-one that can never emit "z" still passes
    // ^[a-z0-9]{10}$ on every sample). 5000 samples x 10 chars = 50k draws;
    // each of the 36 characters is expected ~1389 times, so any character
    // that CAN appear failing to show up even once is effectively
    // impossible ((35/36)^50000 ~ 10^-612) — a miss means a real bug, not
    // bad luck.
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      for (const ch of generateShareSlug()) seen.add(ch);
    }
    expect(Array.from(seen).sort().join("")).toBe("0123456789abcdefghijklmnopqrstuvwxyz");
  });

  it("moveCollection reorders via positionBetween using neighbor ids", async () => {
    const a = await createCollection("A", undefined, db);
    const b = await createCollection("B", undefined, db);
    const c = await createCollection("C", undefined, db);

    // Move C between A and B.
    await moveCollection(c.id, a.id, b.id, db);

    const list = await listCollections(db);
    expect(list.map((x) => x.id)).toEqual([a.id, c.id, b.id]);
  });

  it("moveCollection to the very front (beforeId null) and very back (afterId null) works", async () => {
    const a = await createCollection("A", undefined, db);
    const b = await createCollection("B", undefined, db);
    const c = await createCollection("C", undefined, db);

    await moveCollection(c.id, null, a.id, db); // C to front
    let list = await listCollections(db);
    expect(list.map((x) => x.id)).toEqual([c.id, a.id, b.id]);

    await moveCollection(c.id, b.id, null, db); // C to back
    list = await listCollections(db);
    expect(list.map((x) => x.id)).toEqual([a.id, b.id, c.id]);
  });

  it("softDeleteCollection tombstones the collection and cascades the SAME timestamp to its non-tombstoned links", async () => {
    const c = await createCollection("C", undefined, db);
    const links = await saveTabs(
      c.id,
      [
        { url: "https://a.com", title: "A" },
        { url: "https://b.com", title: "B" },
      ],
      db,
    );

    await softDeleteCollection(c.id, db);

    const collRow = await db.collections.get(c.id);
    expect(collRow!.deletedAt).not.toBeNull();

    const l1 = await db.links.get(links[0]!.id);
    const l2 = await db.links.get(links[1]!.id);
    expect(l1!.deletedAt).toBe(collRow!.deletedAt);
    expect(l2!.deletedAt).toBe(collRow!.deletedAt);
  });

  it("listCollections and listLinks exclude tombstoned rows", async () => {
    const c = await createCollection("C", undefined, db);
    await saveTabs(c.id, [{ url: "https://a.com", title: "A" }], db);

    await softDeleteCollection(c.id, db);

    expect(await listCollections(db)).toHaveLength(0);
    expect(await listLinks(c.id, db)).toHaveLength(0);
  });

  it("restoreCollection undoes the cascade: clears collection tombstone AND only the links tombstoned at that same timestamp, leaving earlier-deleted links deleted", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000);

    const c = await createCollection("C", undefined, db);
    const links = await saveTabs(
      c.id,
      [
        { url: "https://a.com", title: "A" },
        { url: "https://b.com", title: "B" },
        { url: "https://c.com", title: "C" },
      ],
      db,
    );
    const [l1, l2, l3] = links;

    // l3 was deleted earlier, independent of the collection cascade.
    vi.setSystemTime(2_000);
    await softDeleteLinks([l3!.id], db);

    // Collection delete cascades to l1/l2 (still live) at a later timestamp.
    vi.setSystemTime(3_000);
    await softDeleteCollection(c.id, db);

    expect((await db.links.get(l1!.id))!.deletedAt).toBe(3_000);
    expect((await db.links.get(l2!.id))!.deletedAt).toBe(3_000);
    expect((await db.links.get(l3!.id))!.deletedAt).toBe(2_000);

    vi.setSystemTime(4_000);
    await restoreCollection(c.id, db);

    expect((await db.collections.get(c.id))!.deletedAt).toBeNull();
    expect((await db.links.get(l1!.id))!.deletedAt).toBeNull();
    expect((await db.links.get(l2!.id))!.deletedAt).toBeNull();
    // l3 was deleted before the cascade timestamp: restore must not resurrect it.
    expect((await db.links.get(l3!.id))!.deletedAt).toBe(2_000);
  });

  it("softDeleteCollection and restoreCollection enqueue a PendingOp for every touched row", async () => {
    const c = await createCollection("C", undefined, db);
    const links = await saveTabs(c.id, [{ url: "https://a.com", title: "A" }], db);
    await db.pendingOps.clear(); // flush prior ops so we only see this cascade's ops

    await softDeleteCollection(c.id, db);
    expect(await opsFor("collections", c.id)).toHaveLength(1);
    expect(await opsFor("links", links[0]!.id)).toHaveLength(1);

    await db.pendingOps.clear();
    await restoreCollection(c.id, db);
    expect(await opsFor("collections", c.id)).toHaveLength(1);
    expect(await opsFor("links", links[0]!.id)).toHaveLength(1);
  });
});

describe("links repo", () => {
  it("saveTabs appends links at the end using successive positionBetween(lastKey, null)", async () => {
    const c = await createCollection("C", undefined, db);
    const links = await saveTabs(
      c.id,
      [
        { url: "https://a.com", title: "A" },
        { url: "https://b.com", title: "B" },
        { url: "https://c.com", title: "C" },
      ],
      db,
    );

    expect(links[0]!.position < links[1]!.position).toBe(true);
    expect(links[1]!.position < links[2]!.position).toBe(true);

    const listed = await listLinks(c.id, db);
    expect(listed.map((l) => l.url)).toEqual(["https://a.com", "https://b.com", "https://c.com"]);
  });

  it("saveTabs maps TabInfo fields onto Link, defaulting faviconUrl to null and note/tags to null/[]", async () => {
    const c = await createCollection("C", undefined, db);
    const [withFavicon] = await saveTabs(
      c.id,
      [{ url: "https://a.com", title: "A", faviconUrl: "https://a.com/f.ico" }],
      db,
    );
    expect(withFavicon!.faviconUrl).toBe("https://a.com/f.ico");
    expect(withFavicon!.note).toBeNull();
    expect(withFavicon!.tags).toEqual([]);

    const [noFavicon] = await saveTabs(c.id, [{ url: "https://b.com", title: "B" }], db);
    expect(noFavicon!.faviconUrl).toBeNull();
  });

  it("saveTabs dedupes by URL among non-tombstoned links of the collection: updates title instead of duplicating", async () => {
    const c = await createCollection("C", undefined, db);
    const [first] = await saveTabs(c.id, [{ url: "https://a.com", title: "Old title" }], db);

    const [second] = await saveTabs(c.id, [{ url: "https://a.com", title: "New title" }], db);

    expect(second!.id).toBe(first!.id);
    expect(second!.title).toBe("New title");

    const listed = await listLinks(c.id, db);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.title).toBe("New title");
  });

  it("saveTabs dedupe updates faviconUrl only when provided", async () => {
    const c = await createCollection("C", undefined, db);
    await saveTabs(c.id, [{ url: "https://a.com", title: "A", faviconUrl: "https://a.com/1.ico" }], db);

    // No faviconUrl provided on the re-save: existing favicon must be left alone.
    const [updated] = await saveTabs(c.id, [{ url: "https://a.com", title: "A2" }], db);
    expect(updated!.faviconUrl).toBe("https://a.com/1.ico");

    const [updated2] = await saveTabs(
      c.id,
      [{ url: "https://a.com", title: "A3", faviconUrl: "https://a.com/2.ico" }],
      db,
    );
    expect(updated2!.faviconUrl).toBe("https://a.com/2.ico");
  });

  it("saveTabs does not dedupe against a tombstoned link with the same URL (creates a new one)", async () => {
    const c = await createCollection("C", undefined, db);
    const [first] = await saveTabs(c.id, [{ url: "https://a.com", title: "A" }], db);
    await softDeleteLinks([first!.id], db);

    const [second] = await saveTabs(c.id, [{ url: "https://a.com", title: "A again" }], db);

    expect(second!.id).not.toBe(first!.id);
    const listed = await listLinks(c.id, db);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.id).toBe(second!.id);
  });

  it("saveTabs collapses duplicate URLs within ONE batch: every returned slot reflects the final persisted row", async () => {
    const c = await createCollection("C", undefined, db);

    const result = await saveTabs(
      c.id,
      [
        { url: "https://a.com", title: "First" },
        { url: "https://a.com", title: "Second" },
      ],
      db,
    );

    // One Link per input tab, in input order — but both slots must be the
    // FINAL state of the single persisted row, not a stale pre-update snapshot.
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe(result[1]!.id);
    expect(result[0]!.title).toBe("Second");
    expect(result[1]!.title).toBe("Second");

    const rows = await db.links.where("collectionId").equals(c.id).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("Second");
    expect(await opsFor("links", result[0]!.id)).toHaveLength(1);
  });

  it("softDeleteLinks with a nonexistent id neither tombstones anything nor enqueues an op", async () => {
    await softDeleteLinks(["no-such-id"], db);

    expect(await db.links.get("no-such-id")).toBeUndefined();
    expect(await opsFor("links", "no-such-id")).toHaveLength(0);
  });

  it("restoreLinks with a nonexistent id does not enqueue an op", async () => {
    await restoreLinks(["no-such-id"], db);
    expect(await opsFor("links", "no-such-id")).toHaveLength(0);
  });

  it("renameCollection, setCollectionAccent, and setShare on a nonexistent id do not enqueue ops", async () => {
    await renameCollection("no-such-id", "Ghost", db);
    await setCollectionAccent("no-such-id", "#123456", db);
    await setShare("no-such-id", { isShared: true, shareSlug: generateShareSlug() }, db);
    expect(await opsFor("collections", "no-such-id")).toHaveLength(0);
  });

  it("moveCollection and moveLink throw when the moved row does not exist", async () => {
    const c = await createCollection("C", undefined, db);
    await expect(moveCollection("no-such-id", null, c.id, db)).rejects.toThrow();
    await expect(moveLink("no-such-id", c.id, null, null, db)).rejects.toThrow();
    // Nothing was queued for the phantom row.
    expect(await opsFor("collections", "no-such-id")).toHaveLength(0);
    expect(await opsFor("links", "no-such-id")).toHaveLength(0);
  });

  it("saveTabs enqueues a PendingOp for both newly created and updated (deduped) links", async () => {
    const c = await createCollection("C", undefined, db);
    const [link] = await saveTabs(c.id, [{ url: "https://a.com", title: "A" }], db);
    expect(await opsFor("links", link!.id)).toHaveLength(1);

    await db.pendingOps.clear(); // simulate a sync flush
    await saveTabs(c.id, [{ url: "https://a.com", title: "A updated" }], db);
    expect(await opsFor("links", link!.id)).toHaveLength(1);
  });

  it("updateLink patches only the given fields and enqueues a PendingOp", async () => {
    const c = await createCollection("C", undefined, db);
    const [link] = await saveTabs(c.id, [{ url: "https://a.com", title: "A" }], db);
    await db.pendingOps.clear();

    await updateLink(link!.id, { note: "hello", tags: ["x", "y"] }, db);

    const row = await db.links.get(link!.id);
    expect(row!.note).toBe("hello");
    expect(row!.tags).toEqual(["x", "y"]);
    expect(row!.title).toBe("A"); // untouched
    expect(await opsFor("links", link!.id)).toHaveLength(1);
  });

  it("moveLink reorders within the same collection via positionBetween", async () => {
    const c = await createCollection("C", undefined, db);
    const [a, b, cLink] = await saveTabs(
      c.id,
      [
        { url: "https://a.com", title: "A" },
        { url: "https://b.com", title: "B" },
        { url: "https://c.com", title: "C" },
      ],
      db,
    );

    await moveLink(cLink!.id, c.id, a!.id, b!.id, db);

    const listed = await listLinks(c.id, db);
    expect(listed.map((l) => l.id)).toEqual([a!.id, cLink!.id, b!.id]);
  });

  it("moveLink to another collection sets collectionId and positions among the target's links", async () => {
    const source = await createCollection("Source", undefined, db);
    const target = await createCollection("Target", undefined, db);
    const [l1, l2] = await saveTabs(
      source.id,
      [
        { url: "https://a.com", title: "A" },
        { url: "https://b.com", title: "B" },
      ],
      db,
    );
    const [m1] = await saveTabs(target.id, [{ url: "https://m.com", title: "M" }], db);

    await moveLink(l1!.id, target.id, null, m1!.id, db);

    expect((await db.links.get(l1!.id))!.collectionId).toBe(target.id);
    expect(await listLinks(target.id, db).then((r) => r.map((l) => l.id))).toEqual([l1!.id, m1!.id]);
    expect(await listLinks(source.id, db).then((r) => r.map((l) => l.id))).toEqual([l2!.id]);
  });

  it("moveLinkToEnd appends after the target's current last live link", async () => {
    const source = await createCollection("Source", undefined, db);
    const target = await createCollection("Target", undefined, db);
    const [moved] = await saveTabs(source.id, [{ url: "https://moved.com", title: "Moved" }], db);
    const [t1, t2] = await saveTabs(
      target.id,
      [
        { url: "https://t1.com", title: "T1" },
        { url: "https://t2.com", title: "T2" },
      ],
      db,
    );

    await moveLinkToEnd(moved!.id, target.id, db);

    expect((await db.links.get(moved!.id))!.collectionId).toBe(target.id);
    expect(await listLinks(target.id, db).then((r) => r.map((l) => l.id))).toEqual([t1!.id, t2!.id, moved!.id]);
    expect(await listLinks(source.id, db)).toHaveLength(0);
  });

  it("moveLinkToEnd positions past a tombstoned link holding the greatest position (no collision)", async () => {
    // The failure mode this guards: deriving "last" from live links only
    // (listLinks) would compute positionBetween(<last live>, null) and land
    // exactly ON a tombstoned row's position — then a later restore of that
    // tombstone produces two rows with equal positions and nondeterministic
    // order. maxPosition deliberately scans ALL rows (see its docstring);
    // moveLinkToEnd must do the same.
    const source = await createCollection("Source", undefined, db);
    const target = await createCollection("Target", undefined, db);
    const [moved] = await saveTabs(source.id, [{ url: "https://moved.com", title: "Moved" }], db);
    const [t1, t2, t3] = await saveTabs(
      target.id,
      [
        { url: "https://t1.com", title: "T1" },
        { url: "https://t2.com", title: "T2" },
        { url: "https://t3.com", title: "T3" },
      ],
      db,
    );
    // Tombstone the link holding the greatest position; live max is now t2.
    await softDeleteLinks([t3!.id], db);

    await moveLinkToEnd(moved!.id, target.id, db);

    const movedRow = (await db.links.get(moved!.id))!;
    const tombstonedRow = (await db.links.get(t3!.id))!;
    expect(movedRow.position).not.toBe(tombstonedRow.position);
    expect(movedRow.position > tombstonedRow.position).toBe(true);

    // Restoring the tombstone keeps a deterministic order: t1, t2, t3, moved.
    await restoreLinks([t3!.id], db);
    expect(await listLinks(target.id, db).then((r) => r.map((l) => l.id))).toEqual([
      t1!.id,
      t2!.id,
      t3!.id,
      moved!.id,
    ]);
  });

  it("moveLinkToEnd into an empty collection still works", async () => {
    const source = await createCollection("Source", undefined, db);
    const target = await createCollection("Target", undefined, db);
    const [moved] = await saveTabs(source.id, [{ url: "https://moved.com", title: "Moved" }], db);

    await moveLinkToEnd(moved!.id, target.id, db);

    expect(await listLinks(target.id, db).then((r) => r.map((l) => l.id))).toEqual([moved!.id]);
  });

  it("moveLinkToEnd throws when the moved link does not exist and enqueues nothing", async () => {
    const c = await createCollection("C", undefined, db);
    await expect(moveLinkToEnd("no-such-id", c.id, db)).rejects.toThrow();
    expect(await opsFor("links", "no-such-id")).toHaveLength(0);
  });

  it("moveLinkToEnd enqueues a PendingOp", async () => {
    const source = await createCollection("Source", undefined, db);
    const target = await createCollection("Target", undefined, db);
    const [moved] = await saveTabs(source.id, [{ url: "https://moved.com", title: "Moved" }], db);
    await db.pendingOps.clear();

    await moveLinkToEnd(moved!.id, target.id, db);
    expect(await opsFor("links", moved!.id)).toHaveLength(1);
  });

  it("moveLink enqueues a PendingOp", async () => {
    const c = await createCollection("C", undefined, db);
    const [a, b] = await saveTabs(
      c.id,
      [
        { url: "https://a.com", title: "A" },
        { url: "https://b.com", title: "B" },
      ],
      db,
    );
    await db.pendingOps.clear();

    await moveLink(a!.id, c.id, null, b!.id, db);
    expect(await opsFor("links", a!.id)).toHaveLength(1);
  });

  it("softDeleteLinks tombstones and restoreLinks clears the tombstone, both excluded/included from listLinks accordingly", async () => {
    const c = await createCollection("C", undefined, db);
    const [a, b] = await saveTabs(
      c.id,
      [
        { url: "https://a.com", title: "A" },
        { url: "https://b.com", title: "B" },
      ],
      db,
    );

    await softDeleteLinks([a!.id, b!.id], db);
    expect(await listLinks(c.id, db)).toHaveLength(0);
    expect((await db.links.get(a!.id))!.deletedAt).not.toBeNull();

    await restoreLinks([a!.id, b!.id], db);
    const listed = await listLinks(c.id, db);
    expect(listed.map((l) => l.id).sort()).toEqual([a!.id, b!.id].sort());
    expect((await db.links.get(a!.id))!.deletedAt).toBeNull();
  });

  it("softDeleteLinks and restoreLinks enqueue a PendingOp per id", async () => {
    const c = await createCollection("C", undefined, db);
    const [a, b] = await saveTabs(
      c.id,
      [
        { url: "https://a.com", title: "A" },
        { url: "https://b.com", title: "B" },
      ],
      db,
    );
    await db.pendingOps.clear();

    await softDeleteLinks([a!.id, b!.id], db);
    expect(await opsFor("links", a!.id)).toHaveLength(1);
    expect(await opsFor("links", b!.id)).toHaveLength(1);

    await db.pendingOps.clear();
    await restoreLinks([a!.id, b!.id], db);
    expect(await opsFor("links", a!.id)).toHaveLength(1);
    expect(await opsFor("links", b!.id)).toHaveLength(1);
  });
});

describe("PendingOp queue dedupe", () => {
  it("skips enqueueing a second op for the same table+rowId until the existing one is flushed", async () => {
    const c = await createCollection("C", undefined, db); // 1 op enqueued
    expect(await opsFor("collections", c.id)).toHaveLength(1);

    await renameCollection(c.id, "Renamed", db);
    await setCollectionAccent(c.id, "#123456", db);
    // Still just one row: the earlier op for this id hasn't been flushed.
    expect(await opsFor("collections", c.id)).toHaveLength(1);

    // Simulate a sync flush, then mutate again: a fresh op should appear.
    await db.pendingOps.clear();
    await renameCollection(c.id, "Renamed again", db);
    expect(await opsFor("collections", c.id)).toHaveLength(1);
  });
});

describe("sessions repo", () => {
  it("saveSnapshot stores kind/name/windows and never enqueues a PendingOp", async () => {
    const before = await db.pendingOps.count();
    const snap = await saveSnapshot("manual", [{ tabs: [{ url: "https://a.com", title: "A" }] }], "My session", db);

    expect(snap.kind).toBe("manual");
    expect(snap.name).toBe("My session");
    expect(snap.windows).toHaveLength(1);
    expect(await db.pendingOps.count()).toBe(before);
  });

  it("listSnapshots returns newest first", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000);
    const s1 = await saveSnapshot("manual", [], undefined, db);
    vi.setSystemTime(2_000);
    const s2 = await saveSnapshot("manual", [], undefined, db);
    vi.setSystemTime(3_000);
    const s3 = await saveSnapshot("auto", [], undefined, db);

    const list = await listSnapshots(db);
    expect(list.map((s) => s.id)).toEqual([s3.id, s2.id, s1.id]);
  });

  it("deleteSnapshot hard-deletes the row (not a tombstone)", async () => {
    const s = await saveSnapshot("manual", [], undefined, db);
    await deleteSnapshot(s.id, db);
    expect(await db.sessions.get(s.id)).toBeUndefined();
  });

  it("pruneAutoSnapshots keeps exactly N newest of kind auto and never touches manual", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const autoIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      vi.setSystemTime(1_000 + i * 1_000);
      const s = await saveSnapshot("auto", [], undefined, db);
      autoIds.push(s.id);
    }
    vi.setSystemTime(50_000);
    const manual = await saveSnapshot("manual", [], undefined, db);

    await pruneAutoSnapshots(2, db);

    const remaining = await db.sessions.toArray();
    const remainingAuto = remaining.filter((s) => s.kind === "auto");
    expect(remainingAuto).toHaveLength(2);
    // Keeps the two newest autos (last two created).
    expect(remainingAuto.map((s) => s.id).sort()).toEqual(autoIds.slice(3).sort());
    // Manual snapshot is untouched.
    expect(remaining.some((s) => s.id === manual.id)).toBe(true);
  });
});

describe("meta repo", () => {
  it("getMeta returns null when absent", async () => {
    expect(await getMeta("missing-key", db)).toBeNull();
  });

  it("setMeta/getMeta round-trip and never enqueue a PendingOp", async () => {
    const before = await db.pendingOps.count();
    await setMeta("lastUsedCollectionId", "coll-123", db);
    expect(await getMeta("lastUsedCollectionId", db)).toBe("coll-123");
    expect(await db.pendingOps.count()).toBe(before);
  });

  it("setMeta overwrites an existing value for the same key", async () => {
    await setMeta("deviceId", "device-1", db);
    await setMeta("deviceId", "device-2", db);
    expect(await getMeta("deviceId", db)).toBe("device-2");
  });
});

describe("import repo", () => {
  it("is id-preserving: re-importing a prior export after a full wipe reproduces identical collections/links", async () => {
    const c = await createCollection("C", "#F97316", db);
    const [link] = await saveTabs(c.id, [{ url: "https://a.com", title: "A" }], db);

    // Snapshot exactly what a live export would contain (this task's
    // lib/exporter.ts in apps/extension does the same listCollections/
    // listLinks read — importData doesn't care where its payload came from).
    const exportedCollections = await db.collections.toArray();
    const exportedLinks = await db.links.toArray();

    // Wipe the whole profile clean, as if re-importing into a fresh install.
    await db.collections.clear();
    await db.links.clear();
    await db.pendingOps.clear();

    const result = await importData({ collections: exportedCollections, links: exportedLinks, sessions: [] }, db);
    expect(result).toEqual({ collections: 1, links: 1, sessions: 0 });

    const restoredCollection = await db.collections.get(c.id);
    const restoredLink = await db.links.get(link!.id);
    expect(restoredCollection?.id).toBe(c.id);
    expect(restoredCollection?.name).toBe("C");
    expect(restoredCollection?.accent).toBe("#F97316");
    expect(restoredCollection?.position).toBe(c.position);
    expect(restoredLink?.id).toBe(link!.id);
    expect(restoredLink?.url).toBe("https://a.com");
    expect(restoredLink?.collectionId).toBe(c.id);
    expect(restoredLink?.position).toBe(link!.position);
  });

  it("upserts by id instead of duplicating when a row with that id already exists", async () => {
    const c = await createCollection("Old name", undefined, db);
    const [link] = await saveTabs(c.id, [{ url: "https://a.com", title: "Old title" }], db);

    const renamedCollection: Collection = { ...(await db.collections.get(c.id))!, name: "New name" };
    const renamedLink: Link = { ...(await db.links.get(link!.id))!, title: "New title" };

    await importData({ collections: [renamedCollection], links: [renamedLink], sessions: [] }, db);

    expect(await db.collections.count()).toBe(1);
    expect(await db.links.count()).toBe(1);
    expect((await db.collections.get(c.id))!.name).toBe("New name");
    expect((await db.links.get(link!.id))!.title).toBe("New title");
  });

  it("importing a tombstone-free row over an existing tombstoned one un-deletes it, without duplicating", async () => {
    const c = await createCollection("C", undefined, db);
    await softDeleteCollection(c.id, db);
    expect((await db.collections.get(c.id))!.deletedAt).not.toBeNull();

    // A live export (as lib/exporter.ts builds it) only ever contains
    // deletedAt: null rows — simulate re-importing one taken before the delete.
    const liveVersion: Collection = { ...(await db.collections.get(c.id))!, deletedAt: null };
    await importData({ collections: [liveVersion], links: [], sessions: [] }, db);

    expect(await db.collections.count()).toBe(1);
    expect((await db.collections.get(c.id))!.deletedAt).toBeNull();
  });

  it("stamps updatedAt to the import time and enqueues one guarded PendingOp per row", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000);
    const c = await createCollection("C", undefined, db);
    const [link] = await saveTabs(c.id, [{ url: "https://a.com", title: "A" }], db);
    await db.pendingOps.clear();

    vi.setSystemTime(5_000);
    const payload: ImportPayload = {
      collections: [(await db.collections.get(c.id))!],
      links: [(await db.links.get(link!.id))!],
      sessions: [],
    };
    await importData(payload, db);

    expect((await db.collections.get(c.id))!.updatedAt).toBe(5_000);
    expect((await db.links.get(link!.id))!.updatedAt).toBe(5_000);
    expect(await opsFor("collections", c.id)).toHaveLength(1);
    expect(await opsFor("links", link!.id)).toHaveLength(1);
  });

  it("bulkPuts sessions without enqueuing any PendingOp for them", async () => {
    const before = await db.pendingOps.count();
    const session: SessionSnapshot = {
      id: crypto.randomUUID(),
      name: "Imported session",
      kind: "manual",
      windows: [{ tabs: [{ url: "https://a.com", title: "A" }] }],
      createdAt: Date.now(),
    };

    const result = await importData({ collections: [], links: [], sessions: [session] }, db);

    expect(result.sessions).toBe(1);
    expect(await db.sessions.get(session.id)).toEqual(session);
    expect(await db.pendingOps.count()).toBe(before);
  });

  it("is a no-op-safe empty import", async () => {
    const result = await importData({ collections: [], links: [], sessions: [] }, db);
    expect(result).toEqual({ collections: 0, links: 0, sessions: 0 });
  });
});

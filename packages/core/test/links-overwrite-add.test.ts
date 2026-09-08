import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BurrowDB } from "../src/db";
import type { PendingOp } from "../src/types";
import { createCollection } from "../src/repo/collections";
import {
  saveTabs,
  overwriteTabs,
  addLink,
  softDeleteLinks,
  restoreLinks,
  listLinks,
} from "../src/repo/links";
import { maxPosition } from "../src/repo/util";

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

describe("overwriteTabs", () => {
  it("replaces the collection's live links with exactly the new set in order; old rows are tombstoned, not hard-deleted", async () => {
    const c = await createCollection("C", undefined, db);
    const old = await saveTabs(
      c.id,
      [
        { url: "https://old1.com", title: "Old 1" },
        { url: "https://old2.com", title: "Old 2" },
        { url: "https://old3.com", title: "Old 3" },
      ],
      db,
    );

    const next = await overwriteTabs(
      c.id,
      [
        { url: "https://new1.com", title: "New 1" },
        { url: "https://new2.com", title: "New 2" },
      ],
      db,
    );

    // Live set is exactly the two new tabs, in input order.
    const listed = await listLinks(c.id, db);
    expect(listed.map((l) => l.url)).toEqual(["https://new1.com", "https://new2.com"]);
    expect(next.map((l) => l.url)).toEqual(["https://new1.com", "https://new2.com"]);
    expect(next.map((l) => l.id)).toEqual(listed.map((l) => l.id));

    // Old rows still exist as tombstones (not removed from the table).
    for (const o of old) {
      const row = await db.links.get(o.id);
      expect(row).toBeDefined();
      expect(row!.deletedAt).not.toBeNull();
    }

    // New rows are fresh live rows, none reusing an old id.
    const oldIds = new Set(old.map((o) => o.id));
    for (const n of next) {
      expect(oldIds.has(n.id)).toBe(false);
      expect(n.deletedAt).toBeNull();
    }
  });

  it("enqueues an op for every tombstoned old row AND every new row", async () => {
    const c = await createCollection("C", undefined, db);
    const old = await saveTabs(
      c.id,
      [
        { url: "https://old1.com", title: "Old 1" },
        { url: "https://old2.com", title: "Old 2" },
      ],
      db,
    );
    await db.pendingOps.clear(); // flush prior ops so we only see the overwrite's ops

    const next = await overwriteTabs(
      c.id,
      [
        { url: "https://new1.com", title: "New 1" },
        { url: "https://new2.com", title: "New 2" },
        { url: "https://new3.com", title: "New 3" },
      ],
      db,
    );

    for (const o of old) expect(await opsFor("links", o.id)).toHaveLength(1);
    for (const n of next) expect(await opsFor("links", n.id)).toHaveLength(1);
  });

  it("gives new rows positions strictly greater than every tombstoned row's, so a later restore can never tie", async () => {
    const c = await createCollection("C", undefined, db);
    const old = await saveTabs(
      c.id,
      [
        { url: "https://old1.com", title: "Old 1" },
        { url: "https://old2.com", title: "Old 2" },
        { url: "https://old3.com", title: "Old 3" },
      ],
      db,
    );

    const next = await overwriteTabs(
      c.id,
      [
        { url: "https://new1.com", title: "New 1" },
        { url: "https://new2.com", title: "New 2" },
      ],
      db,
    );

    const oldRows = await Promise.all(old.map((o) => db.links.get(o.id)));
    const maxOld = maxPosition(oldRows.map((r) => r!));
    for (const n of next) {
      expect(n.position > maxOld!).toBe(true);
    }
    // Every new position is distinct from every old position (no collision).
    const oldPositions = new Set(oldRows.map((r) => r!.position));
    for (const n of next) expect(oldPositions.has(n.position)).toBe(false);

    // Restoring an old tombstoned row does not tie with any new row, and it
    // sorts ahead of the new set (its key was never reassigned).
    await restoreLinks([old[0]!.id], db);
    const listed = await listLinks(c.id, db);
    expect(listed[0]!.id).toBe(old[0]!.id);
    expect(listed.map((l) => l.id)).toEqual([old[0]!.id, next[0]!.id, next[1]!.id]);
    // All positions are unique.
    const positions = listed.map((l) => l.position);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it("collapses duplicate URLs within the incoming batch onto a single row", async () => {
    const c = await createCollection("C", undefined, db);
    await saveTabs(c.id, [{ url: "https://old.com", title: "Old" }], db);

    const next = await overwriteTabs(
      c.id,
      [
        { url: "https://dup.com", title: "First" },
        { url: "https://dup.com", title: "Second" },
      ],
      db,
    );

    // One Link per input tab, both slots the final persisted row state.
    expect(next).toHaveLength(2);
    expect(next[0]!.id).toBe(next[1]!.id);
    expect(next[0]!.title).toBe("Second");
    expect(next[1]!.title).toBe("Second");

    const listed = await listLinks(c.id, db);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.title).toBe("Second");
    expect(await opsFor("links", next[0]!.id)).toHaveLength(1);
  });

  it("overwriting an empty collection just inserts the new tabs", async () => {
    const c = await createCollection("C", undefined, db);

    const next = await overwriteTabs(
      c.id,
      [
        { url: "https://a.com", title: "A" },
        { url: "https://b.com", title: "B" },
      ],
      db,
    );

    expect(next.map((l) => l.url)).toEqual(["https://a.com", "https://b.com"]);
    const listed = await listLinks(c.id, db);
    expect(listed.map((l) => l.url)).toEqual(["https://a.com", "https://b.com"]);
    expect(next[0]!.position < next[1]!.position).toBe(true);
  });
});

describe("addLink", () => {
  it("appends a single link with an explicit title, enqueues an op, and returns it", async () => {
    const c = await createCollection("C", undefined, db);
    const link = await addLink(c.id, { url: "https://a.com", title: "My title" }, db);

    expect(link.title).toBe("My title");
    expect(link.url).toBe("https://a.com");
    expect(link.deletedAt).toBeNull();
    expect(link.faviconUrl).toBeNull();
    expect(link.note).toBeNull();
    expect(link.tags).toEqual([]);

    const listed = await listLinks(c.id, db);
    expect(listed.map((l) => l.id)).toEqual([link.id]);
    expect(await opsFor("links", link.id)).toHaveLength(1);
  });

  it("appends after the collection's existing links", async () => {
    const c = await createCollection("C", undefined, db);
    const [a, b] = await saveTabs(
      c.id,
      [
        { url: "https://a.com", title: "A" },
        { url: "https://b.com", title: "B" },
      ],
      db,
    );

    const added = await addLink(c.id, { url: "https://c.com", title: "C" }, db);

    expect(added.position > b!.position).toBe(true);
    expect(await listLinks(c.id, db).then((r) => r.map((l) => l.id))).toEqual([a!.id, b!.id, added.id]);
  });

  it("defaults a missing title to the URL hostname", async () => {
    const c = await createCollection("C", undefined, db);
    const link = await addLink(c.id, { url: "https://example.com/some/path?q=1" }, db);
    expect(link.title).toBe("example.com");
  });

  it("defaults an empty title to the URL hostname", async () => {
    const c = await createCollection("C", undefined, db);
    const link = await addLink(c.id, { url: "https://sub.example.com/x", title: "" }, db);
    expect(link.title).toBe("sub.example.com");
  });

  it("falls back to the raw string as title when the URL is un-parseable and no title is given (no throw)", async () => {
    const c = await createCollection("C", undefined, db);
    const link = await addLink(c.id, { url: "not a valid url" }, db);
    expect(link.title).toBe("not a valid url");
    expect(link.url).toBe("not a valid url");
  });

  // Issue #24: a manually-typed bare domain was stored verbatim, and a
  // schemeless string is a RELATIVE reference — chrome.tabs.create resolved
  // it against the extension's origin and opened chrome-extension://<id>/nike.com.
  // normalizeUrl's own edge cases are covered in url.test.ts; these pin the
  // three things addLink itself is responsible for.
  it("stores a manually-typed bare domain with a scheme, so the saved URL is absolute", async () => {
    const c = await createCollection("C", undefined, db);
    const link = await addLink(c.id, { url: "nike.com" }, db);

    expect(link.url).toBe("https://nike.com");
    const listed = await listLinks(c.id, db);
    expect(listed[0]!.url).toBe("https://nike.com");
  });

  it("derives the fallback title from the NORMALIZED url, so a bare domain titles itself by host", async () => {
    const c = await createCollection("C", undefined, db);
    const link = await addLink(c.id, { url: "nike.com/shoes" }, db);
    // Not "nike.com/shoes", and not the full "https://nike.com/shoes".
    expect(link.title).toBe("nike.com");
  });

  it("dedupes a bare-domain re-entry against the normalized link a previous add created", async () => {
    const c = await createCollection("C", undefined, db);
    const first = await addLink(c.id, { url: "https://nike.com", title: "Old title" }, db);
    await db.pendingOps.clear();

    // Same site, typed the short way — must update in place, not insert a
    // second row that only differs by the scheme the user didn't type.
    const second = await addLink(c.id, { url: "nike.com", title: "New title" }, db);

    expect(second.id).toBe(first.id);
    const listed = await listLinks(c.id, db);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.title).toBe("New title");
    expect(await opsFor("links", first.id)).toHaveLength(1);
  });

  it("dedupes against a live link with the same URL: updates title in place, no duplicate, returns the existing id", async () => {
    const c = await createCollection("C", undefined, db);
    const first = await addLink(c.id, { url: "https://a.com", title: "Old title" }, db);
    await db.pendingOps.clear();

    const second = await addLink(c.id, { url: "https://a.com", title: "New title" }, db);

    expect(second.id).toBe(first.id);
    expect(second.title).toBe("New title");

    const listed = await listLinks(c.id, db);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.title).toBe("New title");
    expect(await opsFor("links", first.id)).toHaveLength(1);
  });
});

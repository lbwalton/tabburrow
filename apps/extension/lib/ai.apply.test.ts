// T20 fix pass 1: applyPlan's per-item containment, tested against a REAL
// Dexie database (fake-indexeddb, same harness packages/core/test/repo.test.ts
// uses) — this is the one deliberate exception to this package's
// "pure lib/ functions only" vitest convention, made because the reviewer's
// scenario (a link deleted between preview and apply) is a genuine
// data-layer interaction that no pure-function test can capture.
// `sendSyncNudge` is the single chrome.*-touching call in applyPlan's path
// and is module-mocked so the "nudge fires iff at least one write committed"
// contract is directly assertable.
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BurrowDB, createCollection, listCollections, listLinks, saveTabs } from "@tabburrow/core";
import type { Link } from "@tabburrow/core";
import { applyPlan } from "./ai";
import type { AiPlan } from "./ai";
import { sendSyncNudge } from "./sync-nudge";

vi.mock("./sync-nudge", () => ({ sendSyncNudge: vi.fn() }));

let db: BurrowDB;

beforeEach(async () => {
  vi.mocked(sendSyncNudge).mockClear();
  try {
    await indexedDB.deleteDatabase("tabburrow");
  } catch {
    // ignore: database might not exist yet
  }
  db = new BurrowDB();
  await db.open();
});

afterEach(() => {
  db.close();
});

async function seedSourceLinks(collectionId: string, count: number): Promise<Link[]> {
  return saveTabs(
    collectionId,
    Array.from({ length: count }, (_, i) => ({
      url: `https://example.com/${i}`,
      title: `Link ${i}`,
    })),
    db,
  );
}

function planOf(groups: AiPlan["groups"], tags: AiPlan["tags"] = {}): AiPlan {
  return { groups, tags };
}

describe("applyPlan (fake-indexeddb)", () => {
  it("happy path: creates + merges collections, moves links, merges tags, fires exactly one nudge", async () => {
    const source = await createCollection("Source", undefined, db);
    const recipes = await createCollection("Recipes", undefined, db);
    const [a, b, c] = await seedSourceLinks(source.id, 3);
    // Give link a a pre-existing hand-typed tag whose casing must survive.
    await db.links.update(a!.id, { tags: ["Handpicked"] });

    const result = await applyPlan(
      planOf(
        [
          { name: "Dev Docs", emoji: "💻", linkIds: [a!.id, b!.id] },
          { name: "recipes", emoji: "🍳", linkIds: [c!.id] }, // case-insensitive merge
        ],
        { [a!.id]: ["handpicked", "react"], [c!.id]: ["cooking"] },
      ),
      source.id,
      db,
    );

    expect(result).toEqual({
      createdCollections: 1,
      mergedCollections: 1,
      movedLinks: 3,
      taggedLinks: 2,
      skippedLinks: 0,
      failedGroups: 0,
    });

    const collections = await listCollections(db);
    const devDocs = collections.find((col) => col.name === "Dev Docs");
    expect(devDocs).toBeTruthy();
    expect((await listLinks(devDocs!.id, db)).map((l) => l.id).sort()).toEqual([a!.id, b!.id].sort());
    expect((await listLinks(recipes.id, db)).map((l) => l.id)).toEqual([c!.id]);
    expect(await listLinks(source.id, db)).toEqual([]);

    // Existing casing wins on the collision; incoming order preserved after.
    expect((await db.links.get(a!.id))!.tags).toEqual(["Handpicked", "react"]);

    expect(sendSyncNudge).toHaveBeenCalledTimes(1);
  });

  it("a link deleted between preview and apply is SKIPPED and counted — never aborts the rest", async () => {
    const source = await createCollection("Source", undefined, db);
    const [a, b, c] = await seedSourceLinks(source.id, 3);
    // Hard-delete b's row entirely (harsher than a tombstone: moveLinkToEnd throws).
    await db.links.delete(b!.id);

    const result = await applyPlan(
      planOf([{ name: "Everything", emoji: "🗂️", linkIds: [a!.id, b!.id, c!.id] }]),
      source.id,
      db,
    );

    expect(result).toEqual({
      createdCollections: 1,
      mergedCollections: 0,
      movedLinks: 2,
      taggedLinks: 0,
      skippedLinks: 1,
      failedGroups: 0,
    });

    const everything = (await listCollections(db)).find((col) => col.name === "Everything");
    expect((await listLinks(everything!.id, db)).map((l) => l.id).sort()).toEqual([a!.id, c!.id].sort());
    // The committed writes still get their (single) nudge.
    expect(sendSyncNudge).toHaveBeenCalledTimes(1);
  });

  it("a failed group creation skips that group's members with counts — later groups still apply", async () => {
    const source = await createCollection("Source", undefined, db);
    const [a, b] = await seedSourceLinks(source.id, 2);

    const result = await applyPlan(
      planOf([
        // createCollection throws on an all-whitespace name — the parse layer
        // now prevents this arriving from the AI, so this exercises the
        // apply-side containment for any OTHER repo failure mode.
        { name: "   ", emoji: "🗂️", linkIds: [a!.id] },
        { name: "Good Group", emoji: "✅", linkIds: [b!.id] },
      ]),
      source.id,
      db,
    );

    expect(result).toEqual({
      createdCollections: 1,
      mergedCollections: 0,
      movedLinks: 1,
      taggedLinks: 0,
      skippedLinks: 1,
      failedGroups: 1,
    });

    // a stayed home; b moved.
    expect((await listLinks(source.id, db)).map((l) => l.id)).toEqual([a!.id]);
    const good = (await listCollections(db)).find((col) => col.name === "Good Group");
    expect((await listLinks(good!.id, db)).map((l) => l.id)).toEqual([b!.id]);
    expect(sendSyncNudge).toHaveBeenCalledTimes(1);
  });

  it("total failure (writes attempted, none committed): returns counts, does NOT throw, does NOT nudge", async () => {
    const source = await createCollection("Source", undefined, db);
    const [a] = await seedSourceLinks(source.id, 1);
    vi.mocked(sendSyncNudge).mockClear(); // ignore any nudge bookkeeping from seeding (none expected, but explicit)

    const result = await applyPlan(planOf([{ name: "   ", emoji: "🗂️", linkIds: [a!.id] }]), source.id, db);

    expect(result).toEqual({
      createdCollections: 0,
      mergedCollections: 0,
      movedLinks: 0,
      taggedLinks: 0,
      skippedLinks: 1,
      failedGroups: 1,
    });
    expect(sendSyncNudge).not.toHaveBeenCalled();
  });

  it("db totally unavailable (nothing attempted): throws, no nudge", async () => {
    const brokenDb = {
      collections: {
        toArray() {
          throw new Error("db unavailable");
        },
      },
    } as unknown as BurrowDB;

    await expect(
      applyPlan(planOf([{ name: "G", emoji: "🗂️", linkIds: ["x"] }]), "src", brokenDb),
    ).rejects.toThrow("db unavailable");
    expect(sendSyncNudge).not.toHaveBeenCalled();
  });
});

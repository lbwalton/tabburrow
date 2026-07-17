// Folder-detail action wrappers, tested against a REAL Dexie database
// (fake-indexeddb, the same harness ai.apply.test.ts uses) — this proves the
// wiring: each action drives the intended packages/core repo function with the
// right arguments, so append appends, overwrite replaces, and addLink adds.
// A chrome-free `favicon` stub is passed so no chrome.* is touched.
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BurrowDB, createCollection, listLinks } from "@tabburrow/core";
import { addLinkToFolder, addTabToFolder, appendTabsToFolder, overwriteFolderWithTabs } from "./folderActions";

const fav = (url: string) => `fav:${url}`;

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

afterEach(() => {
  db.close();
});

describe("appendTabsToFolder", () => {
  it("appends tabs to the folder with favicons attached", async () => {
    const c = await createCollection("Coding", undefined, db);
    const saved = await appendTabsToFolder(
      c.id,
      [
        { url: "https://a.com", title: "A" },
        { url: "https://b.com", title: "B" },
      ],
      db,
      fav,
    );
    expect(saved.map((l) => l.url)).toEqual(["https://a.com", "https://b.com"]);
    expect(saved[0]!.faviconUrl).toBe("fav:https://a.com");

    const live = await listLinks(c.id, db);
    expect(live).toHaveLength(2);
  });

  it("appends to existing links rather than replacing them (dedupes by URL)", async () => {
    const c = await createCollection("Coding", undefined, db);
    await appendTabsToFolder(c.id, [{ url: "https://a.com", title: "A" }], db, fav);
    await appendTabsToFolder(
      c.id,
      [
        { url: "https://a.com", title: "A2" }, // dup -> updates in place
        { url: "https://c.com", title: "C" },
      ],
      db,
      fav,
    );
    const live = await listLinks(c.id, db);
    expect(live.map((l) => l.url).sort()).toEqual(["https://a.com", "https://c.com"]);
    expect(live.find((l) => l.url === "https://a.com")!.title).toBe("A2");
  });
});

describe("overwriteFolderWithTabs", () => {
  it("replaces the folder's live links with the given tabs", async () => {
    const c = await createCollection("Coding", undefined, db);
    await appendTabsToFolder(
      c.id,
      [
        { url: "https://old1.com", title: "Old 1" },
        { url: "https://old2.com", title: "Old 2" },
      ],
      db,
      fav,
    );

    const result = await overwriteFolderWithTabs(c.id, [{ url: "https://new.com", title: "New" }], db, fav);
    expect(result.map((l) => l.url)).toEqual(["https://new.com"]);

    const live = await listLinks(c.id, db);
    expect(live.map((l) => l.url)).toEqual(["https://new.com"]);
  });
});

describe("addLinkToFolder", () => {
  it("adds a single link, defaulting the title to the hostname when omitted", async () => {
    const c = await createCollection("Coding", undefined, db);
    const link = await addLinkToFolder(c.id, { url: "https://example.com/path" }, db);
    expect(link.title).toBe("example.com");

    const live = await listLinks(c.id, db);
    expect(live).toHaveLength(1);
    expect(live[0]!.url).toBe("https://example.com/path");
  });

  it("keeps a provided title", async () => {
    const c = await createCollection("Coding", undefined, db);
    const link = await addLinkToFolder(c.id, { url: "https://example.com", title: "My Title" }, db);
    expect(link.title).toBe("My Title");
  });
});

describe("addTabToFolder", () => {
  it("adds a single tab in place with a favicon", async () => {
    const c = await createCollection("Coding", undefined, db);
    const saved = await addTabToFolder(c.id, { url: "https://cur.com", title: "Current" }, db, fav);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.faviconUrl).toBe("fav:https://cur.com");

    const live = await listLinks(c.id, db);
    expect(live.map((l) => l.url)).toEqual(["https://cur.com"]);
  });
});

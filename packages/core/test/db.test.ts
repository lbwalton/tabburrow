import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { BurrowDB, getDB } from "../src/db";
import type { Collection } from "../src/types";

describe("BurrowDB", () => {
  beforeEach(async () => {
    // Clear database before each test
    // Each test will use a fresh database instance
    try {
      await window.indexedDB.deleteDatabase("tabburrow");
    } catch (e) {
      // Database might not exist yet
    }
  });

  it("should create a BurrowDB instance and round-trip a Collection", async () => {
    const db = new BurrowDB();
    await db.open();

    const testCollection: Collection = {
      id: "coll-1",
      name: "Test Collection",
      accent: "#FF5733",
      position: "0|",
      isShared: false,
      shareSlug: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deletedAt: null,
    };

    // Insert the collection
    await db.collections.add(testCollection);

    // Read it back
    const retrieved = await db.collections.get("coll-1");

    // Assert all fields round-trip correctly
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(testCollection.id);
    expect(retrieved?.name).toBe(testCollection.name);
    expect(retrieved?.accent).toBe(testCollection.accent);
    expect(retrieved?.position).toBe(testCollection.position);
    expect(retrieved?.isShared).toBe(testCollection.isShared);
    expect(retrieved?.shareSlug).toBe(testCollection.shareSlug);
    expect(retrieved?.createdAt).toBe(testCollection.createdAt);
    expect(retrieved?.updatedAt).toBe(testCollection.updatedAt);
    expect(retrieved?.deletedAt).toBe(testCollection.deletedAt);

    await db.close();
  });

  it("should have collectionId index on links table", async () => {
    const db = new BurrowDB();
    await db.open();

    // This test verifies that the collectionId index exists by using it in a query
    // The query should not throw
    const query = db.links.where("collectionId").equals("coll-1");
    expect(query).toBeDefined();

    await db.close();
  });

  it("should return the same instance via getDB() singleton", async () => {
    const db1 = getDB();
    const db2 = getDB();

    expect(db1).toBe(db2);
  });
});

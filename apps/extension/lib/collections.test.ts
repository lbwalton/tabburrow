import { describe, it, expect } from "vitest";
import type { Collection } from "@tabburrow/core";
import { sortByRecentlyUpdated, recentCollections, filterCollectionsByName } from "./collections";

function coll(id: string, name: string, updatedAt: number): Collection {
  return {
    id,
    name,
    accent: null,
    position: id,
    isShared: false,
    shareSlug: null,
    createdAt: updatedAt,
    updatedAt,
    deletedAt: null,
  };
}

describe("sortByRecentlyUpdated", () => {
  it("orders newest-updated first, without mutating the input array", () => {
    const input = [coll("a", "A", 1_000), coll("b", "B", 3_000), coll("c", "C", 2_000)];
    const sorted = sortByRecentlyUpdated(input);
    expect(sorted.map((c) => c.id)).toEqual(["b", "c", "a"]);
    expect(input.map((c) => c.id)).toEqual(["a", "b", "c"]); // original order untouched
  });
});

describe("recentCollections", () => {
  it("returns the 5 most recently updated by default", () => {
    const input = Array.from({ length: 8 }, (_, i) => coll(String(i), `C${i}`, i * 1_000));
    const recent = recentCollections(input);
    expect(recent).toHaveLength(5);
    expect(recent.map((c) => c.id)).toEqual(["7", "6", "5", "4", "3"]);
  });

  it("respects a custom limit and returns fewer when there aren't enough collections", () => {
    const input = [coll("a", "A", 1_000), coll("b", "B", 2_000)];
    expect(recentCollections(input, 1).map((c) => c.id)).toEqual(["b"]);
    expect(recentCollections(input, 5)).toHaveLength(2);
  });
});

describe("filterCollectionsByName", () => {
  const input = [coll("1", "Reading List", 1), coll("2", "Work Tabs", 2), coll("3", "reading later", 3)];

  it("is a case-insensitive substring match", () => {
    expect(filterCollectionsByName(input, "READ").map((c) => c.id).sort()).toEqual(["1", "3"]);
  });

  it("returns everything for an empty or whitespace-only query", () => {
    expect(filterCollectionsByName(input, "")).toEqual(input);
    expect(filterCollectionsByName(input, "   ")).toEqual(input);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterCollectionsByName(input, "zzz")).toEqual([]);
  });
});

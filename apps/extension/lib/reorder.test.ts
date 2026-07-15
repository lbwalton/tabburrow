import { describe, it, expect } from "vitest";
import { arraysEqual, moveItem, neighborsAfterMove, sameIdSet } from "./reorder";

describe("moveItem", () => {
  it("moves an item forward", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an item backward", () => {
    expect(moveItem(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("does not mutate the input array", () => {
    const input = ["a", "b", "c"];
    moveItem(input, 0, 2);
    expect(input).toEqual(["a", "b", "c"]);
  });

  it("is a no-op copy for an out-of-range fromIndex or toIndex", () => {
    expect(moveItem(["a", "b"], 5, 0)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], 0, -1)).toEqual(["a", "b"]);
  });
});

describe("neighborsAfterMove", () => {
  it("finds both neighbors for a middle item", () => {
    expect(neighborsAfterMove(["a", "b", "c"], "b")).toEqual({ beforeId: "a", afterId: "c" });
  });

  it("has no beforeId at the start of the list", () => {
    expect(neighborsAfterMove(["a", "b", "c"], "a")).toEqual({ beforeId: null, afterId: "b" });
  });

  it("has no afterId at the end of the list", () => {
    expect(neighborsAfterMove(["a", "b", "c"], "c")).toEqual({ beforeId: "b", afterId: null });
  });

  it("returns nulls when the moved id isn't in the list", () => {
    expect(neighborsAfterMove(["a", "b"], "zzz")).toEqual({ beforeId: null, afterId: null });
  });

  it("handles a single-item list", () => {
    expect(neighborsAfterMove(["a"], "a")).toEqual({ beforeId: null, afterId: null });
  });
});

describe("arraysEqual", () => {
  it("is true for identical order", () => {
    expect(arraysEqual(["a", "b"], ["a", "b"])).toBe(true);
  });

  it("is false for different order", () => {
    expect(arraysEqual(["a", "b"], ["b", "a"])).toBe(false);
  });

  it("is false for different lengths", () => {
    expect(arraysEqual(["a"], ["a", "b"])).toBe(false);
  });
});

describe("sameIdSet", () => {
  it("is true regardless of order", () => {
    expect(sameIdSet(["a", "b", "c"], ["c", "a", "b"])).toBe(true);
  });

  it("is false when an id was added or removed", () => {
    expect(sameIdSet(["a", "b"], ["a", "b", "c"])).toBe(false);
    expect(sameIdSet(["a", "b", "c"], ["a", "b"])).toBe(false);
  });
});

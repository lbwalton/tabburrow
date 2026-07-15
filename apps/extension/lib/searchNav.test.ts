import { describe, it, expect } from "vitest";
import { nextHighlight, resolveHighlight } from "./searchNav";

describe("nextHighlight", () => {
  it("ArrowDown from -1 (nothing highlighted) jumps to the first result", () => {
    expect(nextHighlight(-1, "ArrowDown", 5)).toBe(0);
  });

  it("ArrowUp from -1 also jumps to the first result", () => {
    expect(nextHighlight(-1, "ArrowUp", 5)).toBe(0);
  });

  it("ArrowDown advances by one", () => {
    expect(nextHighlight(1, "ArrowDown", 5)).toBe(2);
  });

  it("ArrowDown clamps at the last index — no wraparound", () => {
    expect(nextHighlight(4, "ArrowDown", 5)).toBe(4);
  });

  it("ArrowUp retreats by one", () => {
    expect(nextHighlight(2, "ArrowUp", 5)).toBe(1);
  });

  it("ArrowUp clamps at 0 — no wraparound", () => {
    expect(nextHighlight(0, "ArrowUp", 5)).toBe(0);
  });

  it("ArrowUp from an out-of-range current clamps into range first, then retreats", () => {
    // A shrinking result set (the user typed another character) can leave a
    // stale in-range-yesterday current behind: clamp to the last valid index
    // (count - 1) BEFORE retreating, so the result is never >= count.
    expect(nextHighlight(19, "ArrowUp", 3)).toBe(1); // min(19, 2) = 2, retreat -> 1
    expect(nextHighlight(3, "ArrowUp", 3)).toBe(1); // just past the end: min(3, 2) = 2, retreat -> 1
  });

  it("ArrowUp from the last valid index retreats normally (the clamp is a no-op in range)", () => {
    expect(nextHighlight(2, "ArrowUp", 3)).toBe(1);
  });

  it("any other key leaves the index unchanged", () => {
    expect(nextHighlight(2, "Enter", 5)).toBe(2);
    expect(nextHighlight(2, "a", 5)).toBe(2);
    expect(nextHighlight(2, "Tab", 5)).toBe(2);
  });

  it("count <= 0 always yields -1, regardless of key or current", () => {
    expect(nextHighlight(0, "ArrowDown", 0)).toBe(-1);
    expect(nextHighlight(3, "ArrowUp", 0)).toBe(-1);
    expect(nextHighlight(2, "ArrowDown", -1)).toBe(-1);
  });
});

describe("resolveHighlight", () => {
  it("resolves an index within the collections range", () => {
    expect(resolveHighlight(0, 3)).toEqual({ kind: "collection", index: 0 });
    expect(resolveHighlight(2, 3)).toEqual({ kind: "collection", index: 2 });
  });

  it("resolves an index past the collections range to a link index", () => {
    expect(resolveHighlight(3, 3)).toEqual({ kind: "link", index: 0 });
    expect(resolveHighlight(5, 3)).toEqual({ kind: "link", index: 2 });
  });

  it("resolves entirely to links when collectionsCount is 0", () => {
    expect(resolveHighlight(0, 0)).toEqual({ kind: "link", index: 0 });
  });

  it("returns null for a negative index (nothing highlighted)", () => {
    expect(resolveHighlight(-1, 3)).toBeNull();
  });
});

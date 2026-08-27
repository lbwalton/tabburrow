import { describe, it, expect } from "vitest";
import { emptySelection, nextSelection, pruneSelection } from "./selection";
import type { SelectionState } from "./selection";

const order = ["a", "b", "c", "d", "e"];
const wide = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];

describe("emptySelection", () => {
  it("has nothing selected, no anchor, no committed base", () => {
    expect(emptySelection()).toEqual({ selected: new Set(), anchorId: null, committed: new Set() });
  });
});

describe("nextSelection: toggle", () => {
  it("adds an unselected id, anchors it, and commits the result", () => {
    const state = nextSelection(emptySelection(), { type: "toggle", id: "b" });
    expect(state).toEqual({ selected: new Set(["b"]), anchorId: "b", committed: new Set(["b"]) });
  });

  it("removes an already-selected id without touching the rest", () => {
    const prior: SelectionState = { selected: new Set(["a", "b"]), anchorId: "b", committed: new Set(["a", "b"]) };
    const state = nextSelection(prior, { type: "toggle", id: "b" });
    // Anchor follows the last-clicked id (b), even though the click deselected it.
    expect(state).toEqual({ selected: new Set(["a"]), anchorId: "b", committed: new Set(["a"]) });
  });

  it("clears everything when toggling off the last selected id", () => {
    const prior: SelectionState = { selected: new Set(["a"]), anchorId: "a", committed: new Set(["a"]) };
    expect(nextSelection(prior, { type: "toggle", id: "a" })).toEqual(emptySelection());
  });

  it("keeps the anchor at the newly-toggled id, even when other ids remain selected", () => {
    const prior: SelectionState = { selected: new Set(["a", "c"]), anchorId: "a", committed: new Set(["a", "c"]) };
    const state = nextSelection(prior, { type: "toggle", id: "b" });
    expect(state).toEqual({ selected: new Set(["a", "b", "c"]), anchorId: "b", committed: new Set(["a", "b", "c"]) });
  });
});

describe("nextSelection: range", () => {
  it("selects the inclusive range forward from the anchor", () => {
    const prior: SelectionState = { selected: new Set(["b"]), anchorId: "b", committed: new Set(["b"]) };
    const state = nextSelection(prior, { type: "range", id: "d", order });
    expect(state).toEqual({ selected: new Set(["b", "c", "d"]), anchorId: "b", committed: new Set(["b"]) });
  });

  it("selects the inclusive range backward from the anchor", () => {
    const prior: SelectionState = { selected: new Set(["d"]), anchorId: "d", committed: new Set(["d"]) };
    const state = nextSelection(prior, { type: "range", id: "b", order });
    expect(state).toEqual({ selected: new Set(["b", "c", "d"]), anchorId: "d", committed: new Set(["d"]) });
  });

  it("keeps the anchor fixed across repeated shift-clicks (grows/shrinks the current range from the same origin)", () => {
    let state: SelectionState = { selected: new Set(["b"]), anchorId: "b", committed: new Set(["b"]) };
    state = nextSelection(state, { type: "range", id: "d", order });
    expect(state.selected).toEqual(new Set(["b", "c", "d"]));
    state = nextSelection(state, { type: "range", id: "c", order });
    expect(state).toEqual({ selected: new Set(["b", "c"]), anchorId: "b", committed: new Set(["b"]) });
  });

  it("accumulates disjoint ranges: a second range unions onto the first instead of replacing it", () => {
    let state = nextSelection(emptySelection(), { type: "toggle", id: "a" });
    state = nextSelection(state, { type: "range", id: "c", order: wide }); // range 1: a,b,c
    expect(state.selected).toEqual(new Set(["a", "b", "c"]));
    state = nextSelection(state, { type: "toggle", id: "f" }); // skip down, new anchor
    state = nextSelection(state, { type: "range", id: "h", order: wide }); // range 2: f,g,h
    expect(state.selected).toEqual(new Set(["a", "b", "c", "f", "g", "h"]));
  });

  it("grows/shrinks only the current range, leaving an earlier range intact", () => {
    let state = nextSelection(emptySelection(), { type: "toggle", id: "a" });
    state = nextSelection(state, { type: "range", id: "c", order: wide }); // a,b,c
    state = nextSelection(state, { type: "toggle", id: "f" });
    state = nextSelection(state, { type: "range", id: "h", order: wide }); // + f,g,h
    state = nextSelection(state, { type: "range", id: "g", order: wide }); // shrink 2nd range to f,g
    expect(state.selected).toEqual(new Set(["a", "b", "c", "f", "g"]));
  });

  it("adds just the id to the current selection when there is no anchor yet", () => {
    const state = nextSelection(emptySelection(), { type: "range", id: "c", order });
    expect(state).toEqual({ selected: new Set(["c"]), anchorId: "c", committed: new Set(["c"]) });
  });

  it("adds the id to the existing selection when the anchor is stale (dropping stale ids is pruneSelection's job)", () => {
    const prior: SelectionState = { selected: new Set(["a"]), anchorId: "zzz", committed: new Set(["a"]) };
    const state = nextSelection(prior, { type: "range", id: "c", order });
    expect(state).toEqual({ selected: new Set(["a", "c"]), anchorId: "c", committed: new Set(["a", "c"]) });
  });

  it("a single-item range (anchor === id) selects just that item", () => {
    const prior: SelectionState = { selected: new Set(["c"]), anchorId: "c", committed: new Set(["c"]) };
    const state = nextSelection(prior, { type: "range", id: "c", order });
    expect(state).toEqual({ selected: new Set(["c"]), anchorId: "c", committed: new Set(["c"]) });
  });
});

describe("nextSelection: clear", () => {
  it("empties selection, anchor, and committed base", () => {
    const prior: SelectionState = { selected: new Set(["a", "b"]), anchorId: "b", committed: new Set(["a", "b"]) };
    expect(nextSelection(prior, { type: "clear" })).toEqual(emptySelection());
  });
});

describe("pruneSelection", () => {
  it("returns the same reference when the selection is already empty", () => {
    const empty = emptySelection();
    expect(pruneSelection(empty, ["a", "b"])).toBe(empty);
  });

  it("returns the same reference when every id is still valid", () => {
    const state: SelectionState = { selected: new Set(["a", "b"]), anchorId: "a", committed: new Set(["a", "b"]) };
    expect(pruneSelection(state, ["a", "b", "c"])).toBe(state);
  });

  it("drops ids no longer present from both selected and committed", () => {
    const state: SelectionState = { selected: new Set(["a", "b", "c"]), anchorId: "a", committed: new Set(["a", "b", "c"]) };
    const next = pruneSelection(state, ["a", "c"]);
    expect(next.selected).toEqual(new Set(["a", "c"]));
    expect(next.committed).toEqual(new Set(["a", "c"]));
  });

  it("clears the anchor when it's no longer valid, even if other ids remain", () => {
    const state: SelectionState = { selected: new Set(["a", "b"]), anchorId: "a", committed: new Set(["a", "b"]) };
    const next = pruneSelection(state, ["b"]);
    expect(next).toEqual({ selected: new Set(["b"]), anchorId: null, committed: new Set(["b"]) });
  });
});

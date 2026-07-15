import { describe, it, expect } from "vitest";
import { emptySelection, nextSelection, pruneSelection } from "./selection";
import type { SelectionState } from "./selection";

const order = ["a", "b", "c", "d", "e"];

describe("emptySelection", () => {
  it("has nothing selected and no anchor", () => {
    expect(emptySelection()).toEqual({ selected: new Set(), anchorId: null });
  });
});

// T10 removed the "click" event variant: a plain click no longer selects
// (it opens the link — see lib/click-intent.ts), so `nextSelection` never
// receives a "replace selection with just this id" event from a click
// anymore. The range tests below construct their `prior` selection state
// as plain literals instead of via a removed `{type:"click"}` dispatch.

describe("nextSelection: toggle", () => {
  it("adds an unselected id and makes it the anchor", () => {
    const state = nextSelection(emptySelection(), { type: "toggle", id: "b" });
    expect(state).toEqual({ selected: new Set(["b"]), anchorId: "b" });
  });

  it("removes an already-selected id without touching the rest", () => {
    const prior: SelectionState = { selected: new Set(["a", "b"]), anchorId: "b" };
    const state = nextSelection(prior, { type: "toggle", id: "b" });
    expect(state.selected).toEqual(new Set(["a"]));
  });

  it("clears the anchor when toggling off the last selected id", () => {
    const prior: SelectionState = { selected: new Set(["a"]), anchorId: "a" };
    const state = nextSelection(prior, { type: "toggle", id: "a" });
    expect(state).toEqual({ selected: new Set(), anchorId: null });
  });

  it("keeps the anchor at the newly-toggled id, even when other ids remain selected", () => {
    const prior: SelectionState = { selected: new Set(["a", "c"]), anchorId: "a" };
    const state = nextSelection(prior, { type: "toggle", id: "b" });
    expect(state).toEqual({ selected: new Set(["a", "c", "b"]), anchorId: "b" });
  });
});

describe("nextSelection: range", () => {
  it("selects the inclusive range forward from the anchor", () => {
    const prior: SelectionState = { selected: new Set(["b"]), anchorId: "b" };
    const state = nextSelection(prior, { type: "range", id: "d", order });
    expect(state).toEqual({ selected: new Set(["b", "c", "d"]), anchorId: "b" });
  });

  it("selects the inclusive range backward from the anchor", () => {
    const prior: SelectionState = { selected: new Set(["d"]), anchorId: "d" };
    const state = nextSelection(prior, { type: "range", id: "b", order });
    expect(state).toEqual({ selected: new Set(["b", "c", "d"]), anchorId: "d" });
  });

  it("keeps the anchor fixed across repeated shift-clicks (grows/shrinks from the same origin)", () => {
    let state: SelectionState = { selected: new Set(["b"]), anchorId: "b" };
    state = nextSelection(state, { type: "range", id: "d", order });
    state = nextSelection(state, { type: "range", id: "c", order });
    expect(state).toEqual({ selected: new Set(["b", "c"]), anchorId: "b" });
  });

  it("falls back to selecting just the id when there is no anchor yet", () => {
    const state = nextSelection(emptySelection(), { type: "range", id: "c", order });
    expect(state).toEqual({ selected: new Set(["c"]), anchorId: "c" });
  });

  it("falls back to selecting just the id when the anchor is stale (no longer in order)", () => {
    const prior: SelectionState = { selected: new Set(["zzz"]), anchorId: "zzz" };
    const state = nextSelection(prior, { type: "range", id: "c", order });
    expect(state).toEqual({ selected: new Set(["c"]), anchorId: "c" });
  });

  it("a single-item range (anchor === id) selects just that item", () => {
    const prior: SelectionState = { selected: new Set(["c"]), anchorId: "c" };
    const state = nextSelection(prior, { type: "range", id: "c", order });
    expect(state).toEqual({ selected: new Set(["c"]), anchorId: "c" });
  });
});

describe("nextSelection: clear", () => {
  it("empties the selection and anchor", () => {
    const prior: SelectionState = { selected: new Set(["a", "b"]), anchorId: "b" };
    expect(nextSelection(prior, { type: "clear" })).toEqual(emptySelection());
  });
});

describe("pruneSelection", () => {
  it("returns the same reference when the selection is already empty", () => {
    const empty = emptySelection();
    expect(pruneSelection(empty, ["a", "b"])).toBe(empty);
  });

  it("returns the same reference when every selected id is still valid", () => {
    const state: SelectionState = { selected: new Set(["a", "b"]), anchorId: "a" };
    expect(pruneSelection(state, ["a", "b", "c"])).toBe(state);
  });

  it("drops ids no longer present in validIds", () => {
    const state: SelectionState = { selected: new Set(["a", "b", "c"]), anchorId: "a" };
    const next = pruneSelection(state, ["a", "c"]);
    expect(next.selected).toEqual(new Set(["a", "c"]));
  });

  it("clears the anchor when it's no longer valid, even if other selected ids remain", () => {
    const state: SelectionState = { selected: new Set(["a", "b"]), anchorId: "a" };
    const next = pruneSelection(state, ["b"]);
    expect(next).toEqual({ selected: new Set(["b"]), anchorId: null });
  });
});

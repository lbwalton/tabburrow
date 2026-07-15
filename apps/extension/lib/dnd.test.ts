import { describe, it, expect } from "vitest";
import { resolveDragEnd } from "./dnd";
import type { DragEndInput } from "./dnd";

function input(overrides: Partial<DragEndInput>): DragEndInput {
  return {
    activeId: "a",
    activeType: "collection",
    overId: "b",
    overType: "collection",
    ...overrides,
  };
}

describe("resolveDragEnd", () => {
  it("is a noop when there is no drop target", () => {
    expect(resolveDragEnd(input({ overId: null }))).toEqual({ kind: "noop" });
  });

  it("is a noop when dropped back on itself", () => {
    expect(resolveDragEnd(input({ activeId: "a", overId: "a" }))).toEqual({ kind: "noop" });
  });

  it("resolves a collection dragged over another collection to reorder-collections", () => {
    expect(resolveDragEnd(input({ activeType: "collection", overType: "collection", activeId: "a", overId: "b" }))).toEqual(
      { kind: "reorder-collections", activeId: "a", overId: "b" },
    );
  });

  it("is a noop when a collection is dragged over a link (shouldn't happen structurally, guarded anyway)", () => {
    expect(resolveDragEnd(input({ activeType: "collection", overType: "link" }))).toEqual({ kind: "noop" });
  });

  it("resolves a link dragged over a collection row to move-link", () => {
    expect(
      resolveDragEnd(input({ activeType: "link", activeId: "link-1", overType: "collection", overId: "col-2" })),
    ).toEqual({ kind: "move-link", linkId: "link-1", targetCollectionId: "col-2" });
  });

  it("resolves a link dragged over another link to reorder-links", () => {
    expect(
      resolveDragEnd(input({ activeType: "link", activeId: "link-1", overType: "link", overId: "link-2" })),
    ).toEqual({ kind: "reorder-links", activeId: "link-1", overId: "link-2" });
  });

  it("is a noop when the active drag type is unknown (data not yet registered)", () => {
    expect(resolveDragEnd(input({ activeType: undefined, overType: "collection" }))).toEqual({ kind: "noop" });
  });

  it("is a noop when the over type is unknown", () => {
    expect(resolveDragEnd(input({ activeType: "link", overType: undefined }))).toEqual({ kind: "noop" });
  });
});

/**
 * The single decision function behind the dashboard's one lifted `DndContext`
 * (see `App.tsx`): given the drag-kind ("collection" row vs. "link" card) of
 * whatever was picked up and whatever it's hovering over, which operation —
 * if any — should `onDragEnd` perform?
 *
 * Pure and dnd-kit-agnostic on purpose: `App.tsx` is responsible for reading
 * `event.active`/`event.over` (ids + `data.current?.type`) into a
 * `DragEndInput` and for actually calling `moveCollection`/`moveLink`/the
 * optimistic-order setters once it has a `DndOperation` back. No dnd-kit
 * import here.
 */

export type DragKind = "collection" | "link";

export interface DragEndInput {
  activeId: string;
  activeType: DragKind | undefined;
  overId: string | null;
  overType: DragKind | undefined;
}

export type DndOperation =
  | { kind: "reorder-collections"; activeId: string; overId: string }
  | { kind: "reorder-links"; activeId: string; overId: string }
  | { kind: "move-link"; linkId: string; targetCollectionId: string }
  | { kind: "noop" };

const NOOP: DndOperation = { kind: "noop" };

/**
 * - No `over` (dropped outside any droppable), or dropped back on itself:
 *   `noop`.
 * - A collection row dragged over another collection row: `reorder-collections`
 *   (the rail's existing behavior). Dragged over anything else (shouldn't
 *   happen structurally — rows and cards live in different lists — but
 *   guarded defensively): `noop`.
 * - A link card dragged over a collection row: `move-link` (the rail becomes
 *   a drop target for cards). Dragged over another link card: `reorder-links`
 *   (within-grid reorder). Otherwise: `noop`.
 */
export function resolveDragEnd(input: DragEndInput): DndOperation {
  const { activeId, activeType, overId, overType } = input;
  if (overId === null || activeId === overId) return NOOP;

  if (activeType === "collection") {
    return overType === "collection"
      ? { kind: "reorder-collections", activeId, overId }
      : NOOP;
  }

  if (activeType === "link") {
    if (overType === "collection") {
      return { kind: "move-link", linkId: activeId, targetCollectionId: overId };
    }
    if (overType === "link") {
      return { kind: "reorder-links", activeId, overId };
    }
  }

  return NOOP;
}

/**
 * Pure helpers behind the rail's drag-reorder. dnd-kit owns the gesture and
 * live "make room" animation during a drag; these functions only compute
 * (a) the array-move result once a drag ends and (b) the before/after
 * neighbor ids `moveCollection` needs to persist a fractional-index
 * position. No dnd-kit or chrome import here — these are plain array ops.
 */

/**
 * Relocates the item at `fromIndex` to `toIndex`, shifting the rest.
 * Returns a new array; does not mutate the input. Out-of-range indices are
 * a no-op (returns an equal-valued copy) rather than throwing, since a
 * drag-end event with a stale/missing id should never crash the rail.
 */
export function moveItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex < 0 ||
    fromIndex >= items.length ||
    toIndex < 0 ||
    toIndex >= items.length
  ) {
    return [...items];
  }
  const copy = [...items];
  const [moved] = copy.splice(fromIndex, 1);
  copy.splice(toIndex, 0, moved as T);
  return copy;
}

export interface Neighbors {
  beforeId: string | null;
  afterId: string | null;
}

/**
 * The ids immediately before/after `movedId` within `orderedIds` — exactly
 * the `beforeId`/`afterId` shape `moveCollection` expects. Either end of
 * the list yields `null` on that side; an id not present in the list
 * (shouldn't happen, but a drag-end race is cheap to guard) yields both
 * `null`.
 */
export function neighborsAfterMove(orderedIds: string[], movedId: string): Neighbors {
  const idx = orderedIds.indexOf(movedId);
  if (idx === -1) return { beforeId: null, afterId: null };
  return {
    beforeId: idx > 0 ? orderedIds[idx - 1]! : null,
    afterId: idx < orderedIds.length - 1 ? orderedIds[idx + 1]! : null,
  };
}

/** Same length, same ids, in the same order. */
export function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * Same set of ids, any order. Used to tell "the live query caught up with
 * our optimistic order" apart from "the collection set itself changed
 * (add/delete) underneath an in-flight drag" — the rail should drop its
 * optimistic override in either case, but the two are different enough
 * (confirmed vs. stale) to be worth distinguishing in the caller.
 */
export function sameIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const bSet = new Set(b);
  return a.every((id) => bSet.has(id));
}

/** An event the rail's optimistic-order state must react to. */
export type ReorderEvent =
  | { type: "live-update"; liveOrder: string[] }
  | { type: "write-failed" };

/**
 * The single decision function behind the rail's optimistic drag order:
 * given the current override (`localOrder`, `null` when inactive) and an
 * event, what should the override become?
 *
 * - `write-failed` (the `moveCollection` promise rejected): drop the
 *   override so the rail reverts to the live (persisted) order — otherwise
 *   a Dexie transaction abort would leave an unpersisted order on screen
 *   forever.
 * - `live-update` with the same order: the write is confirmed; drop it.
 * - `live-update` with the same id set but a different order: the write is
 *   still in flight; keep waiting. Returns the SAME array reference so a
 *   React `setState(fn)` caller bails out without a re-render.
 * - `live-update` with a different id set: an add/delete landed underneath
 *   the drag; the override is stale, drop it.
 */
export function nextLocalOrder(localOrder: string[] | null, event: ReorderEvent): string[] | null {
  if (localOrder === null) return null;
  if (event.type === "write-failed") return null;
  if (!sameIdSet(localOrder, event.liveOrder)) return null;
  if (arraysEqual(localOrder, event.liveOrder)) return null;
  return localOrder;
}

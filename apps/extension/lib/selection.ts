/**
 * Pure multi-select state for the link grid: cmd/ctrl-click or Space (toggle),
 * shift-click (range), Escape/collection-change (clear). No DOM/React import —
 * the grid wires DOM events to `SelectionEvent` and calls `nextSelection`.
 *
 * Shift-click ranges are Finder / file-explorer style: a range is UNIONED onto
 * the selection as it stood at the last toggle (`committed`), so multiple
 * disjoint ranges accumulate (select 1-3, then 8-10, and keep both), while
 * repeatedly shift-clicking from the same anchor grows/shrinks only the CURRENT
 * range and leaves earlier ones intact.
 *
 * As of T10 a PLAIN click (or Enter) no longer selects — it opens the link
 * instead (see `lib/click-intent.ts`), so `nextSelection` only ever receives
 * `toggle`/`range`/`clear`.
 */

export interface SelectionState {
  selected: Set<string>;
  /** The id a shift-click range is measured from. Fixed across repeated shift-clicks so a range grows/shrinks from the same origin. */
  anchorId: string | null;
  /**
   * The selection as it stood at the last `toggle` — the base a shift-click
   * `range` is unioned onto. This is what makes ranges ADDITIVE (disjoint
   * ranges survive) while a repeated shift-click from the same anchor still
   * only grows/shrinks the current range: each re-range starts from `committed`,
   * not from the previous range's result.
   */
  committed: Set<string>;
}

export function emptySelection(): SelectionState {
  return { selected: new Set(), anchorId: null, committed: new Set() };
}

export type SelectionEvent =
  | { type: "toggle"; id: string }
  | { type: "range"; id: string; order: string[] }
  | { type: "clear" };

/**
 * The single decision function behind the grid's selection.
 *
 * - `toggle` (cmd/ctrl-click, or Space): adds/removes `id` without touching the
 *   rest, then COMMITS the result as the new base future ranges add onto, and
 *   anchors at `id`. Toggling off the last id clears everything.
 * - `range` (shift-click): unions the contiguous slice of `order` between the
 *   anchor and `id` onto `committed`. The anchor and committed base don't move,
 *   so a later shift-click re-ranges from the same origin (grow/shrink the
 *   current range) without disturbing earlier ranges. With no usable anchor
 *   (none yet, or a since-removed row) it just adds `id` to the current
 *   selection and anchors there.
 * - `clear`: empties everything.
 */
export function nextSelection(state: SelectionState, event: SelectionEvent): SelectionState {
  switch (event.type) {
    case "clear":
      return emptySelection();

    case "toggle": {
      const selected = new Set(state.selected);
      if (selected.has(event.id)) {
        selected.delete(event.id);
      } else {
        selected.add(event.id);
      }
      if (selected.size === 0) return emptySelection();
      return { selected, anchorId: event.id, committed: new Set(selected) };
    }

    case "range": {
      const anchorIndex = state.anchorId !== null ? event.order.indexOf(state.anchorId) : -1;
      const clickIndex = event.order.indexOf(event.id);
      if (anchorIndex === -1 || clickIndex === -1) {
        // No usable anchor: add just this id to the current selection (don't
        // wipe it) and anchor here. Dropping ids of since-removed rows is
        // pruneSelection's job, not this fallback's.
        const selected = new Set([...state.selected, event.id]);
        return { selected, anchorId: event.id, committed: new Set(selected) };
      }
      const [start, end] = anchorIndex <= clickIndex ? [anchorIndex, clickIndex] : [clickIndex, anchorIndex];
      const selected = new Set([...state.committed, ...event.order.slice(start, end + 1)]);
      return { selected, anchorId: state.anchorId, committed: state.committed };
    }
  }
}

/**
 * Drops any selected / anchor / committed ids no longer present in `validIds`
 * (a link moved to another collection, bulk-deleted, or a stale collection
 * switch). Returns the SAME reference when nothing changed, so a caller's
 * `setState(fn)` can bail out without a re-render.
 */
export function pruneSelection(state: SelectionState, validIds: string[]): SelectionState {
  const validSet = new Set(validIds);
  const selected = new Set([...state.selected].filter((id) => validSet.has(id)));
  const committed = new Set([...state.committed].filter((id) => validSet.has(id)));
  const anchorId = state.anchorId !== null && validSet.has(state.anchorId) ? state.anchorId : null;
  if (selected.size === state.selected.size && committed.size === state.committed.size && anchorId === state.anchorId) {
    return state;
  }
  return { selected, anchorId, committed };
}

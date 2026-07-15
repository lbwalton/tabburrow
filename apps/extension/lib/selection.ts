/**
 * Pure multi-select state for the link grid: click (single), cmd/ctrl-click
 * (toggle), shift-click (range from a fixed anchor within the current sort
 * order), Escape/collection-change (clear). No DOM/React import — the grid
 * wires DOM events (`event.shiftKey`/`metaKey`/`ctrlKey`) to `SelectionEvent`
 * and calls `nextSelection`.
 */

export interface SelectionState {
  selected: Set<string>;
  /** The id a shift-click range is measured from. Stays fixed across repeated shift-clicks (doesn't jump to the new end) so a range can grow and shrink from the same origin. */
  anchorId: string | null;
}

export function emptySelection(): SelectionState {
  return { selected: new Set(), anchorId: null };
}

export type SelectionEvent =
  | { type: "click"; id: string }
  | { type: "toggle"; id: string }
  | { type: "range"; id: string; order: string[] }
  | { type: "clear" };

/**
 * The single decision function behind the grid's selection: given the
 * current state and a click-shaped event, what should the selection become?
 *
 * - `click`: replaces the selection with just `id`; `id` becomes the new
 *   anchor for a future range.
 * - `toggle` (cmd/ctrl-click): adds/removes `id` from the selection without
 *   touching the rest. The toggled id becomes the anchor, unless the toggle
 *   just emptied the selection entirely — then there's nothing sensible to
 *   range from, so the anchor clears too.
 * - `range` (shift-click): selects the contiguous slice of `order` between
 *   the current anchor and `id` (inclusive), REPLACING the prior selection.
 *   The anchor itself does not move, so a later shift-click still ranges
 *   from the original starting point. Falls back to plain `click` semantics
 *   when there's no anchor yet, or the anchor/id aren't in `order` (a stale
 *   anchor from a since-removed row).
 * - `clear`: empties both.
 */
export function nextSelection(state: SelectionState, event: SelectionEvent): SelectionState {
  switch (event.type) {
    case "clear":
      return emptySelection();

    case "click":
      return { selected: new Set([event.id]), anchorId: event.id };

    case "toggle": {
      const selected = new Set(state.selected);
      if (selected.has(event.id)) {
        selected.delete(event.id);
      } else {
        selected.add(event.id);
      }
      return { selected, anchorId: selected.size > 0 ? event.id : null };
    }

    case "range": {
      const anchorIndex = state.anchorId !== null ? event.order.indexOf(state.anchorId) : -1;
      const clickIndex = event.order.indexOf(event.id);
      if (anchorIndex === -1 || clickIndex === -1) {
        return { selected: new Set([event.id]), anchorId: event.id };
      }
      const [start, end] = anchorIndex <= clickIndex ? [anchorIndex, clickIndex] : [clickIndex, anchorIndex];
      return { selected: new Set(event.order.slice(start, end + 1)), anchorId: state.anchorId };
    }
  }
}

/**
 * Drops any selected/anchor ids no longer present in `validIds` — a link
 * moved to another collection, bulk-deleted, or a stale collection switch.
 * Returns the SAME reference when nothing actually changed, so a caller's
 * `setState(fn)` can bail out without a re-render (mirrors `nextLocalOrder`
 * in `reorder.ts`).
 */
export function pruneSelection(state: SelectionState, validIds: string[]): SelectionState {
  if (state.selected.size === 0 && state.anchorId === null) return state;
  const validSet = new Set(validIds);
  const selected = new Set([...state.selected].filter((id) => validSet.has(id)));
  const anchorId = state.anchorId !== null && validSet.has(state.anchorId) ? state.anchorId : null;
  if (selected.size === state.selected.size && anchorId === state.anchorId) return state;
  return { selected, anchorId };
}

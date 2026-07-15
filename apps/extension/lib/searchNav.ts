/**
 * Pure keyboard-navigation state for the flat, grouped (Collections then
 * Links) search-result list — shared by `SearchOverlay` (dashboard) and the
 * popup's inline search results, so ArrowUp/ArrowDown/Enter behave
 * identically in both places.
 */

export type HighlightTarget = { kind: "collection"; index: number } | { kind: "link"; index: number };

/**
 * Moves the flat highlight index in response to a keydown's `key`. `count`
 * is the number of results CURRENTLY RENDERED (collections + links
 * combined) — callers pass whatever's actually on screen (the popup caps
 * display at ~8; the dashboard overlay shows the full up-to-`MAX_SEARCH_RESULTS`
 * list `rankSearch` returned).
 *
 * No wraparound: ArrowDown clamps at the last index, ArrowUp clamps at 0.
 * `current === -1` ("nothing highlighted yet") jumps to the first result on
 * either key. Any other key, or `count <= 0` (no results to highlight at
 * all), returns unchanged — `count <= 0` always normalizes to -1 regardless
 * of what `current` was, since a shrinking result set (e.g. the user typed
 * another character) can leave a stale in-range `current` behind.
 */
export function nextHighlight(current: number, key: string, count: number): number {
  if (count <= 0) return -1;
  if (key === "ArrowDown") return current < 0 ? 0 : Math.min(current + 1, count - 1);
  if (key === "ArrowUp") return current < 0 ? 0 : Math.max(current - 1, 0);
  return current;
}

/**
 * Resolves a flat highlight index back to which group it falls in
 * ("Collections" render first, then "Links" — the same order `rankSearch`
 * already returns them in) and that group's own index. `null` for a
 * negative index ("nothing highlighted").
 */
export function resolveHighlight(index: number, collectionsCount: number): HighlightTarget | null {
  if (index < 0) return null;
  return index < collectionsCount ? { kind: "collection", index } : { kind: "link", index: index - collectionsCount };
}

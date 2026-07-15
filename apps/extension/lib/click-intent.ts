/**
 * Pure click/key -> intent resolution behind the T10 interaction
 * redefinition: a plain click on a link card OPENS it in a new background
 * tab (the dashboard keeps focus); cmd/ctrl-click TOGGLEs its selection;
 * shift-click ranges. On the card body's own keydown (guarded to the card
 * itself, not the grip handle or an open edit popover — see
 * `LinkCard.handleKeyDown`'s docstring): Enter opens (same background-tab
 * semantics as a click), Space toggles.
 *
 * `LinkCard` reads the raw DOM event into the shapes below, calls these,
 * and hands the resolved intent up to `LinkGrid` (which owns selection
 * state / the current `order` / the actual `openLinks` call) — no DOM/React
 * import here, same split `lib/selection.ts`'s `SelectionEvent` uses.
 */

export type ClickIntent = "open" | "toggle" | "range";

export interface ClickModifiers {
  /**
   * `MouseEvent.button` — 0 is the primary button. Not currently used to
   * change the result (React's `onClick` only ever fires for a primary-
   * button click in the first place), kept in the shape so a future
   * non-primary-click policy has somewhere to plug in without changing
   * every call site's signature.
   */
  button?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
}

/**
 * Same precedence `LinkGrid` used pre-T10 for shift vs. meta/ctrl: shift
 * wins when both are held (arbitrary, but a decision has to be made, and
 * shift-range is the "bigger" gesture). A plain click with no modifiers
 * now resolves to "open" — pre-T10 this fell through to "select"; that's
 * the whole redefinition.
 */
export function clickIntent(mods: ClickModifiers): ClickIntent {
  if (mods.shiftKey) return "range";
  if (mods.metaKey || mods.ctrlKey) return "toggle";
  return "open";
}

/** Keys resolved on the card body itself. There is no keyboard equivalent of shift-range. */
export type KeyIntent = "open" | "toggle";

/** Enter -> open (same as a plain click). Space -> toggle (same as a cmd/ctrl-click). Anything else -> `null`, meaning "not handled here" (LinkCard neither calls a handler nor calls `preventDefault`). */
export function keyIntent(key: string): KeyIntent | null {
  if (key === "Enter") return "open";
  if (key === " ") return "toggle";
  return null;
}

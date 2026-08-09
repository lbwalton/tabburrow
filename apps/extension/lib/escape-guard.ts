/**
 * The Escape-guard rules shared by the popup's folder detail (`FolderDetail`)
 * and the dashboard's link grid (`LinkGrid`). Both clear a multi-select when
 * Escape is pressed, and both must stand down when some other surface on the
 * page owns that keypress instead.
 *
 * This logic was written wrong three separate times before it was covered, and
 * every failure mode was silent — no error, just a selection that vanished. So
 * it lives here once, and the decision part is deliberately DOM-free: it takes
 * a tag name and an input type as plain strings rather than an `Element`, which
 * makes it unit-testable in this package's node-environment vitest (which mocks
 * no DOM — see `vitest.config.ts`). `addEscapeListener` is the one function
 * here that touches `window` and is therefore NOT unit tested, matching the
 * split `lib/restore.ts` documents for its own `chrome.*` caller.
 */

/**
 * Input types where Escape means "revert what I'm typing", so the focused field
 * owns the key and the list-level clear must not also fire.
 *
 * A positive allowlist, and the direction is load-bearing. A checkbox is also
 * an `HTMLInputElement`, so a bare `instanceof` check bails on every checkbox
 * click — which silently disabled clear-selection immediately after the user
 * ticked a box, the exact regression that shipped once already. With an
 * allowlist, an unrecognized type falls through to clearing, which is the
 * harmless direction to be wrong in.
 */
const TEXT_ENTRY_TYPES = new Set(["text", "url", "search", "email", "password", "tel", "number"]);

/**
 * Everything that owns Escape ahead of a selection: any open native `<dialog>`
 * (confirms, `EditLinkPopover`, `SendMenu`, `OpenAllButton`'s over-15 confirm,
 * `SearchOverlay`), any `role="menu"` (the folder and per-row ⋯ menus,
 * `RestoreAllButton`), and any `role="dialog"`.
 *
 * That last clause is the one people forget, and forgetting it is what caused
 * the first bug: `AccentPicker` is a plain `<div role="dialog">`, not a native
 * `<dialog>`, so a `dialog[open]`-only selector sails straight past it.
 */
export const ESCAPE_OWNER_SELECTOR = "dialog[open], [role='menu'], [role='dialog']";

/**
 * Whether the currently focused element is a text-entry field that owns Escape.
 *
 * Takes strings rather than an element so it can be tested without a DOM.
 * Callers pass `document.activeElement`'s `tagName` and, for inputs, its `type`.
 *
 * An `<input>` with no `type` attribute reports `"text"` in the DOM, so a
 * missing `inputType` is treated as `"text"` — that is what makes the rail's
 * and the popup's untyped rename fields work without special-casing.
 */
export function isTextEntryFocus(tagName: string | null | undefined, inputType?: string | null): boolean {
  if (!tagName) return false;
  const tag = tagName.toUpperCase();
  if (tag === "TEXTAREA") return true;
  if (tag !== "INPUT") return false;
  return TEXT_ENTRY_TYPES.has((inputType ?? "text").toLowerCase());
}

/**
 * Installs `handler` as a window-level Escape listener and returns the cleanup,
 * ready to be returned straight from a `useEffect`.
 *
 * **The capture phase is the whole point, and it is why this is a function
 * rather than two exported constants.** React 18 flushes a discrete update
 * synchronously, so by the time a BUBBLE-phase listener on `window` runs, the
 * surface that owned the key has already gone: `AccentPicker` is unmounted, a
 * cancelled rename input has already blurred. Neither guard above can see what
 * it is meant to protect, and the selection gets wiped anyway. Capture runs
 * before React's root-container listeners, so the DOM is still intact.
 *
 * Wrapping it also makes the second failure impossible by construction: the
 * `true` has to be passed to BOTH `addEventListener` and `removeEventListener`
 * or the cleanup silently fails to detach and leaks a listener per mount.
 *
 * Do not "simplify" this to bubble phase. A `happy-dom` repro once confidently
 * proved the opposite of what Chrome does; only a real browser settles it, and
 * the e2e specs `r10-folder-actions` and `t09-grid-dnd` are what cover it.
 */
export function addEscapeListener(handler: (event: KeyboardEvent) => void): () => void {
  window.addEventListener("keydown", handler, true);
  return () => window.removeEventListener("keydown", handler, true);
}

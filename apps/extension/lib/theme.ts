export type Theme = "dark" | "paper";

/** Meta key both entrypoints read on mount and the Settings pane writes on toggle. Meta is the durable source of truth. */
export const THEME_META_KEY = "theme";

/**
 * localStorage key for the synchronous pre-paint theme cache. Meta
 * (IndexedDB) can only be read async — from a post-paint effect — so a
 * paper-theme user would otherwise see a dark flash on every page open.
 * `applyTheme` below mirrors the theme here, and `public/theme-init.js` (a
 * classic, blocking <script> placed FIRST in both entrypoints' <head>)
 * reads it synchronously and stamps `data-theme` before first paint. Must
 * stay in sync with the literal in that script — a classic pre-paint script
 * can't import from a module.
 */
export const THEME_STORAGE_KEY = "tabburrow-theme";

export const DEFAULT_THEME: Theme = "dark";

/**
 * Narrows an arbitrary meta value to a known `Theme`, defaulting to "dark"
 * for anything unrecognized — absent meta (fresh install), a stale/foreign
 * value, or `null`.
 */
export function parseTheme(value: string | null): Theme {
  return value === "paper" ? "paper" : DEFAULT_THEME;
}

/**
 * Applies `theme` to the document root via `data-theme` — `@tabburrow/ui`'s
 * `[data-theme="paper"]` CSS block (tokens.css) keys off this attribute;
 * `:root`'s own dark values apply whenever it's anything else, so "dark"
 * doesn't need its own CSS block. Also mirrors the theme into the
 * localStorage pre-paint cache (see THEME_STORAGE_KEY) so the NEXT page
 * open paints in the right theme immediately; meta stays the durable source
 * of truth, this cache is best-effort. Chrome-extension-page DOM call, not
 * unit tested — same precedent as lib/tabs.ts's chrome-calling helpers.
 */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // localStorage can throw (disabled/quota). Worst case the pre-paint
    // cache is stale or absent and the next open briefly paints dark before
    // the async meta read reconciles — the pre-T13.1 behavior, not an error.
  }
}

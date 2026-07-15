export type Theme = "dark" | "paper";

/** Meta key both entrypoints read on mount and the Settings pane writes on toggle. */
export const THEME_META_KEY = "theme";

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
 * doesn't need its own CSS block. Chrome-extension-page DOM call, not unit
 * tested — same precedent as lib/tabs.ts's chrome-calling helpers.
 */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

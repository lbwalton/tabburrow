/**
 * Collection accent palette for the rail's accent picker: 8 token-derived
 * color swatches (never a new hex literal — every value is `var(...)` or a
 * `color-mix()` of existing tokens) plus a small curated emoji row.
 */

/** Curated emoji accents — deliberately a small, tasteful set, not exhaustive. */
export const ACCENT_EMOJIS = ["\u{1F5C2}\u{FE0F}", "\u{1F4DA}", "\u{1F9ED}", "\u{1F6E0}\u{FE0F}", "\u{1F3AC}", "\u{1F9EA}"] as const;

export interface AccentSwatch {
  id: string;
  /** A CSS color value: a token `var()` or a `color-mix()` expression over token vars. */
  value: string;
}

/**
 * The two brand accents plus 6 tasteful tints/shades, all mixed from
 * `--accent`, `--accent-2`, `--muted`, and `--text` via `color-mix()`.
 */
export function accentPalette(): AccentSwatch[] {
  return [
    { id: "accent", value: "var(--accent)" },
    { id: "accent-2", value: "var(--accent-2)" },
    { id: "accent-muted", value: "color-mix(in srgb, var(--accent) 65%, var(--muted) 35%)" },
    { id: "accent-2-muted", value: "color-mix(in srgb, var(--accent-2) 65%, var(--muted) 35%)" },
    { id: "accent-blend", value: "color-mix(in srgb, var(--accent) 50%, var(--accent-2) 50%)" },
    { id: "accent-tint", value: "color-mix(in srgb, var(--accent) 70%, var(--text) 30%)" },
    { id: "accent-2-tint", value: "color-mix(in srgb, var(--accent-2) 70%, var(--text) 30%)" },
    { id: "muted-tint", value: "color-mix(in srgb, var(--muted) 60%, var(--text) 40%)" },
  ];
}

/**
 * True when `accent` is a CSS color value (a token expression, or a legacy
 * literal hex) that can be used as a `backgroundColor`/`borderColor` — as
 * opposed to an emoji/text glyph, which renders as a character instead.
 */
export function isCssColorAccent(accent: string): boolean {
  return accent.startsWith("var(") || accent.startsWith("color-mix(") || accent.startsWith("#");
}

/**
 * The CSS color to paint for a collection's accent. An unset accent (`null`)
 * and an emoji/text accent (see `ACCENT_EMOJIS`) have no color of their own,
 * so both resolve to the brand orange. This is for callers that only ever
 * paint a color — callers that render the emoji glyph itself (FolderRow's
 * `AccentDot`) still branch on `isCssColorAccent` first.
 */
export function accentColor(accent: string | null): string {
  if (accent !== null && isCssColorAccent(accent)) return accent;
  return "var(--accent)";
}

/**
 * Scheme normalization for manually-typed link URLs.
 *
 * A URL typed as a bare domain ("nike.com") is not a URL as far as any
 * browser API is concerned — it's a RELATIVE reference. Handing one to
 * `chrome.tabs.create` resolves it against the extension's own origin and
 * opens `chrome-extension://<id>/nike.com` instead of the site (issue #24).
 * Everything here exists to turn what a person means into what the tabs API
 * needs, without rewriting input that was already fine.
 */

/**
 * A scheme candidate: letters/digits/`+`/`-`/`.` up to the first colon, per
 * RFC 3986. Captures the remainder so `hasScheme` can inspect it.
 */
const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):([\s\S]*)$/;

/**
 * Whether `raw` really opens with a URL scheme ("https:", "mailto:",
 * "chrome:") rather than a bare `host:port` that merely looks like one.
 *
 * `new URL()` can't make this call on its own: it parses "localhost:3000"
 * happily, as scheme `localhost:` with path `3000`. So a "does it parse?"
 * scheme test silently accepts the single input shape people most often
 * mean as a host and a port, and leaves it unnormalized and broken.
 *
 * The disambiguation is the one browser omniboxes use: if everything after
 * the colon is digits (optionally followed by a path/query/fragment), the
 * colon introduces a PORT, so the text before it is a host, not a scheme.
 */
function hasScheme(raw: string): boolean {
  const match = SCHEME_RE.exec(raw);
  if (!match) return false;
  const rest = match[2]!;
  return !/^\d+([/?#]|$)/.test(rest);
}

/**
 * Fills in the missing scheme on a manually-typed URL so it is absolute, and
 * therefore openable. Deliberately minimal: it trims surrounding whitespace
 * and may prepend a scheme, and otherwise returns the string untouched — it
 * never round-trips through `URL.href`, so it can't quietly append a
 * trailing slash, percent-encode, or lowercase a host. Keeping the string
 * stable this way matters beyond aesthetics: link dedupe (`addLink`,
 * `saveTabs`) compares URLs with `===`, so any canonicalization here would
 * silently change which links count as duplicates.
 *
 * - Already-absolute input ("https://nike.com", "mailto:a@b.com",
 *   "chrome://settings", "file:///x") is returned as-is.
 * - A bare domain, `host:port`, or protocol-relative reference ("nike.com",
 *   "localhost:3000", "//nike.com") gets an "https://" scheme.
 * - Anything that still won't parse as a URL (free text like "read this
 *   later") is returned trimmed but otherwise unchanged, rather than being
 *   mangled into a bogus "https://read this later". Callers already tolerate
 *   an unparseable URL (`hostnameOf` and the UI's `formatHost` both fall
 *   back to the raw string), so preserving it loses nothing.
 *
 * Safe to call on an already-normalized string: it is idempotent.
 */
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  if (hasScheme(trimmed)) return trimmed;

  // "//host/path" is protocol-relative: it already carries its own "//", so
  // prefixing the full "https://" would produce "https:////host/path".
  const candidate = trimmed.startsWith("//") ? `https:${trimmed}` : `https://${trimmed}`;
  try {
    new URL(candidate);
    return candidate;
  } catch {
    return trimmed;
  }
}

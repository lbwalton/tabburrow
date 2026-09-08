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

/**
 * The schemes a link may be STORED with. Deliberately the same set the tab
 * capture flows already accept (`apps/extension/lib/tabs.ts`'s
 * `isSaveableUrl`, which now delegates here so the two can't drift): ordinary
 * pages, plus `file:` for a local report or saved HTML export.
 */
const STORABLE_PROTOCOLS = new Set(["http:", "https:", "file:"]);

/**
 * Whether `rawUrl` may be saved as a link at all.
 *
 * This is the INPUT half of the scheme defence; the public share page has its
 * own `safeLinkHref` gate on the render side (`apps/web/lib/share.ts`). Both
 * exist on purpose: this one stops a hostile URL from being stored, that one
 * protects against the rows already stored before this check existed and
 * against anything sync delivers.
 *
 * It allowlists the PARSED protocol rather than blocklisting known-bad
 * prefixes. `javascript:` is only the obvious hazard — `data:`, `vbscript:`
 * and `blob:` are no better — and a raw-string prefix check is defeated by
 * `java\nscript:`, which the URL parser normalizes straight back into a
 * javascript: URL.
 *
 * Input is normalized first, so a bare "nike.com" is judged as
 * "https://nike.com" and accepted. Anything that still isn't an absolute URL
 * (free text like "read this later") is rejected too: it could never be
 * opened, so storing it only ever produces a dead row.
 */
export function isStorableLinkUrl(rawUrl: string): boolean {
  try {
    return STORABLE_PROTOCOLS.has(new URL(normalizeUrl(rawUrl)).protocol);
  } catch {
    return false;
  }
}

/** User-facing reason a link was refused, shared by `addLink` and the popup's add-link form so both say the same thing. */
export const UNSUPPORTED_LINK_URL_MESSAGE =
  "That doesn't look like a web address. Links must start with http, https, or file.";

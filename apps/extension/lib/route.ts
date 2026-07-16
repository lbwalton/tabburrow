/**
 * The dashboard's hash router, split into two pure steps:
 *
 * 1. `parseHash` reads only `location.hash` — it has no idea which
 *    collections actually exist, so an id-shaped route just gets carried
 *    through as-is.
 * 2. `resolveRoute` combines that parse with the live set of collection
 *    ids to apply the two rules that need data: "unknown id -> not-found
 *    (with a fallback to fall back to)" and "no id at all -> default to
 *    the first collection, or an empty-dashboard state if there are none."
 *
 * Splitting it this way keeps both halves pure and independently testable
 * without any DOM/hashchange or dexie-react-hooks mocking.
 */

export type ParsedRoute =
  | { kind: "collection"; id: string }
  | { kind: "sessions" }
  | { kind: "settings" }
  | { kind: "root" };

const COLLECTION_HASH = /^\/c\/(.+)$/;

/** Parses `location.hash` (leading "#" optional). Unrecognized or empty input is "root". */
export function parseHash(hash: string): ParsedRoute {
  const trimmed = hash.replace(/^#/, "");
  if (trimmed === "/sessions") return { kind: "sessions" };
  if (trimmed === "/settings") return { kind: "settings" };
  const match = COLLECTION_HASH.exec(trimmed);
  if (match) {
    try {
      return { kind: "collection", id: decodeURIComponent(match[1]!) };
    } catch {
      // Malformed percent-encoding (e.g. "#/c/%zz") — a hand-mangled URL.
      // Treat it as no route at all rather than letting the URIError take
      // down the whole dashboard render.
      return { kind: "root" };
    }
  }
  return { kind: "root" };
}

/**
 * T20: the popup's "Save all + organize" secondary action deep-links into
 * the dashboard as `#/c/<id>?organize=1` — a query string glued onto the
 * HASH itself (this is a hash router; there is no real `location.search`
 * hop here), so it needs its own parse step separate from `parseHash`
 * above. `useRoute` checks this on the RAW hash before stripping it (so
 * `parseHash`/`resolveRoute` only ever see a clean `#/c/<id>`), consumes it
 * exactly once, then calls `stripOrganizeFlag` to rewrite `location.hash` —
 * so a page reload, back-navigation, or a second look at the same URL never
 * replays the auto-open.
 */
const ORGANIZE_FLAG_PARAM = "organize";
const ORGANIZE_FLAG_VALUE = "1";

/** True when `hash` carries a "?organize=1" suffix. Pure. */
export function hasOrganizeFlag(hash: string): boolean {
  const qIndex = hash.indexOf("?");
  if (qIndex === -1) return false;
  const query = new URLSearchParams(hash.slice(qIndex + 1));
  return query.get(ORGANIZE_FLAG_PARAM) === ORGANIZE_FLAG_VALUE;
}

/** Removes the "organize" param from `hash`'s query suffix (dropping the "?" entirely once nothing's left in it) — the exact inverse of however the flag got added. Pure. Any OTHER query param survives, though nothing in this codebase sets one today. */
export function stripOrganizeFlag(hash: string): string {
  const qIndex = hash.indexOf("?");
  if (qIndex === -1) return hash;
  const base = hash.slice(0, qIndex);
  const query = new URLSearchParams(hash.slice(qIndex + 1));
  query.delete(ORGANIZE_FLAG_PARAM);
  const rest = query.toString();
  return rest ? `${base}?${rest}` : base;
}

export type ResolvedRoute =
  | { kind: "collection"; id: string }
  | { kind: "sessions" }
  | { kind: "settings" }
  | { kind: "not-found"; fallbackId: string | null }
  | { kind: "empty" };

/**
 * Resolves a parsed route against the live list of collection ids (ordered
 * by position — `collectionIds[0]` is "the first collection").
 *
 * - `collection` routes whose id isn't live become `not-found`, carrying the
 *   first live id as a fallback (or `null` if there are none left at all).
 * - `root` (no hash, or an unrecognized one) defaults to the first
 *   collection, or `empty` when there are no collections yet.
 */
export function resolveRoute(parsed: ParsedRoute, collectionIds: string[]): ResolvedRoute {
  switch (parsed.kind) {
    case "sessions":
      return { kind: "sessions" };
    case "settings":
      return { kind: "settings" };
    case "collection":
      return collectionIds.includes(parsed.id)
        ? { kind: "collection", id: parsed.id }
        : { kind: "not-found", fallbackId: collectionIds[0] ?? null };
    case "root":
      return collectionIds.length > 0 ? { kind: "collection", id: collectionIds[0]! } : { kind: "empty" };
  }
}

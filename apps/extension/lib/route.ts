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

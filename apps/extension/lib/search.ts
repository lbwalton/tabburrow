import fuzzysort from "fuzzysort";
import type { BurrowDB, Collection, Link } from "@tabburrow/core";
import { getDB, listCollections } from "@tabburrow/core";

export interface SearchResults {
  collections: Collection[];
  links: (Link & { collectionName: string })[];
}

/**
 * Max results returned TOTAL (collections + links combined), after
 * score-ranking both kinds on one shared scale.
 *
 * Raised from 20 for cross-folder open-all (#17): the driving case is "every
 * client's Meta Business Manager link at once", and with a folder per client
 * that set alone can pass 20. A cap that silently truncated it would make
 * "Open all" quietly mean "open all except the clients that didn't fit" —
 * the one failure mode this feature can't have. 100 is still low enough to
 * keep `rankSearch` a trivial in-memory sort and the listbox scrollable
 * rather than endless.
 */
export const MAX_SEARCH_RESULTS = 100;

/**
 * Whether a search surface should show its "No results" message right now.
 * Search is debounced + async, so on every fresh keystroke the RESULTS
 * state still belongs to the previous query (or is empty on a first
 * search) — a zero `total` in that window means "don't know yet", not "no
 * results", and rendering the message then flashes a false negative for
 * the debounce-plus-query duration. `settledQuery` is the exact query
 * string whose `searchAll` response last landed (callers reset it to ""
 * alongside their results state): only when it equals the live `query`
 * does a zero total genuinely mean no results.
 *
 * Returns "no-results" when the message should show, "none" otherwise
 * (empty/whitespace query, still pending, or there ARE results).
 */
export function emptyStateFor(query: string, settledQuery: string, total: number): "none" | "no-results" {
  if (!query.trim()) return "none";
  if (query !== settledQuery) return "none"; // pending: results are stale or absent, not "none found"
  return total === 0 ? "no-results" : "none";
}

// A link's title/collection's name is the strongest signal a match is
// actually what the user meant; url and tag matches are real but weaker
// signals, so their raw fuzzysort score is discounted before entering the
// shared ranking — see the "weights a title match above a url/tag match"
// tests in search.test.ts for the exact mechanism this proves.
const URL_MATCH_WEIGHT = 0.6;
const TAG_MATCH_WEIGHT = 0.5;

interface ScoredEntry {
  kind: "collection" | "link";
  score: number;
  /** Original push order (collections first in their input order, then links in theirs) — the tie-break for equal scores, so ranking never depends on Array.prototype.sort's stability guarantee alone. */
  order: number;
  collection?: Collection;
  link?: Link & { collectionName: string };
}

/**
 * The pure, deterministic ranking core: fuzzysort runs entirely in here, on
 * plain in-memory arrays — no IndexedDB, no `chrome.*`, safe to unit test
 * directly (see search.test.ts). `searchAll` below is the thin IO wrapper
 * that loads the arrays this expects and calls straight through.
 *
 * Every collection/link is scored independently against `q`:
 * - A collection's only signal is its `name`.
 * - A link's signal is the BEST of its title match (full weight), its url
 *   match (`URL_MATCH_WEIGHT`), and its joined-tags match
 *   (`TAG_MATCH_WEIGHT`) — whichever field matched best after weighting
 *   wins, so a link can surface via title OR url OR tags, but a title
 *   match always outranks an equally-strong url/tag match on another link.
 *
 * Non-matches (fuzzysort returns `null` for every field) are dropped
 * entirely, not scored as 0 — a collection/link that doesn't match `q` at
 * all should never appear, regardless of how weak the weakest real match
 * in the result set is.
 *
 * Collections and links are ranked together on ONE shared score scale, THEN
 * capped to `MAX_SEARCH_RESULTS` total, THEN split back into the two
 * `SearchResults` arrays (each preserving its post-cap rank order) for
 * display grouping — a weak collection can lose its spot in the cap to a
 * strong link match, and vice versa; there's no "collections always win a
 * slot" rule.
 */
export function rankSearch(
  collections: Collection[],
  linksWithNames: (Link & { collectionName: string })[],
  q: string,
): SearchResults {
  const query = q.trim();
  if (!query) return { collections: [], links: [] };

  const entries: ScoredEntry[] = [];
  let order = 0;

  for (const collection of collections) {
    const match = fuzzysort.single(query, collection.name);
    if (match) entries.push({ kind: "collection", score: match.score, order: order++, collection });
  }

  for (const l of linksWithNames) {
    const titleMatch = fuzzysort.single(query, l.title);
    const urlMatch = fuzzysort.single(query, l.url);
    const tagMatch = l.tags.length > 0 ? fuzzysort.single(query, l.tags.join(" ")) : null;

    const candidateScores: number[] = [];
    if (titleMatch) candidateScores.push(titleMatch.score);
    if (urlMatch) candidateScores.push(urlMatch.score * URL_MATCH_WEIGHT);
    if (tagMatch) candidateScores.push(tagMatch.score * TAG_MATCH_WEIGHT);
    if (candidateScores.length === 0) continue; // matched nothing — drop, don't score as 0

    entries.push({ kind: "link", score: Math.max(...candidateScores), order: order++, link: l });
  }

  entries.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.order - b.order));
  const top = entries.slice(0, MAX_SEARCH_RESULTS);

  return {
    collections: top.filter((e) => e.kind === "collection").map((e) => e.collection!),
    links: top.filter((e) => e.kind === "link").map((e) => e.link!),
  };
}

/**
 * IO wrapper: loads every live collection and link (repos/raw table reads
 * already exclude tombstones — `listCollections` via the repo, and `links`
 * filtered on `deletedAt === null` here directly off `db.links`, the same
 * "bypass the per-collection repo function for a full-table read" precedent
 * `lib/dashboard.ts`'s `countLinksByCollection` already established, since
 * `packages/core` has no "every link across every collection" repo query),
 * joins each link to its collection's name, and hands both arrays to
 * `rankSearch`. NOT unit tested here — same precedent as `countLinksByCollection`
 * / `lib/restore.ts`'s `openLinks` / `lib/tabs.ts`'s `getCurrentTab`: this
 * package's vitest config deliberately does no IndexedDB/chrome.* mocking.
 */
export async function searchAll(q: string, db: BurrowDB = getDB()): Promise<SearchResults> {
  if (!q.trim()) return { collections: [], links: [] };

  const [collections, allLinks] = await Promise.all([listCollections(db), db.links.toArray()]);
  const nameById = new Map(collections.map((c) => [c.id, c.name]));
  const linksWithNames = allLinks
    .filter((l) => l.deletedAt === null)
    .map((l) => ({ ...l, collectionName: nameById.get(l.collectionId) ?? "" }));

  return rankSearch(collections, linksWithNames, q);
}

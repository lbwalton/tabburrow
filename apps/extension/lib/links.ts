import type { BurrowDB } from "@tabburrow/core";
import { getDB, listLinks, moveLink } from "@tabburrow/core";

/** The link grid's sort menu. "manual" is the drag-ordered `position` column; "name"/"date" are view-only sorts that never touch `position`. */
export type SortMode = "manual" | "name" | "date";

const SORT_MODES: readonly SortMode[] = ["manual", "name", "date"];

function isSortMode(value: string): value is SortMode {
  return (SORT_MODES as readonly string[]).includes(value);
}

/** Reads a stored sort-mode value (from `meta`, so it may be `null`/garbage from a future version) back into a `SortMode`, defaulting to "manual". */
export function parseSortMode(value: string | null | undefined): SortMode {
  return value !== null && value !== undefined && isSortMode(value) ? value : "manual";
}

/** The `meta` key a collection's sort-mode choice is persisted under. */
export function sortMetaKey(collectionId: string): string {
  return `sort:${collectionId}`;
}

/**
 * Free-text tag input (comma-separated) -> a clean tag list: trimmed,
 * lowercased, empty entries dropped, duplicates collapsed onto their first
 * occurrence. Order of the surviving tags is preserved.
 */
export function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of raw.split(",")) {
    const tag = part.trim().toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

/**
 * A link's URL -> a lowercased hostname with a leading "www." stripped, for
 * the card's domain line (e.g. "https://www.Example.com/x" -> "example.com").
 * Falls back to the raw (lowercased) input for a URL the platform can't
 * parse, rather than throwing.
 */
export function formatHost(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return url.toLowerCase();
  }
}

/**
 * View-only ordering for the grid's "name"/"date" sort modes — never
 * reorders `position` (that only happens via drag, in "manual" mode) and
 * never mutates the input. "manual" is a deliberate no-op: callers already
 * have the position-ordered list (from `listLinks`) and should just use it
 * directly rather than calling this.
 */
export function sortLinksForView<T extends { title: string; createdAt: number }>(
  links: T[],
  mode: SortMode,
): T[] {
  if (mode === "manual") return links;
  const copy = [...links];
  if (mode === "name") {
    copy.sort((a, b) => a.title.localeCompare(b.title));
  } else {
    copy.sort((a, b) => b.createdAt - a.createdAt); // newest first
  }
  return copy;
}

/**
 * Moves `linkId` into `targetCollectionId`, appended after whichever link is
 * currently last there (or first, if the target is empty yet). Looks the
 * target's order up fresh on every call — so a caller doing several of these
 * in a row (the grid's cross-collection drag, and the bulk bar's "Move to…")
 * MUST `await` each one sequentially rather than `Promise.all`-ing them, or
 * they'll all read the same "current last" and collide instead of chaining.
 *
 * Deliberately not `moveLink(linkId, targetCollectionId, null, null)`: that
 * pins every moved link to the exact same fractional-index midpoint
 * (`positionBetween(null, null)`), which only lands "at the end" for a
 * collection that's currently empty — for a populated one it can sort
 * *before* existing rows. Looking up the real last link avoids that.
 */
export async function appendLinkToCollection(
  linkId: string,
  targetCollectionId: string,
  db: BurrowDB = getDB(),
): Promise<void> {
  const targetLinks = await listLinks(targetCollectionId, db);
  const lastId = targetLinks.length > 0 ? targetLinks[targetLinks.length - 1]!.id : null;
  await moveLink(linkId, targetCollectionId, lastId, null, db);
}

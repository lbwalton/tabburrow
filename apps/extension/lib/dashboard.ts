import type { BurrowDB } from "@tabburrow/core";
import { getDB } from "@tabburrow/core";

/** The hash-route fragment for a collection, e.g. "#/c/<id>" — single source of truth for `dashboardCollectionPath` and the dashboard's own rail/router navigation. */
export function collectionHash(id: string): string {
  return `#/c/${id}`;
}

/**
 * dashboard.html hash-route for a collection. Emitting the format now per
 * the Task 7 brief; the route itself is wired up in T8 (dashboard shell).
 */
export function dashboardCollectionPath(id: string): string {
  return `dashboard.html${collectionHash(id)}`;
}

/** Full extension-origin URL, for chrome.tabs.create. */
export function dashboardCollectionUrl(id: string): string {
  return chrome.runtime.getURL(`/${dashboardCollectionPath(id)}`);
}

/**
 * Live link counts per collection, in one table scan rather than one query
 * per collection — the pattern flagged as a scaling concern for RecentList
 * in Task 7 (5 rows there; the rail can have far more). dexie-react-hooks
 * still tracks this reactively since it reads `db.links` directly.
 */
export async function countLinksByCollection(db: BurrowDB = getDB()): Promise<Map<string, number>> {
  const rows = await db.links.toArray();
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.deletedAt !== null) continue;
    counts.set(row.collectionId, (counts.get(row.collectionId) ?? 0) + 1);
  }
  return counts;
}

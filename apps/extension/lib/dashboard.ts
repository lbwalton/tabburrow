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
 * Full extension-origin URL for a collection with the T20 auto-open flag
 * appended (`#/c/<id>?organize=1`) — the popup's "Save all + organize"
 * secondary action opens exactly this, and the dashboard's `useRoute`
 * (lib/route.ts's `hasOrganizeFlag`/`stripOrganizeFlag`) consumes it to
 * auto-open AiOrganizeDialog for that collection.
 */
export function dashboardCollectionOrganizeUrl(id: string): string {
  return chrome.runtime.getURL(`/dashboard.html${collectionHash(id)}?organize=1`);
}

/** dashboard.html hash-route for Settings — see lib/route.ts's `parseHash`. */
export function dashboardSettingsPath(): string {
  return "dashboard.html#/settings";
}

/** Full extension-origin URL for the Settings pane, for chrome.tabs.create — used by the popup footer's signed-out "Sign in" link (T16). */
export function dashboardSettingsUrl(): string {
  return chrome.runtime.getURL(`/${dashboardSettingsPath()}`);
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

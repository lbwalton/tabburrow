import type { Page } from "@playwright/test";

/**
 * Direct IndexedDB seeding helpers, for scenarios where driving the real UI
 * would be too slow (200 links) or isn't the thing under test (crash-restore
 * flag simulation). These write straight into the "tabburrow" database's
 * object stores via the raw `indexedDB` API — NOT through Dexie/`@tabburrow/core`
 * (page.evaluate can't reach into the app's bundled module graph) — so the
 * shapes here must be kept in sync with `packages/core/src/types.ts` and
 * `packages/core/src/db.ts` by hand.
 *
 * Must be called on a page that has already loaded dashboard.html or
 * popup.html at least once in this browsing session: that's what causes
 * Dexie to create the "tabburrow" database and its object stores/indexes in
 * the first place (`indexedDB.open("tabburrow")` below opens whatever
 * version already exists — it does not declare a schema itself).
 */

export interface SeedCollection {
  id: string;
  name: string;
  accent?: string | null;
  position: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface SeedLink {
  id: string;
  collectionId: string;
  url: string;
  title: string;
  position: string;
  note?: string | null;
  tags?: string[];
  createdAt?: number;
  updatedAt?: number;
}

/** Zero-padded, always-non-"0"-terminated position keys, sortable as plain strings for up to 999,999 items — good enough for seeded fixture data (see fractional-index.ts's docstring on why a trailing "0" key is invalid). */
export function seedPosition(index: number): string {
  return `${String(index + 1).padStart(6, "0")}1`;
}

export async function seedCollectionsAndLinks(
  page: Page,
  collections: SeedCollection[],
  links: SeedLink[],
): Promise<void> {
  await page.evaluate(
    ({ collections, links }) => {
      return new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("tabburrow");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const now = Date.now();
          const tx = db.transaction(["collections", "links"], "readwrite");
          const collStore = tx.objectStore("collections");
          const linkStore = tx.objectStore("links");
          for (const c of collections) {
            collStore.put({
              id: c.id,
              name: c.name,
              accent: c.accent ?? null,
              position: c.position,
              isShared: false,
              shareSlug: null,
              createdAt: c.createdAt ?? now,
              updatedAt: c.updatedAt ?? now,
              deletedAt: null,
            });
          }
          for (const l of links) {
            linkStore.put({
              id: l.id,
              collectionId: l.collectionId,
              url: l.url,
              title: l.title,
              faviconUrl: null,
              note: l.note ?? null,
              tags: l.tags ?? [],
              position: l.position,
              createdAt: l.createdAt ?? now,
              updatedAt: l.updatedAt ?? now,
              deletedAt: null,
            });
          }
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    },
    { collections, links },
  );
}

/** Writes a `meta` key/value row directly (crash-detection flags, theme, sort mode, etc. — see `packages/core/src/repo/meta.ts`'s shape: `{key, value}`). */
export async function seedMeta(page: Page, entries: Record<string, string>): Promise<void> {
  await page.evaluate((entries) => {
    return new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("tabburrow");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(["meta"], "readwrite");
        const store = tx.objectStore("meta");
        for (const [key, value] of Object.entries(entries)) store.put({ key, value });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, entries);
}

export interface SeedSessionWindow {
  tabs: Array<{ url: string; title: string; pinned?: boolean }>;
}

export interface SeedSnapshot {
  id: string;
  name?: string | null;
  kind: "manual" | "auto";
  windows: SeedSessionWindow[];
  createdAt?: number;
}

export async function seedSnapshots(page: Page, snapshots: SeedSnapshot[]): Promise<void> {
  await page.evaluate((snapshots) => {
    return new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("tabburrow");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const now = Date.now();
        const tx = db.transaction(["sessions"], "readwrite");
        const store = tx.objectStore("sessions");
        for (const s of snapshots) {
          store.put({
            id: s.id,
            name: s.name ?? null,
            kind: s.kind,
            windows: s.windows,
            createdAt: s.createdAt ?? now,
          });
        }
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, snapshots);
}

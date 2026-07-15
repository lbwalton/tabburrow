import type { BurrowDB } from "../db";
import { getDB } from "../db";
import type { Link, TabInfo } from "../types";
import { positionBetween } from "../fractional-index";
import { enqueueOp } from "./op-queue";
import { maxPosition, sortByPosition } from "./util";

/**
 * Appends `tabs` to the end of `collectionId`, one `positionBetween(lastKey,
 * null)` call per new row (so successive appends stay ordered and short).
 * Dedupes by URL among the collection's currently non-tombstoned links: an
 * existing live link with a matching URL has its `title` (and `faviconUrl`,
 * only when the incoming tab provides one) updated in place instead of a
 * duplicate being inserted. A tombstoned link with the same URL is NOT
 * considered a match — a fresh live link is created instead.
 *
 * Duplicate URLs within the same `tabs` array are also collapsed onto a
 * single resulting row.
 *
 * Returns one Link per input tab (updated or newly created), in input order.
 */
export async function saveTabs(
  collectionId: string,
  tabs: TabInfo[],
  db: BurrowDB = getDB(),
): Promise<Link[]> {
  return db.transaction("rw", db.links, db.pendingOps, async () => {
    const existing = await db.links.where("collectionId").equals(collectionId).toArray();
    const byUrl = new Map<string, Link>();
    for (const link of existing) {
      if (link.deletedAt === null) byUrl.set(link.url, link);
    }
    let lastPosition = maxPosition(existing);
    const now = Date.now();
    const result: Link[] = [];

    for (const tab of tabs) {
      const match = byUrl.get(tab.url);
      if (match) {
        const patch: Partial<Link> = { title: tab.title, updatedAt: now };
        if (tab.faviconUrl !== undefined) patch.faviconUrl = tab.faviconUrl;
        await db.links.update(match.id, patch);
        await enqueueOp(db, "links", match.id);
        const updated: Link = { ...match, ...patch };
        byUrl.set(tab.url, updated);
        result.push(updated);
      } else {
        lastPosition = positionBetween(lastPosition, null);
        const link: Link = {
          id: crypto.randomUUID(),
          collectionId,
          url: tab.url,
          title: tab.title,
          faviconUrl: tab.faviconUrl ?? null,
          note: null,
          tags: [],
          position: lastPosition,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        await db.links.add(link);
        await enqueueOp(db, "links", link.id);
        byUrl.set(tab.url, link);
        result.push(link);
      }
    }

    return result;
  });
}

export async function updateLink(
  id: string,
  patch: Partial<Pick<Link, "title" | "note" | "tags">>,
  db: BurrowDB = getDB(),
): Promise<void> {
  return db.transaction("rw", db.links, db.pendingOps, async () => {
    await db.links.update(id, { ...patch, updatedAt: Date.now() });
    await enqueueOp(db, "links", id);
  });
}

/**
 * Repositions a link between its new neighbors (looked up the same way as
 * `moveCollection`), optionally moving it into another collection first.
 */
export async function moveLink(
  id: string,
  toCollectionId: string,
  beforeId: string | null,
  afterId: string | null,
  db: BurrowDB = getDB(),
): Promise<void> {
  return db.transaction("rw", db.links, db.pendingOps, async () => {
    const [before, after] = await Promise.all([
      beforeId ? db.links.get(beforeId) : undefined,
      afterId ? db.links.get(afterId) : undefined,
    ]);
    const position = positionBetween(before?.position ?? null, after?.position ?? null);
    await db.links.update(id, { collectionId: toCollectionId, position, updatedAt: Date.now() });
    await enqueueOp(db, "links", id);
  });
}

export async function softDeleteLinks(ids: string[], db: BurrowDB = getDB()): Promise<void> {
  return db.transaction("rw", db.links, db.pendingOps, async () => {
    const now = Date.now();
    for (const id of ids) {
      await db.links.update(id, { deletedAt: now, updatedAt: now });
      await enqueueOp(db, "links", id);
    }
  });
}

export async function restoreLinks(ids: string[], db: BurrowDB = getDB()): Promise<void> {
  return db.transaction("rw", db.links, db.pendingOps, async () => {
    const now = Date.now();
    for (const id of ids) {
      await db.links.update(id, { deletedAt: null, updatedAt: now });
      await enqueueOp(db, "links", id);
    }
  });
}

/** Live (non-tombstoned) links of a collection, ordered by position ascending. */
export async function listLinks(collectionId: string, db: BurrowDB = getDB()): Promise<Link[]> {
  const rows = await db.links.where("collectionId").equals(collectionId).toArray();
  return sortByPosition(rows.filter((l) => l.deletedAt === null));
}

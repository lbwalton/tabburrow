import type { BurrowDB } from "../db";
import { getDB } from "../db";
import type { Link, TabInfo } from "../types";
import { positionBetween } from "../fractional-index";
import { isStorableLinkUrl, normalizeUrl, UNSUPPORTED_LINK_URL_MESSAGE } from "../url";
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
    const resultUrls: string[] = [];

    for (const tab of tabs) {
      const match = byUrl.get(tab.url);
      if (match) {
        const patch: Partial<Link> = { title: tab.title, updatedAt: now };
        if (tab.faviconUrl !== undefined) patch.faviconUrl = tab.faviconUrl;
        await db.links.update(match.id, patch);
        await enqueueOp(db, "links", match.id);
        byUrl.set(tab.url, { ...match, ...patch });
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
      }
      resultUrls.push(tab.url);
    }

    // Resolve the returned array only AFTER the whole batch has been
    // applied, so a URL appearing more than once in `tabs` yields the FINAL
    // persisted row state in every one of its slots, not a stale snapshot
    // captured before a later duplicate updated the row again.
    return resultUrls.map((url) => byUrl.get(url)!);
  });
}

/**
 * Replaces every live link in `collectionId` with `tabs`, in one transaction.
 * First tombstones each currently non-tombstoned link (set `deletedAt` +
 * `updatedAt` to now, one `enqueueOp` per row that actually changed — the same
 * discipline as `softDeleteLinks`), then appends `tabs` exactly the way
 * `saveTabs` appends new rows: fresh positions from `positionBetween(maxPosition
 * (allRows), null)` per new row. `maxPosition` scans ALL of the collection's
 * rows (the just-created tombstones included, whose positions are untouched by
 * tombstoning), so the new keys sort strictly after every tombstoned row and
 * can never collide with one that is later restored.
 *
 * This is an overwrite, not a merge: tombstoned rows are never revived, so a
 * new tab whose URL matches an old (now tombstoned) link still becomes a fresh
 * live row. Duplicate URLs WITHIN the incoming `tabs` array collapse onto a
 * single resulting row (same as `saveTabs`).
 *
 * Returns one Link per input tab (newly created, or the shared row for
 * within-batch duplicates), in input order.
 */
export async function overwriteTabs(
  collectionId: string,
  tabs: TabInfo[],
  db: BurrowDB = getDB(),
): Promise<Link[]> {
  return db.transaction("rw", db.links, db.pendingOps, async () => {
    const existing = await db.links.where("collectionId").equals(collectionId).toArray();
    const now = Date.now();

    // Tombstone every currently-live link. Only enqueue for rows that actually
    // changed, mirroring softDeleteLinks.
    for (const link of existing) {
      if (link.deletedAt !== null) continue;
      const modified = await db.links.update(link.id, { deletedAt: now, updatedAt: now });
      if (modified > 0) await enqueueOp(db, "links", link.id);
    }

    // Append the new tabs like saveTabs. `maxPosition(existing)` scans every
    // row (tombstones included); tombstoning never touches `position`, so this
    // is the same max the table holds now — the fresh keys sort strictly after
    // all of them. No live rows remain, so `byUrl` starts empty and only
    // collapses duplicates within this batch (tombstoned rows are never
    // revived — this is an overwrite, not a merge).
    let lastPosition = maxPosition(existing);
    const byUrl = new Map<string, Link>();
    const resultUrls: string[] = [];

    for (const tab of tabs) {
      const match = byUrl.get(tab.url);
      if (match) {
        const patch: Partial<Link> = { title: tab.title, updatedAt: now };
        if (tab.faviconUrl !== undefined) patch.faviconUrl = tab.faviconUrl;
        await db.links.update(match.id, patch);
        await enqueueOp(db, "links", match.id);
        byUrl.set(tab.url, { ...match, ...patch });
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
      }
      resultUrls.push(tab.url);
    }

    // Resolve returned rows only after the whole batch applies, so a URL
    // appearing twice yields the FINAL persisted state in both slots.
    return resultUrls.map((url) => byUrl.get(url)!);
  });
}

/**
 * Appends a single manually-entered link to the end of `collectionId`.
 *
 * The URL is run through `normalizeUrl` FIRST, so a bare domain typed as
 * "nike.com" is stored as "https://nike.com". Storing it verbatim was issue
 * #24: a schemeless string is a relative reference, and `chrome.tabs.create`
 * resolves it against the extension's own origin, opening
 * `chrome-extension://<id>/nike.com` instead of the site.
 *
 * THROWS `UNSUPPORTED_LINK_URL_MESSAGE` when the normalized URL isn't
 * storable (see `isStorableLinkUrl`): a scripting scheme like `javascript:`
 * or `data:`, or free text that could never be opened. Callers surface the
 * message directly — it's written for the user.
 *
 * When `title` is missing or empty it defaults to the NORMALIZED URL's
 * hostname (`new URL(url).hostname`) — so a bare "nike.com" titles itself
 * "nike.com" rather than the whole "https://nike.com".
 *
 * Dedupes by URL against the collection's non-tombstoned links exactly like
 * `saveTabs`, comparing NORMALIZED URLs so re-adding "nike.com" matches the
 * "https://nike.com" row a previous add created rather than inserting a
 * near-duplicate: a matching live link has its `title` updated in place (op
 * enqueued) and is returned instead of a duplicate being inserted.
 *
 * Returns the resulting Link (updated live match, or the newly created row).
 */
export async function addLink(
  collectionId: string,
  input: { url: string; title?: string },
  db: BurrowDB = getDB(),
): Promise<Link> {
  return db.transaction("rw", db.links, db.pendingOps, async () => {
    const now = Date.now();
    const url = normalizeUrl(input.url);
    // Refuse a URL that could never be opened, or whose scheme is a scripting
    // vector once the collection is publicly shared (`javascript:`, `data:`).
    // See `isStorableLinkUrl` — this is the input half of that defence.
    if (!isStorableLinkUrl(url)) {
      throw new Error(UNSUPPORTED_LINK_URL_MESSAGE);
    }
    const title = input.title || hostnameOf(url);

    const existing = await db.links.where("collectionId").equals(collectionId).toArray();
    const match = existing.find((l) => l.deletedAt === null && l.url === url);
    if (match) {
      const patch: Partial<Link> = { title, updatedAt: now };
      await db.links.update(match.id, patch);
      await enqueueOp(db, "links", match.id);
      return { ...match, ...patch };
    }

    const link: Link = {
      id: crypto.randomUUID(),
      collectionId,
      url,
      title,
      faviconUrl: null,
      note: null,
      tags: [],
      position: positionBetween(maxPosition(existing), null),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await db.links.add(link);
    await enqueueOp(db, "links", link.id);
    return link;
  });
}

/** The URL's hostname, or the raw string if it can't be parsed as a URL. */
function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export async function updateLink(
  id: string,
  patch: Partial<Pick<Link, "title" | "note" | "tags">>,
  db: BurrowDB = getDB(),
): Promise<void> {
  return db.transaction("rw", db.links, db.pendingOps, async () => {
    // Dexie's update() resolves to the number of modified rows (0 when the
    // id doesn't exist) — only enqueue an op when a row actually changed.
    const modified = await db.links.update(id, { ...patch, updatedAt: Date.now() });
    if (modified > 0) await enqueueOp(db, "links", id);
  });
}

/**
 * Repositions a link between its new neighbors (looked up the same way as
 * `moveCollection`), optionally moving it into another collection first.
 * Throws if the moved link does not exist.
 */
export async function moveLink(
  id: string,
  toCollectionId: string,
  beforeId: string | null,
  afterId: string | null,
  db: BurrowDB = getDB(),
): Promise<void> {
  return db.transaction("rw", db.links, db.pendingOps, async () => {
    const [row, before, after] = await Promise.all([
      db.links.get(id),
      beforeId ? db.links.get(beforeId) : undefined,
      afterId ? db.links.get(afterId) : undefined,
    ]);
    if (!row) {
      throw new Error(`moveLink: no link with id "${id}"`);
    }
    const position = positionBetween(before?.position ?? null, after?.position ?? null);
    await db.links.update(id, { collectionId: toCollectionId, position, updatedAt: Date.now() });
    await enqueueOp(db, "links", id);
  });
}

/**
 * Moves a link into `toCollectionId`, positioned after everything currently
 * there — computed from ALL of the target's rows (tombstoned included), the
 * same `maxPosition` policy `saveTabs` appends with (see maxPosition's
 * docstring). Deriving "last" from live rows only would land exactly ON a
 * tombstoned row's position whenever the tombstone holds the greatest key,
 * and a later restore would then produce two rows with equal positions and
 * nondeterministic order. Throws if the moved link does not exist.
 */
export async function moveLinkToEnd(
  id: string,
  toCollectionId: string,
  db: BurrowDB = getDB(),
): Promise<void> {
  return db.transaction("rw", db.links, db.pendingOps, async () => {
    const row = await db.links.get(id);
    if (!row) {
      throw new Error(`moveLinkToEnd: no link with id "${id}"`);
    }
    const targetRows = await db.links.where("collectionId").equals(toCollectionId).toArray();
    // No need to exclude the moved row itself when it's already in the
    // target: if it holds the max, the new key is strictly greater than its
    // own old one — still "the end", still collision-free.
    const position = positionBetween(maxPosition(targetRows), null);
    await db.links.update(id, { collectionId: toCollectionId, position, updatedAt: Date.now() });
    await enqueueOp(db, "links", id);
  });
}

export async function softDeleteLinks(ids: string[], db: BurrowDB = getDB()): Promise<void> {
  return db.transaction("rw", db.links, db.pendingOps, async () => {
    const now = Date.now();
    for (const id of ids) {
      const modified = await db.links.update(id, { deletedAt: now, updatedAt: now });
      if (modified > 0) await enqueueOp(db, "links", id);
    }
  });
}

export async function restoreLinks(ids: string[], db: BurrowDB = getDB()): Promise<void> {
  return db.transaction("rw", db.links, db.pendingOps, async () => {
    const now = Date.now();
    for (const id of ids) {
      const modified = await db.links.update(id, { deletedAt: null, updatedAt: now });
      if (modified > 0) await enqueueOp(db, "links", id);
    }
  });
}

/** Live (non-tombstoned) links of a collection, ordered by position ascending. */
export async function listLinks(collectionId: string, db: BurrowDB = getDB()): Promise<Link[]> {
  const rows = await db.links.where("collectionId").equals(collectionId).toArray();
  return sortByPosition(rows.filter((l) => l.deletedAt === null));
}

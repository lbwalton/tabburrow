import type { BurrowDB } from "../db";
import { getDB } from "../db";
import type { Collection } from "../types";
import { positionBetween } from "../fractional-index";
import { enqueueOp } from "./op-queue";
import { maxPosition, sortByPosition } from "./util";

/**
 * Creates a collection, positioned after the current last collection
 * (tombstoned or not — see `maxPosition`). Throws if `name` is empty after
 * trimming. `accent` defaults to `null`.
 */
export async function createCollection(
  name: string,
  accent?: string,
  db: BurrowDB = getDB(),
): Promise<Collection> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("createCollection: name must not be empty");
  }

  return db.transaction("rw", db.collections, db.pendingOps, async () => {
    const last = maxPosition(await db.collections.toArray());
    const now = Date.now();
    const collection: Collection = {
      id: crypto.randomUUID(),
      name: trimmed,
      accent: accent ?? null,
      position: positionBetween(last, null),
      isShared: false,
      shareSlug: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await db.collections.add(collection);
    await enqueueOp(db, "collections", collection.id);
    return collection;
  });
}

export async function renameCollection(
  id: string,
  name: string,
  db: BurrowDB = getDB(),
): Promise<void> {
  return db.transaction("rw", db.collections, db.pendingOps, async () => {
    await db.collections.update(id, { name, updatedAt: Date.now() });
    await enqueueOp(db, "collections", id);
  });
}

export async function setCollectionAccent(
  id: string,
  accent: string | null,
  db: BurrowDB = getDB(),
): Promise<void> {
  return db.transaction("rw", db.collections, db.pendingOps, async () => {
    await db.collections.update(id, { accent, updatedAt: Date.now() });
    await enqueueOp(db, "collections", id);
  });
}

/**
 * Repositions a collection between its new neighbors. `beforeId`/`afterId`
 * are the ids of the rows that should end up immediately before/after it
 * (either may be `null` to mean "this end of the list"); their current
 * positions are looked up and `positionBetween` computes the new key.
 */
export async function moveCollection(
  id: string,
  beforeId: string | null,
  afterId: string | null,
  db: BurrowDB = getDB(),
): Promise<void> {
  return db.transaction("rw", db.collections, db.pendingOps, async () => {
    const [before, after] = await Promise.all([
      beforeId ? db.collections.get(beforeId) : undefined,
      afterId ? db.collections.get(afterId) : undefined,
    ]);
    const position = positionBetween(before?.position ?? null, after?.position ?? null);
    await db.collections.update(id, { position, updatedAt: Date.now() });
    await enqueueOp(db, "collections", id);
  });
}

/**
 * Tombstones the collection and cascades the SAME `deletedAt` timestamp to
 * all of its currently-live (non-tombstoned) links, so `restoreCollection`
 * can later tell "deleted by this cascade" apart from "was already deleted
 * for its own reason". Enqueues a PendingOp for every touched row.
 */
export async function softDeleteCollection(id: string, db: BurrowDB = getDB()): Promise<void> {
  return db.transaction("rw", db.collections, db.links, db.pendingOps, async () => {
    const now = Date.now();
    await db.collections.update(id, { deletedAt: now, updatedAt: now });
    await enqueueOp(db, "collections", id);

    const liveLinks = (await db.links.where("collectionId").equals(id).toArray()).filter(
      (link) => link.deletedAt === null,
    );
    for (const link of liveLinks) {
      await db.links.update(link.id, { deletedAt: now, updatedAt: now });
      await enqueueOp(db, "links", link.id);
    }
  });
}

/**
 * Undoes a `softDeleteCollection` cascade: clears the collection's tombstone
 * and, of its links, clears `deletedAt` ONLY on those whose `deletedAt`
 * exactly equals the collection's own tombstone timestamp (i.e. the links
 * that cascade actually touched). Links tombstoned independently, earlier or
 * later, are left alone. No-ops if the collection doesn't exist or isn't
 * currently tombstoned. Enqueues a PendingOp for every touched row.
 */
export async function restoreCollection(id: string, db: BurrowDB = getDB()): Promise<void> {
  return db.transaction("rw", db.collections, db.links, db.pendingOps, async () => {
    const collection = await db.collections.get(id);
    if (!collection || collection.deletedAt === null) return;
    const cascadeTimestamp = collection.deletedAt;
    const now = Date.now();

    await db.collections.update(id, { deletedAt: null, updatedAt: now });
    await enqueueOp(db, "collections", id);

    const cascadedLinks = (await db.links.where("collectionId").equals(id).toArray()).filter(
      (link) => link.deletedAt === cascadeTimestamp,
    );
    for (const link of cascadedLinks) {
      await db.links.update(link.id, { deletedAt: null, updatedAt: now });
      await enqueueOp(db, "links", link.id);
    }
  });
}

/** Live (non-tombstoned) collections, ordered by position ascending. */
export async function listCollections(db: BurrowDB = getDB()): Promise<Collection[]> {
  const rows = await db.collections.toArray();
  return sortByPosition(rows.filter((c) => c.deletedAt === null));
}

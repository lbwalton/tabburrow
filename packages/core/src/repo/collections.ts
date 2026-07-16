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
    // Dexie's update() resolves to the number of modified rows (0 when the
    // id doesn't exist) — only enqueue an op when a row actually changed.
    const modified = await db.collections.update(id, { name, updatedAt: Date.now() });
    if (modified > 0) await enqueueOp(db, "collections", id);
  });
}

export async function setCollectionAccent(
  id: string,
  accent: string | null,
  db: BurrowDB = getDB(),
): Promise<void> {
  return db.transaction("rw", db.collections, db.pendingOps, async () => {
    const modified = await db.collections.update(id, { accent, updatedAt: Date.now() });
    if (modified > 0) await enqueueOp(db, "collections", id);
  });
}

const SHARE_SLUG_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const SHARE_SLUG_LENGTH = 10;
/**
 * The largest multiple of the alphabet size that fits in a byte
 * (36 * 7 = 252). Bytes >= this are REJECTED rather than mapped: a plain
 * `byte % 36` over all 256 byte values would map them unevenly (the first
 * 256 % 36 = 4 characters would each have 8 source bytes, the other 32 only
 * 7), biasing slugs toward "0"-"3". Rejection sampling keeps every character
 * at exactly 7 source bytes — a uniform distribution.
 */
const SHARE_SLUG_REJECTION_BOUND = SHARE_SLUG_ALPHABET.length * Math.floor(256 / SHARE_SLUG_ALPHABET.length);

/**
 * Generates a share slug for `setShare`: 10 characters, uniformly random
 * over the lowercase-alphanumeric alphabet, via `crypto.getRandomValues`
 * with rejection sampling (see `SHARE_SLUG_REJECTION_BOUND`). Dependency-free
 * on purpose — `crypto.getRandomValues` exists in every runtime core targets
 * (browsers, extension pages/workers, and Node 20+ under vitest), whereas
 * the obvious library choice (nanoid v6) requires Node >= 22, above this
 * repo's engine floor and CI's pinned Node 20. The alphabet/length MUST
 * match the public web share page's slug validator (`apps/web/lib/share.ts`'s
 * `isValidShareSlug`, `/^[a-z0-9]{10}$/`) — a slug outside that shape would
 * 404 on its own share page the instant it synced. Both properties are
 * pinned by tests in test/repo.test.ts: an alphabet-conformance property
 * test (200 samples) and a distribution sanity test (all 36 characters
 * appear across 5000 samples).
 */
export function generateShareSlug(): string {
  let slug = "";
  while (slug.length < SHARE_SLUG_LENGTH) {
    // 2x oversampling per round: 252/256 of bytes are accepted, so one round
    // nearly always fills the remainder; the while loop guards the rare
    // shortfall (never an infinite spin — each accepted byte makes progress,
    // and P(all 20 bytes rejected) = (4/256)^20).
    const bytes = crypto.getRandomValues(new Uint8Array((SHARE_SLUG_LENGTH - slug.length) * 2));
    for (const byte of bytes) {
      if (byte >= SHARE_SLUG_REJECTION_BOUND) continue; // rejected — see the bound's docstring
      slug += SHARE_SLUG_ALPHABET[byte % SHARE_SLUG_ALPHABET.length]!;
      if (slug.length === SHARE_SLUG_LENGTH) break;
    }
  }
  return slug;
}

/**
 * Turns sharing on or off for a collection: an ordinary repo mutation with
 * the same shape as `setCollectionAccent` (bump `updatedAt`, enqueue a
 * PendingOp only when a row actually changed). The share-page-visible slug
 * itself comes from the caller (`generateShareSlug()` for turning sharing on
 * or rotating the link; `null` for turning it off) — this function does not
 * generate or validate slugs, it just persists whatever the caller decided.
 */
export async function setShare(
  id: string,
  share: { isShared: boolean; shareSlug: string | null },
  db: BurrowDB = getDB(),
): Promise<void> {
  return db.transaction("rw", db.collections, db.pendingOps, async () => {
    const modified = await db.collections.update(id, {
      isShared: share.isShared,
      shareSlug: share.shareSlug,
      updatedAt: Date.now(),
    });
    if (modified > 0) await enqueueOp(db, "collections", id);
  });
}

/**
 * Repositions a collection between its new neighbors. `beforeId`/`afterId`
 * are the ids of the rows that should end up immediately before/after it
 * (either may be `null` to mean "this end of the list"); their current
 * positions are looked up and `positionBetween` computes the new key.
 * Throws if the moved collection does not exist.
 */
export async function moveCollection(
  id: string,
  beforeId: string | null,
  afterId: string | null,
  db: BurrowDB = getDB(),
): Promise<void> {
  return db.transaction("rw", db.collections, db.pendingOps, async () => {
    const [row, before, after] = await Promise.all([
      db.collections.get(id),
      beforeId ? db.collections.get(beforeId) : undefined,
      afterId ? db.collections.get(afterId) : undefined,
    ]);
    if (!row) {
      throw new Error(`moveCollection: no collection with id "${id}"`);
    }
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
    const modified = await db.collections.update(id, { deletedAt: now, updatedAt: now });
    if (modified === 0) return; // nonexistent collection: nothing to tombstone or enqueue
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

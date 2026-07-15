import type { Collection, Link } from "../types";

/**
 * The minimal shape `mergeRow` needs to resolve a conflict between a local
 * and a remote copy of the same row: an id to match rows by, `updatedAt` for
 * last-write-wins ordering, and `deletedAt` so a tombstone can be recognized
 * regardless of which concrete table (`Collection`, `Link`, ...) it comes
 * from. `Collection` and `Link` both satisfy this structurally.
 */
export interface Syncable {
  id: string;
  updatedAt: number;
  deletedAt: number | null;
}

/**
 * The transport `SyncEngine` pushes to and pulls from. Implemented over
 * Supabase in Task 18 — this interface is what that transport binds to, so
 * its shape is verbatim-binding for this task.
 *
 * `pullSince` returns everything changed since `cursor` in a single
 * response; real pagination (for large deltas) is the transport
 * implementation's concern, not the engine's.
 */
export interface SyncTransport {
  pushCollections(rows: Collection[]): Promise<void>;
  pushLinks(rows: Link[]): Promise<void>;
  pullSince(cursor: number): Promise<{ collections: Collection[]; links: Link[]; serverNow: number }>;
}

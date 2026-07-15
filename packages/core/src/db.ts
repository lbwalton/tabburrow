import Dexie, { type Table } from "dexie";
import type { Collection, Link, SessionSnapshot, PendingOp } from "./types";

export class BurrowDB extends Dexie {
  collections!: Table<Collection, string>;
  links!: Table<Link, string>;
  sessions!: Table<SessionSnapshot, string>;
  pendingOps!: Table<PendingOp, number>;
  meta!: Table<{ key: string; value: string }, string>;

  constructor() {
    super("tabburrow");
    this.version(1).stores({
      collections: "id, position, updatedAt, deletedAt",
      links: "id, collectionId, position, updatedAt, deletedAt, url",
      sessions: "id, kind, createdAt",
      pendingOps: "++id, table, rowId",
      meta: "key",
    });
  }
}

let _db: BurrowDB | null = null;
export function getDB(): BurrowDB {
  return (_db ??= new BurrowDB());
}

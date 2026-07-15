import type { BurrowDB } from "../db";
import { getDB } from "../db";
import type { SessionSnapshot, SessionWindow } from "../types";

// Sessions are local-only: they never enqueue PendingOps (nothing here syncs).

export async function saveSnapshot(
  kind: "manual" | "auto",
  windows: SessionWindow[],
  name?: string,
  db: BurrowDB = getDB(),
): Promise<SessionSnapshot> {
  const snapshot: SessionSnapshot = {
    id: crypto.randomUUID(),
    name: name ?? null,
    kind,
    windows,
    createdAt: Date.now(),
  };
  await db.sessions.add(snapshot);
  return snapshot;
}

/** All snapshots, newest first. */
export async function listSnapshots(db: BurrowDB = getDB()): Promise<SessionSnapshot[]> {
  const rows = await db.sessions.toArray();
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

/** Hard delete (snapshots have no tombstone field). */
export async function deleteSnapshot(id: string, db: BurrowDB = getDB()): Promise<void> {
  await db.sessions.delete(id);
}

/** Keeps the `keep` newest snapshots of kind "auto"; hard-deletes the rest. Never touches "manual" snapshots. */
export async function pruneAutoSnapshots(keep: number, db: BurrowDB = getDB()): Promise<void> {
  return db.transaction("rw", db.sessions, async () => {
    const autos = await db.sessions.where("kind").equals("auto").toArray();
    autos.sort((a, b) => b.createdAt - a.createdAt);
    const toDelete = autos.slice(keep);
    for (const snapshot of toDelete) {
      await db.sessions.delete(snapshot.id);
    }
  });
}

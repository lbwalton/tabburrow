import type { BurrowDB, Collection, Link, SessionSnapshot } from "@tabburrow/core";
import { getDB, listCollections, listSnapshots } from "@tabburrow/core";

export interface BurrowExport {
  version: 1;
  exportedAt: number;
  collections: Collection[];
  links: Link[];
  sessions: SessionSnapshot[];
}

/**
 * Pure serializer: packages whatever rows it's handed into the export shape.
 * The caller decides what "whatever rows" means — `exportJson` below only
 * ever hands it LIVE (non-tombstoned) rows, since this export is the user's
 * manual escape hatch/backup, not a sync mirror, and there's no value in
 * shipping deleted rows out to a file.
 */
export function buildExport(collections: Collection[], links: Link[], sessions: SessionSnapshot[]): BurrowExport {
  return { version: 1, exportedAt: Date.now(), collections, links, sessions };
}

/** "tabburrow-export-YYYY-MM-DD.json", in local time (matches lib/sessions.ts's relativeTime date-formatting convention). */
export function exportFilename(now: number): string {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `tabburrow-export-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}

/** "N collections · N links · N sessions" (singular-aware) — the Settings pane's Data stats line. */
export function formatDataStats(collections: number, links: number, sessions: number): string {
  const c = collections === 1 ? "collection" : "collections";
  const l = links === 1 ? "link" : "links";
  const s = sessions === 1 ? "session" : "sessions";
  return `${collections} ${c} · ${links} ${l} · ${sessions} ${s}`;
}

/**
 * Reads every LIVE collection/link/session and serializes them to a
 * downloadable JSON Blob. Links are read via one full-table scan
 * (`db.links.toArray()`, filtered) rather than one `listLinks` call per
 * collection — same N+1-avoidance precedent as lib/dashboard.ts's
 * `countLinksByCollection`. Chrome-extension-page DB call, not unit tested
 * (see file-level precedent in lib/sessions.ts); `buildExport` above is the
 * pure, tested core.
 */
export async function exportJson(db: BurrowDB = getDB()): Promise<Blob> {
  const [collections, allLinks, sessions] = await Promise.all([
    listCollections(db),
    db.links.toArray(),
    listSnapshots(db),
  ]);
  const links = allLinks.filter((l) => l.deletedAt === null);
  const data = buildExport(collections, links, sessions);
  return new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
}

/** Triggers a browser download of `blob` via a temporary `<a download>` click — no `downloads` permission needed. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

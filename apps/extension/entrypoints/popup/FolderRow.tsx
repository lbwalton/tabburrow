import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getDB, listLinks, softDeleteCollection } from "@tabburrow/core";
import type { Collection } from "@tabburrow/core";
import { Badge, Button, Dialog } from "@tabburrow/ui";
import { isCssColorAccent } from "../../lib/accents";
import { sendSyncNudge } from "../../lib/sync-nudge";
import { OpenAllButton } from "./OpenAllButton";

export interface FolderRowProps {
  collection: Collection;
  /** Drill into this folder (row-body click / Enter). */
  onOpen: (collectionId: string) => void;
  /** Add the current tab to THIS folder in place (the "+" action). Resolves when saved. */
  onAddCurrent: (collectionId: string) => Promise<void>;
  /** False when there's no saveable current tab (e.g. a chrome:// page) — disables "+". */
  canAddCurrent: boolean;
  onError?: (message: string) => void;
}

/** A color dot when the accent is a CSS color, or the emoji glyph when it's an emoji accent. */
function AccentDot({ accent }: { accent: string | null }) {
  if (accent && !isCssColorAccent(accent)) {
    return (
      <span className="flex h-3 w-3 shrink-0 items-center justify-center text-[0.7rem] leading-none" aria-hidden="true">
        {accent}
      </span>
    );
  }
  // Unset folders default to an accent-orange dot with a soft orange underglow,
  // so the bullets carry the separation from the background now that rows are
  // bare at rest. A folder with its own accent keeps that color (and glows in
  // it). The glow is a color-mixed box-shadow, not a new hardcoded hex.
  const color = accent ?? "var(--accent)";
  return (
    <span
      className="h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: color, boxShadow: `0 0 7px 1px color-mix(in srgb, ${color} 55%, transparent)` }}
      aria-hidden="true"
    />
  );
}

/**
 * One folder in the home list: accent dot, name, live link count (Geist Mono
 * muted Badge, same as RecentList), and — revealed on hover and keyboard focus
 * — a "+" that adds the current tab to this folder in place, an open-all
 * icon, and a trash that deletes the whole folder. The row body drills into
 * the folder; the three action buttons sit outside that button so the markup
 * stays valid (no nested buttons). Unlike the "+" and open-all, the trash
 * confirms first (see `handleDelete`) and owns its write directly —
 * `softDeleteCollection` + `sendSyncNudge()` — rather than routing through
 * `FoldersHome`, mirroring how this component already owns its own
 * `listLinks` query instead of having links prop-drilled in.
 */
export function FolderRow({ collection, onOpen, onAddCurrent, canAddCurrent, onError }: FolderRowProps) {
  const db = getDB();
  const links = useLiveQuery(() => listLinks(collection.id, db), [collection.id]);
  const count = links?.length ?? 0;
  const [added, setAdded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleAddCurrent() {
    if (adding || !canAddCurrent) return;
    setAdding(true);
    try {
      await onAddCurrent(collection.id);
      setAdded(true);
      window.setTimeout(() => setAdded(false), 1500);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Could not add the current tab.");
    } finally {
      setAdding(false);
    }
  }

  /**
   * Confirmed, unlike `LinkRow`'s one-click trash: one link is cheap to lose,
   * a folder takes all of its links with it. Still fewer clicks than the old
   * path (⋯ → Delete folder → confirm), which is the point.
   */
  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    setDeleteOpen(false);
    try {
      await softDeleteCollection(collection.id, db);
      sendSyncNudge();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Could not delete the folder.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="group flex items-center gap-1 rounded-[var(--radius-card)] border border-transparent pr-1 transition-all duration-150 hover:border-[var(--line-hi)] hover:bg-[var(--surface-hover)] hover:shadow-[0_2px_10px_rgba(0,0,0,0.28)] focus-within:border-[var(--line-hi)] focus-within:bg-[var(--surface-hover)]">
        <button
          type="button"
          onClick={() => onOpen(collection.id)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-card)] px-2 py-1.5 text-left text-sm text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <AccentDot accent={collection.accent} />
          <span className="min-w-0 flex-1 truncate">{collection.name}</span>
          <Badge variant="muted">{count}</Badge>
        </button>

        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            aria-label={`Add current tab to ${collection.name}`}
            title={added ? "Added" : "Add current tab"}
            onClick={() => void handleAddCurrent()}
            disabled={!canAddCurrent || adding}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-[var(--text-2)] hover:bg-[var(--surface)] hover:text-[var(--text)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-40"
          >
            <span aria-hidden="true">{added ? "✓" : "+"}</span>
          </button>
          <span className="focus-within:opacity-100">
            <OpenAllButton urls={(links ?? []).map((l) => l.url)} collectionName={collection.name} onError={onError} compact />
          </span>
          {/*
            Last, not first — `LinkRow` puts its trash first, but `↗` (open every
            tab in this folder) is the most-used control on this row, and a
            folder-deleting trash sitting right beside it invites exactly the
            mis-click that costs the most. Distance from the hot control is worth
            the local inconsistency.
          */}
          <button
            type="button"
            aria-label={`Delete ${collection.name}`}
            title="Delete folder"
            onClick={() => setDeleteOpen(true)}
            disabled={deleting}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-[var(--text-2)] hover:bg-[var(--surface)] hover:text-[var(--accent)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-40"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m1 0-.7 12.1a1 1 0 0 1-1 .9H7.7a1 1 0 0 1-1-.9L6 7" />
            </svg>
          </button>
        </div>
      </div>

      {/*
        A sibling of the row `<div>` above, not nested inside it: that div's
        `group` hover/opacity rules (`opacity-0` at rest, border/shadow on
        hover) are scoped to its own descendants, and a native `<dialog>`
        rendered there would inherit them and stay invisibly at opacity-0
        once opened.
      */}
      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={`Delete "${collection.name}"?`}
        footer={
          <>
            <Button type="button" variant="ghost" size="sm" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button type="button" variant="danger" size="sm" onClick={() => void handleDelete()} disabled={deleting}>
              Delete
            </Button>
          </>
        }
      >
        <p>
          Delete {collection.name} and its {count} {count === 1 ? "link" : "links"}? This can&rsquo;t be undone.
        </p>
      </Dialog>
    </>
  );
}

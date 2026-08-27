import { useState } from "react";
import type { Collection, Link } from "@tabburrow/core";
import { getDB, moveLinkToEnd, softDeleteLinks } from "@tabburrow/core";
import { Button, Kbd } from "@tabburrow/ui";
import { openFailureMessage, openLinks } from "../../lib/restore";

export interface BulkBarProps {
  /** The selected links, already in current display order (so "Open all" and "Move to…" preserve it). */
  selectedLinks: Link[];
  currentCollectionId: string;
  collections: Collection[];
  onClear: () => void;
  onError: (message: string) => void;
  /** Notifies `App` after Delete succeeds, so it can show the 6s Undo toast (`restoreLinks`, positions intact). */
  onDeleted: (ids: string[]) => void;
}

/**
 * Slides up from the bottom of the main area once 1+ links are selected
 * (see the `.bulk-bar` `@starting-style` transition in `assets/tailwind.css`).
 * "Move to…" awaits `moveLinkToEnd` one link at a time — each call reads the
 * target's current max position fresh inside its own transaction, so
 * sequential awaits are what makes "preserving relative order" true;
 * `Promise.all`-ing them could interleave the read-then-write pairs.
 */
export function BulkBar({ selectedLinks, currentCollectionId, collections, onClear, onError, onDeleted }: BulkBarProps) {
  const db = getDB();
  const [busy, setBusy] = useState(false);
  const targets = collections.filter((c) => c.id !== currentCollectionId);

  async function openAll() {
    // Background tabs (dashboard keeps focus) via lib/restore.ts's shared
    // `openLinks` — same helper the collection header's "Restore all" and a
    // single card-click open use, instead of re-deriving the
    // try/catch-per-tab loop a third time.
    const result = await openLinks(selectedLinks.map((l) => l.url));
    if (result.failed > 0) {
      onError(openFailureMessage(result.failed));
    }
  }

  async function moveTo(targetCollectionId: string) {
    if (!targetCollectionId || busy) return;
    setBusy(true);
    try {
      for (const link of selectedLinks) {
        await moveLinkToEnd(link.id, targetCollectionId, db);
      }
      onClear();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not move those links.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelected() {
    if (busy) return;
    setBusy(true);
    try {
      const ids = selectedLinks.map((l) => l.id);
      await softDeleteLinks(ids, db);
      onDeleted(ids);
      onClear();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not delete those links.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      // `fixed` + left offset matching the rail's w-[280px] (Rail.tsx) +
      // `mx-auto`/`w-fit`, not `sticky` — sticky's containing block depends
      // on every ancestor between here and the scrolling `<main>` having the
      // right height/overflow, which is easy to get subtly wrong across
      // `LinkGrid` → `CollectionPanel` → `main`'s nested flex containers.
      // The left-[280px] centers the bar within the content pane right of
      // the rail; if the rail ever becomes resizable, both widths need to
      // move to a shared token.
      className="bulk-bar fixed bottom-4 left-[280px] right-0 z-40 mx-auto flex w-fit flex-col gap-1.5 rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5 shadow-lg"
      style={{ fontFamily: "var(--font-body)" }}
    >
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-[var(--text)]" style={{ fontFamily: "var(--font-mono)" }}>
          {selectedLinks.length} selected
        </span>

        <Button size="sm" variant="ghost" onClick={() => void openAll()} disabled={busy}>
          Open all
        </Button>

        <select
          aria-label="Move to collection"
          value=""
          disabled={busy || targets.length === 0}
          onChange={(e) => void moveTo(e.target.value)}
          className="h-8 rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] px-2 text-sm text-[var(--text)] hover:border-[var(--line-hi)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50"
        >
          <option value="" disabled>
            Move to…
          </option>
          {targets.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <Button size="sm" variant="danger" onClick={() => void deleteSelected()} disabled={busy}>
          Delete
        </Button>

        <button
          type="button"
          aria-label="Clear selection"
          title="Clear selection (Esc)"
          onClick={onClear}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-[var(--text-2)] transition-[transform,background-color,color] duration-150 hover:bg-[var(--surface-hover)] hover:text-[var(--text)] motion-safe:hover:-translate-y-0.5 active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <span aria-hidden="true" className="text-lg leading-none">×</span>
        </button>
      </div>

      {/* Same copy + key-cap as the popup's SelectionBar; self-limiting at exactly one selection. */}
      {selectedLinks.length === 1 ? (
        <p className="flex items-center gap-1.5 text-[11px] text-[var(--text-2)]">
          <Kbd style={{ minWidth: 0, padding: "0 0.25rem", fontSize: "10px" }}>⇧</Kbd>
          click another to select a range
        </p>
      ) : null}
    </div>
  );
}

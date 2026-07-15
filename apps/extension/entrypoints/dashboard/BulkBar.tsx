import { useState } from "react";
import type { Collection, Link } from "@tabburrow/core";
import { getDB, softDeleteLinks } from "@tabburrow/core";
import { Button } from "@tabburrow/ui";
import { appendLinkToCollection } from "../../lib/links";

export interface BulkBarProps {
  /** The selected links, already in current display order (so "Open all" and "Move to…" preserve it). */
  selectedLinks: Link[];
  currentCollectionId: string;
  collections: Collection[];
  onClear: () => void;
  onError: (message: string) => void;
}

/**
 * Slides up from the bottom of the main area once 1+ links are selected
 * (see the `.bulk-bar` `@starting-style` transition in `assets/tailwind.css`).
 * "Move to…" awaits `appendLinkToCollection` one link at a time — each call
 * looks the target's current last position up fresh, so sequential awaits
 * are what makes "preserving relative order" true; `Promise.all`-ing them
 * would have every link land on the same position.
 */
export function BulkBar({ selectedLinks, currentCollectionId, collections, onClear, onError }: BulkBarProps) {
  const db = getDB();
  const [busy, setBusy] = useState(false);
  const targets = collections.filter((c) => c.id !== currentCollectionId);

  function openAll() {
    for (const link of selectedLinks) {
      chrome.tabs.create({ url: link.url });
    }
  }

  async function moveTo(targetCollectionId: string) {
    if (!targetCollectionId || busy) return;
    setBusy(true);
    try {
      for (const link of selectedLinks) {
        await appendLinkToCollection(link.id, targetCollectionId, db);
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
      await softDeleteLinks(
        selectedLinks.map((l) => l.id),
        db,
      );
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
      // `fixed` + `inset-x-0`/`mx-auto`/`w-fit` (the same viewport-relative
      // pattern the Toast stack uses in App.tsx), not `sticky` — sticky's
      // containing block depends on every ancestor between here and the
      // scrolling `<main>` having the right height/overflow, which is easy
      // to get subtly wrong across `LinkGrid` → `CollectionPanel` → `main`'s
      // nested flex containers. `fixed` sidesteps that entirely at the cost
      // of centering across the FULL window rather than just the content
      // pane right of the rail — acceptable at the rail's fixed 280px width.
      className="bulk-bar fixed inset-x-0 bottom-4 z-40 mx-auto flex w-fit items-center gap-3 rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5 shadow-lg"
      style={{ fontFamily: "var(--font-body)" }}
    >
      <span className="text-sm font-medium text-[var(--text)]" style={{ fontFamily: "var(--font-mono)" }}>
        {selectedLinks.length} selected
      </span>

      <Button size="sm" variant="ghost" onClick={openAll} disabled={busy}>
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
        onClick={onClear}
        className="rounded-[4px] px-1 leading-none text-[var(--text-2)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        ×
      </button>
    </div>
  );
}

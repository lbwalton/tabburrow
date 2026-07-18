import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getDB, listLinks } from "@tabburrow/core";
import type { Collection } from "@tabburrow/core";
import { Badge } from "@tabburrow/ui";
import { isCssColorAccent } from "../../lib/accents";
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
 * — a "+" that adds the current tab to this folder in place and an open-all
 * icon. The row body drills into the folder; the two action buttons sit
 * outside that button so the markup stays valid (no nested buttons).
 */
export function FolderRow({ collection, onOpen, onAddCurrent, canAddCurrent, onError }: FolderRowProps) {
  const db = getDB();
  const links = useLiveQuery(() => listLinks(collection.id, db), [collection.id]);
  const count = links?.length ?? 0;
  const [added, setAdded] = useState(false);
  const [adding, setAdding] = useState(false);

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

  return (
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
      </div>
    </div>
  );
}

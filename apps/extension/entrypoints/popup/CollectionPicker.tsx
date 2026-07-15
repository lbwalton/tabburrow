import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { Collection } from "@tabburrow/core";
import { Button, Input } from "@tabburrow/ui";
import { sortByRecentlyUpdated, filterCollectionsByName, friendlyCreateError } from "../../lib/collections";

export interface CollectionPickerProps {
  collections: Collection[];
  onSelect: (collection: Collection) => void;
  /** Creates the collection AND resolves the picker with it (App owns the continuation). */
  onCreate: (name: string) => Promise<Collection>;
  onCancel: () => void;
  /**
   * True while a selection/creation is resolving (the reducer's `resolving`
   * flag). Gates every row and the create submit so a rapid second click
   * can't retarget or double-fire the save.
   */
  busy: boolean;
}

/**
 * Replaces the popup body inline (not a modal). Existing collections are
 * ordered most-recently-updated first, with a pinned "New collection…" row.
 * When there are zero collections yet, skips straight to the inline name
 * input, autofocused, with no search box and no "+ New collection…" click
 * required (first-run state).
 */
export function CollectionPicker({ collections, onSelect, onCreate, onCancel, busy }: CollectionPickerProps) {
  const isEmpty = collections.length === 0;
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(isEmpty);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const newNameRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const ordered = useMemo(() => sortByRecentlyUpdated(collections), [collections]);
  const filtered = useMemo(() => filterCollectionsByName(ordered, query), [ordered, query]);

  // Keyboard flow must be continuous: something inside the picker receives
  // focus the moment it opens (the SaveBar it replaced has unmounted, so
  // without this, focus would drop to <body>). Create mode focuses the name
  // input; list mode focuses the search input.
  useEffect(() => {
    if (creating) newNameRef.current?.focus();
    else searchRef.current?.focus();
  }, [creating]);

  async function handleCreate() {
    if (busy) return;
    setError(null);
    try {
      await onCreate(newName);
      // Success resolves the picker (App dispatches PICKER_RESOLVED and
      // unmounts it); this write is a harmless no-op when that has happened.
      setNewName("");
    } catch (err) {
      setError(friendlyCreateError(err));
    }
  }

  function handleContainerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onCancel(); // the reducer ignores ESCAPE while resolving
    }
  }

  return (
    <div className="flex flex-col gap-3" onKeyDown={handleContainerKeyDown}>
      <div className="flex items-center justify-between">
        <h2
          className="text-sm font-semibold text-[var(--text)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {isEmpty ? "Name your first collection" : "Save to…"}
        </h2>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>

      {!isEmpty ? (
        <Input
          ref={searchRef}
          type="text"
          placeholder="Search collections…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search collections"
        />
      ) : null}

      <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
        {!isEmpty && !creating ? (
          <button
            type="button"
            onClick={() => {
              if (!busy) setCreating(true);
            }}
            aria-disabled={busy || undefined}
            className="flex items-center gap-2 rounded-[var(--radius-card)] px-3 py-2 text-left text-sm font-medium text-[var(--accent)] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            + New collection…
          </button>
        ) : (
          <div className="flex flex-col gap-1.5 px-1 py-1">
            <Input
              ref={newNameRef}
              type="text"
              placeholder="Collection name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleCreate();
                }
              }}
              invalid={!!error}
              disabled={busy}
            />
            {error ? <p className="px-1 text-xs text-[var(--accent-2)]">{error}</p> : null}
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void handleCreate()} disabled={busy}>
                Create
              </Button>
              {!isEmpty ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setCreating(false);
                    setNewName("");
                    setError(null);
                  }}
                  disabled={busy}
                >
                  Back
                </Button>
              ) : null}
            </div>
          </div>
        )}

        {filtered.map((collection) => (
          <button
            key={collection.id}
            type="button"
            onClick={() => {
              if (!busy) onSelect(collection); // App's reducer guard is the backstop
            }}
            aria-disabled={busy || undefined}
            className="flex items-center gap-2 rounded-[var(--radius-card)] px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: collection.accent ?? "var(--text-2)" }}
            />
            <span className="truncate">{collection.name}</span>
          </button>
        ))}

        {!isEmpty && filtered.length === 0 ? (
          <p className="px-3 py-2 text-xs text-[var(--text-2)]">No collections match &ldquo;{query}&rdquo;.</p>
        ) : null}
      </div>
    </div>
  );
}

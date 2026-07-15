import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { Collection } from "@tabburrow/core";
import { Button, Input } from "@tabburrow/ui";
import { sortByRecentlyUpdated, filterCollectionsByName } from "../../lib/collections";

export interface CollectionPickerProps {
  collections: Collection[];
  onSelect: (collection: Collection) => void;
  onCreate: (name: string) => Promise<Collection>;
  onCancel: () => void;
}

/**
 * Replaces the popup body inline (not a modal). Existing collections are
 * ordered most-recently-updated first, with a pinned "New collection…" row.
 * When there are zero collections yet, skips straight to the inline name
 * input, autofocused, with no search box and no "+ New collection…" click
 * required (first-run state).
 */
export function CollectionPicker({ collections, onSelect, onCreate, onCancel }: CollectionPickerProps) {
  const isEmpty = collections.length === 0;
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(isEmpty);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const newNameRef = useRef<HTMLInputElement>(null);

  const ordered = useMemo(() => sortByRecentlyUpdated(collections), [collections]);
  const filtered = useMemo(() => filterCollectionsByName(ordered, query), [ordered, query]);

  useEffect(() => {
    if (creating) newNameRef.current?.focus();
  }, [creating]);

  async function handleCreate() {
    setError(null);
    setBusy(true);
    try {
      const created = await onCreate(newName);
      setNewName("");
      setCreating(isEmpty); // stay expanded if the list is still empty after creating
      onSelect(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create collection.");
    } finally {
      setBusy(false);
    }
  }

  function handleContainerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onCancel();
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
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      {!isEmpty ? (
        <Input
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
            onClick={() => setCreating(true)}
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
            onClick={() => onSelect(collection)}
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

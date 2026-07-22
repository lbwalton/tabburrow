import { useEffect, useMemo, useState } from "react";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Collection } from "@tabburrow/core";
import { Button, Input } from "@tabburrow/ui";
import { friendlyCreateError } from "../../lib/collections";
import { getPlan, onAuthChange } from "../../lib/auth";
import type { AuthUser, Plan } from "../../lib/auth";
import { isSupabaseConfigured } from "../../lib/supabase";
import { proBadgeState } from "../../lib/proBadge";
import { CollectionRow } from "./CollectionRow";
import { ProBadge } from "./ProBadge";

export interface RailProps {
  collections: Collection[];
  /** The order to render rows in — the dashboard's optimistic drag order when a reorder is in flight, otherwise the live (persisted) order. Owned by `App` (see its docstring) since the single lifted `DndContext`'s `onDragEnd` needs to update it directly. */
  order: string[];
  linkCounts: Map<string, number>;
  selectedId: string | null;
  onCreateCollection: (name: string) => Promise<Collection>;
  onDeleteCollection: (collection: Collection) => void;
}

/**
 * Left rail: wordmark, the draggable collections list, and a "New
 * collection" affordance pinned to the bottom. The `DndContext` (and its
 * sensors, and the optimistic drag-order state) live in `App.tsx` — a single
 * context has to span the rail AND the link grid so a card can be dropped on
 * a row (see `App`'s docstring) — this component just renders `order` inside
 * a `SortableContext`.
 */
export function Rail({ collections, order, linkCounts, selectedId, onCreateCollection, onDeleteCollection }: RailProps) {
  const byId = useMemo(() => new Map(collections.map((c) => [c.id, c])), [collections]);
  const ordered = order.map((id) => byId.get(id)).filter((c): c is Collection => !!c);

  // Plan state for the wordmark's "PRO" chip — same "components subscribe to
  // onAuthChange themselves" precedent AccountPane and AiOrganizeDialog set
  // (onAuthChange fires once immediately on subscribe; no polling).
  const cloudConfigured = isSupabaseConfigured();
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  useEffect(() => {
    if (!cloudConfigured) return;
    return onAuthChange(setAuthUser);
  }, [cloudConfigured]);
  useEffect(() => {
    if (!authUser) {
      setPlan(null);
      return;
    }
    let cancelled = false;
    void getPlan().then((p) => {
      if (!cancelled) setPlan(p);
    });
    return () => {
      cancelled = true;
    };
  }, [authUser]);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creatingBusy, setCreatingBusy] = useState(false);

  async function submitCreate() {
    if (creatingBusy) return;
    setCreatingBusy(true);
    setCreateError(null);
    try {
      await onCreateCollection(newName);
      setNewName("");
      setCreating(false);
    } catch (err) {
      setCreateError(friendlyCreateError(err));
    } finally {
      setCreatingBusy(false);
    }
  }

  function cancelCreate() {
    setCreating(false);
    setNewName("");
    setCreateError(null);
  }

  return (
    <nav className="flex h-screen w-[280px] shrink-0 flex-col bg-[var(--bg-well)]" aria-label="Collections">
      <div className="flex items-center gap-2 px-4 py-5">
        <span className="text-lg font-bold text-[var(--text)]" style={{ fontFamily: "var(--font-display)" }}>
          TabBurrow
        </span>
        <ProBadge
          state={proBadgeState(cloudConfigured, authUser, plan)}
          onUpgrade={() => (window.location.hash = "#/settings")}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-0.5">
            {ordered.map((collection) => (
              <CollectionRow
                key={collection.id}
                collection={collection}
                selected={collection.id === selectedId}
                linkCount={linkCounts.get(collection.id) ?? 0}
                onDelete={() => onDeleteCollection(collection)}
              />
            ))}
          </ul>
        </SortableContext>
      </div>

      {/* Plain div, not a second <nav> landmark — the outer <nav> above already covers this whole rail. */}
      <div className="flex flex-col gap-0.5 border-t border-[var(--line)] px-2 py-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          onClick={() => (window.location.hash = "#/sessions")}
        >
          Sessions
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          onClick={() => (window.location.hash = "#/settings")}
        >
          Settings
        </Button>
      </div>

      <div className="border-t border-[var(--line)] p-2">
        {creating ? (
          <div className="flex flex-col gap-1.5 p-1">
            <Input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Collection name"
              invalid={!!createError}
              disabled={creatingBusy}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submitCreate();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelCreate();
                }
              }}
            />
            {createError ? <p className="px-1 text-xs text-[var(--accent-2)]">{createError}</p> : null}
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void submitCreate()} disabled={creatingBusy}>
                Create
              </Button>
              <Button size="sm" variant="ghost" onClick={cancelCreate} disabled={creatingBusy}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => setCreating(true)}>
            + New collection
          </Button>
        )}
      </div>
    </nav>
  );
}

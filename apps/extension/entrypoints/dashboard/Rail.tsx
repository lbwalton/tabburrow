import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Collection } from "@tabburrow/core";
import { getDB, moveCollection } from "@tabburrow/core";
import { Button, Input } from "@tabburrow/ui";
import { moveItem, neighborsAfterMove, nextLocalOrder } from "../../lib/reorder";
import { friendlyCreateError } from "../../lib/collections";
import { CollectionRow } from "./CollectionRow";

export interface RailProps {
  collections: Collection[];
  linkCounts: Map<string, number>;
  selectedId: string | null;
  onCreateCollection: (name: string) => Promise<Collection>;
  onDeleteCollection: (collection: Collection) => void;
  /** Called when a drag's moveCollection write rejects (the rail has already rolled back to the live order). */
  onReorderFailed: () => void;
}

/**
 * Left rail: wordmark, the draggable collections list, and a "New
 * collection" affordance pinned to the bottom. Drag reordering keeps a
 * local optimistic order (`localOrder`) during the async `moveCollection`
 * write so the row lands in its new spot instantly and doesn't snap back
 * and then forward once the live query catches up (see reorder.ts for the
 * pure neighbor/array-move math this drives).
 */
export function Rail({
  collections,
  linkCounts,
  selectedId,
  onCreateCollection,
  onDeleteCollection,
  onReorderFailed,
}: RailProps) {
  const db = getDB();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const liveOrder = useMemo(() => collections.map((c) => c.id), [collections]);
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);

  // Reconcile the optimistic override against every live-query emission:
  // confirmed order or a changed collection set both drop it (see
  // nextLocalOrder's docstring). The functional update returns the SAME
  // reference while the write is still in flight, so React bails out and
  // this can't loop.
  useEffect(() => {
    setLocalOrder((current) => nextLocalOrder(current, { type: "live-update", liveOrder }));
  }, [liveOrder]);

  const order = localOrder ?? liveOrder;
  const byId = useMemo(() => new Map(collections.map((c) => [c.id, c])), [collections]);
  const ordered = order.map((id) => byId.get(id)).filter((c): c is Collection => !!c);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const current = localOrder ?? liveOrder;
    const fromIndex = current.indexOf(String(active.id));
    const toIndex = current.indexOf(String(over.id));
    if (fromIndex === -1 || toIndex === -1) return;
    const nextOrder = moveItem(current, fromIndex, toIndex);
    setLocalOrder(nextOrder);
    const { beforeId, afterId } = neighborsAfterMove(nextOrder, String(active.id));
    moveCollection(String(active.id), beforeId, afterId, db).catch(() => {
      // The write never landed (Dexie transaction abort, positionBetween
      // throw): roll the rail back to the live order instead of leaving an
      // unpersisted order on screen forever, and let App surface a toast.
      setLocalOrder((current) => nextLocalOrder(current, { type: "write-failed" }));
      onReorderFailed();
    });
  }

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
      <div className="px-4 py-5">
        <span className="text-lg font-bold text-[var(--text)]" style={{ fontFamily: "var(--font-display)" }}>
          TabBurrow
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
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
        </DndContext>
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

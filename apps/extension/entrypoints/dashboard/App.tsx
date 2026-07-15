import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { Collection } from "@tabburrow/core";
import {
  createCollection,
  getDB,
  getMeta,
  listCollections,
  listLinks,
  moveCollection,
  moveLink,
  moveLinkToEnd,
  restoreCollection,
  restoreLinks,
  setMeta,
  softDeleteCollection,
} from "@tabburrow/core";
import { Toast } from "@tabburrow/ui";
import { collectionHash, countLinksByCollection } from "../../lib/dashboard";
import { resolveDragEnd } from "../../lib/dnd";
import { parseSortMode, sortMetaKey } from "../../lib/links";
import type { SortMode } from "../../lib/links";
import { moveItem, neighborsAfterMove, nextLocalOrder } from "../../lib/reorder";
import { useRoute } from "./useRoute";
import { Rail } from "./Rail";
import { DashboardMain } from "./DashboardMain";
import { SearchOverlay } from "./SearchOverlay";

interface PendingDelete {
  id: string;
  name: string;
}

interface LinkOpError {
  id: number;
  message: string;
}

interface PendingLinkDelete {
  /** Date.now() — doubles as the Toast key so a second link-delete during the first toast's window restarts it rather than being swallowed (same pattern `reorderError`/`linkOpError` already use below). */
  key: number;
  ids: string[];
  count: number;
}

// Stable empty-Map reference so the Rail/linkCounts prop doesn't change
// identity every render while the live query's first emission is pending.
const EMPTY_COUNTS = new Map<string, number>();

/**
 * The dashboard shell: rail + main area, wired to a SINGLE `DndContext`.
 *
 * Why here and not in `Rail`/`LinkGrid`: dropping a link card onto a rail
 * `CollectionRow` (to move it to that collection) only works if the row and
 * the card are droppable/draggable within the *same* dnd-kit context — two
 * independent `DndContext`s can't see each other's drags. So this component
 * owns the sensors, the context, and — since `onDragEnd` needs to update
 * them synchronously — BOTH optimistic drag-order overrides: the rail's
 * collection order (moved up from where Task 8 originally built it) and the
 * grid's link order (new). Each override follows the exact same shape as
 * the other (`lib/reorder.ts`'s `nextLocalOrder`/`moveItem`/
 * `neighborsAfterMove`, reused verbatim — they were already generic over
 * plain id arrays) so the "no flicker, roll back on write failure" behavior
 * Task 8 built for the rail applies identically to the grid.
 *
 * `onDragEnd` itself only ever does dispatch: `resolveDragEnd` (pure, see
 * `lib/dnd.ts`) decides WHICH of the three operations a given
 * active/over pair means, and this function is just the `switch` that runs
 * the matching optimistic-update + persistence call.
 */
export function App() {
  const db = getDB();
  const collectionsRaw = useLiveQuery(() => listCollections(db), []);
  const collections = collectionsRaw ?? [];
  const collectionsLoaded = collectionsRaw !== undefined;

  const collectionIds = useMemo(() => collections.map((c) => c.id), [collections]);
  const route = useRoute(collectionIds);
  const activeCollectionId = route.kind === "collection" ? route.id : null;

  const linkCounts = useLiveQuery(() => countLinksByCollection(db), []) ?? EMPTY_COUNTS;

  const linksRaw = useLiveQuery(
    () => (activeCollectionId ? listLinks(activeCollectionId, db) : Promise.resolve([])),
    [activeCollectionId, db],
  );
  const links = linksRaw ?? [];
  const linksLoaded = linksRaw !== undefined;

  const sortModeRaw = useLiveQuery(
    () => (activeCollectionId ? getMeta(sortMetaKey(activeCollectionId), db) : Promise.resolve(null)),
    [activeCollectionId, db],
  );
  const sortMode = parseSortMode(sortModeRaw);

  function handleSortModeChange(mode: SortMode) {
    if (activeCollectionId) void setMeta(sortMetaKey(activeCollectionId), mode, db);
  }

  // --- Rail (collection) optimistic drag order — unchanged from Task 8,
  // just relocated so onDragEnd (below) can reach it. ---
  const railLiveOrder = useMemo(() => collections.map((c) => c.id), [collections]);
  const [railLocalOrder, setRailLocalOrder] = useState<string[] | null>(null);
  useEffect(() => {
    setRailLocalOrder((current) => nextLocalOrder(current, { type: "live-update", liveOrder: railLiveOrder }));
  }, [railLiveOrder]);
  const railOrder = railLocalOrder ?? railLiveOrder;

  // --- Grid (link) optimistic drag order — same shape, new. Naturally
  // resets when the active collection changes too: a different collection's
  // link ids are an entirely different id set, so nextLocalOrder's
  // sameIdSet check drops the override on its own. ---
  const linkLiveOrder = useMemo(() => links.map((l) => l.id), [links]);
  const [linkLocalOrder, setLinkLocalOrder] = useState<string[] | null>(null);
  useEffect(() => {
    setLinkLocalOrder((current) => nextLocalOrder(current, { type: "live-update", liveOrder: linkLiveOrder }));
  }, [linkLiveOrder]);
  const linkOrder = linkLocalOrder ?? linkLiveOrder;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  // Timestamp doubles as the Toast key so a second failure during the
  // first toast's window restarts it rather than being swallowed.
  const [reorderError, setReorderError] = useState<number | null>(null);
  const [linkOpError, setLinkOpError] = useState<LinkOpError | null>(null);
  // Single slot, same "replace the pending one" semantics as `pendingDelete`
  // above: a second link-delete while the first's Undo toast is still up
  // silently drops the first batch's undo (it stays deleted) rather than
  // stacking multiple pending-undo toasts of the same kind.
  const [pendingLinkDelete, setPendingLinkDelete] = useState<PendingLinkDelete | null>(null);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const op = resolveDragEnd({
      activeId: String(active.id),
      activeType: active.data.current?.type,
      overId: over ? String(over.id) : null,
      overType: over?.data.current?.type,
    });

    switch (op.kind) {
      case "reorder-collections": {
        const current = railLocalOrder ?? railLiveOrder;
        const fromIndex = current.indexOf(op.activeId);
        const toIndex = current.indexOf(op.overId);
        if (fromIndex === -1 || toIndex === -1) return;
        const nextOrder = moveItem(current, fromIndex, toIndex);
        setRailLocalOrder(nextOrder);
        const { beforeId, afterId } = neighborsAfterMove(nextOrder, op.activeId);
        moveCollection(op.activeId, beforeId, afterId, db).catch(() => {
          // The write never landed: roll the rail back to the live order
          // instead of leaving an unpersisted order on screen forever.
          setRailLocalOrder((cur) => nextLocalOrder(cur, { type: "write-failed" }));
          setReorderError(Date.now());
        });
        return;
      }

      case "reorder-links": {
        if (!activeCollectionId) return;
        const current = linkLocalOrder ?? linkLiveOrder;
        const fromIndex = current.indexOf(op.activeId);
        const toIndex = current.indexOf(op.overId);
        if (fromIndex === -1 || toIndex === -1) return;
        const nextOrder = moveItem(current, fromIndex, toIndex);
        setLinkLocalOrder(nextOrder);
        const { beforeId, afterId } = neighborsAfterMove(nextOrder, op.activeId);
        moveLink(op.activeId, activeCollectionId, beforeId, afterId, db).catch(() => {
          setLinkLocalOrder((cur) => nextLocalOrder(cur, { type: "write-failed" }));
          setLinkOpError({ id: Date.now(), message: "Couldn't save that order. Try again." });
        });
        return;
      }

      case "move-link": {
        // Dropped on the row of the collection already open: nothing to do,
        // there's no meaningful "move".
        if (op.targetCollectionId === activeCollectionId) return;
        moveLinkToEnd(op.linkId, op.targetCollectionId, db).catch((err) => {
          setLinkOpError({
            id: Date.now(),
            message: err instanceof Error ? err.message : "Couldn't move that link.",
          });
        });
        return;
      }

      case "noop":
        return;
    }
  }

  async function handleCreateCollection(name: string): Promise<Collection> {
    const created = await createCollection(name, undefined, db);
    window.location.hash = collectionHash(created.id);
    return created;
  }

  function handleCreateFirstCollection() {
    void handleCreateCollection("New collection");
  }

  function handleDeleteCollection(collection: Collection) {
    void softDeleteCollection(collection.id, db);
    setPendingDelete({ id: collection.id, name: collection.name });
  }

  function handleUndoDelete() {
    if (!pendingDelete) return;
    void restoreCollection(pendingDelete.id, db);
    setPendingDelete(null);
  }

  function handleLinkError(message: string) {
    setLinkOpError({ id: Date.now(), message });
  }

  function handleLinksDeleted(ids: string[]) {
    if (ids.length === 0) return;
    setPendingLinkDelete({ key: Date.now(), ids, count: ids.length });
  }

  function handleUndoLinkDelete() {
    if (!pendingLinkDelete) return;
    // restoreLinks (packages/core/src/repo/links.ts) only ever clears
    // deletedAt — it never touches position, so this is guaranteed to put
    // every restored link back exactly where it was (core's repo.test.ts
    // asserts this directly: restoring a tombstoned link lands it back in
    // its original slot relative to its siblings, not appended to the end).
    void restoreLinks(pendingLinkDelete.ids, db);
    setPendingLinkDelete(null);
  }

  // Gate the whole shell on the first live-query emission: rendering the
  // rail/empty-state before we actually know whether any collections exist
  // would flash the wrong state for an instant (the "no flicker" rule
  // applies just as much here as it does to the drag-reorder path below).
  if (!collectionsLoaded) {
    return <div className="h-screen bg-[var(--bg-ground)]" />;
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="flex h-screen bg-[var(--bg-ground)]">
        <SearchOverlay onError={handleLinkError} />
        <Rail
          collections={collections}
          order={railOrder}
          linkCounts={linkCounts}
          selectedId={activeCollectionId}
          onCreateCollection={handleCreateCollection}
          onDeleteCollection={handleDeleteCollection}
        />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <DashboardMain
            route={route}
            collections={collections}
            links={links}
            linksLoaded={linksLoaded}
            linkOrder={linkOrder}
            sortMode={sortMode}
            onSortModeChange={handleSortModeChange}
            onLinkError={handleLinkError}
            onLinksDeleted={handleLinksDeleted}
            onCreateFirstCollection={handleCreateFirstCollection}
          />
        </main>
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">
          {reorderError !== null ? (
            <Toast
              key={reorderError}
              message="Couldn't save that order. Try again."
              durationMs={4000}
              onDismiss={() => setReorderError(null)}
            />
          ) : null}
          {linkOpError !== null ? (
            <Toast
              key={linkOpError.id}
              message={linkOpError.message}
              durationMs={4000}
              onDismiss={() => setLinkOpError(null)}
            />
          ) : null}
          {pendingDelete ? (
            <Toast
              key={pendingDelete.id}
              message={`"${pendingDelete.name}" deleted`}
              actionLabel="Undo"
              onAction={handleUndoDelete}
              durationMs={6000}
              onDismiss={() => setPendingDelete(null)}
            />
          ) : null}
          {pendingLinkDelete ? (
            <Toast
              key={pendingLinkDelete.key}
              message={`Deleted ${pendingLinkDelete.count} link${pendingLinkDelete.count === 1 ? "" : "s"}`}
              actionLabel="Undo"
              onAction={handleUndoLinkDelete}
              durationMs={6000}
              onDismiss={() => setPendingLinkDelete(null)}
            />
          ) : null}
        </div>
      </div>
    </DndContext>
  );
}

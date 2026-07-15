import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Collection } from "@tabburrow/core";
import { createCollection, getDB, listCollections, restoreCollection, softDeleteCollection } from "@tabburrow/core";
import { Toast } from "@tabburrow/ui";
import { collectionHash, countLinksByCollection } from "../../lib/dashboard";
import { useRoute } from "./useRoute";
import { Rail } from "./Rail";
import { DashboardMain } from "./DashboardMain";

interface PendingDelete {
  id: string;
  name: string;
}

// Stable empty-Map reference so the Rail/linkCounts prop doesn't change
// identity every render while the live query's first emission is pending.
const EMPTY_COUNTS = new Map<string, number>();

export function App() {
  const db = getDB();
  const collectionsRaw = useLiveQuery(() => listCollections(db), []);
  const collections = collectionsRaw ?? [];
  const collectionsLoaded = collectionsRaw !== undefined;

  const collectionIds = useMemo(() => collections.map((c) => c.id), [collections]);
  const route = useRoute(collectionIds);

  const linkCounts = useLiveQuery(() => countLinksByCollection(db), []) ?? EMPTY_COUNTS;

  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

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

  // Gate the whole shell on the first live-query emission: rendering the
  // rail/empty-state before we actually know whether any collections exist
  // would flash the wrong state for an instant (the "no flicker" rule
  // applies just as much here as it does to the drag-reorder path below).
  if (!collectionsLoaded) {
    return <div className="h-screen bg-[var(--bg-ground)]" />;
  }

  return (
    <div className="flex h-screen bg-[var(--bg-ground)]">
      <Rail
        collections={collections}
        linkCounts={linkCounts}
        selectedId={route.kind === "collection" ? route.id : null}
        onCreateCollection={handleCreateCollection}
        onDeleteCollection={handleDeleteCollection}
      />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <DashboardMain route={route} collections={collections} onCreateFirstCollection={handleCreateFirstCollection} />
      </main>
      <div className="fixed bottom-6 right-6 z-50">
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
      </div>
    </div>
  );
}

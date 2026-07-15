import { useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import type { Collection, Link } from "@tabburrow/core";
import type { SortMode } from "../../lib/links";
import { sortLinksForView } from "../../lib/links";
import { emptySelection, nextSelection, pruneSelection } from "../../lib/selection";
import { LinkCard } from "./LinkCard";
import { BulkBar } from "./BulkBar";

export interface LinkGridProps {
  collectionId: string;
  /** Position-ordered links (from `listLinks`, via `App`). */
  links: Link[];
  /** The manual drag order in effect (optimistic override, or the live order) — used only when `sortMode === "manual"`. */
  order: string[];
  sortMode: SortMode;
  /** For the bulk bar's "Move to…" menu (filters out `collectionId` itself). */
  collections: Collection[];
  onLinkError: (message: string) => void;
}

/**
 * Responsive card grid + multi-select + the bulk-action bar. Selection is
 * local to this component (it's purely a grid-view concern) and resets
 * whenever `collectionId` changes; dragging is wired through `useSortable`
 * on each `LinkCard`, but the actual `DndContext`/`onDragEnd` live in
 * `App.tsx` (see its docstring) since a card can be dropped on a rail row
 * outside this component's subtree.
 */
export function LinkGrid({ collectionId, links, order, sortMode, collections, onLinkError }: LinkGridProps) {
  const [selection, setSelection] = useState(emptySelection());

  // A different collection is a different selection universe entirely.
  useEffect(() => {
    setSelection(emptySelection());
  }, [collectionId]);

  // A link leaving the set underneath an active selection (moved out via
  // drag, bulk-moved, deleted from another surface) shouldn't leave a
  // dangling selected id — pruneSelection bails out to the same reference
  // when nothing needs dropping, so this doesn't cause an extra render on
  // every unrelated links update.
  useEffect(() => {
    const validIds = links.map((l) => l.id);
    setSelection((current) => pruneSelection(current, validIds));
  }, [links]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSelection(emptySelection());
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const byId = useMemo(() => new Map(links.map((l) => [l.id, l])), [links]);
  // Not wrapped in useMemo: `links`/`order` are already the cheapest
  // possible inputs to re-derive from (small arrays, plain .map/.filter),
  // and a memoized `displayLinks` would need to be recomputed on every
  // render anyway once `byId` (a fresh Map each `links` change) is a
  // dependency — see `byId` above, which IS the one that actually reuses a
  // stable reference across renders.
  const displayLinks =
    sortMode === "manual"
      ? order.map((id) => byId.get(id)).filter((l): l is Link => !!l)
      : sortLinksForView(links, sortMode);
  const displayOrder = displayLinks.map((l) => l.id);

  function handleCardSelect(id: string, event: MouseEvent) {
    if (event.shiftKey) {
      setSelection((s) => nextSelection(s, { type: "range", id, order: displayOrder }));
    } else if (event.metaKey || event.ctrlKey) {
      setSelection((s) => nextSelection(s, { type: "toggle", id }));
    } else {
      setSelection((s) => nextSelection(s, { type: "click", id }));
    }
  }

  const selectedLinks = displayLinks.filter((l) => selection.selected.has(l.id));
  const dragDisabled = sortMode !== "manual";

  return (
    <div className="flex flex-1 flex-col">
      <div
        role="listbox"
        aria-multiselectable="true"
        aria-label="Links"
        title={dragDisabled ? "Switch to Manual to reorder" : undefined}
        className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3"
      >
        <SortableContext items={displayOrder} strategy={rectSortingStrategy}>
          {displayLinks.map((link) => (
            <LinkCard
              key={link.id}
              link={link}
              selected={selection.selected.has(link.id)}
              dragDisabled={dragDisabled}
              onSelect={handleCardSelect}
              onError={onLinkError}
            />
          ))}
        </SortableContext>
      </div>

      {selectedLinks.length > 0 ? (
        <BulkBar
          selectedLinks={selectedLinks}
          currentCollectionId={collectionId}
          collections={collections}
          onClear={() => setSelection(emptySelection())}
          onError={onLinkError}
        />
      ) : null}
    </div>
  );
}

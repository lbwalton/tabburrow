import { useEffect, useMemo, useState } from "react";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import type { Collection, Link } from "@tabburrow/core";
import type { SortMode } from "../../lib/links";
import { sortLinksForView } from "../../lib/links";
import { emptySelection, nextSelection, pruneSelection } from "../../lib/selection";
import type { ClickIntent, KeyIntent } from "../../lib/click-intent";
import { openFailureMessage, openLinks } from "../../lib/restore";
import { LinkCard } from "./LinkCard";
import { BulkBar } from "./BulkBar";

/**
 * Input types that own Escape themselves, because there Escape means "revert
 * what I'm typing" rather than "clear the selection".
 *
 * A positive list, not an exclusion list, and the direction is load-bearing: a
 * checkbox is also an `HTMLInputElement`, so a bare `instanceof` check would
 * bail on any focused input and silently disable clear-selection. An
 * unrecognized type falling through to clearing is the harmless failure.
 */
const TEXT_ENTRY_TYPES = new Set(["text", "url", "search", "email", "password", "tel", "number"]);

/**
 * Everything on the dashboard that owns Escape before the grid does. Covers
 * `RestoreAllButton`'s `role="menu"`, `AccentPicker`'s `role="dialog"` (a plain
 * `<div>`, not a native dialog — the clause that is easiest to forget), and
 * every native `<dialog>` on the page, including `EditLinkPopover`'s and
 * `SearchOverlay`'s.
 */
const ESCAPE_OWNER_SELECTOR = "dialog[open], [role='menu'], [role='dialog']";

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
  /** Notifies `App` after a link-delete succeeds, so it can show the 6s Undo toast. */
  onLinksDeleted: (ids: string[]) => void;
}

/**
 * Responsive card grid + multi-select + the bulk-action bar. Selection is
 * local to this component (it's purely a grid-view concern) and resets
 * whenever `collectionId` changes; dragging is wired through `useSortable`
 * on each `LinkCard`, but the actual `DndContext`/`onDragEnd` live in
 * `App.tsx` (see its docstring) since a card can be dropped on a rail row
 * outside this component's subtree.
 *
 * T10: a card's click/key resolves to an `open`/`toggle`/`range` intent in
 * `LinkCard` (via `lib/click-intent.ts`) and is handed up here as
 * `onCardIntent`/`onKeyIntent` — this is where the intent actually DOES
 * something: `open` opens the link as a background tab (`lib/restore.ts`'s
 * `openLinks`, dashboard keeps focus) and surfaces a failure toast; `toggle`
 * / `range` update `selection` exactly as the old plain-click/cmd-click/
 * shift-click handling did (a plain click no longer touches selection at
 * all — see `lib/selection.ts`'s docstring).
 */
export function LinkGrid({ collectionId, links, order, sortMode, collections, onLinkError, onLinksDeleted }: LinkGridProps) {
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

  // Escape clears the selection, but only when nothing else owns the keypress.
  //
  // Registered on the CAPTURE phase, and that is the whole trick. React 18
  // flushes a discrete update synchronously, so by the time a BUBBLE-phase
  // listener on `window` runs, the surface that owned the key has already
  // unmounted: `AccentPicker` is gone from the DOM and a cancelled rename
  // <Input> has already blurred, so neither guard below can see them and the
  // selection gets wiped anyway. Capture runs before React's root-container
  // listeners, so the DOM is still intact when we inspect it.
  //
  // Do not "simplify" this back to bubble. The identical bug shipped three
  // times in the popup's copy of this guard before the phase was identified,
  // and a happy-dom repro confidently proved the opposite of what Chrome does.
  // The `true` must be on BOTH add and remove, or the cleanup silently fails
  // to detach and leaks a listener per mount.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const active = document.activeElement as HTMLInputElement | null;
      const tag = active?.tagName;
      if (tag === "TEXTAREA") return;
      // `active.type` is "text" for an <input> with no type attribute, so the
      // rail's inline rename field is covered without special-casing.
      if (tag === "INPUT" && TEXT_ENTRY_TYPES.has(active?.type ?? "")) return;
      if (document.querySelector(ESCAPE_OWNER_SELECTOR)) return;
      setSelection(emptySelection());
    }
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
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

  // `chrome.tabs.create` can reject (invalid URL, window gone) — surface
  // ONE failure toast instead of throwing (same policy `openLinks` itself
  // documents; a single-link open just never has >1 failure to report).
  async function openLink(id: string) {
    const link = byId.get(id);
    if (!link) return;
    const result = await openLinks([link.url]);
    if (result.failed > 0) onLinkError(openFailureMessage(result.failed));
  }

  function handleCardIntent(id: string, intent: ClickIntent) {
    if (intent === "open") {
      void openLink(id);
    } else if (intent === "toggle") {
      setSelection((s) => nextSelection(s, { type: "toggle", id }));
    } else {
      setSelection((s) => nextSelection(s, { type: "range", id, order: displayOrder }));
    }
  }

  function handleCardKeyIntent(id: string, intent: KeyIntent) {
    if (intent === "open") {
      void openLink(id);
    } else {
      setSelection((s) => nextSelection(s, { type: "toggle", id }));
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
              onCardIntent={handleCardIntent}
              onKeyIntent={handleCardKeyIntent}
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
          onDeleted={onLinksDeleted}
        />
      ) : null}
    </div>
  );
}

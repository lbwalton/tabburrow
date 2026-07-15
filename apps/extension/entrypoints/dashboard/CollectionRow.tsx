import { useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Collection } from "@tabburrow/core";
import { getDB, renameCollection, setCollectionAccent } from "@tabburrow/core";
import { Input } from "@tabburrow/ui";
import { collectionHash } from "../../lib/dashboard";
import { isCssColorAccent } from "../../lib/accents";
import { useInlineRename } from "./useInlineRename";
import { AccentPicker } from "./AccentPicker";

export interface CollectionRowProps {
  collection: Collection;
  selected: boolean;
  linkCount: number;
  onDelete: () => void;
}

/**
 * One rail row: drag handle, accent dot/emoji, name (double-click to
 * rename inline), live link count, and hover/focus-revealed actions
 * (rename, accent picker, delete). Selection state is driven by the hash
 * router (App/Rail), not local state — clicking the name just navigates.
 */
export function CollectionRow({ collection, selected, linkCount, onDelete }: CollectionRowProps) {
  const db = getDB();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: collection.id,
  });
  const rename = useInlineRename({
    value: collection.name,
    onCommit: (name) => void renameCollection(collection.id, name, db),
  });
  const [accentOpen, setAccentOpen] = useState(false);
  const accentTriggerRef = useRef<HTMLButtonElement>(null);

  const accentIsColor = collection.accent !== null && isCssColorAccent(collection.accent);
  const borderAccent = accentIsColor ? collection.accent! : "var(--accent)";

  function selectCollection() {
    window.location.hash = collectionHash(collection.id);
  }

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
        borderRadius: selected ? "var(--radius-arch)" : "var(--radius-card)",
        borderLeft: `3px solid ${selected ? borderAccent : "transparent"}`,
        background: selected ? "var(--surface)" : undefined,
      }}
      className={`group flex items-center gap-1.5 py-1.5 pl-1.5 pr-2 ${selected ? "" : "hover:bg-[var(--surface-hover)]"}`}
    >
      <button
        type="button"
        aria-label="Reorder collection"
        {...attributes}
        {...listeners}
        className="shrink-0 cursor-grab touch-none rounded-[4px] px-0.5 text-[var(--text-2)] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] active:cursor-grabbing"
      >
        ⠿
      </button>

      {collection.accent && !accentIsColor ? (
        <span aria-hidden="true" className="flex h-4 w-4 shrink-0 items-center justify-center text-xs leading-none">
          {collection.accent}
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: collection.accent ?? "var(--text-2)" }}
        />
      )}

      {rename.editing ? (
        <Input
          ref={rename.inputRef}
          value={rename.draft}
          onChange={(e) => rename.setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          {...rename.inputHandlers}
          className="h-7 min-w-0 flex-1 px-2 text-sm"
        />
      ) : (
        <button
          type="button"
          onClick={selectCollection}
          onDoubleClick={rename.start}
          className="min-w-0 flex-1 truncate text-left text-sm text-[var(--text)]"
        >
          {collection.name}
        </button>
      )}

      <span className="shrink-0 text-xs text-[var(--text-2)]" style={{ fontFamily: "var(--font-mono)" }}>
        {linkCount}
      </span>

      <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          type="button"
          aria-label="Rename collection"
          onClick={rename.start}
          className="rounded-[4px] px-1 py-0.5 text-xs leading-none text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          ✎
        </button>
        <button
          ref={accentTriggerRef}
          type="button"
          aria-label="Choose accent"
          aria-expanded={accentOpen}
          onClick={() => setAccentOpen((v) => !v)}
          className="rounded-[4px] px-1 py-0.5 text-xs leading-none text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          🎨
        </button>
        <button
          type="button"
          aria-label="Delete collection"
          onClick={onDelete}
          className="rounded-[4px] px-1 py-0.5 text-xs leading-none text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--accent)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          🗑
        </button>
      </div>

      {accentOpen ? (
        <AccentPicker
          anchorRef={accentTriggerRef}
          value={collection.accent}
          onChoose={(accent) => {
            void setCollectionAccent(collection.id, accent, db);
            setAccentOpen(false);
          }}
          onClose={() => setAccentOpen(false)}
        />
      ) : null}
    </li>
  );
}

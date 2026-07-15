import { useRef, useState } from "react";
import type { MouseEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Link } from "@tabburrow/core";
import { updateLink, getDB } from "@tabburrow/core";
import { Badge, Card } from "@tabburrow/ui";
import { faviconFor } from "../../lib/tabs";
import { formatHost } from "../../lib/links";
import type { EditLinkPatch } from "./EditLinkPopover";
import { EditLinkPopover } from "./EditLinkPopover";

export interface LinkCardProps {
  link: Link;
  selected: boolean;
  /** True while the grid is view-sorted (name/date) — dragging is fully disabled in that mode. */
  dragDisabled: boolean;
  onSelect: (id: string, event: MouseEvent) => void;
  onError: (message: string) => void;
}

/** 16px favicon with an inline-SVG globe fallback (currentColor, so it follows the card's text color) for a broken/missing favicon URL. */
function Favicon({ url, faviconUrl }: { url: string; faviconUrl: string | null }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <svg
        viewBox="0 0 16 16"
        width={16}
        height={16}
        aria-hidden="true"
        className="mt-0.5 shrink-0 text-[var(--text-2)]"
      >
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <path
          d="M1.5 8h13M8 1.5c2.2 2 2.2 11 0 13M8 1.5c-2.2 2-2.2 11 0 13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
        />
      </svg>
    );
  }
  return (
    <img
      src={faviconUrl ?? faviconFor(url)}
      alt=""
      width={16}
      height={16}
      className="mt-0.5 shrink-0 rounded-[3px]"
      onError={() => setFailed(true)}
    />
  );
}

/**
 * One card in the link grid: favicon, title, domain, optional note/tags,
 * and a hover/focus-revealed edit pencil. Draggable (reorder within the
 * grid, or drop onto a rail `CollectionRow` to move collections) via the
 * same `useSortable` id/`data` pattern `CollectionRow` uses, but tagged
 * `{type: "link"}` so the single lifted `DndContext` in `App.tsx` can tell
 * the two drag kinds apart (see `lib/dnd.ts`). Selection (click, cmd/ctrl,
 * shift) and drag share the same pointer-down: dnd-kit's `PointerSensor`
 * only starts a drag past its activation distance and swallows the
 * following click once it does, so a plain click still reaches `onClick`
 * normally (verified against `@dnd-kit/core`'s sensor source). No custom
 * Enter/Space "select via keyboard" handler here on purpose: dnd-kit's
 * `KeyboardSensor` defaults bind BOTH of those keys to "pick up this
 * sortable for a keyboard-driven drag" on the very same focused element
 * (`defaultKeyboardCodes`), and reconfiguring that would also change the
 * rail's already-shipped drag-handle keyboard behavior (shared sensor
 * instance, must not regress). Keyboard selection is a gap worth a follow-up
 * with a dedicated key, not this one.
 */
export function LinkCard({ link, selected, dragDisabled, onSelect, onError }: LinkCardProps) {
  const db = getDB();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: link.id,
    data: { type: "link" },
    disabled: dragDisabled,
    // dnd-kit's own default (role="button", tabIndex=0) doesn't fit — the
    // card behaves like a listbox option (see the grid's role="listbox"),
    // not a button. Override here rather than fighting spread-order in the
    // JSX below (a literal `role`/`tabIndex` next to `{...attributes}` is a
    // static duplicate-prop error either way).
    attributes: { role: "option", tabIndex: 0 },
  });
  const [editOpen, setEditOpen] = useState(false);
  const editTriggerRef = useRef<HTMLButtonElement>(null);

  function handleClick(event: MouseEvent) {
    onSelect(link.id, event);
  }

  function handleSave(patch: EditLinkPatch) {
    updateLink(link.id, patch, db).catch((err) => {
      onError(err instanceof Error ? err.message : "Could not save changes.");
    });
    setEditOpen(false);
  }

  return (
    <Card
      ref={setNodeRef}
      variant="surface"
      aria-selected={selected}
      onClick={handleClick}
      {...attributes}
      {...(dragDisabled ? {} : listeners)}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        boxShadow: selected ? "0 0 0 2px var(--accent) inset" : undefined,
      }}
      className={`group relative flex flex-col gap-2 text-left transition-[background-color,transform] duration-150 hover:bg-[var(--surface-hover)] hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
        dragDisabled ? "cursor-default" : "cursor-grab active:cursor-grabbing"
      }`}
    >
      <div className="flex items-start gap-2 pr-5">
        <Favicon url={link.url} faviconUrl={link.faviconUrl} />
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-sm font-medium leading-snug text-[var(--text)]">{link.title}</h3>
          <p className="mt-0.5 truncate text-xs text-[var(--text-2)]" style={{ fontFamily: "var(--font-mono)" }}>
            {formatHost(link.url)}
          </p>
        </div>
      </div>

      {link.note ? <p className="line-clamp-1 text-xs text-[var(--text-2)]">{link.note}</p> : null}

      {link.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {link.tags.map((tag) => (
            <Badge key={tag} variant="muted">
              {tag}
            </Badge>
          ))}
        </div>
      ) : null}

      <button
        ref={editTriggerRef}
        type="button"
        aria-label="Edit link"
        aria-expanded={editOpen}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setEditOpen((v) => !v);
        }}
        className="absolute right-2 top-2 rounded-[4px] px-1 py-0.5 text-xs leading-none text-[var(--text-2)] opacity-0 hover:bg-[var(--surface-hover)] hover:text-[var(--text)] group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        ✎
      </button>

      {editOpen ? (
        <EditLinkPopover
          anchorRef={editTriggerRef}
          title={link.title}
          note={link.note}
          tags={link.tags}
          onSave={handleSave}
          onClose={() => setEditOpen(false)}
        />
      ) : null}
    </Card>
  );
}

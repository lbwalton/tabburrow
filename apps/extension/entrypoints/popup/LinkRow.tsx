import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { getDB, normalizeUrl, softDeleteLinks, updateLink } from "@tabburrow/core";
import type { Link } from "@tabburrow/core";
import { faviconFor } from "../../lib/tabs";
import { openFailureMessage } from "../../lib/restore";
import { sendSyncNudge } from "../../lib/sync-nudge";
import { EditLinkPopover } from "../dashboard/EditLinkPopover";
import type { EditLinkPatch } from "../dashboard/EditLinkPopover";

export interface LinkRowProps {
  link: Link;
  /** Whether this row is part of the current multi-select. */
  selected: boolean;
  /** Resolved CSS color for the checked box (see `lib/accents.ts`'s `accentColor`). Passed in already-resolved so it's computed once per folder, not once per row. */
  checkColor: string;
  /** Checkbox click. `shiftKey` distinguishes a range from a plain toggle; `FolderDetail` decides what that means. */
  onToggle: (id: string, shiftKey: boolean) => void;
  onError?: (message: string) => void;
}

/**
 * One saved link in the folder-detail list: a selection checkbox, favicon +
 * title, and an overflow (⋯) menu revealed on hover/focus offering Open,
 * Edit, and Delete. Edit reuses the dashboard's EditLinkPopover (title / note
 * / tags → updateLink); Delete is a soft delete (softDeleteLinks). The row
 * body opens the link in a new active tab. All writes nudge a sync cycle,
 * matching App's save path.
 */
export function LinkRow({ link, selected, checkColor, onToggle, onError }: LinkRowProps) {
  const db = getDB();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setMenuOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  // Opens in the FOREGROUND (`active: true`), which is why this doesn't go
  // through `lib/restore.ts`'s `openLinks` — that helper is the background-tab
  // policy every bulk/dashboard open follows. It still borrows the same
  // `normalizeUrl` pass, so a link saved schemeless before that fix ("nike.com")
  // opens the site instead of `chrome-extension://<id>/nike.com` (issue #24).
  function openLink() {
    chrome.tabs.create({ url: normalizeUrl(link.url), active: true }).catch(() => {
      onError?.(openFailureMessage(1));
    });
  }

  async function handleDelete() {
    setMenuOpen(false);
    try {
      await softDeleteLinks([link.id], db);
      sendSyncNudge();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Could not delete the link.");
    }
  }

  async function handleEditSave(patch: EditLinkPatch) {
    setEditOpen(false);
    try {
      await updateLink(link.id, patch, db);
      sendSyncNudge();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Could not update the link.");
    }
  }

  return (
    <div className="group relative flex items-center gap-2 rounded-[var(--radius-card)] pr-1 hover:bg-[var(--surface-hover)] focus-within:bg-[var(--surface-hover)]">
      {/* Sibling of the row-body <button>, never inside it: nesting an input
          in a button is invalid HTML with unpredictable click behavior.
          `readOnly` is React's documented way to have a `checked` input with
          no `onChange` — the click handler below is what actually drives
          state, and it fires for Space on a focused box too.

          A click natively flips the DOM `checked` before React hears about
          it, so correctness depends on a re-render always following to
          re-assert the controlled value. It always does: `nextSelection`
          returns a fresh object every call, even when the resulting
          selection is identical, so `setSelection` can never bail out. */}
      <label className="relative flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center">
        <input
          type="checkbox"
          checked={selected}
          readOnly
          aria-label={`Select ${link.title}`}
          onClick={(e) => onToggle(link.id, e.shiftKey)}
          className="peer h-4 w-4 shrink-0 cursor-pointer appearance-none rounded-[4px] border border-[var(--line-hi)] bg-transparent transition-colors hover:border-[var(--text-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          style={selected ? { backgroundColor: checkColor, borderColor: checkColor } : undefined}
        />
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--btn-fg)"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="pointer-events-none absolute h-3 w-3 opacity-0 peer-checked:opacity-100"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </label>
      <button
        type="button"
        onClick={openLink}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-card)] py-1.5 pl-0 pr-2 text-left text-sm text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <img
          src={link.faviconUrl ?? faviconFor(link.url)}
          alt=""
          width={16}
          height={16}
          className="shrink-0 rounded-[3px]"
          onError={(e) => {
            e.currentTarget.style.visibility = "hidden";
          }}
        />
        <span className="min-w-0 flex-1 truncate">{link.title}</span>
      </button>

      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          type="button"
          aria-label={`Delete ${link.title}`}
          title="Delete"
          onClick={() => void handleDelete()}
          className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[var(--text-2)] hover:bg-[var(--surface)] hover:text-[var(--accent)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m1 0-.7 12.1a1 1 0 0 1-1 .9H7.7a1 1 0 0 1-1-.9L6 7" />
          </svg>
        </button>
        <button
          ref={triggerRef}
          type="button"
          aria-label={`More actions for ${link.title}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[var(--text-2)] hover:bg-[var(--surface)] hover:text-[var(--text)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <span aria-hidden="true">⋯</span>
        </button>
      </div>

      {menuOpen ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label={`${link.title} actions`}
          className="absolute right-1 top-full z-50 mt-1 w-40 rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] p-1 shadow-lg"
        >
          <MenuItem
            onClick={() => {
              setMenuOpen(false);
              openLink();
            }}
          >
            Open
          </MenuItem>
          <MenuItem
            onClick={() => {
              setMenuOpen(false);
              setEditOpen(true);
            }}
          >
            Edit
          </MenuItem>
        </div>
      ) : null}

      {editOpen ? (
        <EditLinkPopover
          anchorRef={triggerRef}
          title={link.title}
          note={link.note}
          tags={link.tags}
          onSave={handleEditSave}
          onClose={() => setEditOpen(false)}
        />
      ) : null}
    </div>
  );
}

function MenuItem({ onClick, danger, children }: { onClick: () => void; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`w-full rounded-[4px] px-2 py-1.5 text-left text-sm hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
        danger ? "text-[var(--accent)]" : "text-[var(--text)]"
      }`}
    >
      {children}
    </button>
  );
}

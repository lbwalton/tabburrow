import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { getDB, softDeleteLinks, updateLink } from "@tabburrow/core";
import type { Link } from "@tabburrow/core";
import { faviconFor } from "../../lib/tabs";
import { sendSyncNudge } from "../../lib/sync-nudge";
import { EditLinkPopover } from "../dashboard/EditLinkPopover";
import type { EditLinkPatch } from "../dashboard/EditLinkPopover";

export interface LinkRowProps {
  link: Link;
  onError?: (message: string) => void;
}

/**
 * One saved link in the folder-detail list: favicon + title, with an overflow
 * (⋯) menu revealed on hover/focus offering Open, Edit, and Delete. Edit reuses
 * the dashboard's EditLinkPopover (title / note / tags → updateLink); Delete is
 * a soft delete (softDeleteLinks). The row body opens the link in a new active
 * tab. All writes nudge a sync cycle, matching App's save path.
 */
export function LinkRow({ link, onError }: LinkRowProps) {
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

  function openLink() {
    chrome.tabs.create({ url: link.url, active: true });
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
      <button
        type="button"
        onClick={openLink}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-card)] px-2 py-1.5 text-left text-sm text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
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

      <button
        ref={triggerRef}
        type="button"
        aria-label={`Actions for ${link.title}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-[var(--text-2)] opacity-0 transition-opacity hover:bg-[var(--surface)] hover:text-[var(--text)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <span aria-hidden="true">⋯</span>
      </button>

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
          <MenuItem onClick={() => void handleDelete()} danger>
            Delete
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

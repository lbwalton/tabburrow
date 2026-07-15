import { useEffect, useRef, useState } from "react";
import type { Link } from "@tabburrow/core";
import { Button, Dialog } from "@tabburrow/ui";
import { needsRestoreConfirm, openFailureMessage, openLinks } from "../../lib/restore";

export interface RestoreAllButtonProps {
  /** The collection's live links (from `listLinks` — already excludes tombstoned ones, so this IS "every live link"). */
  links: Link[];
  onError: (message: string) => void;
}

/**
 * Collection-header "Restore all" (open every live link as a background
 * tab) + a small chevron menu offering the "in a new window" variant —
 * mirrors the split-button pattern common to browser session-restore UIs.
 *
 * Collections over `RESTORE_CONFIRM_THRESHOLD` (15, see `lib/restore.ts`'s
 * `needsRestoreConfirm`) get ONE shared confirm `Dialog` before anything
 * opens — reached from either the main button or the chevron item — with
 * both open-mode actions plus Cancel, so confirming never forces a second
 * "which mode" decision. At or under the threshold, either path opens
 * immediately, no dialog.
 */
export function RestoreAllButton({ links, onError }: RestoreAllButtonProps) {
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || menuTriggerRef.current?.contains(target)) return;
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

  async function restoreAll(newWindow: boolean) {
    if (busy) return;
    setBusy(true);
    setConfirmOpen(false);
    setMenuOpen(false);
    try {
      const result = await openLinks(
        links.map((l) => l.url),
        { newWindow },
      );
      if (result.failed > 0) onError(openFailureMessage(result.failed));
    } finally {
      setBusy(false);
    }
  }

  function handleRestoreAllClick() {
    if (needsRestoreConfirm(links.length)) {
      setConfirmOpen(true);
    } else {
      void restoreAll(false);
    }
  }

  function handleNewWindowClick() {
    setMenuOpen(false);
    if (needsRestoreConfirm(links.length)) {
      setConfirmOpen(true);
    } else {
      void restoreAll(true);
    }
  }

  if (links.length === 0) return null;

  return (
    <div className="relative inline-flex items-center">
      <button
        type="button"
        onClick={handleRestoreAllClick}
        disabled={busy}
        className="h-8 rounded-l-[var(--radius-card)] border border-r-0 border-[var(--line)] bg-[var(--surface)] px-2.5 text-xs font-medium leading-none text-[var(--text)] hover:border-[var(--line-hi)] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50"
      >
        Restore all
      </button>
      <button
        ref={menuTriggerRef}
        type="button"
        aria-label="More restore options"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
        disabled={busy}
        className="h-8 rounded-r-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] px-1.5 text-xs leading-none text-[var(--text-2)] hover:border-[var(--line-hi)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50"
      >
        ▾
      </button>

      {menuOpen ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Restore options"
          className="absolute right-0 top-full z-50 mt-1 w-56 rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] p-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={handleNewWindowClick}
            className="w-full rounded-[4px] px-2 py-1.5 text-left text-sm text-[var(--text)] hover:bg-[var(--surface-hover)]"
          >
            Restore all in new window
          </button>
        </div>
      ) : null}

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={`Open ${links.length} tabs?`}
        footer={
          <>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => void restoreAll(true)} disabled={busy}>
              Restore all in new window
            </Button>
            <Button type="button" size="sm" onClick={() => void restoreAll(false)} disabled={busy}>
              Open {links.length} tabs
            </Button>
          </>
        }
      >
        <p>This collection has {links.length} links. Opening them all will create {links.length} new tabs.</p>
      </Dialog>
    </div>
  );
}

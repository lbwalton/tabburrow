import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export interface SaveSplitButtonProps {
  /** Main-button click: save the current tab to the last-used folder (or open the picker when cold). */
  onSaveCurrent: () => void;
  onSaveAll: () => void;
  onSaveSelected: () => void;
  /** Opens the CollectionPicker ("Choose folder…"). */
  onChooseFolder: () => void;
  /** http(s) tab count in the window, shown on "Save all tabs (N)". */
  allCount: number;
  /** Highlighted tab count; "Save selected (N)" only appears when this is ≥ 2. */
  selectedCount: number;
  disabled?: boolean;
}

/**
 * The home header's primary control: an orange "Save" button whose main click
 * saves the current tab to the last-used folder (App's warm/cold save path),
 * plus a caret menu for the other save targets. Folds the old SaveBar's three
 * buttons into one compact control so the home body can lead with the folder
 * list. Menu dismissal (outside pointerdown / Escape) mirrors the dashboard's
 * RestoreAllButton.
 */
export function SaveSplitButton({
  onSaveCurrent,
  onSaveAll,
  onSaveSelected,
  onChooseFolder,
  allCount,
  selectedCount,
  disabled,
}: SaveSplitButtonProps) {
  const [menuOpen, setMenuOpen] = useState(false);
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

  function runItem(fn: () => void) {
    setMenuOpen(false);
    fn();
  }

  return (
    <div className="relative inline-flex items-center">
      <button
        type="button"
        onClick={onSaveCurrent}
        disabled={disabled}
        style={{ fontFamily: "var(--font-body)" }}
        className="h-8 rounded-l-[var(--radius-card)] bg-[var(--accent)] px-3 text-sm font-medium leading-none text-[var(--btn-fg)] hover:brightness-110 active:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-ground)] disabled:opacity-50"
      >
        Save
      </button>
      <button
        ref={triggerRef}
        type="button"
        aria-label="More save options"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
        disabled={disabled}
        style={{ borderLeftColor: "color-mix(in srgb, var(--btn-fg) 25%, transparent)" }}
        className="flex h-8 items-center rounded-r-[var(--radius-card)] border-l bg-[var(--accent)] px-1.5 text-sm leading-none text-[var(--btn-fg)] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-ground)] disabled:opacity-50"
      >
        <span aria-hidden="true">▾</span>
      </button>

      {menuOpen ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Save options"
          className="absolute right-0 top-full z-50 mt-1 w-52 rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] p-1 shadow-lg"
        >
          <MenuItem onClick={() => runItem(onSaveCurrent)}>Save this tab</MenuItem>
          <MenuItem onClick={() => runItem(onSaveAll)}>Save all tabs ({allCount})</MenuItem>
          {selectedCount >= 2 ? (
            <MenuItem onClick={() => runItem(onSaveSelected)}>Save selected ({selectedCount})</MenuItem>
          ) : null}
          <MenuItem onClick={() => runItem(onChooseFolder)}>Choose folder…</MenuItem>
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="w-full rounded-[4px] px-2 py-1.5 text-left text-sm text-[var(--text)] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    >
      {children}
    </button>
  );
}

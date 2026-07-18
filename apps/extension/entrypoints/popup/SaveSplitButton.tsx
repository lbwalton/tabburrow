import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";

export interface SaveSplitButtonProps {
  /** Main-button click: save the current tab to the resolved target (or open the picker when nothing is resolved). */
  onSaveCurrent: () => void;
  /** "Save all → to {target}" — save every window tab to the resolved target (picker when nothing is resolved). */
  onSaveAll: () => void;
  /** "Save all → Choose a folder…" — always open the picker, then save all into the chosen folder. */
  onSaveAllChoose: () => void;
  /** "Save all → New folder (named by AI)" — save all into a fresh, AI-named folder. */
  onSaveAllNewAiFolder: () => void;
  /** "Save selected tabs (N)" — only shown when 2+ tabs are highlighted. */
  onSaveSelected: () => void;
  /** "Change default folder…" — open the picker and pin the choice as the default. */
  onChangeDefault: () => void;
  /** http(s) tab count in the window, shown on "Save all tabs (N)". */
  allCount: number;
  /** Highlighted tab count; "Save selected (N)" only appears when this is ≥ 2. */
  selectedCount: number;
  /** Resolved target name for the "Save all → to {name}" label; null when nothing is pinned yet. */
  targetName: string | null;
  disabled?: boolean;
}

/** Keep menu labels compact — long folder names are trimmed with an ellipsis rather than wrapping the row. */
function truncateName(name: string, max = 22): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

/**
 * The home header's primary control: an orange "Save" button whose main click
 * saves the current tab to the resolved target (App's one-click save path),
 * plus a caret menu for the other save targets — save all (to the default,
 * to a chosen folder, or to a new AI-named folder), save selected, and change
 * the default folder. Menu dismissal (outside pointerdown / Escape) and
 * roving arrow-key focus mirror the FolderDetail overflow menu's pattern.
 */
export function SaveSplitButton({
  onSaveCurrent,
  onSaveAll,
  onSaveAllChoose,
  onSaveAllNewAiFolder,
  onSaveSelected,
  onChangeDefault,
  allCount,
  selectedCount,
  targetName,
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

  // Focus the first item when the menu opens so keyboard flow continues into it.
  useEffect(() => {
    if (menuOpen) menuItems()[0]?.focus();
  }, [menuOpen]);

  function menuItems(): HTMLButtonElement[] {
    return menuRef.current ? Array.from(menuRef.current.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')) : [];
  }

  /** Roving focus so Up/Down/Home/End move between menu items (Escape is handled globally above). */
  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const items = menuItems();
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      items[(current + 1 + items.length) % items.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      items[(current - 1 + items.length) % items.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      items[items.length - 1]?.focus();
    }
  }

  function runItem(fn: () => void) {
    setMenuOpen(false);
    fn();
  }

  const saveAllToLabel = targetName ? `To ${truncateName(targetName)}` : "To the default folder";

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
          onKeyDown={handleMenuKeyDown}
          className="absolute right-0 top-full z-50 mt-1 w-56 rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] p-1 shadow-lg"
        >
          <MenuItem onClick={() => runItem(onSaveCurrent)}>Save this tab</MenuItem>
          {selectedCount >= 2 ? (
            <MenuItem onClick={() => runItem(onSaveSelected)}>Save selected tabs ({selectedCount})</MenuItem>
          ) : null}

          <MenuDivider />
          <MenuGroupLabel>Save all tabs ({allCount})</MenuGroupLabel>
          <MenuItem indent onClick={() => runItem(onSaveAll)}>
            {saveAllToLabel}
          </MenuItem>
          <MenuItem indent onClick={() => runItem(onSaveAllChoose)}>
            Choose a folder…
          </MenuItem>
          <MenuItem indent onClick={() => runItem(onSaveAllNewAiFolder)}>
            New folder (named by AI)
          </MenuItem>

          <MenuDivider />
          <MenuItem onClick={() => runItem(onChangeDefault)}>Change default folder…</MenuItem>
        </div>
      ) : null}
    </div>
  );
}

function MenuDivider() {
  return <div role="separator" className="my-1 h-px bg-[var(--line)]" />;
}

function MenuGroupLabel({ children }: { children: ReactNode }) {
  return (
    <p
      role="presentation"
      className="px-2 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-2)]"
    >
      {children}
    </p>
  );
}

function MenuItem({ onClick, indent, children }: { onClick: () => void; indent?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      onClick={onClick}
      className={`w-full truncate rounded-[4px] py-1.5 pr-2 text-left text-sm text-[var(--text)] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
        indent ? "pl-4" : "pl-2"
      }`}
    >
      {children}
    </button>
  );
}

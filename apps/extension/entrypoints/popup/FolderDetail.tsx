import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getDB, listLinks, renameCollection, setCollectionAccent, softDeleteCollection, softDeleteLinks } from "@tabburrow/core";
import type { Collection } from "@tabburrow/core";
import { Badge, Button, Dialog, Input } from "@tabburrow/ui";
import { getAllTabs, getCurrentTab } from "../../lib/tabs";
import { addTabToFolder, appendTabsToFolder, overwriteFolderWithTabs } from "../../lib/folderActions";
import { friendlyCreateError } from "../../lib/collections";
import { sendSyncNudge } from "../../lib/sync-nudge";
import { dashboardCollectionOrganizeUrl } from "../../lib/dashboard";
import { accentColor } from "../../lib/accents";
import { emptySelection, nextSelection, pruneSelection } from "../../lib/selection";
import { openFailureMessage, openLinks } from "../../lib/restore";
import { AccentPicker } from "../dashboard/AccentPicker";
import { OpenAllButton } from "./OpenAllButton";
import { LinkRow } from "./LinkRow";
import { AddLinkRow } from "./AddLinkRow";
import { SendMenu } from "./SendMenu";
import { SelectionBar } from "./SelectionBar";

export interface FolderDetailProps {
  collection: Collection;
  onBack: () => void;
}

/**
 * Input types that own Escape because Escape means "revert what I'm typing".
 * A positive list, not an exclusion list: an unrecognized type falls through
 * to clearing the selection, which is the harmless failure. Excluding known
 * non-text types instead would mean any future type silently disables the
 * clear-selection shortcut — exactly the checkbox regression this replaces.
 */
const TEXT_ENTRY_TYPES = new Set(["text", "url", "search", "email", "password", "tel", "number"]);

/**
 * Screen 2 of the popup hub: a folder's live links (LinkRow each) plus a manual
 * AddLinkRow, with a bottom action bar leading on Append tabs / Overwrite (the
 * two favorites) and a secondary row for Organize with AI (deep-links into the
 * dashboard's organize flow — no inline AI here), Send (copy/email), and an
 * overflow with Rename, Change color, Delete folder, and Add current tab.
 * Owns its own data calls (mirroring RecentList / RestoreAllButton), so App
 * only passes the collection and the back handler.
 *
 * Also owns the checkbox multi-select state for the list (`lib/selection.ts`):
 * each LinkRow is handed its checked flag, the folder's resolved accent color
 * for the checked fill, and a toggle handler that turns a shift-click into a
 * range and a plain click into a single toggle. The selection is pruned
 * whenever `links` changes underneath it and cleared on Escape, except when a
 * focused text-entry field (the rename `Input`, AddLinkRow's URL/title
 * fields — see `TEXT_ENTRY_TYPES`; a checkbox is an `HTMLInputElement` too but
 * is deliberately not in that set) owns that Escape to revert its own edit
 * instead, or an open `[role="menu"]`, `[role="dialog"]`, or native `<dialog>`
 * is on the page and gets to close on its own Escape handler first.
 * `selectedLinks` feeds the inline `SelectionBar`, which renders once 1+
 * rows are ticked and offers open-selected plus a confirmed bulk delete
 * (see `handleDeleteSelected`) — unlike the per-row hover trash, which
 * deletes immediately with no dialog.
 */
export function FolderDetail({ collection, onBack }: FolderDetailProps) {
  const db = getDB();
  const links = useLiveQuery(() => listLinks(collection.id, db), [collection.id]);
  const count = links?.length ?? 0;
  const urls = (links ?? []).map((l) => l.url);
  const [selection, setSelection] = useState(emptySelection());
  // `listLinks` is position-ordered, so this IS the display order a
  // shift-range measures against.
  const order = (links ?? []).map((l) => l.id);
  const selectedLinks = (links ?? []).filter((l) => selection.selected.has(l.id));
  const checkColor = accentColor(collection.accent);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [overwriteOpen, setOverwriteOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(collection.name);

  const backRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  // a11y: focus the detail header (back arrow) on enter so keyboard flow
  // continues into this screen rather than dropping to <body>.
  useEffect(() => {
    backRef.current?.focus();
  }, []);

  // A link deleted from another surface (or by this folder's own bulk
  // delete) shouldn't leave a dangling selected id. `pruneSelection`
  // returns the SAME reference when nothing changed, so this doesn't cause
  // an extra render on every unrelated links update.
  useEffect(() => {
    if (!links) return;
    const validIds = links.map((l) => l.id);
    setSelection((current) => pruneSelection(current, validIds));
  }, [links]);

  // Escape clears the selection, but only when nothing else owns the key.
  // The one selector covers the folder ⋯ menu, every per-row ⋯ menu, all
  // three <dialog>s in this file, and AccentPicker's `role="dialog"` panel
  // (reachable right from here via ⋯ → Change color) — it's a plain <div>,
  // not a native <dialog> or a role="menu", so it needs its own clause.
  //
  // `LinkRow`'s own Escape listener is also on `document` and fires for the
  // same keypress — that's fine and intended: its menu-closing setState
  // hasn't flushed to the DOM yet, so [role="menu"] is still queryable here
  // and this handler correctly bails. One Escape closes the menu, a second
  // clears the selection.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // A focused text-entry field owns Escape (revert/dismiss what you're
      // typing); it should never also fire the list-level "clear selection"
      // shortcut. Covers the rename Input here and both AddLinkRow fields,
      // and keeps covering any text field added later — which per-call-site
      // stopPropagation would not. Checked against TEXT_ENTRY_TYPES rather
      // than "is an HTMLInputElement", because a checkbox is an
      // HTMLInputElement too: LinkRow's checkbox keeps focus after the click
      // that ticks it (the row's key doesn't change, so React keeps the same
      // DOM node mounted), and a bare instanceof check would make Escape
      // silently do nothing right after ticking a box.
      const active = document.activeElement;
      const inTextEntry =
        (active instanceof HTMLInputElement && TEXT_ENTRY_TYPES.has(active.type)) ||
        active instanceof HTMLTextAreaElement;
      if (inTextEntry) return;
      if (document.querySelector("dialog[open], [role='menu'], [role='dialog']")) return;
      setSelection(emptySelection());
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (renaming) {
      setNameDraft(collection.name);
      renameRef.current?.focus();
      renameRef.current?.select();
    }
  }, [renaming, collection.name]);

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

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2500);
  }

  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAppend() {
    await run(async () => {
      const tabs = await getAllTabs();
      if (tabs.length === 0) {
        setError("No tabs to save (only http/https pages count).");
        return;
      }
      const saved = await appendTabsToFolder(collection.id, tabs, db);
      sendSyncNudge();
      flash(`Appended ${saved.length} ${saved.length === 1 ? "tab" : "tabs"}.`);
    });
  }

  async function handleOverwrite() {
    setOverwriteOpen(false);
    await run(async () => {
      const tabs = await getAllTabs();
      if (tabs.length === 0) {
        setError("No tabs to save (only http/https pages count).");
        return;
      }
      const saved = await overwriteFolderWithTabs(collection.id, tabs, db);
      sendSyncNudge();
      flash(`Replaced with ${saved.length} ${saved.length === 1 ? "tab" : "tabs"}.`);
    });
  }

  async function handleAddCurrent() {
    setMenuOpen(false);
    await run(async () => {
      const tab = await getCurrentTab();
      await addTabToFolder(collection.id, tab, db);
      sendSyncNudge();
      flash("Added the current tab.");
    });
  }

  async function handleRename() {
    const name = nameDraft.trim();
    if (!name) {
      setError(friendlyCreateError(new Error("name must not be empty")));
      return;
    }
    setRenaming(false);
    await run(async () => {
      await renameCollection(collection.id, name, db);
      sendSyncNudge();
    });
  }

  async function handleChooseColor(accent: string) {
    setColorOpen(false);
    await run(async () => {
      await setCollectionAccent(collection.id, accent, db);
      sendSyncNudge();
    });
  }

  async function handleDeleteFolder() {
    setDeleteOpen(false);
    await run(async () => {
      await softDeleteCollection(collection.id, db);
      sendSyncNudge();
      onBack();
    });
  }

  /**
   * Confirmed, unlike the per-row hover delete: one link is cheap to lose,
   * several are not, and the popup has no undo toast the way the dashboard
   * does. `softDeleteLinks` IS a soft delete, so the dialog copy points at
   * the dashboard for recovery.
   */
  async function handleDeleteSelected() {
    setBulkDeleteOpen(false);
    const ids = selectedLinks.map((l) => l.id);
    await run(async () => {
      await softDeleteLinks(ids, db);
      sendSyncNudge();
      setSelection(emptySelection());
      flash(`Deleted ${ids.length} ${ids.length === 1 ? "link" : "links"}.`);
    });
  }

  function handleOrganize() {
    chrome.tabs.create({ url: dashboardCollectionOrganizeUrl(collection.id) });
  }

  function handleToggle(id: string, shiftKey: boolean) {
    setSelection((s) =>
      shiftKey
        ? nextSelection(s, { type: "range", id, order })
        : nextSelection(s, { type: "toggle", id })
    );
  }

  /**
   * `openLinks` creates `active: false` background tabs, so unlike a single
   * row-body click this does NOT dismiss the popup — the selection clears
   * and the user stays where they are.
   *
   * No `needsRestoreConfirm` gate here, deliberately: that guards the header's
   * ↗ because one click there can open an entire folder. Hand-ticking 16
   * checkboxes is already deliberate, and the dashboard's `BulkBar` doesn't
   * confirm either.
   *
   * Routed through `run()` like every other handler in this file, even
   * though it isn't a DB write: `run()`'s re-entrancy guard (`if (busy)
   * return`) is what makes the bar's `disabled={busy}` true, so a
   * double-click can't fire two overlapping `chrome.tabs.create` loops
   * against the same `selectedLinks` snapshot. `run()` clearing `error`
   * first also means a stale failure from a prior batch doesn't linger
   * underneath a later batch's success notice.
   *
   * The selection clears wholesale even when some links failed to open,
   * with no way to re-select just the failures for a retry: `openLinks`
   * reports only `{opened, failed}` counts, not which urls failed, so there
   * is nothing to reselect. (Mirrors this bar's own compactness — the
   * dashboard's `BulkBar.openAll` never clears the selection on open at all,
   * so this is a deliberate divergence from that precedent, not an oversight.)
   */
  async function handleOpenSelected() {
    await run(async () => {
      const result = await openLinks(selectedLinks.map((l) => l.url));
      setSelection(emptySelection());
      if (result.failed > 0) setError(openFailureMessage(result.failed));
      if (result.opened > 0) {
        flash(`Opened ${result.opened} ${result.opened === 1 ? "tab" : "tabs"}.`);
      }
    });
  }

  const allTabsCount = links === undefined ? "…" : count;

  return (
    <div className="flex flex-col gap-3">
      <header className="flex items-center gap-2">
        <button
          ref={backRef}
          type="button"
          aria-label="Back to folders"
          onClick={onBack}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-card)] text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <span aria-hidden="true">&#8592;</span>
        </button>

        {renaming ? (
          <Input
            ref={renameRef}
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleRename();
              } else if (e.key === "Escape") {
                setRenaming(false);
              }
            }}
            onBlur={() => void handleRename()}
            aria-label="Folder name"
            className="h-8 flex-1"
          />
        ) : (
          <button
            type="button"
            onClick={() => setRenaming(true)}
            title="Click to rename"
            aria-label={`Rename folder ${collection.name}`}
            className="group/title flex min-w-0 flex-1 items-center gap-1.5 truncate rounded-[6px] px-1 py-0.5 text-left text-base font-semibold text-[var(--text)] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            <span className="truncate">{collection.name}</span>
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="shrink-0 text-[var(--text-2)] opacity-0 transition-opacity group-hover/title:opacity-100 group-focus-visible/title:opacity-100"
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </button>
        )}

        <Badge variant="muted">{allTabsCount}</Badge>
        <button
          type="button"
          aria-label="Add current tab to this folder"
          title="Add current tab"
          onClick={() => void handleAddCurrent()}
          disabled={busy}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-card)] text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-40"
        >
          <span aria-hidden="true" className="text-lg leading-none">+</span>
        </button>
        <OpenAllButton urls={urls} collectionName={collection.name} onError={setError} compact />
      </header>

      <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
        {links === undefined ? (
          <p className="px-2 py-3 text-sm text-[var(--text-2)]">Loading…</p>
        ) : links.length === 0 ? (
          <p className="px-2 py-3 text-sm text-[var(--text-2)]">No links yet. Append tabs or add one below.</p>
        ) : (
          links.map((link) => (
            <LinkRow
              key={link.id}
              link={link}
              selected={selection.selected.has(link.id)}
              checkColor={checkColor}
              onToggle={handleToggle}
              onError={setError}
            />
          ))
        )}
        <AddLinkRow collectionId={collection.id} onError={setError} />
      </div>

      {selectedLinks.length > 0 ? (
        <SelectionBar
          count={selectedLinks.length}
          busy={busy}
          onOpen={() => void handleOpenSelected()}
          onDelete={() => setBulkDeleteOpen(true)}
          onClear={() => setSelection(emptySelection())}
        />
      ) : null}

      {notice ? <p className="text-xs text-[var(--accent-2)]">{notice}</p> : null}
      {error ? <p className="text-xs text-[var(--accent)]">{error}</p> : null}

      <div className="flex flex-col gap-2 border-t border-[var(--line)] pt-3">
        <div className="flex gap-2">
          <Button variant="primary" size="sm" onClick={() => void handleAppend()} disabled={busy} className="flex-1">
            Append tabs
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setOverwriteOpen(true)} disabled={busy} className="flex-1">
            Overwrite
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleOrganize} className="flex-1">
            Organize with AI
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSendOpen(true)}>
            Send
          </Button>
          <div className="relative">
            <button
              ref={menuTriggerRef}
              type="button"
              aria-label="More folder actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
              className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-card)] border border-[var(--line)] text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              <span aria-hidden="true">⋯</span>
            </button>
            {menuOpen ? (
              <div
                ref={menuRef}
                role="menu"
                aria-label="Folder actions"
                className="absolute bottom-full right-0 z-50 mb-1 w-48 rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] p-1 shadow-lg"
              >
                <MenuItem
                  onClick={() => {
                    setMenuOpen(false);
                    setRenaming(true);
                  }}
                >
                  Rename folder
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setMenuOpen(false);
                    setColorOpen(true);
                  }}
                >
                  Change color
                </MenuItem>
                <MenuItem onClick={() => void handleAddCurrent()}>Add current tab</MenuItem>
                <MenuItem
                  danger
                  onClick={() => {
                    setMenuOpen(false);
                    setDeleteOpen(true);
                  }}
                >
                  Delete folder
                </MenuItem>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {colorOpen ? (
        <AccentPicker
          anchorRef={menuTriggerRef}
          value={collection.accent}
          onChoose={(accent) => void handleChooseColor(accent)}
          onClose={() => setColorOpen(false)}
        />
      ) : null}

      <SendMenu open={sendOpen} onClose={() => setSendOpen(false)} collection={collection} />

      <Dialog
        open={overwriteOpen}
        onClose={() => setOverwriteOpen(false)}
        title="Overwrite folder?"
        footer={
          <>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOverwriteOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" variant="danger" size="sm" onClick={() => void handleOverwrite()} disabled={busy}>
              Overwrite
            </Button>
          </>
        }
      >
        <p>
          Replace the {count} {count === 1 ? "link" : "links"} in {collection.name} with the tabs in this window? The
          current links are removed (you can undo from the dashboard).
        </p>
      </Dialog>

      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete folder?"
        footer={
          <>
            <Button type="button" variant="ghost" size="sm" onClick={() => setDeleteOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" variant="danger" size="sm" onClick={() => void handleDeleteFolder()} disabled={busy}>
              Delete
            </Button>
          </>
        }
      >
        <p>
          Delete {collection.name} and its {count} {count === 1 ? "link" : "links"}? You can restore it from the
          dashboard.
        </p>
      </Dialog>

      <Dialog
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        title={`Delete ${selectedLinks.length} ${selectedLinks.length === 1 ? "link" : "links"}?`}
        footer={
          <>
            <Button type="button" variant="ghost" size="sm" onClick={() => setBulkDeleteOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" variant="danger" size="sm" onClick={() => void handleDeleteSelected()} disabled={busy}>
              Delete
            </Button>
          </>
        }
      >
        <p>
          Remove {selectedLinks.length} {selectedLinks.length === 1 ? "link" : "links"} from {collection.name}? You can
          restore {selectedLinks.length === 1 ? "it" : "them"} from the dashboard.
        </p>
      </Dialog>
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

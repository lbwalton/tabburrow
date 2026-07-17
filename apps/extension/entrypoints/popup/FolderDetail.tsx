import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getDB, listLinks, renameCollection, setCollectionAccent, softDeleteCollection } from "@tabburrow/core";
import type { Collection } from "@tabburrow/core";
import { Badge, Button, Dialog, Input } from "@tabburrow/ui";
import { getAllTabs, getCurrentTab } from "../../lib/tabs";
import { addTabToFolder, appendTabsToFolder, overwriteFolderWithTabs } from "../../lib/folderActions";
import { friendlyCreateError } from "../../lib/collections";
import { sendSyncNudge } from "../../lib/sync-nudge";
import { dashboardCollectionOrganizeUrl } from "../../lib/dashboard";
import { AccentPicker } from "../dashboard/AccentPicker";
import { OpenAllButton } from "./OpenAllButton";
import { LinkRow } from "./LinkRow";
import { AddLinkRow } from "./AddLinkRow";
import { SendMenu } from "./SendMenu";

export interface FolderDetailProps {
  collection: Collection;
  onBack: () => void;
}

/**
 * Screen 2 of the popup hub: a folder's live links (LinkRow each) plus a manual
 * AddLinkRow, with a bottom action bar leading on Append tabs / Overwrite (the
 * two favorites) and a secondary row for Organize with AI (deep-links into the
 * dashboard's organize flow — no inline AI here), Send (copy/email), and an
 * overflow with Rename, Change color, Delete folder, and Add current tab.
 * Owns its own data calls (mirroring RecentList / RestoreAllButton), so App
 * only passes the collection and the back handler.
 */
export function FolderDetail({ collection, onBack }: FolderDetailProps) {
  const db = getDB();
  const links = useLiveQuery(() => listLinks(collection.id, db), [collection.id]);
  const count = links?.length ?? 0;
  const urls = (links ?? []).map((l) => l.url);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [overwriteOpen, setOverwriteOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
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

  function handleOrganize() {
    chrome.tabs.create({ url: dashboardCollectionOrganizeUrl(collection.id) });
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
          <h1
            className="min-w-0 flex-1 truncate text-base font-semibold text-[var(--text)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {collection.name}
          </h1>
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
          links.map((link) => <LinkRow key={link.id} link={link} onError={setError} />)
        )}
        <AddLinkRow collectionId={collection.id} onError={setError} />
      </div>

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

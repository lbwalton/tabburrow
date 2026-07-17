import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { Collection } from "@tabburrow/core";
import { createCollection, getDB } from "@tabburrow/core";
import { Input } from "@tabburrow/ui";
import { faviconFor } from "../../lib/tabs";
import { friendlyCreateError, sortByRecentlyUpdated } from "../../lib/collections";
import { formatHost } from "../../lib/links";
import { emptyStateFor, searchAll } from "../../lib/search";
import type { SearchResults } from "../../lib/search";
import { nextHighlight, resolveHighlight } from "../../lib/searchNav";
import { SaveSplitButton } from "./SaveSplitButton";
import { FolderRow } from "./FolderRow";
import { ProBanner } from "./ProBanner";
import type { Plan } from "../../lib/auth";

const EMPTY_SEARCH_RESULTS: SearchResults = { collections: [], links: [] };
const SEARCH_DEBOUNCE_MS = 150;
/** Compact popup body: show at most this many combined results, collections first. */
const POPUP_SEARCH_LIMIT = 8;

type SortMode = "recent" | "az";

export interface FoldersHomeProps {
  collections: Collection[];
  collectionsLoaded: boolean;
  /** Both tabs snapshot + collections loaded — gates the Save control. */
  dataLoaded: boolean;
  plan: Plan | null;
  allCount: number;
  selectedCount: number;
  /** False when there's no saveable current tab (chrome:// etc.). */
  canAddCurrent: boolean;
  onSaveCurrent: () => void;
  onSaveAll: () => void;
  onSaveSelected: () => void;
  onChooseFolder: () => void;
  onOpenFolder: (collectionId: string) => void;
  onAddCurrent: (collectionId: string) => Promise<void>;
  onError: (message: string) => void;
}

function sortCollections(collections: Collection[], mode: SortMode): Collection[] {
  if (mode === "az") return [...collections].sort((a, b) => a.name.localeCompare(b.name));
  return sortByRecentlyUpdated(collections);
}

/**
 * Screen 1 of the popup hub: the wordmark + a search toggle + the primary Save
 * split-button, then the full (scrollable) list of folders with live counts
 * and hover/focus actions, a "+ New folder" affordance, and the dismissible Pro
 * banner. The search combobox (moved here from App) filters collections + links;
 * a collection result drills into that folder in the popup, a link result opens
 * the page.
 */
export function FoldersHome(props: FoldersHomeProps) {
  const {
    collections,
    collectionsLoaded,
    dataLoaded,
    plan,
    allCount,
    selectedCount,
    canAddCurrent,
    onSaveCurrent,
    onSaveAll,
    onSaveSelected,
    onChooseFolder,
    onOpenFolder,
    onAddCurrent,
    onError,
  } = props;

  const db = getDB();
  const [sort, setSort] = useState<SortMode>("recent");

  // ---- Search combobox (same shape as the pre-redesign App search) --------
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResults>(EMPTY_SEARCH_RESULTS);
  const [searchSettledQuery, setSearchSettledQuery] = useState("");
  const [searchHighlight, setSearchHighlight] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResults(EMPTY_SEARCH_RESULTS);
      setSearchSettledQuery("");
      setSearchHighlight(-1);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchAll(searchQuery).then((r) => {
        if (cancelled) return;
        setSearchResults(r);
        setSearchSettledQuery(searchQuery);
        setSearchHighlight(r.collections.length + r.links.length > 0 ? 0 : -1);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchQuery]);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  const shownCollections = searchResults.collections.slice(0, POPUP_SEARCH_LIMIT);
  const shownLinks = searchResults.links.slice(0, Math.max(0, POPUP_SEARCH_LIMIT - shownCollections.length));
  const shownTotal = shownCollections.length + shownLinks.length;
  const searchActiveId = searchHighlight >= 0 ? `popup-search-option-${searchHighlight}` : undefined;

  function activateSearchResult(index: number) {
    const target = resolveHighlight(index, shownCollections.length);
    if (!target) return;
    if (target.kind === "collection") {
      const c = shownCollections[target.index];
      if (c) onOpenFolder(c.id);
      return;
    }
    const l = shownLinks[target.index];
    if (l) chrome.tabs.create({ url: l.url, active: true });
  }

  function closeSearch() {
    setSearchOpen(false);
    setSearchQuery("");
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSearchHighlight((h) => nextHighlight(h, "ArrowDown", shownTotal));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSearchHighlight((h) => nextHighlight(h, "ArrowUp", shownTotal));
    } else if (event.key === "Enter") {
      if (shownTotal === 0) return;
      event.preventDefault();
      activateSearchResult(searchHighlight);
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (searchQuery) setSearchQuery("");
      else closeSearch();
    }
  }

  // ---- New folder ---------------------------------------------------------
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const newNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creating) newNameRef.current?.focus();
  }, [creating]);

  async function handleCreateFolder() {
    setCreateError(null);
    try {
      const created = await createCollection(newName, undefined, db);
      setNewName("");
      setCreating(false);
      onOpenFolder(created.id);
    } catch (err) {
      setCreateError(friendlyCreateError(err));
    }
  }

  const ordered = sortCollections(collections, sort);

  return (
    <div className="flex flex-col gap-3">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-[var(--text)]" style={{ fontFamily: "var(--font-display)" }}>
          TabBurrow
        </h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={searchOpen ? "Close search" : "Search collections and links"}
            aria-pressed={searchOpen}
            onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
            className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-card)] border border-[var(--line)] text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <span aria-hidden="true">{searchOpen ? "×" : "⌕"}</span>
          </button>
          <SaveSplitButton
            onSaveCurrent={onSaveCurrent}
            onSaveAll={onSaveAll}
            onSaveSelected={onSaveSelected}
            onChooseFolder={onChooseFolder}
            allCount={allCount}
            selectedCount={selectedCount}
            disabled={!dataLoaded}
          />
        </div>
      </header>

      {searchOpen ? (
        <>
          <Input
            ref={searchInputRef}
            type="text"
            role="combobox"
            aria-expanded={searchQuery.trim().length > 0}
            aria-controls="popup-search-listbox"
            aria-activedescendant={searchActiveId}
            aria-label="Search collections and links"
            placeholder="Search collections and links…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
          {searchQuery.trim().length > 0 ? (
            <div
              id="popup-search-listbox"
              role="listbox"
              aria-label="Search results"
              className="flex max-h-72 flex-col gap-2 overflow-y-auto"
            >
              {shownCollections.length > 0 ? (
                <ResultGroup label="Collections">
                  {shownCollections.map((c, i) => (
                    <ResultRow
                      key={c.id}
                      id={`popup-search-option-${i}`}
                      highlighted={searchHighlight === i}
                      onActivate={() => activateSearchResult(i)}
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: c.accent ?? "var(--text-2)" }}
                      />
                      <span className="truncate">{c.name}</span>
                    </ResultRow>
                  ))}
                </ResultGroup>
              ) : null}

              {shownLinks.length > 0 ? (
                <ResultGroup label="Links">
                  {shownLinks.map((l, i) => {
                    const flatIndex = shownCollections.length + i;
                    return (
                      <ResultRow
                        key={l.id}
                        id={`popup-search-option-${flatIndex}`}
                        highlighted={searchHighlight === flatIndex}
                        onActivate={() => activateSearchResult(flatIndex)}
                      >
                        <img
                          src={l.faviconUrl ?? faviconFor(l.url)}
                          alt=""
                          width={14}
                          height={14}
                          className="shrink-0 rounded-[3px]"
                          onError={(e) => {
                            e.currentTarget.style.visibility = "hidden";
                          }}
                        />
                        <span className="min-w-0 flex-1 truncate">{l.title}</span>
                        <span
                          className="shrink-0 truncate text-xs text-[var(--text-2)]"
                          style={{ fontFamily: "var(--font-mono)" }}
                        >
                          {formatHost(l.url)}
                        </span>
                      </ResultRow>
                    );
                  })}
                </ResultGroup>
              ) : null}

              {emptyStateFor(searchQuery, searchSettledQuery, shownTotal) === "no-results" ? (
                <p className="px-1 py-2 text-xs text-[var(--text-2)]">
                  No results for &ldquo;{searchQuery.trim()}&rdquo;.
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-2)]">Folders</h2>
            <button
              type="button"
              onClick={() => setSort((s) => (s === "recent" ? "az" : "recent"))}
              className="rounded-[6px] px-1.5 py-0.5 text-xs text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              {sort === "recent" ? "Recent" : "A–Z"}
            </button>
          </div>

          <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
            {ordered.map((c) => (
              <FolderRow
                key={c.id}
                collection={c}
                onOpen={onOpenFolder}
                onAddCurrent={onAddCurrent}
                canAddCurrent={canAddCurrent}
                onError={onError}
              />
            ))}
            {collectionsLoaded && ordered.length === 0 ? (
              <p className="px-2 py-3 text-sm text-[var(--text-2)]">No folders yet. Create one to start burrowing.</p>
            ) : null}
          </div>

          {creating ? (
            <div className="flex flex-col gap-1.5">
              <Input
                ref={newNameRef}
                type="text"
                placeholder="Folder name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleCreateFolder();
                  } else if (e.key === "Escape") {
                    setCreating(false);
                    setNewName("");
                    setCreateError(null);
                  }
                }}
                invalid={!!createError}
                aria-label="New folder name"
              />
              {createError ? <p className="px-1 text-xs text-[var(--accent-2)]">{createError}</p> : null}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              disabled={!collectionsLoaded}
              className="flex items-center gap-2 rounded-[var(--radius-card)] px-2 py-1.5 text-left text-sm font-medium text-[var(--accent)] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50"
            >
              + New folder
            </button>
          )}

          <ProBanner plan={plan} />
        </>
      )}
    </div>
  );
}

function ResultGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="px-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-2)]">{label}</h2>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function ResultRow({
  id,
  highlighted,
  onActivate,
  children,
}: {
  id: string;
  highlighted: boolean;
  onActivate: () => void;
  children: ReactNode;
}) {
  return (
    <button
      id={id}
      type="button"
      role="option"
      aria-selected={highlighted}
      tabIndex={-1}
      onClick={onActivate}
      style={{ boxShadow: highlighted ? "2px 0 0 var(--accent) inset" : undefined }}
      className={`flex w-full items-center gap-2 rounded-[var(--radius-card)] px-2 py-1.5 text-left text-sm ${
        highlighted ? "bg-[var(--surface-hover)] text-[var(--text)]" : "text-[var(--text)] hover:bg-[var(--surface-hover)]"
      }`}
    >
      {children}
    </button>
  );
}

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { Collection } from "@tabburrow/core";
import { createCollection, getDB, normalizeUrl } from "@tabburrow/core";
import { Input } from "@tabburrow/ui";
import { faviconFor } from "../../lib/tabs";
import { friendlyCreateError, sortByRecentlyUpdated } from "../../lib/collections";
import { formatHost } from "../../lib/links";
import { emptyStateFor, searchAll } from "../../lib/search";
import type { SearchResults } from "../../lib/search";
import { nextHighlight, resolveHighlight } from "../../lib/searchNav";
import { openConfirmMessage, planSearchOpen, selectLabel } from "../../lib/searchSelection";
import { emptySelection, nextSelection, pruneSelection } from "../../lib/selection";
import type { SelectionState } from "../../lib/selection";
import { openFailureMessage, openLinks } from "../../lib/restore";
import { SaveSplitButton } from "./SaveSplitButton";
import { FolderRow } from "./FolderRow";
import { ProBanner } from "./ProBanner";
import { ProBadge } from "../dashboard/ProBadge";
import type { ProBadgeState } from "../../lib/proBadge";
import type { Plan } from "../../lib/auth";

const EMPTY_SEARCH_RESULTS: SearchResults = { collections: [], links: [] };
const SEARCH_DEBOUNCE_MS = 150;
/**
 * Show at most this many combined results, collections first.
 *
 * Was 8, for a deliberately compact popup body. Raised for cross-folder
 * open-all (#17): the whole point is "every client's Meta link at once", and
 * with a folder per client 8 rows silently hid most of them — which would
 * make this surface's "Open all" mean something different from the same
 * button in the dashboard. The list already scrolls (`max-h-72
 * overflow-y-auto`), so the extra rows cost scroll, not layout. Still below
 * `MAX_SEARCH_RESULTS` so the popup stays the lighter of the two surfaces.
 */
const POPUP_SEARCH_LIMIT = 50;

type SortMode = "manual" | "recent" | "az";

export interface FoldersHomeProps {
  collections: Collection[];
  collectionsLoaded: boolean;
  /** Both tabs snapshot + collections loaded — gates the Save control. */
  dataLoaded: boolean;
  plan: Plan | null;
  /** Which "PRO" chip to show next to the wordmark — App computes this via lib/proBadge.ts's `proBadgeState` ("hidden" on builds with no cloud backend). */
  proBadge: ProBadgeState;
  /** The muted chip's click-through: opens the dashboard Settings tab (the upgrade path). */
  onUpgradeToPro: () => void;
  allCount: number;
  selectedCount: number;
  /** False when there's no saveable current tab (chrome:// etc.). */
  canAddCurrent: boolean;
  /** Resolved one-click Save target name, shown on the "Saving to {folder}" line; null when a folder must still be chosen. */
  targetName: string | null;
  onSaveCurrent: () => void;
  onSaveAll: () => void;
  onSaveAllChoose: () => void;
  onSaveAllNewAiFolder: () => void;
  onSaveSelected: () => void;
  /** Open the picker to change the one-click Save target (the "Change" button + "Choose a folder…"). */
  onChangeTarget: () => void;
  /** Open the picker and pin the choice as the default folder. */
  onChangeDefault: () => void;
  onOpenFolder: (collectionId: string) => void;
  onAddCurrent: (collectionId: string) => Promise<void>;
  onError: (message: string) => void;
}

const SORT_LABEL: Record<SortMode, string> = { manual: "Added", recent: "Recent", az: "A–Z" };
const NEXT_SORT: Record<SortMode, SortMode> = { manual: "recent", recent: "az", az: "manual" };

function sortCollections(collections: Collection[], mode: SortMode): Collection[] {
  if (mode === "az") return [...collections].sort((a, b) => a.name.localeCompare(b.name));
  if (mode === "recent") return sortByRecentlyUpdated(collections);
  // "manual" = creation order: listCollections already returns rows by position
  // ascending, and createCollection appends at the end, so a new folder lands
  // at the bottom of the list right where it was made.
  return collections;
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
    proBadge,
    onUpgradeToPro,
    allCount,
    selectedCount,
    canAddCurrent,
    targetName,
    onSaveCurrent,
    onSaveAll,
    onSaveAllChoose,
    onSaveAllNewAiFolder,
    onSaveSelected,
    onChangeTarget,
    onChangeDefault,
    onOpenFolder,
    onAddCurrent,
    onError,
  } = props;

  const db = getDB();
  const [sort, setSort] = useState<SortMode>("manual");

  // ---- Search combobox (same shape as the pre-redesign App search) --------
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResults>(EMPTY_SEARCH_RESULTS);
  const [searchSettledQuery, setSearchSettledQuery] = useState("");
  const [searchHighlight, setSearchHighlight] = useState(-1);
  // Ticked results for a cross-folder bulk open (#17) — same `lib/selection.ts`
  // model as the folder-detail list, and the same inline two-step confirm as
  // the dashboard overlay for a large batch.
  const [searchSelection, setSearchSelection] = useState<SelectionState>(emptySelection);
  const [confirmingOpen, setConfirmingOpen] = useState(false);
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
  const shownLinkIds = shownLinks.map((l) => l.id);
  // Planned off `shownLinks`, NOT `searchResults.links`: the popup slices its
  // results, and "Open all 12" must mean the 12 rows on screen.
  const openPlan = planSearchOpen(shownLinks, searchSelection.selected);

  // A new result set replaces the rows the ticks referred to — drop the stale
  // ones. `pruneSelection` returns the same object when nothing changed.
  useEffect(() => {
    setSearchSelection((s) => pruneSelection(s, shownLinks.map((l) => l.id)));
    setConfirmingOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the results identity; shownLinks is derived from it each render
  }, [searchResults]);

  function toggleSearchSelect(id: string, shiftKey: boolean) {
    setConfirmingOpen(false);
    setSearchSelection((s) =>
      nextSelection(s, shiftKey ? { type: "range", id, order: shownLinkIds } : { type: "toggle", id }),
    );
  }

  async function runSearchOpen() {
    if (openPlan.count === 0) return;
    if (openPlan.needsConfirm && !confirmingOpen) {
      setConfirmingOpen(true);
      return;
    }
    setConfirmingOpen(false);
    // Background tabs via the shared helper, so the popup stays open and the
    // user can keep picking — same policy as the folder-detail "Open N".
    const result = await openLinks(openPlan.urls);
    if (result.failed > 0) onError(openFailureMessage(result.failed));
  }

  function activateSearchResult(index: number) {
    const target = resolveHighlight(index, shownCollections.length);
    if (!target) return;
    if (target.kind === "collection") {
      const c = shownCollections[target.index];
      if (c) onOpenFolder(c.id);
      return;
    }
    const l = shownLinks[target.index];
    // Foreground open (see LinkRow's `openLink` for why this doesn't route
    // through `openLinks`), with the same `normalizeUrl` repair for links
    // saved schemeless before `addLink` started normalizing (issue #24).
    if (l) {
      chrome.tabs.create({ url: normalizeUrl(l.url), active: true }).catch(() => {
        onError(openFailureMessage(1));
      });
    }
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
  // Guards Enter-then-blur from creating the same folder twice, and lets
  // Escape suppress the blur that firing setCreating(false) triggers.
  const submittingRef = useRef(false);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (creating) newNameRef.current?.focus();
  }, [creating]);

  // Confirm on Enter OR on click-away (blur). On success we stay on the home
  // list (no drilling into the new folder) so it appears at the bottom, right
  // where it was made, ready to rename or fill.
  async function handleCreateFolder() {
    if (submittingRef.current) return;
    const name = newName.trim();
    if (!name) {
      setCreating(false);
      return;
    }
    submittingRef.current = true;
    setCreateError(null);
    try {
      await createCollection(name, undefined, db);
      setNewName("");
      setCreating(false);
    } catch (err) {
      setCreateError(friendlyCreateError(err));
    } finally {
      submittingRef.current = false;
    }
  }

  function handleCreateBlur() {
    if (cancelRef.current) {
      cancelRef.current = false;
      return;
    }
    void handleCreateFolder();
  }

  function cancelCreate() {
    cancelRef.current = true;
    setCreating(false);
    setNewName("");
    setCreateError(null);
  }

  const ordered = sortCollections(collections, sort);

  return (
    <div className="flex flex-col gap-3">
      <header className="flex items-center justify-between gap-2">
        {/* If width pressure ever returns (long locales, font scaling), the
            wordmark truncates; the badge and the search/Save controls are
            shrink-0 so flexbox can never crush them into overlapping. */}
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="min-w-0 truncate text-lg font-bold text-[var(--text)]" style={{ fontFamily: "var(--font-display)" }}>
            TabBurrow
          </h1>
          <ProBadge state={proBadge} onUpgrade={onUpgradeToPro} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            aria-label={searchOpen ? "Close search" : "Search collections and links"}
            aria-pressed={searchOpen}
            onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-card)] border border-[var(--line)] text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            {searchOpen ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.2-3.2" />
              </svg>
            )}
          </button>
          <SaveSplitButton
            onSaveCurrent={onSaveCurrent}
            onSaveAll={onSaveAll}
            onSaveAllChoose={onSaveAllChoose}
            onSaveAllNewAiFolder={onSaveAllNewAiFolder}
            onSaveSelected={onSaveSelected}
            onChangeDefault={onChangeDefault}
            allCount={allCount}
            selectedCount={selectedCount}
            targetName={targetName}
            disabled={!dataLoaded}
          />
        </div>
      </header>

      {dataLoaded ? (
        <div className="flex items-center gap-2.5 rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--bg-well)] px-2.5 py-2">
          <span
            aria-hidden="true"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--accent-2)_18%,transparent)] text-[var(--accent-2)]"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="8" />
              <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
              <path d="M12 2v2M12 20v2M2 12h2M20 12h2" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-2)]">
              1-click Save goes to
            </p>
            <p className="truncate text-sm font-medium text-[var(--text)]">{targetName ?? "a folder you choose"}</p>
          </div>
          <button
            type="button"
            onClick={onChangeTarget}
            className="shrink-0 rounded-[8px] border border-[var(--line-hi)] bg-[var(--surface)] px-2.5 py-1 text-xs font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            {targetName ? "Change" : "Choose"}
          </button>
        </div>
      ) : null}

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
                      // Grid, not flex: ResultRow is `w-full`, which inside a
                      // flex row would resolve to the full wrapper width and
                      // overflow by the checkbox's width. A `minmax(0,1fr)`
                      // track bounds it so the row truncates instead.
                      <div key={l.id} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-1.5">
                        {/* Sibling of the role="option" button, not a child:
                            an interactive control inside a <button> is invalid
                            HTML, and keeping them separate leaves the existing
                            combobox keyboard contract untouched. */}
                        <SelectBox
                          checked={searchSelection.selected.has(l.id)}
                          label={selectLabel(l.title)}
                          onToggle={(shiftKey) => toggleSearchSelect(l.id, shiftKey)}
                        />
                        <ResultRow
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
                          {/* The folder/client this link lives in, ordered
                              BEFORE the host: with one folder per client, "which
                              client is this?" is the thing a cross-folder search
                              can't answer from the title alone (#17). `searchAll`
                              already attaches collectionName, so this needs no
                              new data. Capped width so a long folder name can't
                              crowd out the title. */}
                          <span
                            className="max-w-[44%] shrink truncate text-xs text-[var(--text-2)]"
                            style={{ fontFamily: "var(--font-mono)" }}
                          >
                            {l.collectionName} · {formatHost(l.url)}
                          </span>
                        </ResultRow>
                      </div>
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

          {/* Outside the scrolling list, so it stays reachable no matter how
              many folders matched. */}
          {searchQuery.trim().length > 0 && shownLinks.length > 0 ? (
            <div className="flex items-center gap-2 border-t border-[var(--line)] pt-2">
              <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-2)]">
                {confirmingOpen
                  ? openConfirmMessage(openPlan.count)
                  : searchSelection.selected.size > 0
                    ? `${searchSelection.selected.size} selected`
                    : "Tick rows, or open every match"}
              </span>

              {searchSelection.selected.size > 0 && !confirmingOpen ? (
                <button
                  type="button"
                  onClick={() => setSearchSelection(emptySelection())}
                  className="shrink-0 rounded-[6px] px-1.5 py-0.5 text-xs text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  Clear
                </button>
              ) : null}

              {confirmingOpen ? (
                <button
                  type="button"
                  onClick={() => setConfirmingOpen(false)}
                  className="shrink-0 rounded-[6px] px-1.5 py-0.5 text-xs text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  Cancel
                </button>
              ) : null}

              <button
                type="button"
                onClick={() => void runSearchOpen()}
                className="shrink-0 rounded-[8px] bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-[var(--btn-fg)] hover:brightness-110 active:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-ground)]"
              >
                {confirmingOpen ? `Open ${openPlan.count} tabs` : openPlan.label}
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-2)]">Folders</h2>
            <button
              type="button"
              aria-label={`Sort folders: ${SORT_LABEL[sort]}. Change`}
              onClick={() => setSort((s) => NEXT_SORT[s])}
              className="rounded-[6px] px-1.5 py-0.5 text-xs text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              {SORT_LABEL[sort]}
            </button>
          </div>

          <div className="flex max-h-72 flex-col gap-1 overflow-y-auto py-0.5">
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
                    e.preventDefault();
                    cancelCreate();
                  }
                }}
                onBlur={handleCreateBlur}
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

/** The per-result tick. `tabIndex={-1}` keeps real focus on the search input — the combobox's arrow-key navigation dies the moment Tab can land on a row. */
function SelectBox({
  checked,
  label,
  onToggle,
}: {
  checked: boolean;
  label: string;
  onToggle: (shiftKey: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      tabIndex={-1}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(e.shiftKey);
      }}
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
        checked
          ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--btn-fg)]"
          : "border-[var(--line-hi)] bg-[var(--surface)] hover:border-[var(--accent)]"
      }`}
    >
      {checked ? (
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : null}
    </button>
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

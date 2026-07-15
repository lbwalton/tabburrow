import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { Collection, Link } from "@tabburrow/core";
import { Dialog, Input, Kbd } from "@tabburrow/ui";
import type { SearchResults } from "../../lib/search";
import { emptyStateFor, searchAll } from "../../lib/search";
import { nextHighlight, resolveHighlight } from "../../lib/searchNav";
import { openFailureMessage, openLinks } from "../../lib/restore";
import { collectionHash } from "../../lib/dashboard";
import { formatHost } from "../../lib/links";
import { faviconFor } from "../../lib/tabs";

const EMPTY_RESULTS: SearchResults = { collections: [], links: [] };
const DEBOUNCE_MS = 150;

export interface SearchOverlayProps {
  onError: (message: string) => void;
}

/**
 * The dashboard's global fuzzy search: Cmd/Ctrl+K anywhere, or `/` when
 * focus isn't in a text field, opens a top-aligned `Dialog` with an
 * autofocused search box. Self-contained (owns its own open/query/results/
 * highlight state) and mounted unconditionally in `App.tsx` — like
 * `RestoreAllButton`'s confirm dialog, it's always in the tree, just
 * visually absent until `open` flips.
 *
 * Query -> results is debounced 150ms via a single effect (see the
 * `useEffect` below): a plain `setTimeout` whose cleanup both clears the
 * pending timer AND flags any in-flight `searchAll` call as stale, so a
 * fast second keystroke can't have its OWN result overwritten by an
 * earlier, slower-resolving search's response landing after it.
 *
 * ArrowUp/ArrowDown move `highlight` — a flat index across Collections then
 * Links (`lib/searchNav.ts`'s `nextHighlight`/`resolveHighlight`, shared
 * with the popup's inline results) — Enter or a click activates whatever's
 * highlighted: a link opens as a background tab (dashboard keeps focus,
 * same `lib/restore.ts` policy every other "open" in this app follows) and
 * a collection navigates via the hash router. Either activation closes the
 * overlay; Escape (native `<dialog>` cancel, handled by `Dialog` itself)
 * and a backdrop click do too.
 */
export function SearchOverlay({ onError }: SearchOverlayProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
  // The exact query string whose searchAll response last landed. Until it
  // equals `query`, `results` is stale/pending — `emptyStateFor` uses this
  // to suppress a false "No results" flash during the debounce+query window.
  const [settledQuery, setSettledQuery] = useState("");
  const [highlight, setHighlight] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global open shortcuts. Cmd/Ctrl+K works from anywhere (even inside a
  // text field) and toggles; "/" only opens when it wouldn't otherwise be
  // typed into something — an input/textarea/contenteditable currently
  // focused (including this overlay's OWN search box once it's open).
  useEffect(() => {
    function handleGlobalKeyDown(event: globalThis.KeyboardEvent) {
      const isCmdK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (isCmdK) {
        event.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (event.key === "/" && !open) {
        const target = event.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
        event.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [open]);

  // Autofocus the search box every time the overlay opens (not just on
  // first mount — the content persists mounted while closed, same as
  // RestoreAllButton's confirm Dialog, so React's own `autoFocus` prop
  // would only fire once).
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Reset ALL overlay state on every close, however it happened (Escape,
  // backdrop click, or an explicit activation below) — one place, so
  // reopening always starts from a clean search box rather than the
  // previous query/results/highlight.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults(EMPTY_RESULTS);
      setSettledQuery("");
      setHighlight(-1);
    }
  }, [open]);

  // Debounced query -> results, with stale-response protection: if `query`
  // changes again before this effect's timer fires (or before its
  // `searchAll` call resolves), the cleanup below flips `cancelled` so that
  // response is dropped instead of clobbering a newer one.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(EMPTY_RESULTS);
      setSettledQuery("");
      setHighlight(-1);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchAll(query).then((r) => {
        if (cancelled) return;
        setResults(r);
        setSettledQuery(query);
        setHighlight(r.collections.length + r.links.length > 0 ? 0 : -1);
      });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const total = results.collections.length + results.links.length;

  function activate(index: number) {
    const target = resolveHighlight(index, results.collections.length);
    if (!target) return;
    if (target.kind === "collection") {
      const c = results.collections[target.index];
      if (!c) return;
      window.location.hash = collectionHash(c.id);
      setOpen(false);
      return;
    }
    const l = results.links[target.index];
    if (!l) return;
    setOpen(false);
    void openLinks([l.url]).then((r) => {
      if (r.failed > 0) onError(openFailureMessage(r.failed));
    });
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((h) => nextHighlight(h, "ArrowDown", total));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((h) => nextHighlight(h, "ArrowUp", total));
    } else if (event.key === "Enter") {
      if (total === 0) return;
      event.preventDefault();
      activate(highlight);
    }
    // Escape is handled natively by the <dialog> element (Dialog.tsx's own
    // "close" listener) — not intercepted here.
  }

  const activeId = highlight >= 0 ? `dashboard-search-option-${highlight}` : undefined;

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      title="Search"
      className="mt-[10vh] mb-auto"
      footer={
        <span className="flex items-center gap-3 text-xs text-[var(--text-2)]">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navigate
          </span>
          <span className="flex items-center gap-1">
            <Kbd>Enter</Kbd> open
          </span>
          <span className="flex items-center gap-1">
            <Kbd>Esc</Kbd> close
          </span>
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        <Input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={total > 0}
          aria-controls="dashboard-search-listbox"
          aria-activedescendant={activeId}
          aria-label="Search collections and links"
          placeholder="Search collections and links…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleInputKeyDown}
        />

        <div id="dashboard-search-listbox" role="listbox" aria-label="Search results" className="flex max-h-96 flex-col gap-3 overflow-y-auto">
          {results.collections.length > 0 ? (
            <ResultGroup label="Collections">
              {results.collections.map((c, i) => (
                <CollectionRow
                  key={c.id}
                  id={`dashboard-search-option-${i}`}
                  collection={c}
                  highlighted={highlight === i}
                  onActivate={() => activate(i)}
                />
              ))}
            </ResultGroup>
          ) : null}

          {results.links.length > 0 ? (
            <ResultGroup label="Links">
              {results.links.map((l, i) => {
                const flatIndex = results.collections.length + i;
                return (
                  <LinkRow
                    key={l.id}
                    id={`dashboard-search-option-${flatIndex}`}
                    link={l}
                    highlighted={highlight === flatIndex}
                    onActivate={() => activate(flatIndex)}
                  />
                );
              })}
            </ResultGroup>
          ) : null}

          {emptyStateFor(query, settledQuery, total) === "no-results" ? (
            <p className="px-1 py-2 text-sm text-[var(--text-2)]">No results for &ldquo;{query.trim()}&rdquo;.</p>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}

function ResultGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-2)]">{label}</h3>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function OptionRow({
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
      // Options are virtually highlighted via the input's
      // aria-activedescendant (combobox pattern) — real DOM focus stays on
      // the input. Without this, Tab lands on a row and arrow-key nav dies.
      tabIndex={-1}
      onClick={onActivate}
      style={{ boxShadow: highlighted ? "2px 0 0 var(--accent) inset" : undefined }}
      className={`flex w-full items-center gap-2 rounded-[4px] px-2 py-1.5 text-left text-sm ${
        highlighted ? "bg-[var(--surface-hover)] text-[var(--text)]" : "text-[var(--text)] hover:bg-[var(--surface-hover)]"
      }`}
    >
      {children}
    </button>
  );
}

function CollectionRow({
  id,
  collection,
  highlighted,
  onActivate,
}: {
  id: string;
  collection: Collection;
  highlighted: boolean;
  onActivate: () => void;
}) {
  return (
    <OptionRow id={id} highlighted={highlighted} onActivate={onActivate}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: collection.accent ?? "var(--text-2)" }} />
      <span className="truncate">{collection.name}</span>
    </OptionRow>
  );
}

function LinkRow({
  id,
  link,
  highlighted,
  onActivate,
}: {
  id: string;
  link: Link & { collectionName: string };
  highlighted: boolean;
  onActivate: () => void;
}) {
  return (
    <OptionRow id={id} highlighted={highlighted} onActivate={onActivate}>
      <img
        src={link.faviconUrl ?? faviconFor(link.url)}
        alt=""
        width={14}
        height={14}
        className="shrink-0 rounded-[3px]"
        onError={(e) => {
          e.currentTarget.style.visibility = "hidden";
        }}
      />
      <span className="min-w-0 flex-1 truncate">{link.title}</span>
      <span className="shrink-0 truncate text-xs text-[var(--text-2)]" style={{ fontFamily: "var(--font-mono)" }}>
        {formatHost(link.url)} · {link.collectionName}
      </span>
    </OptionRow>
  );
}

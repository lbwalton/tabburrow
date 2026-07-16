import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Collection, Link } from "@tabburrow/core";
import { getDB, renameCollection } from "@tabburrow/core";
import { Button, EmptyState } from "@tabburrow/ui";
import type { ResolvedRoute } from "../../lib/route";
import { collectionHash } from "../../lib/dashboard";
import type { SortMode } from "../../lib/links";
import { onAuthChange } from "../../lib/auth";
import { isSupabaseConfigured } from "../../lib/supabase";
import { AiOrganizeDialog } from "./AiOrganizeDialog";
import { BurrowIllustration } from "./BurrowIllustration";
import { useInlineRename } from "./useInlineRename";
import { LinkGrid } from "./LinkGrid";
import { SortMenu } from "./SortMenu";
import { RestoreAllButton } from "./RestoreAllButton";
import { SessionsPane } from "./SessionsPane";
import { SettingsPane } from "./SettingsPane";

export interface DashboardMainProps {
  route: ResolvedRoute;
  collections: Collection[];
  /** The active collection's links (position-ordered), lifted to `App` so the single `DndContext`'s `onDragEnd` can reach the same optimistic order this renders with. Empty/stale when no collection route is active. */
  links: Link[];
  linksLoaded: boolean;
  linkOrder: string[];
  sortMode: SortMode;
  onSortModeChange: (mode: SortMode) => void;
  onLinkError: (message: string) => void;
  /** Notifies `App` after a link-delete succeeds, so it can show the 6s Undo toast. */
  onLinksDeleted: (ids: string[]) => void;
  onCreateFirstCollection: () => void;
  /** T20: pulses `true` once when the popup's "Save all + organize" deep link (`?organize=1`, consumed by `useRoute`) targets THIS route — CollectionPanel auto-opens AiOrganizeDialog in response. */
  autoOpenOrganize: boolean;
  /** T20: notifies `App` after AI organize applies, so it can show the "Organized N links into M collections" toast. */
  onOrganized: (message: string) => void;
}

/** The dashboard's main area: routes to a collection panel, the sessions pane, the settings pane, or one of the empty states. */
export function DashboardMain({
  route,
  collections,
  links,
  linksLoaded,
  linkOrder,
  sortMode,
  onSortModeChange,
  onLinkError,
  onLinksDeleted,
  onCreateFirstCollection,
  autoOpenOrganize,
  onOrganized,
}: DashboardMainProps) {
  if (route.kind === "sessions") {
    return <SessionsPane onError={onLinkError} />;
  }

  if (route.kind === "settings") {
    return <SettingsPane />;
  }

  // No collections exist at all — either the route resolver said so
  // directly ("empty"), or it's a stale/unknown collection id with no
  // remaining collection to fall back to.
  if (route.kind === "empty" || (route.kind === "not-found" && route.fallbackId === null)) {
    return (
      <Centered>
        <EmptyState
          title="Nothing here yet"
          description="Create a collection to start saving tabs from the popup."
          illustration={<BurrowIllustration />}
          action={<Button onClick={onCreateFirstCollection}>New collection</Button>}
        />
      </Centered>
    );
  }

  if (route.kind === "not-found") {
    return (
      <Centered>
        <EmptyState
          title="Collection not found"
          description="That collection doesn't exist anymore."
          illustration={<BurrowIllustration />}
          action={
            <Button onClick={() => (window.location.hash = collectionHash(route.fallbackId!))}>
              Back to your collections
            </Button>
          }
        />
      </Centered>
    );
  }

  const collection = collections.find((c) => c.id === route.id);
  // resolveRoute only ever emits `{kind:"collection", id}` for an id present
  // in `collections` (see lib/route.ts) — this is a defensive fallback for
  // the impossible case, not an expected path.
  if (!collection) return null;

  return (
    <CollectionPanel
      collection={collection}
      collections={collections}
      links={links}
      linksLoaded={linksLoaded}
      linkOrder={linkOrder}
      sortMode={sortMode}
      onSortModeChange={onSortModeChange}
      onLinkError={onLinkError}
      onLinksDeleted={onLinksDeleted}
      autoOpenOrganize={autoOpenOrganize}
      onOrganized={onOrganized}
    />
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex h-full items-center justify-center">{children}</div>;
}

interface CollectionPanelProps {
  collection: Collection;
  collections: Collection[];
  links: Link[];
  linksLoaded: boolean;
  linkOrder: string[];
  sortMode: SortMode;
  onSortModeChange: (mode: SortMode) => void;
  onLinkError: (message: string) => void;
  onLinksDeleted: (ids: string[]) => void;
  autoOpenOrganize: boolean;
  onOrganized: (message: string) => void;
}

function CollectionPanel({
  collection,
  collections,
  links,
  linksLoaded,
  linkOrder,
  sortMode,
  onSortModeChange,
  onLinkError,
  onLinksDeleted,
  autoOpenOrganize,
  onOrganized,
}: CollectionPanelProps) {
  const db = getDB();
  const rename = useInlineRename({
    value: collection.name,
    onCommit: (name) => void renameCollection(collection.id, name, db),
  });

  // T20: "Organize with AI" — own its open state (like RestoreAllButton's
  // confirm dialog) AND respond to the popup deep link's one-shot pulse.
  // `signedIn` is ONLY for the trigger button's lock glyph; AiOrganizeDialog
  // subscribes to auth itself for its own view logic (same "leaf components
  // own their auth state" precedent AccountPane/popup's App already set).
  const [aiOpen, setAiOpen] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    return onAuthChange((user) => setSignedIn(!!user));
  }, []);
  useEffect(() => {
    if (autoOpenOrganize) setAiOpen(true);
  }, [autoOpenOrganize]);

  return (
    <div className="flex h-full flex-col px-8 py-8">
      <header className="mb-6 flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3">
          {rename.editing ? (
            <input
              ref={rename.inputRef}
              value={rename.draft}
              onChange={(e) => rename.setDraft(e.target.value)}
              {...rename.inputHandlers}
              className="border-b border-[var(--line-hi)] bg-transparent text-3xl font-bold text-[var(--text)] outline-none"
              style={{ fontFamily: "var(--font-display)" }}
            />
          ) : (
            <h1
              onDoubleClick={rename.start}
              title="Double-click to rename"
              className="text-3xl font-bold text-[var(--text)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {collection.name}
            </h1>
          )}
          <span className="text-xs text-[var(--text-2)]" style={{ fontFamily: "var(--font-mono)" }}>
            {linksLoaded ? `${links.length} ${links.length === 1 ? "link" : "links"}` : ""}
          </span>
        </div>
        {linksLoaded && links.length > 0 ? (
          <div className="flex items-center gap-2">
            <RestoreAllButton links={links} onError={onLinkError} />
            <Button type="button" variant="ghost" size="sm" onClick={() => setAiOpen(true)}>
              {signedIn ? "Organize with AI" : "🔒 Organize with AI"}
            </Button>
            <SortMenu value={sortMode} onChange={onSortModeChange} />
          </div>
        ) : null}
      </header>

      <div className="flex-1">
        {!linksLoaded ? null : links.length === 0 ? (
          <EmptyState
            title="No links yet"
            description="Save some tabs from the popup to see them here."
            illustration={<BurrowIllustration />}
          />
        ) : (
          <LinkGrid
            collectionId={collection.id}
            links={links}
            order={linkOrder}
            sortMode={sortMode}
            collections={collections}
            onLinkError={onLinkError}
            onLinksDeleted={onLinksDeleted}
          />
        )}
      </div>

      <AiOrganizeDialog
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        collectionId={collection.id}
        collectionName={collection.name}
        links={links}
        collections={collections}
        onError={onLinkError}
        onOrganized={onOrganized}
      />
    </div>
  );
}

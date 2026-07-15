import type { ReactNode } from "react";
import type { Collection, Link } from "@tabburrow/core";
import { getDB, renameCollection } from "@tabburrow/core";
import { Button, EmptyState } from "@tabburrow/ui";
import type { ResolvedRoute } from "../../lib/route";
import { collectionHash } from "../../lib/dashboard";
import type { SortMode } from "../../lib/links";
import { BurrowIllustration } from "./BurrowIllustration";
import { useInlineRename } from "./useInlineRename";
import { LinkGrid } from "./LinkGrid";
import { SortMenu } from "./SortMenu";
import { RestoreAllButton } from "./RestoreAllButton";
import { SessionsPane } from "./SessionsPane";

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
}

/** The dashboard's main area: routes to a collection panel, the sessions pane, a settings placeholder, or one of the empty states. */
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
}: DashboardMainProps) {
  if (route.kind === "sessions") {
    return <SessionsPane onError={onLinkError} />;
  }

  if (route.kind === "settings") {
    return (
      <Centered>
        <EmptyState
          title="Settings"
          description="Theme, sign-in, import/export, and shortcuts land in a later task."
          illustration={<BurrowIllustration />}
        />
      </Centered>
    );
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
}: CollectionPanelProps) {
  const db = getDB();
  const rename = useInlineRename({
    value: collection.name,
    onCommit: (name) => void renameCollection(collection.id, name, db),
  });

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
    </div>
  );
}

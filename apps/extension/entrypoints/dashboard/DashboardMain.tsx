import { useLiveQuery } from "dexie-react-hooks";
import type { ReactNode } from "react";
import type { Collection } from "@tabburrow/core";
import { getDB, listLinks, renameCollection } from "@tabburrow/core";
import { Button, EmptyState } from "@tabburrow/ui";
import type { ResolvedRoute } from "../../lib/route";
import { collectionHash } from "../../lib/dashboard";
import { BurrowIllustration } from "./BurrowIllustration";
import { useInlineRename } from "./useInlineRename";

export interface DashboardMainProps {
  route: ResolvedRoute;
  collections: Collection[];
  onCreateFirstCollection: () => void;
}

/** The dashboard's main area: routes to a collection panel, a sessions/settings placeholder, or one of the empty states. */
export function DashboardMain({ route, collections, onCreateFirstCollection }: DashboardMainProps) {
  if (route.kind === "sessions") {
    return (
      <Centered>
        <EmptyState
          title="Sessions"
          description="Window snapshots and crash restore land in a later task."
          illustration={<BurrowIllustration />}
        />
      </Centered>
    );
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

  return <CollectionPanel collection={collection} />;
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex h-full items-center justify-center">{children}</div>;
}

function CollectionPanel({ collection }: { collection: Collection }) {
  const db = getDB();
  const links = useLiveQuery(() => listLinks(collection.id, db), [collection.id]);
  const rename = useInlineRename({
    value: collection.name,
    onCommit: (name) => void renameCollection(collection.id, name, db),
  });

  return (
    <div className="flex h-full flex-col px-8 py-8">
      <header className="mb-6 flex items-baseline gap-3">
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
          {links === undefined ? "" : `${links.length} ${links.length === 1 ? "link" : "links"}`}
        </span>
      </header>

      <div className="flex-1">
        {links === undefined ? null : links.length === 0 ? (
          <EmptyState
            title="No links yet"
            description="Save some tabs from the popup to see them here."
            illustration={<BurrowIllustration />}
          />
        ) : (
          // TEMP (T8 placeholder): T9 replaces this line with the real link
          // grid (favicon cards, drag reorder, multi-select, bulk actions).
          <p className="text-sm text-[var(--text-2)]">
            {links.length} saved {links.length === 1 ? "link" : "links"} — grid view lands in T9.
          </p>
        )}
      </div>
    </div>
  );
}

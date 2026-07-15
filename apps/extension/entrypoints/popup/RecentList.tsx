import { useLiveQuery } from "dexie-react-hooks";
import { getDB, listLinks } from "@tabburrow/core";
import type { Collection } from "@tabburrow/core";
import { Badge } from "@tabburrow/ui";
import { recentCollections } from "../../lib/collections";
import { dashboardCollectionUrl } from "../../lib/dashboard";

export interface RecentListProps {
  collections: Collection[];
}

function RecentRow({ collection }: { collection: Collection }) {
  const db = getDB();
  const count = useLiveQuery(() => listLinks(collection.id, db).then((links) => links.length), [collection.id]);

  function open() {
    chrome.tabs.create({ url: dashboardCollectionUrl(collection.id) });
  }

  return (
    <button
      type="button"
      onClick={open}
      className="flex w-full items-center gap-2 rounded-[var(--radius-card)] px-2 py-1.5 text-left text-sm text-[var(--text)] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: collection.accent ?? "var(--text-2)" }}
      />
      <span className="flex-1 truncate">{collection.name}</span>
      <Badge variant="muted">{count ?? 0}</Badge>
    </button>
  );
}

/** The 5 most recently updated collections; clicking one opens the dashboard focused on it. */
export function RecentList({ collections }: RecentListProps) {
  const recents = recentCollections(collections, 5);
  if (recents.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <h2 className="px-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-2)]">
        Recent
      </h2>
      {recents.map((collection) => (
        <RecentRow key={collection.id} collection={collection} />
      ))}
    </div>
  );
}

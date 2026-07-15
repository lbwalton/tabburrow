import type { Collection } from "@tabburrow/core";

/** Newest-updated first. Does not mutate the input array. */
export function sortByRecentlyUpdated(collections: Collection[]): Collection[] {
  return [...collections].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** The `limit` most recently updated collections, newest first. Default 5 (RecentList). */
export function recentCollections(collections: Collection[], limit = 5): Collection[] {
  return sortByRecentlyUpdated(collections).slice(0, limit);
}

/**
 * Case-insensitive substring match on name, for the popup's CollectionPicker
 * search box. T11 upgrades this to real fuzzy search.
 */
export function filterCollectionsByName(collections: Collection[], query: string): Collection[] {
  const q = query.trim().toLowerCase();
  if (!q) return collections;
  return collections.filter((c) => c.name.toLowerCase().includes(q));
}

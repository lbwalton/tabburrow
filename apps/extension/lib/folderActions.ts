import type { BurrowDB, Link, TabInfo } from "@tabburrow/core";
import { addLink, getDB, overwriteTabs, saveTabs } from "@tabburrow/core";
import { faviconFor } from "./tabs";

/**
 * The folder-detail screen's mutating actions, each a thin wrapper over exactly
 * one `packages/core` repo function with the extension-side favicon decoration
 * applied first. Kept in `lib/` (not inline in FolderDetail.tsx) so the wiring
 * — which core function each action calls, and with what arguments — is unit
 * testable against a fake-indexeddb DB without rendering React.
 *
 * `favicon` is injectable purely so tests can pass a chrome-free stub; the
 * default is the real `faviconFor` (which resolves through `chrome.runtime`).
 * Sync nudging is deliberately NOT done here — the component fires
 * `sendSyncNudge()` after awaiting, matching how App.tsx's `performSave` keeps
 * that side channel out of the data call.
 */

function withFavicons(tabs: TabInfo[], favicon: (url: string) => string): TabInfo[] {
  return tabs.map((tab) => ({ ...tab, faviconUrl: favicon(tab.url) }));
}

/** Append every given tab to the folder (dedupe by URL in place, like Save all). */
export function appendTabsToFolder(
  collectionId: string,
  tabs: TabInfo[],
  db: BurrowDB = getDB(),
  favicon: (url: string) => string = faviconFor,
): Promise<Link[]> {
  return saveTabs(collectionId, withFavicons(tabs, favicon), db);
}

/** Replace the folder's live links with the given tabs (destructive — gated behind a confirm in the UI). */
export function overwriteFolderWithTabs(
  collectionId: string,
  tabs: TabInfo[],
  db: BurrowDB = getDB(),
  favicon: (url: string) => string = faviconFor,
): Promise<Link[]> {
  return overwriteTabs(collectionId, withFavicons(tabs, favicon), db);
}

/** Add one manually-entered link (core fills a hostname title when none is given). */
export function addLinkToFolder(
  collectionId: string,
  input: { url: string; title?: string },
  db: BurrowDB = getDB(),
): Promise<Link> {
  return addLink(collectionId, input, db);
}

/** Add a single tab (typically the current one) to the folder in place. */
export function addTabToFolder(
  collectionId: string,
  tab: TabInfo,
  db: BurrowDB = getDB(),
  favicon: (url: string) => string = faviconFor,
): Promise<Link[]> {
  return saveTabs(collectionId, withFavicons([tab], favicon), db);
}

import type { TabInfo } from "@tabburrow/core";

/** True for ordinary http(s) pages; false for chrome://, extension pages, file://, about:blank, etc. */
export function isHttpUrl(url: string | undefined): url is string {
  if (!url) return false;
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Discarded (and some back-forward-cache) tabs can report an undefined or
 * empty title; fall back to the URL's hostname so saved links never show a
 * blank name.
 */
export function titleForTab(tab: { title?: string; url?: string }): string {
  if (tab.title) return tab.title;
  if (tab.url) {
    try {
      return new URL(tab.url).hostname;
    } catch {
      return tab.url;
    }
  }
  return "";
}

/** Pure mapping from a chrome.tabs.Tab-shaped object to a TabInfo — no chrome.* calls. */
export function toTabInfo(tab: { title?: string; url?: string }): TabInfo {
  return { url: tab.url ?? "", title: titleForTab(tab) };
}

/** Pure filter+map: http(s)-only tabs, in their given order. Shared by getAllTabs/getHighlightedTabs. */
export function filterTabs(tabs: Array<{ title?: string; url?: string }>): TabInfo[] {
  return tabs.filter((t) => isHttpUrl(t.url)).map(toTabInfo);
}

/** The active tab in the current window. Throws if it isn't an http(s) page. */
export async function getCurrentTab(): Promise<TabInfo> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const [info] = filterTabs(tab ? [tab] : []);
  if (!info) {
    throw new Error("No active tab to save (only http/https pages can be saved).");
  }
  return info;
}

/** Every http(s) tab in the current window. */
export async function getAllTabs(): Promise<TabInfo[]> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  return filterTabs(tabs);
}

/** The highlighted (multi-selected) http(s) tabs in the current window. */
export async function getHighlightedTabs(): Promise<TabInfo[]> {
  const tabs = await chrome.tabs.query({ currentWindow: true, highlighted: true });
  return filterTabs(tabs);
}

/** Closes exactly the open tabs (in the current window) whose URL is in `urls`. Never called automatically. */
export async function closeTabsByUrl(urls: string[]): Promise<void> {
  if (urls.length === 0) return;
  const urlSet = new Set(urls);
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const ids = tabs
    .filter((t): t is chrome.tabs.Tab & { id: number } => t.id !== undefined && !!t.url && urlSet.has(t.url))
    .map((t) => t.id);
  if (ids.length > 0) await chrome.tabs.remove(ids);
}

/** Chrome's favicon API, resolved through the extension's own origin. */
export function faviconFor(url: string): string {
  return chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`);
}

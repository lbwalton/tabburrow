import type { TabInfo } from "@tabburrow/core";
import { isStorableLinkUrl } from "@tabburrow/core";


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
 * Broader than {@link isHttpUrl}: also accepts local `file://` pages, which are
 * legitimate things to bookmark (a saved HTML export, a local report, a PDF on
 * disk). This is what the tab-capture SAVE flows use
 * (getCurrentTab/getAllTabs/getHighlightedTabs), so saving works while sitting
 * on a `file://` tab — the exact case that was silently failing. chrome://,
 * about:, and extension pages stay excluded (they aren't useful links).
 *
 * Reading a `file://` tab's URL only needs the "tabs" permission, which is
 * already granted, so SAVING never requires the user's "Allow access to file
 * URLs" toggle. Re-OPENING a saved `file://` link later can require it — see
 * lib/restore.ts.
 */
export function isSaveableUrl(url: string | undefined): url is string {
  if (!url) return false;
  // Delegates to core's storable-link allowlist rather than repeating the
  // protocol set: "a tab worth capturing" and "a URL a link may hold" are the
  // same question, and two copies of the list would eventually disagree.
  return isStorableLinkUrl(url);
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
      const u = new URL(tab.url);
      // http(s) pages have a hostname; file:// (and similar) don't — fall back
      // to the last path segment (the filename) so a titleless local file
      // reads as "report.html", not a blank name.
      if (u.hostname) return u.hostname;
      const segment = u.pathname.split("/").filter(Boolean).pop();
      return segment ? decodeURIComponent(segment) : tab.url;
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

/** Pure filter+map: saveable tabs (http, https, file), in their given order. Shared by getCurrentTab/getAllTabs/getHighlightedTabs. */
export function filterTabs(tabs: Array<{ title?: string; url?: string }>): TabInfo[] {
  return tabs.filter((t) => isSaveableUrl(t.url)).map(toTabInfo);
}

/**
 * The active tab in the current window, resolved fresh (never cached), so a
 * transient miss at popup open can't leave the caller stuck on a stale null.
 * Falls back to `lastFocusedWindow` because in some popup/focus states
 * `currentWindow` resolves to nothing usable. Throws if the active page isn't
 * saveable (a chrome:// or extension page, not an http(s) or file:// one).
 */
export async function getCurrentTab(): Promise<TabInfo> {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  }
  const [info] = filterTabs(tab ? [tab] : []);
  if (!info) {
    throw new Error("This page can't be saved. Only web pages and local files can be saved.");
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

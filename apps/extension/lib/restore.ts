/**
 * Opening links as background tabs (or one new window), plus the pure
 * decisions around it: whether a restore-all needs a confirm first, and
 * how to phrase an open-failure toast.
 *
 * `openLinks` is the one chrome-calling function in this file — consistent
 * with `lib/dashboard.ts`'s `countLinksByCollection` / `lib/tabs.ts`'s
 * `getCurrentTab` precedent, it is NOT unit tested (this package's vitest
 * config deliberately does no chrome.* mocking). `needsRestoreConfirm` and
 * `openFailureMessage` are pure and ARE test-driven (see restore.test.ts).
 */

import { normalizeUrl } from "@tabburrow/core";

export interface OpenLinksResult {
  opened: number;
  failed: number;
}

export interface OpenLinksOptions {
  /** Open every url in ONE new window instead of as background tabs in the current window. */
  newWindow?: boolean;
}

/**
 * Opens each url as a background tab (`active: false` — the dashboard tab
 * keeps focus) via sequential `chrome.tabs.create` calls, or all of them at
 * once via a single `chrome.windows.create({url: urls})` when
 * `opts.newWindow` is set.
 *
 * Every url is passed through `normalizeUrl` on the way out. `addLink`
 * already normalizes on the way IN, but that only protects links saved from
 * that fix onward: a bare "nike.com" typed before it is still sitting in the
 * database schemeless, and a schemeless string is RELATIVE — `chrome.tabs
 * .create` resolves it against the extension's own origin and opens
 * `chrome-extension://<id>/nike.com` (issue #24). Normalizing here repairs
 * those existing rows at open time, without a data migration rewriting (and
 * re-syncing) links behind the user's back. It's a no-op for the absolute
 * URLs every tab-capture path already stores.
 *
 * Never throws: `chrome.tabs.create`/`chrome.windows.create` can reject
 * per-call (invalid URL, window gone, permissions, etc.) — each failure is
 * counted, not propagated, so one bad link doesn't abort the rest of the
 * batch (the same policy `BulkBar`'s "Open all" already used before this
 * file existed — see BulkBar.tsx, which now calls this instead of
 * duplicating the loop).
 */
export async function openLinks(urls: string[], opts?: OpenLinksOptions): Promise<OpenLinksResult> {
  if (urls.length === 0) return { opened: 0, failed: 0 };

  const targets = urls.map(normalizeUrl);

  if (opts?.newWindow) {
    try {
      await chrome.windows.create({ url: targets });
      return { opened: targets.length, failed: 0 };
    } catch {
      return { opened: 0, failed: targets.length };
    }
  }

  let opened = 0;
  let failed = 0;
  for (const url of targets) {
    try {
      await chrome.tabs.create({ url, active: false });
      opened += 1;
    } catch {
      failed += 1;
    }
  }
  return { opened, failed };
}

/** Collections with more than this many live links get a confirm dialog before "Restore all" opens every one of them as a tab. */
export const RESTORE_CONFIRM_THRESHOLD = 15;

/** Whether "Restore all" on a collection with `count` live links should confirm first, or open immediately. `count === RESTORE_CONFIRM_THRESHOLD` does NOT need confirmation — the threshold is exclusive. */
export function needsRestoreConfirm(count: number): boolean {
  return count > RESTORE_CONFIRM_THRESHOLD;
}

/** The error-toast text for an open batch (restore-all or a single card open) with `failed` failures. Only meaningful when `failed > 0` — callers gate on that before showing it. */
export function openFailureMessage(failed: number): string {
  return `Couldn't open ${failed} link${failed === 1 ? "" : "s"}.`;
}

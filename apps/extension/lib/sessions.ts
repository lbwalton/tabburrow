import type { SessionWindow } from "@tabburrow/core";
import { isHttpUrl, titleForTab } from "./tabs";

/**
 * Window-capture and session-restore helpers, plus the pure decisions
 * around them (equality for the auto-snapshot dedupe check, relative-time
 * labels, the crash-restore-banner gate, and small UI-text formatters).
 *
 * `captureAllWindows` and `restoreSnapshot` are the two chrome-calling
 * functions in this file — consistent with `lib/restore.ts`'s `openLinks` /
 * `lib/tabs.ts`'s `getCurrentTab`/`getAllTabs` precedent, neither is unit
 * tested (this package's vitest config deliberately does no chrome.*
 * mocking). Everything else here is pure and IS test-driven (see
 * sessions.test.ts).
 */

/**
 * Snapshots every open browser window: http(s) tabs only (same filter as
 * `lib/tabs.ts`'s `getAllTabs`), titles fall back to hostname via
 * `titleForTab`, pinned state is preserved. A window left with zero http(s)
 * tabs after filtering (e.g. all chrome:// pages) is dropped entirely
 * rather than recorded as an empty `SessionWindow`.
 */
export async function captureAllWindows(): Promise<SessionWindow[]> {
  const chromeWindows = await chrome.windows.getAll({ populate: true });
  const windows: SessionWindow[] = [];
  for (const win of chromeWindows) {
    const tabs = (win.tabs ?? [])
      .filter((tab) => isHttpUrl(tab.url))
      .map((tab) => ({
        url: tab.url!,
        title: titleForTab(tab),
        pinned: tab.pinned,
      }));
    if (tabs.length > 0) windows.push({ tabs });
  }
  return windows;
}

/**
 * Order-sensitive equality over URL + pinned state only — titles are
 * ignored (a tab's title can change between two otherwise-identical
 * captures without the "session" itself having changed). Used by the
 * auto-snapshot alarm handler to skip saving a new snapshot when nothing
 * changed since the newest existing auto snapshot.
 */
export function snapshotsEqual(a: SessionWindow[], b: SessionWindow[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const tabsA = a[i]!.tabs;
    const tabsB = b[i]!.tabs;
    if (tabsA.length !== tabsB.length) return false;
    for (let j = 0; j < tabsA.length; j++) {
      if (tabsA[j]!.url !== tabsB[j]!.url) return false;
      if (!!tabsA[j]!.pinned !== !!tabsB[j]!.pinned) return false;
    }
  }
  return true;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Human-readable relative label for a snapshot's `createdAt`, given the
 * current time (passed explicitly so this stays pure/testable — no
 * `Date.now()` inside). Buckets: <1m "just now", <1h "Nm ago", <1d "Nh ago",
 * <2d "yesterday", <7d "Nd ago", otherwise an explicit "Mon D, YYYY" date
 * (spelled out manually rather than via `Intl`/`toLocaleDateString` so the
 * output — and this function's tests — don't depend on the runtime's
 * locale data).
 */
export function relativeTime(then: number, now: number): string {
  const diff = Math.max(0, now - then);
  if (diff < MINUTE_MS) return "just now";
  if (diff < HOUR_MS) return `${Math.floor(diff / MINUTE_MS)}m ago`;
  if (diff < DAY_MS) return `${Math.floor(diff / HOUR_MS)}h ago`;
  if (diff < 2 * DAY_MS) return "yesterday";
  if (diff < 7 * DAY_MS) return `${Math.floor(diff / DAY_MS)}d ago`;
  const date = new Date(then);
  return `${MONTH_NAMES[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

export interface CrashRestoreState {
  /**
   * True when `background.ts`'s `chrome.runtime.onStartup` handler found
   * meta `sessionState` still `"running"` from the previous run (i.e. it
   * set meta `crashDetected` = `"1"`) — the previous browser session never
   * reached `chrome.windows.onRemoved`'s clean-shutdown path.
   */
  sessionMarkedRunning: boolean;
  /** Whether at least one auto snapshot exists to offer as the restore target. */
  hasAutoSnapshot: boolean;
}

/**
 * Whether the dashboard should show the "Restore your last session?"
 * banner. Both conditions are required: a crash was detected AND there's
 * actually an auto snapshot to restore from — a detected crash with no
 * auto snapshot has nothing to offer, so the caller clears the flag
 * silently instead of showing an empty promise.
 */
export function shouldOfferCrashRestore(state: CrashRestoreState): boolean {
  return state.sessionMarkedRunning && state.hasAutoSnapshot;
}

/** "2 windows · 14 tabs" (singular-aware) — the count line under a snapshot row's name. */
export function windowTabCountLabel(windows: SessionWindow[]): string {
  const windowCount = windows.length;
  const tabCount = windows.reduce((sum, w) => sum + w.tabs.length, 0);
  const windowWord = windowCount === 1 ? "window" : "windows";
  const tabWord = tabCount === 1 ? "tab" : "tabs";
  return `${windowCount} ${windowWord} · ${tabCount} ${tabWord}`;
}

/** The error-toast text for a restore batch with `failed` failed window creations. Only meaningful when `failed > 0` — callers gate on that before showing it. */
export function restoreFailureMessage(failed: number): string {
  return `Couldn't restore ${failed} window${failed === 1 ? "" : "s"}.`;
}

export interface RestoreSnapshotResult {
  opened: number;
  failed: number;
}

/**
 * Restores a snapshot: one new chrome window per `SessionWindow`, all its
 * tabs opened at once via `chrome.windows.create({url: [...]})`, then a
 * `chrome.tabs.update` per originally-pinned tab to restore pinned state
 * (the `windows.create` bulk-url form has no per-tab pinned option).
 * Restoring never deletes the snapshot — that's the caller's call.
 *
 * A whole window's creation failing (invalid urls, permissions, etc.) is
 * counted as one failure and does not abort the rest of the batch — same
 * per-item-failure policy as `lib/restore.ts`'s `openLinks`. A tab
 * individually failing to re-pin does NOT count as a window failure: the
 * window and its tabs still opened, only the pinned flag didn't stick.
 */
export async function restoreSnapshot(windows: SessionWindow[]): Promise<RestoreSnapshotResult> {
  let opened = 0;
  let failed = 0;
  for (const win of windows) {
    if (win.tabs.length === 0) continue;
    try {
      const created = await chrome.windows.create({ url: win.tabs.map((tab) => tab.url) });
      opened += 1;
      const createdTabs = created?.tabs ?? [];
      for (let i = 0; i < win.tabs.length; i++) {
        const tab = win.tabs[i]!;
        const createdTab = createdTabs[i];
        if (!tab.pinned || createdTab?.id === undefined) continue;
        try {
          await chrome.tabs.update(createdTab.id, { pinned: true });
        } catch {
          // Tab opened but couldn't be re-pinned — not a window failure.
        }
      }
    } catch {
      failed += 1;
    }
  }
  return { opened, failed };
}

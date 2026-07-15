import type { TabInfo } from "@tabburrow/core";
import { getDB, saveTabs } from "@tabburrow/core";
import { faviconFor, getCurrentTab } from "./tabs";

// Shared meta keys — same "single source of truth" precedent as
// lib/sessions.ts's SESSION_STATE_META_KEY etc: background.ts (the writer,
// for pendingCommand) and popup/App.tsx (the reader/clearer) must never
// drift on a raw string literal, and popup/App.tsx (the writer, for
// lastUsedCollectionId) and background.ts (the reader) mustn't either.
export const LAST_USED_COLLECTION_META_KEY = "lastUsedCollectionId";
export const PENDING_COMMAND_META_KEY = "pendingCommand";
export const PENDING_COMMAND_SAVE_ALL = "save-all";
/** Meta value that means "no pending command" — written to clear/revert the flag. */
export const PENDING_COMMAND_CLEAR = "";

/**
 * A pending command is only honored within this window of its being set.
 * The flag is meant to bridge ONE background→popup hop (milliseconds); the
 * TTL is the belt-and-suspenders guard for any path where the flag was
 * written but the popup never opened to clear it (openPopup rejecting
 * before the rollback in background.ts could run, the service worker dying
 * mid-flight, ...) — without it, a stranded flag would silently fire a full
 * save-all on the next unrelated popup open, hours or days later.
 */
export const PENDING_COMMAND_MAX_AGE_MS = 15_000;

/** True when a pending-command flag stamped at `ts` is still within its TTL at `now`. A garbage `ts` (NaN, from a malformed flag) is never fresh. */
export function isPendingCommandFresh(ts: number, now: number): boolean {
  return now - ts < PENDING_COMMAND_MAX_AGE_MS;
}

/** The meta value background.ts writes for a pending save-all: JSON `{command, ts}` so the popup can check freshness, not just presence. */
export function pendingSaveAllFlagValue(now: number): string {
  return JSON.stringify({ command: PENDING_COMMAND_SAVE_ALL, ts: now });
}

export interface PendingCommandFlag {
  command: string;
  /** NaN when the stored flag had no (or a non-numeric) timestamp — `isPendingCommandFresh` treats that as stale. */
  ts: number;
}

/**
 * Parses a stored pendingCommand meta value. Returns null for anything that
 * isn't a `{command: string, ...}` JSON object — absent/cleared values,
 * malformed JSON, and the pre-JSON legacy bare-string format alike (a
 * legacy flag carries no timestamp to prove freshness, so it must not
 * replay).
 */
export function parsePendingCommandFlag(value: string | null): PendingCommandFlag | null {
  if (!value) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { command, ts } = parsed as { command?: unknown; ts?: unknown };
  if (typeof command !== "string") return null;
  return { command, ts: typeof ts === "number" ? ts : NaN };
}

export type CommandPlan =
  | { action: "save-current-silently" }
  | { action: "open-popup" }
  | { action: "open-popup-pending-save-all" }
  | { action: "open-dashboard" }
  | { action: "noop" };

/**
 * Pure decision table for background.ts's `chrome.commands.onCommand`
 * listener (the manifest's three shortcuts — see wxt.config.ts):
 *
 * - "save-current-tab": a warm `lastUsedCollectionId` means the shortcut can
 *   save silently (badge flash, no UI); cold (no target chosen yet) falls
 *   back to opening the popup so the user can pick one — there's no sane
 *   "silent" target to save into.
 * - "save-all-tabs": ALWAYS opens the popup, warm or cold. Unlike the
 *   single-tab case, "save all" has real UX beyond just persisting rows (the
 *   popup's existing confirm view offers "Close saved tabs"), so the
 *   shortcut can't skip the popup even with a warm target — it sets the
 *   "pendingCommand" meta flag instead, which the popup reads+clears on
 *   mount and replays through its own save-all flow (see popup/App.tsx).
 * - "open-dashboard": always opens/creates a dashboard tab.
 * - anything else: no-op (defensive default; the manifest only ever fires
 *   the three commands above).
 */
export function commandPlan(command: string, hasLastUsed: boolean): CommandPlan {
  switch (command) {
    case "save-current-tab":
      return hasLastUsed ? { action: "save-current-silently" } : { action: "open-popup" };
    case "save-all-tabs":
      return { action: "open-popup-pending-save-all" };
    case "open-dashboard":
      return { action: "open-dashboard" };
    default:
      return { action: "noop" };
  }
}

// matches --accent token — service workers have no DOM/CSSOM, so
// chrome.action.setBadgeBackgroundColor can't read a CSS custom property;
// this is the one sanctioned hardcoded brand hex outside packages/ui/src/tokens.css.
const BADGE_ACCENT_HEX = "#F97316";
const BADGE_FLASH_MS = 1500;

/** Flashes a "✓" on the toolbar action badge for `BADGE_FLASH_MS`, then clears it. Chrome-calling; not unit tested (see file-level precedent in lib/sessions.ts). */
export function flashSavedBadge(): void {
  chrome.action.setBadgeBackgroundColor({ color: BADGE_ACCENT_HEX });
  chrome.action.setBadgeText({ text: "✓" });
  // If the MV3 service worker is torn down within these 1.5s the clear never
  // runs and the ✓ sticks until the next SW wake — accepted cosmetic risk
  // (an alarm-based clear would outlive the worker but is overkill here).
  setTimeout(() => {
    chrome.action.setBadgeText({ text: "" });
  }, BADGE_FLASH_MS);
}

/**
 * The "save-current-tab" shortcut's silent path: saves the active tab into
 * `collectionId` (same dedupe-by-URL semantics as every other saveTabs
 * call) and flashes the badge. Swallows a "no active http(s) tab" failure —
 * there is no popup/toast surface to show an error in from the background
 * context for this specific path, and a missed keypress on a chrome:// tab
 * is a low-stakes no-op, not worth surfacing.
 */
export async function saveCurrentTabSilently(collectionId: string): Promise<void> {
  let tab: TabInfo;
  try {
    tab = await getCurrentTab();
  } catch {
    return;
  }
  await saveTabs(collectionId, [{ ...tab, faviconUrl: faviconFor(tab.url) }], getDB());
  flashSavedBadge();
}

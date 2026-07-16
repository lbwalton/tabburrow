/**
 * The message `background.ts`'s `chrome.runtime.onMessage` listener debounces
 * into a `requestSync("nudge")` call (see its docstring for the debounce
 * mechanics) — shared as a named constant, not a string literal, so the
 * sender (this file) and the receiver (`background.ts`) can never drift the
 * way `lib/sessions.ts`'s meta-key constants already guard against for the
 * crash-detection flag.
 */
export const SYNC_NUDGE_MESSAGE_TYPE = "sync-nudge";

/** The literal message shape `sendSyncNudge` posts and `isSyncNudgeMessage` recognizes. */
export interface SyncNudgeMessage {
  type: typeof SYNC_NUDGE_MESSAGE_TYPE;
}

/** Pure predicate over an arbitrary `chrome.runtime.onMessage` payload — the one piece of this file worth unit testing without mocking `chrome.runtime` (see lib/sync-nudge.test.ts). */
export function isSyncNudgeMessage(message: unknown): message is SyncNudgeMessage {
  return (
    !!message &&
    typeof message === "object" &&
    (message as { type?: unknown }).type === SYNC_NUDGE_MESSAGE_TYPE
  );
}

/**
 * Fire-and-forget: tells the background service worker local data just
 * changed, so it can debounce a sync cycle instead of waiting for the next
 * 1-minute "sync-interval" alarm (see `background.ts`). Called from the
 * popup and dashboard's App-level mutation completion points (`lib/sync-nudge.ts`'s
 * only callers) — NOT from every individual repo call, per T18's "keep the
 * touch surface small" decision; a missed nudge only costs latency, since
 * the periodic alarm is the correctness backstop, not this.
 *
 * Never throws: `chrome.runtime.sendMessage` can reject (e.g. the service
 * worker hasn't finished registering its listener yet, or the extension
 * context is mid-reload) — none of that is this caller's problem, so the
 * failure is swallowed rather than surfaced as an uncaught rejection in a UI
 * event handler.
 */
export function sendSyncNudge(): void {
  try {
    const message: SyncNudgeMessage = { type: SYNC_NUDGE_MESSAGE_TYPE };
    void chrome.runtime.sendMessage(message)?.catch(() => {});
  } catch {
    // chrome.runtime unavailable / context invalidated — nothing to do.
  }
}

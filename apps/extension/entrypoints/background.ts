import { getMeta, listSnapshots, pruneAutoSnapshots, saveSnapshot, setMeta } from "@tabburrow/core";
import {
  captureAllWindows,
  CRASH_DETECTED_META_KEY,
  CRASH_FLAG_SET,
  SESSION_STATE_ENDED_CLEAN,
  SESSION_STATE_META_KEY,
  SESSION_STATE_RUNNING,
  snapshotsEqual,
} from "../lib/sessions";
import {
  commandPlan,
  LAST_USED_COLLECTION_META_KEY,
  PENDING_COMMAND_CLEAR,
  PENDING_COMMAND_META_KEY,
  pendingSaveAllFlagValue,
  saveCurrentTabSilently,
} from "../lib/commands";
import { onAuthChange } from "../lib/auth";
import type { AuthUser } from "../lib/auth";
import { getClient } from "../lib/supabase";
import { requestSync } from "../lib/sync-controller";
import { isSyncNudgeMessage } from "../lib/sync-nudge";

const AUTO_SNAPSHOT_ALARM = "auto-snapshot";
const AUTO_SNAPSHOT_INTERVAL_MINUTES = 5;
const AUTO_SNAPSHOT_KEEP = 10;

// --- Sync (T18) ---
// "sync-interval" polls unconditionally every minute (requestSync's own
// gating decides whether anything actually happens — see lib/sync-controller.ts);
// "sync-debounce" is a ONE-SHOT alarm (re)armed by every incoming
// "sync-nudge" message, so a burst of edits collapses into a single sync a
// few seconds after the LAST one, not one per edit. chrome.alarms, not
// setTimeout, because a setTimeout dies with the service worker the moment
// it's recycled — an alarm survives that and still fires.
const SYNC_INTERVAL_ALARM = "sync-interval";
const SYNC_DEBOUNCE_ALARM = "sync-debounce";
const SYNC_INTERVAL_MINUTES = 1;
// 3s nominal — but Chrome only honors sub-30s alarm delays for UNPACKED
// extensions (dev/e2e). In a packed store build this is clamped to ~30s
// (Chrome logs a warning and rounds up). Acceptable: the debounce is purely
// a latency optimization, and the 1-minute "sync-interval" alarm above is
// the correctness backstop either way — a clamped nudge still beats it.
const SYNC_DEBOUNCE_MINUTES = 0.05;

// Constructed once at the service worker's top level (not lazily inside a
// handler) so supabase-js's autoRefreshToken timer starts keeping any
// persisted session fresh for as long as this worker instance stays alive.
// `null` when cloud isn't configured (see lib/supabase.ts's getClient()) —
// every call below already handles that; this line itself makes zero
// network calls in that case.
const supabaseClient = getClient();

export default defineBackground(() => {
  console.log("[tabburrow] service worker up");

  if (supabaseClient) {
    // No PII beyond the email's domain — see emailDomain() below.
    onAuthChange((user: AuthUser | null) => {
      console.log(`[tabburrow] auth state: ${user ? `signed in (${emailDomain(user.email)})` : "signed out"}`);
      // A fresh sign-in (this device's OWN session turning on, or a token
      // refresh landing) is exactly when it's worth trying a sync right
      // away rather than waiting for the next alarm tick — requestSync's own
      // gating (lib/sync-controller.ts) is what actually decides whether
      // this does anything (e.g. a free user's sign-in still calls this and
      // is still gated out).
      if (user) void requestSync("startup");
    });
  }

  chrome.runtime.onInstalled.addListener((details) => {
    console.log(`[tabburrow] onInstalled reason=${details.reason}`);
    chrome.alarms.create(AUTO_SNAPSHOT_ALARM, { periodInMinutes: AUTO_SNAPSHOT_INTERVAL_MINUTES });
    chrome.alarms.create(SYNC_INTERVAL_ALARM, { periodInMinutes: SYNC_INTERVAL_MINUTES });
    // Fresh install (or extension update): there is no prior browser
    // session that could have crashed, so this never flags "crashDetected"
    // — only onStartup (below) does that, and only by comparing against a
    // "sessionState" written by a PREVIOUS run.
    void setMeta(SESSION_STATE_META_KEY, SESSION_STATE_RUNNING);
  });

  chrome.runtime.onStartup.addListener(() => {
    // chrome.alarms persists alarms across browser restarts on its own, but
    // re-creating here (same name = overwrite, not a duplicate) means the
    // schedule survives even if it was ever cleared some other way.
    chrome.alarms.create(AUTO_SNAPSHOT_ALARM, { periodInMinutes: AUTO_SNAPSHOT_INTERVAL_MINUTES });
    chrome.alarms.create(SYNC_INTERVAL_ALARM, { periodInMinutes: SYNC_INTERVAL_MINUTES });
    void handleBrowserStartup();
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === AUTO_SNAPSHOT_ALARM) void runAutoSnapshot();
    else if (alarm.name === SYNC_INTERVAL_ALARM) void requestSync("alarm");
    else if (alarm.name === SYNC_DEBOUNCE_ALARM) void requestSync("nudge");
  });

  // Fire-and-forget: no sendResponse, no `return true` — this listener never
  // sends an async response, so it must stay synchronous (an MV3 listener
  // that returns `true` without ever calling sendResponse leaks the message
  // port until GC, and Chrome logs a warning). Registered top-level and
  // synchronously, same MV3 rule every other listener in this file follows.
  chrome.runtime.onMessage.addListener((message) => {
    if (isSyncNudgeMessage(message)) {
      chrome.alarms.create(SYNC_DEBOUNCE_ALARM, { delayInMinutes: SYNC_DEBOUNCE_MINUTES });
    }
  });

  // Fires once per closed window, for every window — not just the last one.
  // The `chrome.windows.getAll()` check below is what actually tells us
  // whether the BROWSER (not the service worker, which can die and restart
  // at any time under MV3 — that's normal and not a crash) just reached a
  // clean shutdown.
  chrome.windows.onRemoved.addListener(() => {
    void handleWindowRemoved();
  });

  chrome.commands.onCommand.addListener((command) => {
    void handleCommand(command);
  });
});

/**
 * The manifest's three keyboard shortcuts (see wxt.config.ts's
 * `commands` block). `commandPlan` (lib/commands.ts) is the pure decision —
 * this function is just the dispatch + the chrome.* calls each branch needs.
 */
async function handleCommand(command: string): Promise<void> {
  const lastUsedId = await getMeta(LAST_USED_COLLECTION_META_KEY);
  const plan = commandPlan(command, lastUsedId !== null);

  switch (plan.action) {
    case "save-current-silently":
      // lastUsedId is non-null whenever commandPlan returns this action.
      await saveCurrentTabSilently(lastUsedId!);
      return;
    case "open-popup":
      try {
        await chrome.action.openPopup();
      } catch (err) {
        // openPopup can reject (no active window, another popup open, ...).
        // Nothing to roll back on this path — just make the failure visible.
        console.warn("[tabburrow] openPopup failed for save-current fallback", err);
      }
      return;
    case "open-popup-pending-save-all":
      // The service worker can't reproduce the popup's picker/"Close saved
      // tabs" confirmation UX itself — it just leaves a flag for the popup
      // to pick up on mount (see popup/App.tsx) and opens it. The flag
      // carries a timestamp: the popup ignores (and clears) anything older
      // than PENDING_COMMAND_MAX_AGE_MS, the second layer of defense should
      // the rollback below itself never get to run.
      await setMeta(PENDING_COMMAND_META_KEY, pendingSaveAllFlagValue(Date.now()));
      try {
        await chrome.action.openPopup();
      } catch (err) {
        // The popup never opened, so nothing will consume the flag — revert
        // it now or the NEXT unrelated popup open would replay a save-all
        // the user didn't just ask for.
        await setMeta(PENDING_COMMAND_META_KEY, PENDING_COMMAND_CLEAR);
        console.warn("[tabburrow] openPopup failed for save-all; pendingCommand reverted", err);
      }
      return;
    case "open-dashboard":
      chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
      return;
    case "noop":
      return;
  }
}

/**
 * `chrome.runtime.onStartup` fires once per real browser-session boundary
 * (a fresh browser launch), which is exactly the granularity crash
 * detection needs — MV3 service-worker restarts do NOT fire this event, so
 * there's no risk of a merely-recycled worker being mistaken for a crash.
 *
 * If the "sessionState" meta this run inherits is still "running", the
 * previous session never reached `handleWindowRemoved`'s clean-shutdown
 * write below — i.e. Chrome (or the OS) went away without a chance to mark
 * itself as ended cleanly. That's recorded as "crashDetected" = "1" for the
 * dashboard to read (see `lib/sessions.ts`'s `shouldOfferCrashRestore`).
 */
async function handleBrowserStartup(): Promise<void> {
  const previousState = await getMeta(SESSION_STATE_META_KEY);
  if (previousState === SESSION_STATE_RUNNING) {
    await setMeta(CRASH_DETECTED_META_KEY, CRASH_FLAG_SET);
  }
  await setMeta(SESSION_STATE_META_KEY, SESSION_STATE_RUNNING);
}

/**
 * All windows closed = the browser session ended cleanly.
 *
 * KNOWN GAP (flagged, not patched here): on platforms where closing every
 * window does NOT quit the browser process (macOS in particular), this
 * fires and marks "endedClean" even though Chrome itself keeps running.
 * There's no `chrome.windows.onCreated` listener flipping "sessionState"
 * back to "running" once a new window opens in that same still-alive
 * process — adding one naively would race `handleBrowserStartup`'s
 * read-then-write above (a restored window can fire `onCreated` before or
 * after `onStartup`'s own read, so a blind "always set running" listener
 * risks clobbering the PRE-startup value `handleBrowserStartup` needs to
 * read, causing false-positive crash banners on ordinary restarts). Net
 * effect: a crash that happens after a "close all windows, then reopen one
 * without quitting" sequence can go undetected. Left as-is pending a more
 * deliberate fix (e.g. a monotonic per-boot marker, or migrating to
 * `chrome.storage.session` which Chrome clears on process exit).
 */
async function handleWindowRemoved(): Promise<void> {
  const remaining = await chrome.windows.getAll();
  if (remaining.length === 0) {
    await setMeta(SESSION_STATE_META_KEY, SESSION_STATE_ENDED_CLEAN);
  }
}

/**
 * The "auto-snapshot" alarm handler: capture every open window, skip the
 * write entirely if it's identical (URL + pinned, per `snapshotsEqual`) to
 * the newest existing auto snapshot — so leaving the browser idle doesn't
 * pile up 10 copies of the same tabs — then prune down to the newest
 * `AUTO_SNAPSHOT_KEEP` autos. An empty capture (e.g. every open tab is a
 * chrome:// page) is skipped too: there's nothing worth snapshotting.
 */
async function runAutoSnapshot(): Promise<void> {
  const windows = await captureAllWindows();
  if (windows.length === 0) return;

  const existing = await listSnapshots();
  const newestAuto = existing.find((s) => s.kind === "auto");
  if (newestAuto && snapshotsEqual(windows, newestAuto.windows)) return;

  await saveSnapshot("auto", windows);
  await pruneAutoSnapshots(AUTO_SNAPSHOT_KEEP);
}

/** The "@domain.com" tail of an email, for logging auth state transitions without ever printing a full address. */
function emailDomain(email: string): string {
  const at = email.indexOf("@");
  return at === -1 ? "(no domain)" : email.slice(at);
}

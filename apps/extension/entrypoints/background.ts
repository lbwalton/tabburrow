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

const AUTO_SNAPSHOT_ALARM = "auto-snapshot";
const AUTO_SNAPSHOT_INTERVAL_MINUTES = 5;
const AUTO_SNAPSHOT_KEEP = 10;

export default defineBackground(() => {
  console.log("[tabburrow] service worker up");

  // Command (keyboard shortcut) wiring lands in T13 — this is just an
  // install/update log so the service worker lifecycle is observable.
  chrome.runtime.onInstalled.addListener((details) => {
    console.log(`[tabburrow] onInstalled reason=${details.reason}`);
    chrome.alarms.create(AUTO_SNAPSHOT_ALARM, { periodInMinutes: AUTO_SNAPSHOT_INTERVAL_MINUTES });
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
    void handleBrowserStartup();
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === AUTO_SNAPSHOT_ALARM) void runAutoSnapshot();
  });

  // Fires once per closed window, for every window — not just the last one.
  // The `chrome.windows.getAll()` check below is what actually tells us
  // whether the BROWSER (not the service worker, which can die and restart
  // at any time under MV3 — that's normal and not a crash) just reached a
  // clean shutdown.
  chrome.windows.onRemoved.addListener(() => {
    void handleWindowRemoved();
  });
});

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

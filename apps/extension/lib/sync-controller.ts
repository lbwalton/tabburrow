import { ensureDeviceId, getDB, getMeta, setMeta, SyncEngine } from "@tabburrow/core";
import type { BurrowDB } from "@tabburrow/core";
import { getPlan, getUser } from "./auth";
import type { AuthUser, Plan } from "./auth";
import { isSupabaseConfigured } from "./supabase";
import { createSupabaseTransport } from "./sync-transport";

/** meta key holding the epoch-ms of the last time a sync cycle (initial upload or ordinary) completed successfully — what AccountPane's "Synced Xm ago" line reads. */
export const LAST_SYNC_AT_META_KEY = "lastSyncAt";
/** meta key holding the last sync failure's message, or `""` once cleared by a subsequent success — what AccountPane's "Sync error" state reads. Never `null` once a sync has ever run (meta has no delete; see `getMeta`/`setMeta`). */
export const LAST_SYNC_ERROR_META_KEY = "lastSyncError";

/** meta key marking that THIS device has already run its one-time `initialUpload()` bootstrap for a given user. Scoped per userId (not global) for the same reason `lib/auth.ts`'s `planCacheMetaKey` is: a second user signing into the same Chrome profile must not inherit — or skip — the first user's bootstrap state. Scoped per DEVICE (i.e. this is local meta, never synced) by design: a brand-new device signing into an EXISTING pro account must still push whatever local-only data it already has and pull everything else, exactly once, regardless of whether some OTHER device already completed its own bootstrap for this user. */
export function initialUploadDoneMetaKey(userId: string): string {
  return `initialUploadDone:${userId}`;
}

export type SyncReason = "nudge" | "alarm" | "manual" | "startup";

/**
 * The complete "should a sync actually run" decision, extracted pure so it's
 * unit-testable without touching chrome.* / supabase-js (see
 * lib/sync-controller.test.ts). `plan === null` (getPlan() couldn't
 * determine a plan — cloud unreachable, or simply never fetched) is folded
 * into `"skip-free"`, not treated as a distinct case: this is the "accepted
 * fail-safe" the brief calls for — never sync without a POSITIVELY
 * confirmed PRO entitlement. pendingOps stay queued either way; nothing is
 * lost, sync just waits for the next trigger.
 */
export type SyncGateDecision = "run" | "skip-unconfigured" | "skip-signed-out" | "skip-free";

export function syncGateDecision(input: {
  configured: boolean;
  user: { id: string } | null;
  plan: Plan | null;
}): SyncGateDecision {
  if (!input.configured) return "skip-unconfigured";
  if (!input.user) return "skip-signed-out";
  if (input.plan !== "pro") return "skip-free";
  return "run";
}

export interface SyncRunResult {
  ok: boolean;
  pushed: number;
  pulled: number;
  /** True when this call ran the one-time `initialUpload()` bootstrap instead of an ordinary `syncOnce()` cycle. */
  initialUpload: boolean;
  /** Present only when `ok` is false — the same string written to `meta[LAST_SYNC_ERROR_META_KEY]`. */
  error?: string;
}

export type RequestSyncResult = SyncRunResult | { skipped: Exclude<SyncGateDecision, "run"> };

// Module-level (per JS execution context — background service worker,
// dashboard page, and popup page each get their OWN instance of this
// module, same as every other `getDB()`-backed singleton in this codebase;
// see lib/supabase.ts's `_client` for the identical pattern) singleton
// SyncEngine, built lazily on first use so constructing it never runs before
// `getClient()` has env vars to read. `undefined` = not yet computed,
// `null` = computed and genuinely unavailable (cloud not configured) —
// same sentinel trick `lib/supabase.ts`'s `getClient()` uses, so "not
// configured" is cached too instead of re-checked every call.
let engineInstance: SyncEngine | null | undefined;

function getSyncEngine(db: BurrowDB): SyncEngine | null {
  if (engineInstance !== undefined) return engineInstance;
  const transport = createSupabaseTransport();
  engineInstance = transport ? new SyncEngine(db, transport) : null;
  return engineInstance;
}

// --- Logging: every state TRANSITION is logged, no PII (reason strings,
// push/pull counts, and generic error messages only — never an email or user
// id). Skips are the one thing that can repeat every single minute (the
// "sync-interval" alarm fires regardless of plan/sign-in state) — deduped so
// a free or signed-out user's background doesn't spam one log line a
// minute forever. A successful run always resets the dedupe, so a LATER
// skip (e.g. the user just signed out) logs immediately rather than staying
// suppressed by a stale skip logged hours earlier. ---
let lastSkipLogged: SyncGateDecision | null = null;

function logSkip(decision: SyncGateDecision): void {
  if (decision === lastSkipLogged) return;
  lastSkipLogged = decision;
  console.log(`[tabburrow] sync skipped: ${decision}`);
}

function logRun(reason: SyncReason, outcome: string): void {
  lastSkipLogged = null;
  console.log(`[tabburrow] sync (${reason}): ${outcome}`);
}

// Coalesces concurrent requestSync calls (e.g. the 1-minute alarm firing the
// same tick a user clicks "Sync now") the same way SyncEngine.syncOnce()
// coalesces concurrent cycles at its own layer (packages/core/src/sync/engine.ts) —
// a call made while one is already in flight is handed back the SAME
// promise rather than starting a second, redundant getUser/getPlan/engine
// round trip.
let inFlightRequest: Promise<RequestSyncResult> | null = null;

/**
 * The single entry point every sync trigger (the 1-minute alarm, the
 * debounced UI nudge, the "Sync now" button, and a fresh sign-in) calls
 * through. Gates on `syncGateDecision`, runs the device's one-time
 * `initialUpload()` bootstrap on its first-ever successful sync for this
 * user or an ordinary `syncOnce()` thereafter, and records the outcome to
 * `meta[LAST_SYNC_AT_META_KEY]`/`meta[LAST_SYNC_ERROR_META_KEY]` either way.
 * Never throws — a sync failure is reported through the returned result
 * (and the meta it writes), not a rejected promise, since most callers
 * (alarms, nudges) have no one to show a caught error to.
 */
export function requestSync(reason: SyncReason, db: BurrowDB = getDB()): Promise<RequestSyncResult> {
  if (inFlightRequest) return inFlightRequest;
  const run = runRequestSync(reason, db);
  inFlightRequest = run;
  const clear = () => {
    if (inFlightRequest === run) inFlightRequest = null;
  };
  // .then(clear, clear) rather than .finally(clear): identical reasoning to
  // SyncEngine.syncOnce()'s guard — .finally() would produce a second,
  // unobserved promise that re-rejects on failure and trips an "unhandled
  // rejection" warning. This function never actually rejects (see above),
  // but the pattern is kept consistent with the engine's own guard anyway.
  run.then(clear, clear);
  return run;
}

async function runRequestSync(reason: SyncReason, db: BurrowDB): Promise<RequestSyncResult> {
  const configured = isSupabaseConfigured();
  const user: AuthUser | null = configured ? await getUser() : null;
  const plan: Plan | null = user ? await getPlan(false, db) : null;
  const decision = syncGateDecision({ configured, user, plan });

  if (decision !== "run") {
    logSkip(decision);
    return { skipped: decision };
  }

  const engine = getSyncEngine(db);
  if (!engine) {
    // syncGateDecision said "run" (configured + signed-in + pro) but the
    // transport itself couldn't be built. Not reachable today (configured
    // implies getClient() is non-null, which is the only thing
    // createSupabaseTransport checks) — defensive, treated like
    // "unconfigured" rather than throwing.
    logSkip("skip-unconfigured");
    return { skipped: "skip-unconfigured" };
  }

  // Established (persisted in meta on first call) but not yet wired into any
  // network request — see apps/extension/lib/sync-transport.ts's docstring
  // and the T18 report's "device id" note for why this stops short of
  // stamping it onto request headers.
  await ensureDeviceId(db);

  const flagKey = initialUploadDoneMetaKey(user!.id);
  const alreadyBootstrapped = (await getMeta(flagKey, db)) !== null;

  try {
    if (!alreadyBootstrapped) {
      const pushed = await engine.initialUpload();
      await setMeta(flagKey, "1", db);
      await recordSyncSuccess(db);
      logRun(reason, `initial-upload ok (pushed=${pushed})`);
      return { ok: true, pushed, pulled: 0, initialUpload: true };
    }

    const result = await engine.syncOnce();
    await recordSyncSuccess(db);
    logRun(reason, `sync ok (pushed=${result.pushed} pulled=${result.pulled})`);
    return { ok: true, pushed: result.pushed, pulled: result.pulled, initialUpload: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed.";
    await setMeta(LAST_SYNC_ERROR_META_KEY, message, db);
    logRun(reason, `error: ${message}`);
    return { ok: false, pushed: 0, pulled: 0, initialUpload: !alreadyBootstrapped, error: message };
  }
}

async function recordSyncSuccess(db: BurrowDB): Promise<void> {
  await setMeta(LAST_SYNC_AT_META_KEY, String(Date.now()), db);
  await setMeta(LAST_SYNC_ERROR_META_KEY, "", db);
}

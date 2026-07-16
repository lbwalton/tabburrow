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
/**
 * meta key holding the user id of the LAST account that successfully synced
 * on this device — the anchor of the account-switch guard (see
 * `accountSwitchDecision`). Written only after a successful sync/initialUpload,
 * so a user who signs in but never syncs (free plan, or never online) leaves
 * it untouched and the NEXT account still gets first-sign-in onboarding.
 */
export const LAST_SYNC_USER_ID_META_KEY = "lastSyncUserId";
/**
 * The meta key core's `SyncEngine` stores its pull cursor under
 * (packages/core/src/sync/engine.ts reads/writes `getMeta("syncCursor")`) —
 * duplicated here as a named constant because `wipeLocalDataForAccountSwitch`
 * must reset it and core doesn't export the literal. Kept in sync by hand;
 * the account-switch e2e test would fail loudly (stale cursor -> B's pull
 * misses its cloud rows) if these ever drifted.
 */
export const SYNC_CURSOR_META_KEY = "syncCursor";

const INITIAL_UPLOAD_DONE_PREFIX = "initialUploadDone:";

/** meta key marking that THIS device has already run its one-time `initialUpload()` bootstrap for a given user. Scoped per userId (not global) for the same reason `lib/auth.ts`'s `planCacheMetaKey` is: a second user signing into the same Chrome profile must not inherit — or skip — the first user's bootstrap state. Scoped per DEVICE (i.e. this is local meta, never synced) by design: a brand-new device signing into an EXISTING pro account must still push whatever local-only data it already has and pull everything else, exactly once, regardless of whether some OTHER device already completed its own bootstrap for this user. */
export function initialUploadDoneMetaKey(userId: string): string {
  return `${INITIAL_UPLOAD_DONE_PREFIX}${userId}`;
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

/**
 * The cross-account data-leak guard, extracted pure (TDD'd in
 * lib/sync-controller.test.ts). The scenario it exists for: sign-out keeps
 * local Dexie data (by design — see lib/auth.ts's `signOut`), and the sync
 * cursor + local rows are GLOBAL device state, not per-user. So on a shared
 * Chrome profile, after user A syncs and signs out and user B signs in:
 *
 *  - Without this guard, B's missing `initialUploadDone` flag would trigger
 *    `initialUpload()` of ALL local rows — including A's synced-down data —
 *    stamped with B's user_id on push: a cross-account data leak.
 *  - And a RETURNING B would inherit the cursor A advanced, silently
 *    skipping every row B edited elsewhere between those two timestamps,
 *    forever, while showing "Synced just now".
 *
 * Decisions:
 *  - `"first-signin"` — this device has never completed a sync for ANY
 *    account (`lastSyncUserId` absent/cleared): the designed onboarding,
 *    where the first account to sync adopts the device's local data.
 *  - `"proceed"` — the same account that last synced here is back. Normal.
 *  - `"blocked"` — a DIFFERENT account is signed in. No sync of any kind
 *    runs until the user explicitly resolves it (AccountPane's "Replace
 *    local data" → `replaceLocalDataWithCloud`). Local-only use continues
 *    to work fine meanwhile.
 */
export type AccountSwitchDecision = "proceed" | "first-signin" | "blocked";

export function accountSwitchDecision(input: {
  lastSyncUserId: string | null;
  currentUserId: string;
}): AccountSwitchDecision {
  // "" (meta has no delete; empty string = cleared) counts as never-synced.
  if (!input.lastSyncUserId) return "first-signin";
  return input.lastSyncUserId === input.currentUserId ? "proceed" : "blocked";
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

export type SyncSkipReason = Exclude<SyncGateDecision, "run"> | "account-switch-blocked";

export type RequestSyncResult = SyncRunResult | { skipped: SyncSkipReason };

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
let lastSkipLogged: SyncSkipReason | null = null;

function logSkip(decision: SyncSkipReason): void {
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
 * through. Gates on `syncGateDecision`, then on `accountSwitchDecision`
 * (blocked = no engine call of ANY kind), runs the device's one-time
 * `initialUpload()` bootstrap on its first-ever successful sync for this
 * user or an ordinary `syncOnce()` thereafter, and records the outcome to
 * `meta[LAST_SYNC_AT_META_KEY]`/`meta[LAST_SYNC_ERROR_META_KEY]` — plus
 * `meta[LAST_SYNC_USER_ID_META_KEY]` on success, which is what arms the
 * switch guard for any future different-account sign-in. Never throws — a
 * sync failure is reported through the returned result (and the meta it
 * writes), not a rejected promise, since most callers (alarms, nudges) have
 * no one to show a caught error to.
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

  // Account-switch guard — MUST run before any engine call. A "blocked"
  // device performs no sync in either direction (no initialUpload that
  // would stamp another account's rows with this user_id, no pull against
  // another account's cursor) until the user explicitly resolves it via
  // `replaceLocalDataWithCloud`. See `accountSwitchDecision`'s docstring.
  const lastSyncUserId = await getMeta(LAST_SYNC_USER_ID_META_KEY, db);
  const switchDecision = accountSwitchDecision({ lastSyncUserId, currentUserId: user!.id });
  if (switchDecision === "blocked") {
    logSkip("account-switch-blocked");
    return { skipped: "account-switch-blocked" };
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
  // Truthy check, not `!== null`: an empty-string value means "cleared"
  // everywhere else meta is used as a flag (see lib/auth.ts's plan cache),
  // and must mean "not bootstrapped" here too.
  const alreadyBootstrapped = !!(await getMeta(flagKey, db));

  try {
    if (!alreadyBootstrapped) {
      const pushed = await engine.initialUpload();
      await setMeta(flagKey, "1", db);
      await recordSyncSuccess(db, user!.id);
      logRun(reason, `initial-upload ok (pushed=${pushed})`);
      return { ok: true, pushed, pulled: 0, initialUpload: true };
    }

    const result = await engine.syncOnce();
    await recordSyncSuccess(db, user!.id);
    logRun(reason, `sync ok (pushed=${result.pushed} pulled=${result.pulled})`);
    return { ok: true, pushed: result.pushed, pulled: result.pulled, initialUpload: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed.";
    await setMeta(LAST_SYNC_ERROR_META_KEY, message, db);
    logRun(reason, `error: ${message}`);
    return { ok: false, pushed: 0, pulled: 0, initialUpload: !alreadyBootstrapped, error: message };
  }
}

async function recordSyncSuccess(db: BurrowDB, userId: string): Promise<void> {
  await setMeta(LAST_SYNC_AT_META_KEY, String(Date.now()), db);
  await setMeta(LAST_SYNC_ERROR_META_KEY, "", db);
  // Arms the account-switch guard: from now on, only THIS account may sync
  // on this device without an explicit "Replace local data" resolution.
  // Accepted crash-width window: a process death between the engine op
  // resolving and this write leaves that just-synced account unguarded
  // (a later different-account sign-in would read as first-sign-in) — the
  // window is milliseconds wide and the next successful cycle re-arms it.
  await setMeta(LAST_SYNC_USER_ID_META_KEY, userId, db);
}

/**
 * The db half of AccountPane's "Replace local data" action, in one
 * rw-transaction: wipes `collections`/`links`/`pendingOps` (NOT `sessions` —
 * window snapshots are this device's local browsing history, not account
 * data), resets the sync cursor to 0 so the follow-up pull is a FULL pull,
 * deletes every stale per-user `initialUploadDone:*` flag, then marks the
 * incoming user as both the device's last-synced account AND already
 * bootstrapped (after the wipe there is nothing local left to upload, so an
 * `initialUpload()` would be a pointless no-op push — the follow-up
 * `syncOnce()` from cursor 0 does everything needed).
 *
 * Lives in the extension, not `@tabburrow/core`, deliberately: T18's
 * constraint is that core's engine stays untouched, and this is pure
 * device-lifecycle policy (WHEN local data may be discarded), not sync
 * mechanics — core's repos have no "clear a whole table" surface because no
 * ordinary app path needs one. Direct Dexie table access here follows the
 * same precedent as core's own engine writing winners via `bulkPut` instead
 * of through the repos.
 */
export async function wipeLocalDataForAccountSwitch(userId: string, db: BurrowDB = getDB()): Promise<void> {
  await db.transaction("rw", db.collections, db.links, db.pendingOps, db.meta, async () => {
    await db.collections.clear();
    await db.links.clear();
    await db.pendingOps.clear();
    const staleFlags = (await db.meta.toArray())
      .filter((row) => row.key.startsWith(INITIAL_UPLOAD_DONE_PREFIX))
      .map((row) => row.key);
    if (staleFlags.length > 0) await db.meta.bulkDelete(staleFlags);
    await db.meta.put({ key: SYNC_CURSOR_META_KEY, value: "0" });
    await db.meta.put({ key: LAST_SYNC_USER_ID_META_KEY, value: userId });
    await db.meta.put({ key: initialUploadDoneMetaKey(userId), value: "1" });
  });
}

/**
 * AccountPane's "Replace local data" action: resolves an
 * `accountSwitchDecision === "blocked"` state by discarding this device's
 * local collections/links in favor of the signed-in account's cloud data —
 * `wipeLocalDataForAccountSwitch` then a full pull (`requestSync` with the
 * cursor freshly reset to 0). Waits out any in-flight `requestSync` first:
 * without that, the coalescing guard could hand back a STALE pre-wipe
 * result (e.g. an alarm-triggered cycle that resolved to
 * "account-switch-blocked" moments earlier) instead of actually running the
 * post-wipe pull.
 */
export async function replaceLocalDataWithCloud(userId: string, db: BurrowDB = getDB()): Promise<RequestSyncResult> {
  if (inFlightRequest) await inFlightRequest.then(
    () => undefined,
    () => undefined,
  );
  await wipeLocalDataForAccountSwitch(userId, db);
  return requestSync("manual", db);
}

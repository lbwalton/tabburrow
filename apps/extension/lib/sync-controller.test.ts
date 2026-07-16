import "fake-indexeddb/auto";
import { describe, it, expect, afterEach } from "vitest";
import { BurrowDB, getMeta } from "@tabburrow/core";
import {
  accountSwitchDecision,
  initialUploadDoneMetaKey,
  LAST_SYNC_AT_META_KEY,
  LAST_SYNC_ERROR_META_KEY,
  LAST_SYNC_USER_ID_META_KEY,
  requestSync,
  SYNC_CURSOR_META_KEY,
  syncGateDecision,
  wipeLocalDataForAccountSwitch,
} from "./sync-controller";

// requestSync's "run" branches (initialUpload/syncOnce against a real
// SyncEngine + Supabase transport) are NOT exercised here — createSupabaseTransport
// needs a configured `getClient()`, which reads WXT's build-time-injected
// `import.meta.env.WXT_SUPABASE_URL`/`WXT_SUPABASE_ANON_KEY` (unset under
// plain vitest, same as every other cloud-touching helper in this codebase —
// see lib/auth.test.ts's docstring for the identical precedent). Those
// branches are exercised for real by e2e/specs/t18-sync.spec.ts against the
// local Supabase stack. What IS unit-driven here: the pure gating decision
// every caller (background.ts's alarm/nudge/startup triggers, AccountPane's
// "Sync now") ultimately depends on, the per-user meta-key scoping, and
// requestSync's own "not configured" short-circuit (genuinely exercisable
// under vitest, since cloud really is unconfigured there).

describe("syncGateDecision", () => {
  const USER = { id: "user-a" };

  it("is 'run' only when configured, signed in, and plan is pro", () => {
    expect(syncGateDecision({ configured: true, user: USER, plan: "pro" })).toBe("run");
  });

  it("is 'skip-unconfigured' when cloud isn't configured, regardless of user/plan", () => {
    expect(syncGateDecision({ configured: false, user: USER, plan: "pro" })).toBe("skip-unconfigured");
    expect(syncGateDecision({ configured: false, user: null, plan: null })).toBe("skip-unconfigured");
  });

  it("is 'skip-signed-out' when configured but nobody is signed in", () => {
    expect(syncGateDecision({ configured: true, user: null, plan: null })).toBe("skip-signed-out");
  });

  it("is 'skip-free' when signed in with a confirmed free plan", () => {
    expect(syncGateDecision({ configured: true, user: USER, plan: "free" })).toBe("skip-free");
  });

  it("folds a null plan (undetermined — e.g. a failed profiles fetch) into 'skip-free', the accepted fail-safe", () => {
    expect(syncGateDecision({ configured: true, user: USER, plan: null })).toBe("skip-free");
  });

  it("unconfigured wins over every other condition", () => {
    expect(syncGateDecision({ configured: false, user: USER, plan: "pro" })).toBe("skip-unconfigured");
  });
});

describe("initialUploadDoneMetaKey", () => {
  it("scopes the flag by user id, so two users never share one device's bootstrap state", () => {
    expect(initialUploadDoneMetaKey("user-a")).toBe("initialUploadDone:user-a");
    expect(initialUploadDoneMetaKey("user-a")).not.toBe(initialUploadDoneMetaKey("user-b"));
  });
});

describe("accountSwitchDecision (the cross-account data-leak guard)", () => {
  it("is 'first-signin' when this device has never completed a sync for anyone (adopt-local-data onboarding)", () => {
    expect(accountSwitchDecision({ lastSyncUserId: null, currentUserId: "user-a" })).toBe("first-signin");
  });

  it("treats an empty-string stored value (meta has no delete; '' = cleared) as first sign-in too", () => {
    expect(accountSwitchDecision({ lastSyncUserId: "", currentUserId: "user-a" })).toBe("first-signin");
  });

  it("is 'proceed' when the same user who last synced signs back in", () => {
    expect(accountSwitchDecision({ lastSyncUserId: "user-a", currentUserId: "user-a" })).toBe("proceed");
  });

  it("is 'blocked' when a DIFFERENT user signs in after another account synced on this device", () => {
    expect(accountSwitchDecision({ lastSyncUserId: "user-a", currentUserId: "user-b" })).toBe("blocked");
  });
});

describe("wipeLocalDataForAccountSwitch (the 'Replace local data' action's db half)", () => {
  afterEach(async () => {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase("tabburrow");
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });

  it("wipes collections/links/pendingOps, resets the cursor, swaps the per-user flags, and leaves sessions untouched", async () => {
    const db = new BurrowDB();
    await db.open();
    try {
      // Seed the full pre-switch state: user A's synced-down data, a queued
      // op, an advanced cursor, A's bootstrap flag, and A as the last-synced
      // user — plus a session snapshot, which must SURVIVE the wipe.
      await db.collections.put({
        id: "c1",
        name: "A's Collection",
        accent: null,
        position: "a1",
        isShared: false,
        shareSlug: null,
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null,
      });
      await db.links.put({
        id: "l1",
        collectionId: "c1",
        url: "https://example.com",
        title: "A's Link",
        faviconUrl: null,
        note: null,
        tags: [],
        position: "a1",
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null,
      });
      await db.pendingOps.put({ table: "collections", rowId: "c1", queuedAt: 1 });
      await db.sessions.put({ id: "s1", name: null, kind: "manual", windows: [], createdAt: 1 });
      await db.meta.put({ key: SYNC_CURSOR_META_KEY, value: "123456" });
      await db.meta.put({ key: initialUploadDoneMetaKey("user-a"), value: "1" });
      await db.meta.put({ key: LAST_SYNC_USER_ID_META_KEY, value: "user-a" });
      // An unrelated meta key must survive too.
      await db.meta.put({ key: "theme", value: "paper" });

      await wipeLocalDataForAccountSwitch("user-b", db);

      expect(await db.collections.count()).toBe(0);
      expect(await db.links.count()).toBe(0);
      expect(await db.pendingOps.count()).toBe(0);
      // Sessions are this device's local browsing history, not account data.
      expect(await db.sessions.count()).toBe(1);

      expect(await getMeta(SYNC_CURSOR_META_KEY, db)).toBe("0");
      // A's flag is GONE (not blanked), B's is set — B has nothing local
      // left to upload, so its bootstrap is already "done".
      expect(await getMeta(initialUploadDoneMetaKey("user-a"), db)).toBeNull();
      expect(await getMeta(initialUploadDoneMetaKey("user-b"), db)).toBe("1");
      expect(await getMeta(LAST_SYNC_USER_ID_META_KEY, db)).toBe("user-b");
      expect(await getMeta("theme", db)).toBe("paper");
    } finally {
      db.close();
    }
  });
});

describe("requestSync (not-configured short-circuit)", () => {
  afterEach(async () => {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase("tabburrow");
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });

  it("skips with 'skip-unconfigured' and writes no sync meta when cloud isn't configured", async () => {
    const db = new BurrowDB();
    await db.open();
    try {
      const result = await requestSync("manual", db);
      expect(result).toEqual({ skipped: "skip-unconfigured" });
      expect(await getMeta(LAST_SYNC_AT_META_KEY, db)).toBeNull();
      expect(await getMeta(LAST_SYNC_ERROR_META_KEY, db)).toBeNull();
    } finally {
      db.close();
    }
  });

  it("coalesces two concurrent calls into the same promise", async () => {
    const db = new BurrowDB();
    await db.open();
    try {
      const p1 = requestSync("alarm", db);
      const p2 = requestSync("nudge", db);
      expect(p1).toBe(p2);
      await p1;
    } finally {
      db.close();
    }
  });
});

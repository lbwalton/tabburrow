import "fake-indexeddb/auto";
import { describe, it, expect, afterEach } from "vitest";
import { BurrowDB, getMeta } from "@tabburrow/core";
import {
  initialUploadDoneMetaKey,
  LAST_SYNC_AT_META_KEY,
  LAST_SYNC_ERROR_META_KEY,
  requestSync,
  syncGateDecision,
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

import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { BurrowDB, getMeta } from "@tabburrow/core";
import {
  clearPlanCache,
  describeWebAuthFlowError,
  isPlanCacheFresh,
  parseAuthRedirect,
  parsePlanCache,
  planCacheHit,
  planCacheMetaKey,
  planCacheValue,
  PLAN_CACHE_TTL_MS,
} from "./auth";

// sendEmailCode/verifyEmailCode/signInWithGoogle/signOut/getUser/
// onAuthChange/getPlan's chrome.storage-and-network side are NOT unit
// tested here: they call chrome.identity/chrome.storage and supabase-js,
// and this package's vitest config deliberately does no chrome.* mocking
// (same precedent as lib/tabs.ts). They're exercised for real end-to-end by
// e2e/specs/t16-auth.spec.ts against the local Supabase stack. What IS
// test-driven here is every pure decision those functions defer to — plus
// `clearPlanCache`, which is Dexie-only (no chrome.*/supabase-js), tested
// below against fake-indexeddb the same way packages/core tests its repos.

describe("parseAuthRedirect", () => {
  it("extracts the PKCE code on a successful redirect", () => {
    expect(parseAuthRedirect("https://abc123.chromiumapp.org/?code=pkce-abc&state=xyz")).toEqual({
      kind: "success",
      code: "pkce-abc",
    });
  });

  it("surfaces the provider's error_description when the user denies consent", () => {
    const url = "https://abc123.chromiumapp.org/?error=access_denied&error_description=User+denied+access";
    expect(parseAuthRedirect(url)).toEqual({ kind: "error", message: "User denied access" });
  });

  it("surfaces an unsupported/unconfigured-provider error", () => {
    const url =
      "https://abc123.chromiumapp.org/?error=server_error&error_description=Unsupported+provider%3A+provider+is+not+enabled";
    expect(parseAuthRedirect(url)).toEqual({
      kind: "error",
      message: "Unsupported provider: provider is not enabled",
    });
  });

  it("falls back to a generic message when error has no description", () => {
    expect(parseAuthRedirect("https://abc123.chromiumapp.org/?error=server_error")).toEqual({
      kind: "error",
      message: "Google sign-in failed (server_error).",
    });
  });

  it("is an error when neither code nor error is present", () => {
    expect(parseAuthRedirect("https://abc123.chromiumapp.org/?state=xyz")).toEqual({
      kind: "error",
      message: "Google sign-in redirect was missing its authorization code.",
    });
  });

  it("is an error for an unparsable URL", () => {
    expect(parseAuthRedirect("not a url")).toEqual({
      kind: "error",
      message: "Google sign-in returned an unreadable redirect.",
    });
  });
});

describe("describeWebAuthFlowError", () => {
  it("maps Chrome's 'could not be loaded' text to a not-configured message", () => {
    expect(describeWebAuthFlowError("Authorization page could not be loaded.")).toBe(
      "Google sign-in isn't set up for this Supabase project yet (see docs/SETUP_NOTES.md).",
    );
  });

  it("maps Chrome's 'did not approve' text to a cancelled message", () => {
    expect(describeWebAuthFlowError("The user did not approve access.")).toBe("Google sign-in was cancelled.");
  });

  it("treats a missing message (window just closed) as cancelled", () => {
    expect(describeWebAuthFlowError(undefined)).toBe("Google sign-in was cancelled.");
  });

  it("falls back to a generic message for anything else Chrome reports", () => {
    expect(describeWebAuthFlowError("Some other Chrome error")).toBe(
      "Google sign-in failed: Some other Chrome error",
    );
  });
});

describe("isPlanCacheFresh", () => {
  it("is fresh just under the 12h TTL", () => {
    expect(isPlanCacheFresh(100_000, 100_000 + PLAN_CACHE_TTL_MS - 1)).toBe(true);
  });

  it("is stale at exactly the TTL and beyond", () => {
    expect(isPlanCacheFresh(100_000, 100_000 + PLAN_CACHE_TTL_MS)).toBe(false);
    expect(isPlanCacheFresh(100_000, 100_000 + PLAN_CACHE_TTL_MS + 60_000)).toBe(false);
  });

  it("is fresh at zero age", () => {
    expect(isPlanCacheFresh(100_000, 100_000)).toBe(true);
  });

  it("treats a garbage (NaN) timestamp as stale", () => {
    expect(isPlanCacheFresh(NaN, 100_000)).toBe(false);
  });
});

describe("planCacheMetaKey", () => {
  it("scopes the meta key by user id, so two users can never share an entry", () => {
    expect(planCacheMetaKey("user-a")).toBe("planCache:user-a");
    expect(planCacheMetaKey("user-a")).not.toBe(planCacheMetaKey("user-b"));
  });

  it("never equals the legacy global key a pre-fix build wrote", () => {
    expect(planCacheMetaKey("")).not.toBe("planCache");
  });
});

describe("planCacheValue / parsePlanCache", () => {
  it("round-trips a serialized cache entry", () => {
    expect(parsePlanCache(planCacheValue("user-a", "pro", 100_000))).toEqual({
      userId: "user-a",
      plan: "pro",
      fetchedAt: 100_000,
    });
  });

  it("returns null for a never-cached (null) or cleared (empty-string) value", () => {
    expect(parsePlanCache(null)).toBeNull();
    expect(parsePlanCache("")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parsePlanCache("{not json")).toBeNull();
  });

  it("returns null for an unrecognized plan value", () => {
    expect(parsePlanCache('{"userId":"user-a","plan":"enterprise","fetchedAt":100000}')).toBeNull();
  });

  it("returns null when fetchedAt is missing or not a number", () => {
    expect(parsePlanCache('{"userId":"user-a","plan":"free"}')).toBeNull();
    expect(parsePlanCache('{"userId":"user-a","plan":"free","fetchedAt":"not-a-number"}')).toBeNull();
  });

  it("returns null for a legacy pre-userId cache value (no userId field)", () => {
    expect(parsePlanCache('{"plan":"pro","fetchedAt":100000}')).toBeNull();
  });
});

describe("planCacheHit (the full getPlan cache decision)", () => {
  const NOW = 1_000_000;
  const freshForA = planCacheValue("user-a", "pro", NOW - 1000);

  it("a fresh cache written under user A is returned for A within the TTL", () => {
    expect(planCacheHit(freshForA, "user-a", NOW, false)).toBe("pro");
  });

  it("a cache written under user A is NEVER returned for user B, even fresh (the T16 escalation bug)", () => {
    expect(planCacheHit(freshForA, "user-b", NOW, false)).toBeNull();
  });

  it("force bypasses even a fresh, same-user cache", () => {
    expect(planCacheHit(freshForA, "user-a", NOW, true)).toBeNull();
  });

  it("a stale same-user cache is a miss", () => {
    const stale = planCacheValue("user-a", "pro", NOW - PLAN_CACHE_TTL_MS);
    expect(planCacheHit(stale, "user-a", NOW, false)).toBeNull();
  });

  it("absent/cleared/malformed raw values are a miss", () => {
    expect(planCacheHit(null, "user-a", NOW, false)).toBeNull();
    expect(planCacheHit("", "user-a", NOW, false)).toBeNull();
    expect(planCacheHit("{not json", "user-a", NOW, false)).toBeNull();
  });
});

describe("clearPlanCache (what signOut calls for the departing user)", () => {
  it("clears user A's entry so a later read for A misses", async () => {
    const db = new BurrowDB();
    await db.open();
    try {
      await db.meta.put({ key: planCacheMetaKey("user-a"), value: planCacheValue("user-a", "pro", 100_000) });
      await clearPlanCache("user-a", db);
      const raw = await getMeta(planCacheMetaKey("user-a"), db);
      expect(planCacheHit(raw, "user-a", 100_001, false)).toBeNull();
    } finally {
      db.close();
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase("tabburrow");
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      });
    }
  });

  it("does not touch another user's entry", async () => {
    const db = new BurrowDB();
    await db.open();
    try {
      const bValue = planCacheValue("user-b", "free", 100_000);
      await db.meta.put({ key: planCacheMetaKey("user-a"), value: planCacheValue("user-a", "pro", 100_000) });
      await db.meta.put({ key: planCacheMetaKey("user-b"), value: bValue });
      await clearPlanCache("user-a", db);
      expect(await getMeta(planCacheMetaKey("user-b"), db)).toBe(bValue);
    } finally {
      db.close();
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase("tabburrow");
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      });
    }
  });
});

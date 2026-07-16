import { describe, it, expect } from "vitest";
import {
  describeWebAuthFlowError,
  isPlanCacheFresh,
  parseAuthRedirect,
  parsePlanCache,
  PLAN_CACHE_TTL_MS,
} from "./auth";

// sendEmailCode/verifyEmailCode/signInWithGoogle/signOut/getUser/
// onAuthChange/getPlan's chrome.storage-and-network side are NOT unit
// tested here: they call chrome.identity/chrome.storage and supabase-js,
// and this package's vitest config deliberately does no chrome.* mocking
// (same precedent as lib/tabs.ts). They're exercised for real end-to-end by
// e2e/specs/t16-auth.spec.ts against the local Supabase stack. What IS
// test-driven here is every pure decision those functions defer to.

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

describe("parsePlanCache", () => {
  it("parses a well-formed cache value", () => {
    expect(parsePlanCache('{"plan":"pro","fetchedAt":100000}')).toEqual({ plan: "pro", fetchedAt: 100_000 });
  });

  it("returns null for a never-cached (null) value", () => {
    expect(parsePlanCache(null)).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parsePlanCache("{not json")).toBeNull();
  });

  it("returns null for an unrecognized plan value", () => {
    expect(parsePlanCache('{"plan":"enterprise","fetchedAt":100000}')).toBeNull();
  });

  it("returns null when fetchedAt is missing or not a number", () => {
    expect(parsePlanCache('{"plan":"free"}')).toBeNull();
    expect(parsePlanCache('{"plan":"free","fetchedAt":"not-a-number"}')).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { AUTH_STORAGE_PREFIX, hasSupabaseEnv, prefixedStorageKey } from "./supabase";

// `getClient`/`isSupabaseConfigured` are NOT unit tested here: they read
// `import.meta.env` and call `createClient`/`chrome.storage.local` — this
// package's vitest config deliberately does no chrome.* mocking (same
// precedent as lib/tabs.ts). `hasSupabaseEnv` — the actual "is cloud
// configured" decision both of those defer to — IS test-driven, and the
// real chrome.storage.local-backed adapter is exercised for real by the
// e2e auth spec (e2e/specs/t16-auth.spec.ts).

describe("hasSupabaseEnv", () => {
  it("is true when both url and anon key are non-blank", () => {
    expect(hasSupabaseEnv("http://127.0.0.1:54321", "anon-key")).toBe(true);
  });

  it("is false when both are undefined (no .env.local at all)", () => {
    expect(hasSupabaseEnv(undefined, undefined)).toBe(false);
  });

  it("is false when one side is missing", () => {
    expect(hasSupabaseEnv("http://127.0.0.1:54321", undefined)).toBe(false);
    expect(hasSupabaseEnv(undefined, "anon-key")).toBe(false);
  });

  it("is false when one side is an empty or whitespace-only string (sync-env.mjs wrote a blank line)", () => {
    expect(hasSupabaseEnv("", "anon-key")).toBe(false);
    expect(hasSupabaseEnv("http://127.0.0.1:54321", "   ")).toBe(false);
  });
});

describe("prefixedStorageKey", () => {
  it("prefixes with the sb-auth namespace", () => {
    expect(prefixedStorageKey("some-key")).toBe(`${AUTH_STORAGE_PREFIX}some-key`);
    expect(prefixedStorageKey("some-key")).toBe("sb-auth:some-key");
  });

  it("keeps distinct keys distinct after prefixing", () => {
    expect(prefixedStorageKey("a")).not.toBe(prefixedStorageKey("b"));
  });
});

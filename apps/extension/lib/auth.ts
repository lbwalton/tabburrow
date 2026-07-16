import { getDB, getMeta, setMeta } from "@tabburrow/core";
import type { BurrowDB } from "@tabburrow/core";
import { getClient } from "./supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AuthUser {
  id: string;
  email: string;
}

function requireClient(): SupabaseClient {
  const client = getClient();
  if (!client) throw new Error("Cloud features are not configured for this build.");
  return client;
}

/** Sends a 6-digit email OTP via Supabase Auth. `shouldCreateUser: true` — the same button doubles as sign-up for a brand-new email, matching the "just an email box" UX the design spec calls for (no separate sign-up flow). */
export async function sendEmailCode(email: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) throw error;
}

/** Verifies the 6-digit code from `sendEmailCode`'s email, completing sign-in (and, for a brand-new address, sign-up + the `handle_new_user` profiles-row trigger — see supabase/migrations/0001_init.sql). */
export async function verifyEmailCode(email: string, code: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.auth.verifyOtp({ email, token: code, type: "email" });
  if (error) throw error;
}

export type AuthRedirectResult = { kind: "success"; code: string } | { kind: "error"; message: string };

/**
 * Parses the URL `chrome.identity.launchWebAuthFlow` resolves with after the
 * Google OAuth round-trip. Supabase's `/authorize` redirect carries either
 * `?code=<pkce-code>` (success — exchange it via `exchangeCodeForSession`)
 * or `?error=...&error_description=...` (the user denied consent, or any
 * other provider-side failure) as QUERY params — this codebase always sets
 * `flowType: "pkce"` (see lib/supabase.ts), never the legacy implicit flow,
 * so there is no `#access_token` hash fragment to handle here.
 *
 * Pure: no chrome.* or supabase-js calls, which is what lets this cover the
 * "user denied consent" / "malformed redirect" paths in a unit test without
 * a live Google OAuth client — see lib/auth.test.ts.
 */
export function parseAuthRedirect(url: string): AuthRedirectResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: "error", message: "Google sign-in returned an unreadable redirect." };
  }
  const error = parsed.searchParams.get("error");
  if (error) {
    const description = parsed.searchParams.get("error_description");
    return { kind: "error", message: description || `Google sign-in failed (${error}).` };
  }
  const code = parsed.searchParams.get("code");
  if (!code) {
    return { kind: "error", message: "Google sign-in redirect was missing its authorization code." };
  }
  return { kind: "success", code };
}

/**
 * Maps `chrome.runtime.lastError.message` from a failed
 * `chrome.identity.launchWebAuthFlow` call to a message worth showing a
 * user. The two known, stable-across-versions strings Chrome's identity API
 * produces: "Authorization page could not be loaded." (the auth page never
 * loaded at all — e.g. a network failure) and "The user did not approve
 * access." (the interactive auth window was closed without completing).
 *
 * Honest limitation: verified locally that Google-unconfigured GoTrue
 * responds to `/authorize` with a 400 JSON error body and never redirects
 * (`GET /auth/v1/authorize?provider=google` → `"Unsupported provider:
 * provider is not enabled"`) — but NOT end-to-end what Chrome's identity API
 * does with that specific response in `interactive: true` mode, since that
 * requires a human actually closing the resulting popup (not something a
 * headless harness can drive — see e2e/MANUAL.md). Both branches below are
 * plausible outcomes of that scenario; either way this function's job is
 * just "never let a raw Chrome error string reach the UI unexplained," and
 * that much IS guaranteed regardless of which branch fires. Pure, so it's
 * unit-testable without a live Google client — see lib/auth.test.ts.
 */
export function describeWebAuthFlowError(message: string | undefined): string {
  if (!message) return "Google sign-in was cancelled.";
  const lower = message.toLowerCase();
  if (lower.includes("did not approve") || lower.includes("cancel")) {
    return "Google sign-in was cancelled.";
  }
  if (lower.includes("could not be loaded")) {
    return "Google sign-in isn't set up for this Supabase project yet (see docs/SETUP_NOTES.md).";
  }
  return `Google sign-in failed: ${message}`;
}

function launchWebAuthFlow(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, (responseUrl) => {
      if (chrome.runtime.lastError || !responseUrl) {
        reject(new Error(describeWebAuthFlowError(chrome.runtime.lastError?.message)));
        return;
      }
      resolve(responseUrl);
    });
  });
}

/**
 * Google sign-in, entirely inside the extension — no dangling tab: builds
 * the OAuth URL with `skipBrowserRedirect: true` (so supabase-js never
 * navigates the current page), opens it in `chrome.identity.launchWebAuthFlow`
 * (a purpose-built, self-closing auth popup Chrome owns), and exchanges the
 * PKCE code the resulting redirect carries for a session. The local dev
 * stack has no Google OAuth client configured yet (see docs/SETUP_NOTES.md)
 * — `describeWebAuthFlowError` is what turns that into a clear message
 * instead of an opaque Chrome error.
 */
export async function signInWithGoogle(): Promise<void> {
  const client = requireClient();
  const redirectTo = chrome.identity.getRedirectURL();
  const { data, error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: { skipBrowserRedirect: true, redirectTo },
  });
  if (error || !data?.url) {
    throw new Error("Google sign-in isn't set up for this Supabase project yet (see docs/SETUP_NOTES.md).");
  }
  const responseUrl = await launchWebAuthFlow(data.url);
  const parsedRedirect = parseAuthRedirect(responseUrl);
  if (parsedRedirect.kind === "error") throw new Error(parsedRedirect.message);
  const { error: exchangeError } = await client.auth.exchangeCodeForSession(parsedRedirect.code);
  if (exchangeError) throw exchangeError;
}

/**
 * Signs out of THIS device only (`scope: "local"`) — local Dexie data is
 * untouched either way, since sync (T18) is a separate, PRO-gated concern
 * from auth. The one exception: the departing user's plan cache is cleared
 * FIRST (before the supabase call, so even a failed sign-out never leaves
 * this device holding a warm entitlement entry for a session that was just
 * asked to end) — one layer of the two-layer cross-user isolation fix; see
 * `planCacheMetaKey`. The legacy global "planCache" key a pre-fix build may
 * have written is swept here too (nothing reads it anymore, but a stale
 * "pro" entry shouldn't sit in meta forever).
 */
export async function signOut(db: BurrowDB = getDB()): Promise<void> {
  const client = requireClient();
  const user = await getUser();
  if (user) await clearPlanCache(user.id, db);
  await setMeta(LEGACY_PLAN_CACHE_META_KEY, "", db);
  const { error } = await client.auth.signOut({ scope: "local" });
  if (error) throw error;
}

/** Reads the current session from local storage (no network round trip) — `null` when cloud isn't configured or nobody is signed in. */
export async function getUser(): Promise<AuthUser | null> {
  const client = getClient();
  if (!client) return null;
  const { data, error } = await client.auth.getSession();
  if (error) return null;
  const user = data.session?.user;
  if (!user?.email) return null;
  return { id: user.id, email: user.email };
}

/**
 * Wraps `supabase.auth.onAuthStateChange`, translating each event into a
 * plain `AuthUser | null` — this is the ONLY thing UI (AccountPane, the
 * popup footer) subscribes to for auth state; there is no polling anywhere.
 * supabase-js fires an `INITIAL_SESSION` event immediately on subscribe, so
 * callers get their first state (signed in or out) without a separate
 * `getUser()` call. No-ops (never invokes `cb`) when cloud isn't configured
 * — callers are expected to gate on `isSupabaseConfigured()` before ever
 * subscribing (see lib/supabase.ts), so this is a defensive no-op, not the
 * primary way that state is communicated.
 */
export function onAuthChange(cb: (user: AuthUser | null) => void): () => void {
  const client = getClient();
  if (!client) return () => {};
  const {
    data: { subscription },
  } = client.auth.onAuthStateChange((_event, session) => {
    const user = session?.user;
    cb(user?.email ? { id: user.id, email: user.email } : null);
  });
  return () => subscription.unsubscribe();
}

/**
 * The GLOBAL meta key the original T16 implementation used, kept only so
 * `signOut` can sweep any stale entry a pre-fix build left behind. Never
 * read or written otherwise: an unscoped cache key meant user B could read
 * user A's still-fresh "pro" entry after an A-signs-out/B-signs-in sequence
 * on the same Chrome profile (entitlement escalation, caught in review).
 */
export const LEGACY_PLAN_CACHE_META_KEY = "planCache";
/** 12h, per the design spec's "on sign-in and every 12h, fetch profiles.plan" entitlements rule. */
export const PLAN_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

export type Plan = "free" | "pro";

interface PlanCache {
  userId: string;
  plan: Plan;
  fetchedAt: number;
}

/**
 * The meta key `getPlan` caches under — scoped per user id, layer 1 of the
 * two-layer cross-user isolation fix: a different user's `getPlan` never
 * even reads this entry's key. Layer 2 is `planCacheHit` validating the
 * `userId` stored INSIDE the value too, so even a corrupted/hand-edited
 * entry under the wrong key can't leak across users.
 */
export function planCacheMetaKey(userId: string): string {
  return `${LEGACY_PLAN_CACHE_META_KEY}:${userId}`;
}

/** Serializes a cache entry for `planCacheMetaKey(userId)`. Pure — the exact inverse of `parsePlanCache`; see lib/auth.test.ts's round-trip test. */
export function planCacheValue(userId: string, plan: Plan, fetchedAt: number): string {
  return JSON.stringify({ userId, plan, fetchedAt } satisfies PlanCache);
}

/** True when a plan cached at `fetchedAt` is still within the TTL at `now`. Pure. */
export function isPlanCacheFresh(fetchedAt: number, now: number): boolean {
  return now - fetchedAt < PLAN_CACHE_TTL_MS;
}

/**
 * Narrows a stored plan-cache value to a `PlanCache`, or `null` for
 * anything absent/cleared/malformed — including a legacy pre-userId-shape
 * entry, which carries no proof of WHOSE plan it was and therefore must
 * never be trusted. Pure.
 */
export function parsePlanCache(raw: string | null): PlanCache | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { userId, plan, fetchedAt } = parsed as { userId?: unknown; plan?: unknown; fetchedAt?: unknown };
  if (typeof userId !== "string" || (plan !== "free" && plan !== "pro") || typeof fetchedAt !== "number") return null;
  return { userId, plan, fetchedAt };
}

/**
 * The complete cache-read decision `getPlan` defers to, as one pure
 * function: returns the cached plan only when `force` is off AND the raw
 * value parses AND its embedded `userId` matches the CURRENT user AND it's
 * still within the TTL — anything else is a miss (`null`). The userId
 * equality check is what makes a cache written under user A structurally
 * unreturnable for user B (see lib/auth.test.ts's escalation-bug test).
 */
export function planCacheHit(raw: string | null, userId: string, now: number, force: boolean): Plan | null {
  if (force) return null;
  const cached = parsePlanCache(raw);
  if (!cached || cached.userId !== userId || !isPlanCacheFresh(cached.fetchedAt, now)) return null;
  return cached.plan;
}

/** Clears `userId`'s plan-cache entry (writes the empty string, which `parsePlanCache` treats as absent — meta has no delete). Called by `signOut` for the departing user; other users' entries are untouched (per-user keys). */
export async function clearPlanCache(userId: string, db: BurrowDB = getDB()): Promise<void> {
  await setMeta(planCacheMetaKey(userId), "", db);
}

/**
 * `profiles.plan` for the signed-in user, cached in
 * `meta[planCacheMetaKey(user.id)]` for `PLAN_CACHE_TTL_MS` (12h) — `force`
 * bypasses the cache (used by the Settings "Refresh status" button).
 * Returns `null` when cloud isn't configured or nobody is signed in; never
 * throws for those two cases, only for a genuine query failure being
 * swallowed into `null` too (there's no good UI-facing distinction between
 * "no plan" and "couldn't check" here — both just mean "don't show PRO
 * features").
 */
export async function getPlan(force = false, db: BurrowDB = getDB()): Promise<Plan | null> {
  const client = getClient();
  if (!client) return null;
  const user = await getUser();
  if (!user) return null;

  const hit = planCacheHit(await getMeta(planCacheMetaKey(user.id), db), user.id, Date.now(), force);
  if (hit) return hit;

  // profiles' primary key is user_id, not id — see supabase/migrations/0001_init.sql.
  const { data, error } = await client.from("profiles").select("plan").eq("user_id", user.id).single();
  if (error || !data) return null;
  const plan: Plan = data.plan === "pro" ? "pro" : "free";
  await setMeta(planCacheMetaKey(user.id), planCacheValue(user.id, plan, Date.now()), db);
  return plan;
}

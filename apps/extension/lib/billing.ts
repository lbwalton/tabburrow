// T23b: extension-side billing — the counterpart to apps/web/lib/billing.ts's
// /account page flow (T23a), wired for the extension's own UI (AccountPane)
// and this codebase's typed-error convention (lib/ai.ts's AiOrganizeError).
//
// checkout-session's contract (supabase/functions/checkout-session/index.ts):
// POST, JWT required, body `{interval: "month" | "year"}` -> `{url}` for a
// Stripe-hosted Checkout page. AccountPane opens that url in a NEW TAB
// (`chrome.tabs.create`) rather than navigating the current one — unlike
// apps/web's AccountClient, which redirects the current tab, an extension
// page has no good "redirect away and come back" story, so the dashboard
// tab stays put and the checkout happens alongside it.
import { getAccessToken } from "./auth";
import type { AuthUser, Plan } from "./auth";
import { isSupabaseConfigured } from "./supabase";

export type BillingInterval = "month" | "year";

export type BillingErrorKind = "auth" | "network" | "upstream";

/**
 * Typed error `createCheckoutSession` throws instead of a plain `Error` —
 * same shape/reasoning as lib/ai.ts's `AiOrganizeError`: callers branch on
 * `.kind` (AccountPane shows the same message either way today, but the
 * kind is preserved for whichever caller next needs to distinguish them,
 * matching this codebase's existing convention rather than collapsing to a
 * string).
 */
export class BillingError extends Error {
  readonly kind: BillingErrorKind;

  constructor(kind: BillingErrorKind, message: string) {
    super(message);
    this.name = "BillingError";
    this.kind = kind;
  }
}

export interface CheckoutSessionResult {
  url: string;
}

/** The ONLY origin a checkout-session `{url}` may point at — `handleUpgrade` passes it straight to `chrome.tabs.create`, see `isStripeCheckoutUrl`. */
export const STRIPE_CHECKOUT_ORIGIN = "https://checkout.stripe.com";

/**
 * Pure (fix pass 1): true only for a parseable https: URL whose origin is
 * EXACTLY `https://checkout.stripe.com` — the one origin Stripe's hosted
 * Checkout for this function's `{interval}` requests ever lives on
 * (billing-portal URLs are `billing.stripe.com`, but the portal branch is
 * apps/web's flow, never called from the extension). The response URL is
 * passed straight to `chrome.tabs.create`, so a compromised or
 * misconfigured backend must not be able to open an arbitrary — or
 * `javascript:` — URL in the user's browser; origin equality (not a
 * hostname-suffix check) also rejects `checkout.stripe.com.evil.example`
 * spoofs.
 */
export function isStripeCheckoutUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && parsed.origin === STRIPE_CHECKOUT_ORIGIN;
}

/**
 * Pure: interprets checkout-session's `{status, body}` into `{url}`, or
 * throws `BillingError`. Split out from `createCheckoutSession` so the
 * status-code decision is unit-testable without a network mock (see
 * lib/billing.test.ts) — same split as lib/ai.ts's `parseOrganizeResponse`
 * and apps/web/lib/billing.ts's `parseCheckoutResponse` (this function's
 * closest sibling: same status-code decisions, this app's own error type).
 * A 200 whose url isn't a real `https://checkout.stripe.com` URL is an
 * "upstream" error, same as a missing one — see `isStripeCheckoutUrl`.
 */
export function parseCheckoutSessionResponse(status: number, body: unknown): CheckoutSessionResult {
  if (status === 200) {
    const url = (body as Record<string, unknown> | null)?.url;
    if (typeof url === "string" && isStripeCheckoutUrl(url)) return { url };
    throw new BillingError("upstream", "Stripe didn't return a checkout URL. Try again in a moment.");
  }
  if (status === 401) {
    throw new BillingError("auth", "Sign in again and retry.");
  }
  throw new BillingError("upstream", "Couldn't start checkout. Try again in a moment.");
}

/**
 * Calls the `checkout-session` Edge Function with `{interval}`,
 * authenticated with the current session's access token — same
 * `fetch`-direct convention as lib/ai.ts's `organizeLinks` (not
 * supabase-js's `functions.invoke`), so a non-2xx body is trivial to read.
 * Not unit-tested directly: it calls chrome APIs and the network, the same
 * "e2e-only" convention lib/auth.test.ts's docstring sets for
 * getPlan/getUser/etc. — `parseCheckoutSessionResponse` above carries the
 * actual test-driven logic, and e2e/specs/t23-billing.spec.ts covers the
 * live round trip.
 *
 * Throws `BillingError`:
 *  - "auth" — cloud not configured, or not signed in (no access token).
 *  - "network" — the fetch itself failed (offline, DNS, ...).
 *  - "upstream" — non-2xx (other than 401) or a malformed 200 body.
 */
export async function createCheckoutSession(interval: BillingInterval): Promise<CheckoutSessionResult> {
  if (!isSupabaseConfigured()) {
    throw new BillingError("auth", "Cloud features are not configured for this build.");
  }
  const token = await getAccessToken();
  if (!token) {
    throw new BillingError("auth", "Sign in to upgrade to PRO.");
  }

  const url = `${import.meta.env.WXT_SUPABASE_URL}/functions/v1/checkout-session`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ interval }),
    });
  } catch {
    throw new BillingError("network", "Couldn't reach the billing service. Check your connection and try again.");
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  return parseCheckoutSessionResponse(res.status, body);
}

// ---------------------------------------------------------------------------
// upgradeAvailability — AccountPane's pure "what billing section to show" decision
// ---------------------------------------------------------------------------

export type UpgradeAvailability = "hidden" | "upgrade" | "manage";

/**
 * Pure: decides which billing section AccountPane renders.
 *  - "hidden": cloud not configured, signed out, or plan not yet resolved
 *    (`null` — not yet fetched, or a failed lookup) — folded the same way
 *    lib/ai.ts's `aiOrganizeCtaAvailable` treats an unknown plan as "don't
 *    show a PRO-gated affordance", not "assume the best case".
 *  - "upgrade": signed in FREE — the monthly/yearly checkout buttons.
 *  - "manage": signed in PRO — the "Manage billing" button.
 */
export function upgradeAvailability(input: {
  configured: boolean;
  user: AuthUser | null;
  plan: Plan | null;
}): UpgradeAvailability {
  if (!input.configured || !input.user) return "hidden";
  if (input.plan === "pro") return "manage";
  if (input.plan === "free") return "upgrade";
  return "hidden";
}

// ---------------------------------------------------------------------------
// Manage-billing URL — mirrors lib/share-url.ts's buildShareUrl/shareUrlFor split
// ---------------------------------------------------------------------------

/** Same public-facing fallback lib/share-url.ts's `shareUrlFor` defends with — see that file's docstring for why a build with no root `.env` still needs a real, resolvable origin. */
const DEFAULT_SITE_URL = "https://tabburrow.com";

/**
 * Pure: joins a site origin with "/account" — the web app's own account
 * page (apps/web/app/account, T23a), where "Manage billing" opens a real
 * Stripe customer-portal session. The one piece of `accountUrl` worth unit
 * testing in isolation; see lib/share-url.ts's identical
 * pure-function/env-reading-wrapper split.
 */
export function buildAccountUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/account`;
}

/** Reads `WXT_SITE_URL` (same var/fallback lib/share-url.ts's `shareUrlFor` uses) and builds the URL AccountPane's "Manage billing" button opens in a new tab. */
export function accountUrl(): string {
  const raw = import.meta.env.WXT_SITE_URL as string | undefined;
  const siteUrl = raw?.trim() || DEFAULT_SITE_URL;
  return buildAccountUrl(siteUrl);
}

// ---------------------------------------------------------------------------
// Post-checkout pickup rate limit
// ---------------------------------------------------------------------------

/** How often AccountPane's visibilitychange pickup (below) is allowed to force-refresh the plan. */
export const PICKUP_RATE_LIMIT_MS = 60_000;

/**
 * Pure: whether a visibilitychange-driven `getPlan(true)` pickup should
 * fire right now.
 *
 * Rationale ("post-checkout pickup polish"): clicking "Upgrade to PRO"
 * opens the Stripe-hosted checkout in a NEW TAB (AccountPane's
 * handleUpgrade) — completing it there and switching BACK to the original
 * extension tab is the single most common way anyone will ever see their
 * own upgrade land, and making them remember to also click "Refresh
 * status" is a needless extra step given the tab-switch itself is already
 * a strong "they probably just finished checkout" signal. But
 * `visibilitychange` fires on EVERY tab-switch, including rapid alt-tabbing
 * that has nothing to do with checkout — without a rate limit, that would
 * hammer `getPlan(true)` (a real network round trip that deliberately
 * bypasses the 12h plan cache — see lib/auth.ts's `getPlan`) far more than
 * this cheap local check warrants. 60s is arbitrary but generous: nobody
 * completes a Stripe Checkout faster than that, and it's a small fraction
 * of the 12h cache TTL this pickup is layered in front of.
 */
export function shouldPickupPlanOnVisible(lastCheckedAt: number | null, now: number): boolean {
  if (lastCheckedAt === null) return true;
  return now - lastCheckedAt >= PICKUP_RATE_LIMIT_MS;
}

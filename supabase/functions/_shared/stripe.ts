// T23a: shared Stripe client construction, reused by checkout-session and
// stripe-webhook. Pinned to a specific stripe-node release (same precedent
// as _shared/auth.ts pinning @supabase/supabase-js) rather than a floating
// `npm:stripe` specifier, so a new major release can't silently change
// behavior under this repo. Verified 2026-07-16 against npm's registry
// that 22.3.1 (2026-07-09) is the newest release this sandbox's npm
// registry mirror will resolve (its dependency-freshness cutoff rejects
// 22.3.2, published 2026-07-16); re-check both the latest version and
// that cutoff before bumping.
import Stripe from "npm:stripe@22.3.1";

export { Stripe };

/**
 * Builds a fresh Stripe client from `STRIPE_SECRET_KEY`, or `null` when
 * unset (self-hosters who haven't configured billing yet — same "quiet
 * null, caller decides how to respond" convention as
 * `_shared/auth.ts`'s `createServiceRoleClient` env checks). Deliberately
 * NOT memoized (unlike `apps/web/lib/share.ts`'s service-role client): a
 * `Stripe` instance is cheap to construct (no network call in its
 * constructor) and re-reading `Deno.env` on every call is what lets tests
 * change `STRIPE_SECRET_KEY` between cases without a stale cached client.
 *
 * `httpClient: Stripe.createFetchHttpClient()` is required in the Deno
 * edge runtime: stripe-node's default Node http client isn't available
 * there, and the fetch-based client is also what makes mocking
 * `globalThis.fetch` in tests actually intercept Stripe's own requests.
 */
export function getStripeClient(): Stripe | null {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) return null;
  return new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });
}

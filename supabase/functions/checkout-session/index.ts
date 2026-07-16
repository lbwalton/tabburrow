// T23a: checkout-session Edge Function.
//
// Contract (.superpowers/sdd/task-23-brief.md, task-23a's decisions doc):
//   POST, JWT required. Body: {interval: "month" | "year"} to start a
//   Stripe Checkout subscription, or {portal: true} to open the Stripe
//   customer billing portal (this repo's own choice for where the portal
//   session lives — see the docstring on `handleRequest` below for why it
//   was folded into this function instead of a separate one).
//   Finds-or-creates a Stripe customer for the caller (stored on
//   `profiles.stripe_customer_id` via the service role, idempotent under
//   concurrent calls — see `findOrCreateCustomerId`), then returns
//   `{url}` for the caller to redirect/open.
//
// Auth posture matches ai-organize (supabase/functions/ai-organize/index.ts,
// see its docstring + supabase/config.toml's `[functions.ai-organize]`
// comment): gateway-level `verify_jwt` is set to `false` because this
// project's ES256 access tokens aren't recognized by the gateway's own
// check, and authentication instead rests entirely on `requireUser()`
// below, which every request goes through before anything else runs.
import { handleCorsPreflight } from "../_shared/cors.ts";
import { errorResponse, jsonResponse } from "../_shared/json.ts";
import { createServiceRoleClient, requireUser } from "../_shared/auth.ts";
import { getStripeClient, Stripe } from "../_shared/stripe.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.110.5";

export type BillingInterval = "month" | "year";

export type CheckoutRequestBody =
  | { kind: "checkout"; interval: BillingInterval }
  | { kind: "portal" };

export type ParsedBody = { ok: true; body: CheckoutRequestBody } | { ok: false; reason: "invalid_body" };

/**
 * Validates the request body: `{portal: true}` (billing portal) takes
 * precedence if present, else `{interval: "month" | "year"}` (checkout).
 * Anything else is `invalid_body` -> 400.
 */
export function parseRequestBody(raw: unknown): ParsedBody {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "invalid_body" };
  const { interval, portal } = raw as Record<string, unknown>;
  if (portal === true) return { ok: true, body: { kind: "portal" } };
  if (interval === "month" || interval === "year") return { ok: true, body: { kind: "checkout", interval } };
  return { ok: false, reason: "invalid_body" };
}

/** `STRIPE_PRICE_MONTHLY`/`STRIPE_PRICE_YEARLY` (see .env.example) -> the Stripe price id, or `null` when the relevant secret isn't set. */
export function priceIdForInterval(interval: BillingInterval): string | null {
  const key = interval === "month" ? "STRIPE_PRICE_MONTHLY" : "STRIPE_PRICE_YEARLY";
  return Deno.env.get(key) ?? null;
}

/**
 * Where Checkout/portal `success_url`/`cancel_url`/`return_url` point.
 * This is a SEPARATE secret from apps/web's `NEXT_PUBLIC_SITE_URL`: Edge
 * Functions read `Deno.env`, not Next.js's `process.env`, so the same
 * logical value has to be set twice (once per runtime) — see
 * SELF_HOSTING.md's "Set secrets" section. Trailing slash stripped so
 * every caller can safely do `${site}/account` without a double slash.
 */
export function siteUrl(): string | null {
  const raw = Deno.env.get("SITE_URL");
  if (!raw) return null;
  return raw.replace(/\/$/, "");
}

interface ProfileCustomerRow {
  stripe_customer_id: string | null;
}

export type CustomerResult =
  | { ok: true; customerId: string }
  | { ok: false; reason: "profile_not_found" | "stripe_error" };

/**
 * Finds the caller's Stripe customer id on `profiles.stripe_customer_id`,
 * or creates one and claims it. Idempotent under concurrent calls (two
 * near-simultaneous checkout-session requests from the same user, e.g. a
 * double-click): the claiming UPDATE is conditioned on
 * `stripe_customer_id is null` and returns the row it actually changed
 * (`.select()`); if that comes back empty, a concurrent call already won
 * the race, so this re-reads the profile and uses the winner's id
 * instead. Net effect: `profiles.stripe_customer_id` is set exactly once
 * and every caller ends up agreeing on the same value, at the cost of
 * possibly leaving one harmless orphaned Stripe customer object on the
 * losing side (a bounded, accepted edge — Stripe doesn't mind unused test
 * customers, and this can only happen on the very first checkout for a
 * given user, never again once the column is set).
 */
export async function findOrCreateCustomerId(
  serviceClient: SupabaseClient,
  stripe: Stripe,
  user: { id: string; email?: string },
): Promise<CustomerResult> {
  const { data: existing, error: readError } = await serviceClient
    .from("profiles")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle<ProfileCustomerRow>();
  if (readError) return { ok: false, reason: "profile_not_found" };
  if (!existing) return { ok: false, reason: "profile_not_found" };
  if (existing.stripe_customer_id) return { ok: true, customerId: existing.stripe_customer_id };

  let customer: Stripe.Customer;
  try {
    customer = await stripe.customers.create({
      email: user.email,
      metadata: { user_id: user.id },
    });
  } catch {
    return { ok: false, reason: "stripe_error" };
  }

  const { data: claimed, error: claimError } = await serviceClient
    .from("profiles")
    .update({ stripe_customer_id: customer.id })
    .eq("user_id", user.id)
    .is("stripe_customer_id", null)
    .select("stripe_customer_id")
    .maybeSingle<ProfileCustomerRow>();
  if (claimError) return { ok: false, reason: "profile_not_found" };
  if (claimed?.stripe_customer_id) return { ok: true, customerId: claimed.stripe_customer_id };

  // Lost the race: someone else's concurrent call already claimed the
  // column between our read and our update. Re-fetch to get their id.
  const { data: winner, error: winnerError } = await serviceClient
    .from("profiles")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle<ProfileCustomerRow>();
  if (winnerError || !winner?.stripe_customer_id) return { ok: false, reason: "profile_not_found" };
  return { ok: true, customerId: winner.stripe_customer_id };
}

/**
 * Handles both checkout-session creation and billing-portal-session
 * creation behind one JWT-authed endpoint (this repo's design choice,
 * documented per task-23a's brief: "a NEW small function or reuse ... your
 * call, document it"). Reusing this function was preferred over a second
 * `portal-session` function because both branches need the same auth
 * preamble and Stripe already distinguishes them structurally
 * (`{portal: true}` vs `{interval}`) — splitting them would just
 * duplicate that preamble in two files.
 *
 * Customer handling differs per branch (review fix pass 1, minor):
 *  - checkout finds-or-CREATES the Stripe customer (`findOrCreateCustomerId`),
 *    since a first-ever upgrade is exactly when the customer should come
 *    into existence.
 *  - portal only accepts an EXISTING `stripe_customer_id` — a user who
 *    has never checked out has no billing history to manage, and minting
 *    a throwaway customer just to open an empty portal would pollute
 *    Stripe. Missing customer -> 400 `{error: "no_customer"}` (the web
 *    account page maps this to a "upgrade first" message).
 */
export async function handleRequest(req: Request): Promise<Response> {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return errorResponse("method_not_allowed", 405);
  }

  const authResult = await requireUser(req);
  if (!authResult.ok) return authResult.response;
  const user = authResult.user;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return errorResponse("invalid_body", 400);
  }
  const parsed = parseRequestBody(rawBody);
  if (!parsed.ok) return errorResponse(parsed.reason, 400);

  const site = siteUrl();
  if (!site) return errorResponse("server_misconfigured", 500);

  const stripe = getStripeClient();
  if (!stripe) return errorResponse("server_misconfigured", 500);

  const serviceClient = createServiceRoleClient();

  try {
    if (parsed.body.kind === "portal") {
      const { data, error } = await serviceClient
        .from("profiles")
        .select("stripe_customer_id")
        .eq("user_id", user.id)
        .maybeSingle<ProfileCustomerRow>();
      if (error || !data) return errorResponse("upstream", 502);
      if (!data.stripe_customer_id) return errorResponse("no_customer", 400);

      const session = await stripe.billingPortal.sessions.create({
        customer: data.stripe_customer_id,
        return_url: `${site}/account`,
      });
      return jsonResponse({ url: session.url }, 200);
    }

    const priceId = priceIdForInterval(parsed.body.interval);
    if (!priceId) return errorResponse("server_misconfigured", 500);

    const customerResult = await findOrCreateCustomerId(serviceClient, stripe, {
      id: user.id,
      email: user.email ?? undefined,
    });
    if (!customerResult.ok) return errorResponse("upstream", 502);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerResult.customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${site}/upgrade/success`,
      cancel_url: `${site}/account`,
      client_reference_id: user.id,
      subscription_data: { metadata: { user_id: user.id } },
    });
    if (!session.url) return errorResponse("upstream", 502);
    return jsonResponse({ url: session.url }, 200);
  } catch {
    return errorResponse("upstream", 502);
  }
}

// Only start the HTTP listener when this file is run directly (`supabase
// functions serve` / deployed), never when test.ts imports handleRequest
// and the pure helpers above for direct, in-process testing.
if (import.meta.main) {
  Deno.serve(handleRequest);
}

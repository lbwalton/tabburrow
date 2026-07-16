// T23a (+ review fix pass 1): stripe-webhook Edge Function.
//
// Contract (.superpowers/sdd/task-23-brief.md, task-23a's decisions doc,
// review fix pass 1):
//   POST from Stripe only. Verifies the `Stripe-Signature` header against
//   `STRIPE_WEBHOOK_SECRET` (Stripe's own HMAC scheme, via stripe-node's
//   `constructEventAsync` — the async variant is required in Deno's edge
//   runtime, which only exposes the async Web Crypto API, not Node's
//   synchronous `crypto`). Bad/missing signature -> 401. Unknown event
//   types -> 200 `{ignored: true}`.
//
// ORDERING DESIGN (fix pass 1 — the load-bearing part): Stripe does NOT
// guarantee event delivery order, so a stale `customer.subscription.updated`
// whose payload says `status: "active"` can arrive AFTER
// `customer.subscription.deleted`. Deciding the plan from the event
// payload (this function's original design) would let that stale payload
// re-grant unpaid PRO forever. Instead, events are treated purely as
// TRIGGERS: on any `customer.subscription.*` event, and on
// `checkout.session.completed` when it carries a subscription id, the
// subscription is RE-FETCHED LIVE from Stripe
// (`stripe.subscriptions.retrieve` — a deleted subscription remains
// retrievable with `status: "canceled"`) and the plan is derived from
// that LIVE status via `planForStatus`, never from the payload. If the
// live retrieve fails, this responds 5xx so Stripe retries later rather
// than deciding entitlement from possibly-stale data. The ONE disclosed
// exception: a `checkout.session.completed` with NO subscription id (a
// payment-mode session — never produced by this repo's checkout-session,
// which is always `mode: "subscription"`; the Stripe CLI's default
// trigger fixture is one) has no subscription to consult and grants pro
// from the event itself.
//
// ERROR SEMANTICS (fix pass 1): a genuine Postgres/update ERROR while
// applying the decision responds 5xx (Stripe retries — a transient DB
// blip must never silently strand a canceled user on PRO), while a
// well-formed event that simply matches no profile row responds 200
// `{ok: false, reason: "no_match"}` (terminal: retrying an event that
// can never match would just be a retry storm).
//
// Auth posture is DIFFERENT from every other function in this repo, and
// deliberately so: ai-organize and checkout-session set
// `verify_jwt = false` at the gateway but still require a real user JWT
// via `_shared/auth.ts`'s `requireUser()` (see their own docstrings on
// why the gateway check itself is off). This function has NO JWT check
// anywhere — Stripe's webhook delivery never carries a Supabase user
// token, only its own HMAC signature — so `verify_jwt = false` here means
// exactly what it says: this endpoint is open to any POST, and the
// `Stripe-Signature` verification below is the ENTIRE authentication
// boundary. That check must never be skipped or made optional.
import { errorResponse, jsonResponse } from "../_shared/json.ts";
import { createServiceRoleClient } from "../_shared/auth.ts";
import { getStripeClient, Stripe } from "../_shared/stripe.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.110.5";

// ---------------------------------------------------------------------------
// Pure decision pieces (fixture-testable without network — see test.ts)
// ---------------------------------------------------------------------------

export interface StripeEventLike {
  type: string;
  data: { object: Record<string, unknown> };
}

/**
 * What an event points AT — never what to do about it. The plan is
 * decided later, from the LIVE subscription state (see the module
 * docstring's ordering design), so this deliberately does not carry the
 * payload's own `status`.
 */
export type EventReference =
  | { kind: "subscription"; subscriptionId: string; userId: string | null; customerId: string | null }
  | { kind: "checkout_without_subscription"; userId: string | null; customerId: string | null }
  | { kind: "ignore" };

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** `metadata.user_id` (set by checkout-session via `subscription_data.metadata` at Checkout creation) — carried on every subsequent event for that subscription. */
function metadataUserId(obj: Record<string, unknown>): string | null {
  const metadata = obj.metadata;
  if (!metadata || typeof metadata !== "object") return null;
  return asString((metadata as Record<string, unknown>).user_id);
}

/**
 * Maps an event to the subscription/customer/user it refers to:
 *  - `checkout.session.completed`: user from `client_reference_id` (set
 *    by checkout-session) falling back to `metadata.user_id`; a
 *    `subscription` id routes it to the live-retrieve path, its absence
 *    to the disclosed trust-the-event path (module docstring).
 *  - `customer.subscription.updated`/`.deleted`: the subscription's own
 *    id; user from the subscription's metadata when present.
 *  - everything else (including a subscription event somehow missing its
 *    id): ignore.
 */
export function referenceForEvent(event: StripeEventLike): EventReference {
  const obj = event.data.object;
  switch (event.type) {
    case "checkout.session.completed": {
      const userId = asString(obj.client_reference_id) ?? metadataUserId(obj);
      const customerId = asString(obj.customer);
      const subscriptionId = asString(obj.subscription);
      if (subscriptionId) return { kind: "subscription", subscriptionId, userId, customerId };
      return { kind: "checkout_without_subscription", userId, customerId };
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscriptionId = asString(obj.id);
      if (!subscriptionId) return { kind: "ignore" };
      return { kind: "subscription", subscriptionId, userId: metadataUserId(obj), customerId: asString(obj.customer) };
    }
    default:
      return { kind: "ignore" };
  }
}

/** The pure status -> plan decision core (fix pass 1): only a LIVE `active`/`trialing` subscription is PRO; every other status (`past_due`, `canceled`, `unpaid`, `incomplete`, `incomplete_expired`, `paused`) is free. */
export function planForStatus(status: string): "pro" | "free" {
  return status === "active" || status === "trialing" ? "pro" : "free";
}

// ---------------------------------------------------------------------------
// Applying the decision to `profiles` (service role; profiles has no
// user-facing write policy at all, see supabase/migrations/0001_init.sql)
// ---------------------------------------------------------------------------

export interface PlanUpdate {
  plan: "pro" | "free";
  subscriptionId: string | null;
  userId: string | null;
  customerId: string | null;
}

export type ApplyResult =
  | { ok: true; matchedBy: "user_id" | "customer_id" }
  | { ok: false; reason: "no_match" | "db_error" };

/**
 * Writes `{plan, stripe_subscription_id}` to the profile matching
 * `userId` first, falling back to `customerId` when no userId was
 * resolvable (covers subscriptions created outside this app's own
 * checkout flow, e.g. a self-hoster testing from the Stripe dashboard).
 *
 * Failure modes are deliberately distinct (fix pass 1):
 *  - a Postgres ERROR on either UPDATE -> `db_error` immediately (the
 *    handler turns this into a 5xx so Stripe retries; a transient DB
 *    blip must never be swallowed as success).
 *  - both filters ran cleanly but matched zero rows -> `no_match` (the
 *    handler answers 200: retrying an event that structurally cannot
 *    match any profile would only produce a retry storm).
 *
 * IDEMPOTENT by construction: both branches are single unconditional
 * `UPDATE ... SET plan = X, stripe_subscription_id = Y WHERE ...`
 * statements, not a read-modify-write (contrast with ai-organize's
 * metering, which genuinely needs a row lock — see
 * supabase/migrations/0004_ai_metering.sql). Replaying the same event
 * always lands the same final state, so no event-id dedup ledger is
 * needed — and out-of-order deliveries are already neutralized upstream
 * by deriving `plan` from the LIVE subscription state, not the payload.
 */
export async function applyPlanDecision(serviceClient: SupabaseClient, update: PlanUpdate): Promise<ApplyResult> {
  const patch = { plan: update.plan, stripe_subscription_id: update.subscriptionId };

  if (update.userId) {
    const { data, error } = await serviceClient
      .from("profiles")
      .update(patch)
      .eq("user_id", update.userId)
      .select("user_id");
    if (error) return { ok: false, reason: "db_error" };
    if (data && data.length > 0) return { ok: true, matchedBy: "user_id" };
  }

  if (update.customerId) {
    const { data, error } = await serviceClient
      .from("profiles")
      .update(patch)
      .eq("stripe_customer_id", update.customerId)
      .select("user_id");
    if (error) return { ok: false, reason: "db_error" };
    if (data && data.length > 0) return { ok: true, matchedBy: "customer_id" };
  }

  return { ok: false, reason: "no_match" };
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return errorResponse("method_not_allowed", 405);
  }

  const signature = req.headers.get("stripe-signature");
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!signature || !secret) {
    return errorResponse("unauthorized", 401);
  }

  const stripe = getStripeClient();
  if (!stripe) return errorResponse("server_misconfigured", 500);

  // The RAW body (not parsed JSON) is required: Stripe's signature is
  // computed over the exact bytes it sent, and `constructEventAsync` does
  // its own JSON.parse internally once the signature checks out.
  const body = await req.text();

  let event: StripeEventLike;
  try {
    const verified = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      secret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
    event = verified as unknown as StripeEventLike;
  } catch {
    return errorResponse("unauthorized", 401);
  }

  const ref = referenceForEvent(event);
  if (ref.kind === "ignore") {
    return jsonResponse({ ignored: true }, 200);
  }

  let update: PlanUpdate;
  if (ref.kind === "subscription") {
    // Source of truth: the LIVE subscription, never the event payload —
    // see the module docstring's ordering design.
    let sub: Stripe.Subscription;
    try {
      sub = await stripe.subscriptions.retrieve(ref.subscriptionId);
    } catch {
      // Live state unavailable: 502 so Stripe retries this delivery
      // later, rather than deciding entitlement from possibly-stale data.
      return errorResponse("subscription_retrieve_failed", 502);
    }
    update = {
      plan: planForStatus(sub.status),
      // A canceled subscription is not a live entitlement pointer — clear
      // it (review fix pass 1 minor) instead of leaving a dangling id.
      subscriptionId: sub.status === "canceled" ? null : sub.id,
      // The live subscription's own metadata/customer are extra fallbacks
      // beyond what the event payload carried.
      userId: ref.userId ?? asString((sub.metadata as Record<string, unknown> | null)?.user_id),
      customerId: ref.customerId ?? (typeof sub.customer === "string" ? sub.customer : null),
    };
  } else {
    // checkout_without_subscription: the disclosed trust-the-event path
    // (module docstring) — a payment-mode session has no subscription to
    // consult, and this repo's own checkout flow never produces one.
    update = { plan: "pro", subscriptionId: null, userId: ref.userId, customerId: ref.customerId };
  }

  const serviceClient = createServiceRoleClient();
  const applied = await applyPlanDecision(serviceClient, update);
  if (!applied.ok && applied.reason === "db_error") {
    // Transient DB failure: 502 so Stripe retries (fix pass 1 — this must
    // never fall through to a 200 that Stripe treats as delivered).
    return errorResponse("db_error", 502);
  }
  return jsonResponse(applied, 200);
}

// Only start the HTTP listener when this file is run directly (`supabase
// functions serve` / deployed), never when test.ts imports handleRequest
// and the pure helpers above for direct, in-process testing.
if (import.meta.main) {
  Deno.serve(handleRequest);
}

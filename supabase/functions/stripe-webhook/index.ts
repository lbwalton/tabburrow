// T23a: stripe-webhook Edge Function.
//
// Contract (.superpowers/sdd/task-23-brief.md, task-23a's decisions doc):
//   POST from Stripe only. Verifies the `Stripe-Signature` header against
//   `STRIPE_WEBHOOK_SECRET` (Stripe's own HMAC scheme, via stripe-node's
//   `constructEventAsync` — the async variant is required in Deno's edge
//   runtime, which only exposes the async Web Crypto API, not Node's
//   synchronous `crypto`). Handles `checkout.session.completed`,
//   `customer.subscription.updated`, `customer.subscription.deleted` ->
//   flips `profiles.plan`/`profiles.stripe_subscription_id`. Unknown
//   event types -> 200 `{ignored: true}` (Stripe sends far more event
//   types than this app cares about; those aren't errors). Bad/missing
//   signature -> 401.
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
// Event -> plan decision (pure, no Stripe SDK types required — a plain
// shape is enough to decide, and it's what makes this trivially unit
// testable with hand-built fixture objects; see test.ts).
// ---------------------------------------------------------------------------

export interface StripeEventLike {
  type: string;
  data: { object: Record<string, unknown> };
}

export type PlanDecision =
  | { kind: "update"; plan: "pro" | "free"; subscriptionId: string | null; userId: string | null; customerId: string | null }
  | { kind: "ignore" };

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** `subscription_data.metadata.user_id` (set by checkout-session at Checkout creation, see checkout-session/index.ts) — Stripe copies subscription metadata onto every subsequent event for that subscription, so this is present on `customer.subscription.*` events too, not just the initial one. */
function metadataUserId(obj: Record<string, unknown>): string | null {
  const metadata = obj.metadata;
  if (!metadata || typeof metadata !== "object") return null;
  return asString((metadata as Record<string, unknown>).user_id);
}

/**
 * The entire event -> plan mapping, as one pure function per
 * task-23a's brief ("extract `planForEvent(event)` — TDD"):
 *  - `checkout.session.completed`: the session's own
 *    `client_reference_id` (set by checkout-session to the user id) is
 *    tried first, falling back to `metadata.user_id` if absent -> pro,
 *    with the session's `subscription` id.
 *  - `customer.subscription.updated`: `active`/`trialing` -> pro,
 *    anything else (`past_due`, `canceled`, `unpaid`, `incomplete`,
 *    `incomplete_expired`, `paused`) -> free.
 *  - `customer.subscription.deleted`: always -> free.
 *  - everything else: `{kind: "ignore"}` (handled as a 200, see
 *    `handleRequest`).
 * `userId`/`customerId` on the result are BOTH carried through so
 * `applyPlanDecision` can resolve the profile row by whichever one is
 * actually present (see its own docstring for why metadata can be
 * absent).
 */
export function planForEvent(event: StripeEventLike): PlanDecision {
  const obj = event.data.object;
  switch (event.type) {
    case "checkout.session.completed": {
      const userId = asString(obj.client_reference_id) ?? metadataUserId(obj);
      return {
        kind: "update",
        plan: "pro",
        subscriptionId: asString(obj.subscription),
        userId,
        customerId: asString(obj.customer),
      };
    }
    case "customer.subscription.updated": {
      const status = obj.status;
      const plan: "pro" | "free" = status === "active" || status === "trialing" ? "pro" : "free";
      return {
        kind: "update",
        plan,
        subscriptionId: asString(obj.id),
        userId: metadataUserId(obj),
        customerId: asString(obj.customer),
      };
    }
    case "customer.subscription.deleted": {
      return {
        kind: "update",
        plan: "free",
        subscriptionId: asString(obj.id),
        userId: metadataUserId(obj),
        customerId: asString(obj.customer),
      };
    }
    default:
      return { kind: "ignore" };
  }
}

// ---------------------------------------------------------------------------
// Applying the decision to `profiles` (service role; profiles has no
// user-facing write policy at all, see supabase/migrations/0001_init.sql)
// ---------------------------------------------------------------------------

export type ApplyResult = { ok: true; matchedBy: "user_id" | "customer_id" } | { ok: false; matchedBy: "none" };

/**
 * Writes `{plan, stripe_subscription_id}` to the profile matching
 * `decision.userId` first, falling back to `decision.customerId` when no
 * `userId` was on the event (task-23a's brief: "Resolve the user by
 * stripe_customer_id when metadata is absent") — this covers
 * `customer.subscription.updated`/`.deleted` events that arrive without
 * `metadata.user_id`, e.g. a subscription created outside this app's own
 * checkout-session flow (self-hosters testing the Stripe dashboard
 * directly). Neither resolving -> `{ok: false, matchedBy: "none"}`,
 * which `handleRequest` still answers with 200 (see its docstring: a
 * permanently-unresolvable event isn't something retrying will fix, and a
 * non-2xx here would just make Stripe retry forever).
 *
 * IDEMPOTENT by construction: both branches are single unconditional
 * `UPDATE ... SET plan = X, stripe_subscription_id = Y WHERE ...`
 * statements, not a read-modify-write increment (contrast with
 * `ai-organize`'s metering, which genuinely needs a row lock — see
 * `supabase/migrations/0004_ai_metering.sql`). Replaying the exact same
 * webhook event twice (Stripe's own at-least-once delivery guarantee)
 * always lands the same final `{plan, stripe_subscription_id}`, so no
 * event-id dedup ledger is needed here.
 */
export async function applyPlanDecision(
  serviceClient: SupabaseClient,
  decision: Extract<PlanDecision, { kind: "update" }>,
): Promise<ApplyResult> {
  const patch = { plan: decision.plan, stripe_subscription_id: decision.subscriptionId };

  if (decision.userId) {
    const { data, error } = await serviceClient
      .from("profiles")
      .update(patch)
      .eq("user_id", decision.userId)
      .select("user_id");
    if (!error && data && data.length > 0) return { ok: true, matchedBy: "user_id" };
  }

  if (decision.customerId) {
    const { data, error } = await serviceClient
      .from("profiles")
      .update(patch)
      .eq("stripe_customer_id", decision.customerId)
      .select("user_id");
    if (!error && data && data.length > 0) return { ok: true, matchedBy: "customer_id" };
  }

  return { ok: false, matchedBy: "none" };
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

  const decision = planForEvent(event);
  if (decision.kind === "ignore") {
    return jsonResponse({ ignored: true }, 200);
  }

  const serviceClient = createServiceRoleClient();
  const applied = await applyPlanDecision(serviceClient, decision);
  return jsonResponse(applied, 200);
}

// Only start the HTTP listener when this file is run directly (`supabase
// functions serve` / deployed), never when test.ts imports handleRequest
// and the pure helpers above for direct, in-process testing.
if (import.meta.main) {
  Deno.serve(handleRequest);
}

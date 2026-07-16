// T23a (+ review fix pass 1): stripe-webhook Edge Function tests.
//
// Run with (local stack must be running, `supabase start`):
//   deno test --allow-all supabase/functions/stripe-webhook/test.ts
//
// Fully self-contained: this file never calls the real Stripe API.
//  - Signature generation/verification
//    (`stripe.webhooks.generateTestHeaderStringAsync`/`constructEventAsync`)
//    is pure local HMAC crypto against whatever `STRIPE_WEBHOOK_SECRET`
//    this process has in `Deno.env` — this file uses generated
//    placeholder values instead of the root .env's real ones, per
//    task-23a's brief ("a generated test secret").
//  - The handler's LIVE `stripe.subscriptions.retrieve` call (the
//    source-of-truth re-fetch added in fix pass 1) is mocked by
//    intercepting `globalThis.fetch` for api.stripe.com only, the same
//    pattern ai-organize/test.ts uses for Anthropic. That's what makes
//    the out-of-order-delivery case (a stale "active" event arriving
//    AFTER the subscription was canceled) directly testable: the mock
//    returns the LIVE canceled state while the event payload lies.
//
// `planForStatus`/`referenceForEvent` are pure (fixture-based, no
// network); `applyPlanDecision` runs against the REAL local Postgres via
// a service-role client (same precedent as ai-organize/test.ts's
// metering tests — whether the SQL update actually lands, and whether a
// genuine Postgres ERROR is distinguished from "no row matched", is
// exactly what a mock can't tell us).

import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { createClient } from "npm:@supabase/supabase-js@2.110.5";
import { applyPlanDecision, handleRequest, planForStatus, referenceForEvent } from "./index.ts";
import { getStripeClient, Stripe } from "../_shared/stripe.ts";
import type { PlanUpdate } from "./index.ts";

// ---------------------------------------------------------------------------
// Root .env loading (duplicated per file, see ai-organize/test.ts)
// ---------------------------------------------------------------------------

function loadRootEnv(): Record<string, string> {
  const path = new URL("../../../.env", import.meta.url);
  let text: string;
  try {
    text = Deno.readTextFileSync(path);
  } catch {
    return {};
  }
  const values: Record<string, string> = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1);
    const commentIdx = value.indexOf(" #");
    if (commentIdx !== -1) value = value.slice(0, commentIdx);
    values[key] = value.trim();
  }
  return values;
}

const rootEnv = loadRootEnv();
const SUPABASE_URL = rootEnv.SUPABASE_URL || "http://127.0.0.1:54321";
const ANON_KEY = rootEnv.SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = rootEnv.SUPABASE_SERVICE_ROLE_KEY;

if (!ANON_KEY || !SERVICE_ROLE_KEY) {
  throw new Error(
    "SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY must be set in the root .env (see SELF_HOSTING.md); " +
      "these tests need the local stack running (`supabase start`).",
  );
}

// Deliberately NOT the root .env's real STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET
// — see the file docstring. `getStripeClient()` only needs a non-empty
// string to construct a client; every Stripe API call in this file is
// intercepted by the fetch mock below.
const TEST_STRIPE_SECRET_KEY = "sk_test_fake_for_webhook_signature_tests_only";
const TEST_WEBHOOK_SECRET = "whsec_test_fake_secret_for_deno_tests_only_1234567890";

Deno.env.set("SUPABASE_URL", SUPABASE_URL);
Deno.env.set("SUPABASE_ANON_KEY", ANON_KEY);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);
Deno.env.set("STRIPE_SECRET_KEY", TEST_STRIPE_SECRET_KEY);
Deno.env.set("STRIPE_WEBHOOK_SECRET", TEST_WEBHOOK_SECRET);

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stripe = getStripeClient()!;

// ---------------------------------------------------------------------------
// Stripe API fetch mocking (api.stripe.com only; Supabase Auth/PostgREST
// calls pass through to the real local stack — same split as
// ai-organize/test.ts's Anthropic mock)
// ---------------------------------------------------------------------------

const realFetch = globalThis.fetch;

type Responder = () => Response | Promise<Response>;

function mockStripeApi(responders: Responder[]): { callCount: () => number; restore: () => void } {
  let calls = 0;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://api.stripe.com/")) {
      const responder = responders[Math.min(calls, responders.length - 1)];
      calls++;
      return Promise.resolve(responder());
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;
  return {
    callCount: () => calls,
    restore: () => {
      globalThis.fetch = realFetch;
    },
  };
}

/** A live `GET /v1/subscriptions/:id` response body — the shape `stripe.subscriptions.retrieve` parses. */
function subscriptionResponse(
  id: string,
  status: string,
  customer: string,
  metadata: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ id, object: "subscription", status, customer, metadata }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function stripeErrorResponse(status = 500): Response {
  return new Response(JSON.stringify({ error: { type: "api_error", message: "boom" } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Admin REST helpers (service-role), mirrors ai-organize/test.ts
// ---------------------------------------------------------------------------

const PASSWORD = "t23a-webhook-test-password-1234";

function adminHeaders(): HeadersInit {
  return { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "content-type": "application/json" };
}

async function findUserByEmail(email: string): Promise<{ id: string } | null> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, { headers: adminHeaders() });
  if (!res.ok) throw new Error(`admin listUsers failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { users: Array<{ id: string; email: string | null }> };
  return body.users.find((u) => u.email === email) ?? null;
}

async function createUser(email: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  });
  if (!res.ok) throw new Error(`admin createUser failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { id: string };
  return body.id;
}

async function deleteUser(id: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: adminHeaders() });
  if (!res.ok && res.status !== 404) throw new Error(`admin deleteUser failed: ${res.status} ${await res.text()}`);
}

interface ProfileRow {
  plan: string;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
}

async function fetchProfile(userId: string): Promise<ProfileRow> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?select=plan,stripe_subscription_id,stripe_customer_id&user_id=eq.${userId}`,
    { headers: adminHeaders() },
  );
  if (!res.ok) throw new Error(`profiles select failed: ${res.status} ${await res.text()}`);
  const rows = (await res.json()) as ProfileRow[];
  return rows[0];
}

async function patchProfile(userId: string, patch: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${userId}`, {
    method: "PATCH",
    headers: { ...adminHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`profiles patch failed: ${res.status} ${await res.text()}`);
}

const createdEmails = new Set<string>();

async function setupTestUser(
  emailSlug: string,
  patch: Record<string, unknown> = { plan: "free", stripe_subscription_id: null, stripe_customer_id: null },
): Promise<{ id: string }> {
  const email = `t23a-webhook-${emailSlug}@tabburrow.test`;
  createdEmails.add(email);
  const existing = await findUserByEmail(email);
  const id = existing ? existing.id : await createUser(email);
  await patchProfile(id, patch);
  return { id };
}

// ---------------------------------------------------------------------------
// planForStatus: the pure decision core (fix pass 1's TDD requirement)
// ---------------------------------------------------------------------------

Deno.test("planForStatus: active -> pro", () => {
  assertEquals(planForStatus("active"), "pro");
});

Deno.test("planForStatus: trialing -> pro", () => {
  assertEquals(planForStatus("trialing"), "pro");
});

for (const status of ["past_due", "canceled", "unpaid", "incomplete", "incomplete_expired", "paused"]) {
  Deno.test(`planForStatus: ${status} -> free`, () => {
    assertEquals(planForStatus(status), "free");
  });
}

// ---------------------------------------------------------------------------
// referenceForEvent: pure, fixture-based. Events are TRIGGERS — they only
// say which subscription/customer/user to look at, never the plan itself
// (fix pass 1's source-of-truth redesign).
// ---------------------------------------------------------------------------

function event(type: string, object: Record<string, unknown>) {
  return { type, data: { object } };
}

Deno.test("referenceForEvent: checkout.session.completed with a subscription id -> subscription reference", () => {
  const ref = referenceForEvent(
    event("checkout.session.completed", { client_reference_id: "user-1", customer: "cus_1", subscription: "sub_1" }),
  );
  assertEquals(ref, { kind: "subscription", subscriptionId: "sub_1", userId: "user-1", customerId: "cus_1" });
});

Deno.test("referenceForEvent: checkout.session.completed falls back to metadata.user_id", () => {
  const ref = referenceForEvent(
    event("checkout.session.completed", {
      client_reference_id: null,
      customer: "cus_2",
      subscription: "sub_2",
      metadata: { user_id: "user-2" },
    }),
  );
  assertEquals(ref, { kind: "subscription", subscriptionId: "sub_2", userId: "user-2", customerId: "cus_2" });
});

Deno.test("referenceForEvent: checkout.session.completed WITHOUT a subscription id -> checkout_without_subscription", () => {
  const ref = referenceForEvent(
    event("checkout.session.completed", { client_reference_id: "user-3", customer: "cus_3", subscription: null }),
  );
  assertEquals(ref, { kind: "checkout_without_subscription", userId: "user-3", customerId: "cus_3" });
});

Deno.test("referenceForEvent: customer.subscription.updated -> subscription reference (plan NOT decided from the payload)", () => {
  const ref = referenceForEvent(
    event("customer.subscription.updated", { id: "sub_4", status: "active", customer: "cus_4", metadata: { user_id: "user-4" } }),
  );
  assertEquals(ref, { kind: "subscription", subscriptionId: "sub_4", userId: "user-4", customerId: "cus_4" });
});

Deno.test("referenceForEvent: customer.subscription.deleted -> subscription reference", () => {
  const ref = referenceForEvent(event("customer.subscription.deleted", { id: "sub_5", customer: "cus_5" }));
  assertEquals(ref, { kind: "subscription", subscriptionId: "sub_5", userId: null, customerId: "cus_5" });
});

Deno.test("referenceForEvent: subscription event with a missing id -> ignore", () => {
  assertEquals(referenceForEvent(event("customer.subscription.updated", { status: "active" })), { kind: "ignore" });
});

Deno.test("referenceForEvent: unknown event type -> ignore", () => {
  assertEquals(referenceForEvent(event("invoice.paid", {})), { kind: "ignore" });
  assertEquals(referenceForEvent(event("customer.created", {})), { kind: "ignore" });
});

// ---------------------------------------------------------------------------
// applyPlanDecision: real local Postgres — including the fix-pass-1
// distinction between "no row matched" (no_match -> 200) and a genuine
// Postgres ERROR (db_error -> 5xx so Stripe retries)
// ---------------------------------------------------------------------------

Deno.test("applyPlanDecision: resolves by userId when present", async () => {
  const { id } = await setupTestUser("apply-by-user");
  const update: PlanUpdate = { plan: "pro", subscriptionId: "sub_apply_1", userId: id, customerId: null };
  const result = await applyPlanDecision(admin, update);
  assertEquals(result, { ok: true, matchedBy: "user_id" });
  const profile = await fetchProfile(id);
  assertEquals(profile.plan, "pro");
  assertEquals(profile.stripe_subscription_id, "sub_apply_1");
});

Deno.test("applyPlanDecision: falls back to customerId when userId is absent", async () => {
  const { id } = await setupTestUser("apply-by-customer", {
    plan: "pro",
    stripe_subscription_id: "sub_old",
    stripe_customer_id: "cus_apply_2",
  });
  const update: PlanUpdate = { plan: "free", subscriptionId: "sub_apply_2", userId: null, customerId: "cus_apply_2" };
  const result = await applyPlanDecision(admin, update);
  assertEquals(result, { ok: true, matchedBy: "customer_id" });
  const profile = await fetchProfile(id);
  assertEquals(profile.plan, "free");
});

Deno.test("applyPlanDecision: neither userId nor customerId resolves -> no_match (NOT db_error)", async () => {
  const update: PlanUpdate = {
    plan: "pro",
    subscriptionId: "sub_nowhere",
    userId: "00000000-0000-0000-0000-000000000000",
    customerId: "cus_does_not_exist",
  };
  const result = await applyPlanDecision(admin, update);
  assertEquals(result, { ok: false, reason: "no_match" });
});

Deno.test("applyPlanDecision: a genuine Postgres ERROR -> db_error (NOT no_match)", async () => {
  // "not-a-uuid" makes the user_id equality filter fail with a real
  // Postgres type error ("invalid input syntax for type uuid") — the
  // class of DB failure fix pass 1 requires to be distinguished from "no
  // row matched", so the handler can 5xx and Stripe retries instead of
  // the event being silently dropped as a 200.
  const update: PlanUpdate = { plan: "free", subscriptionId: null, userId: "not-a-uuid", customerId: null };
  const result = await applyPlanDecision(admin, update);
  assertEquals(result, { ok: false, reason: "db_error" });
});

Deno.test("applyPlanDecision: idempotent, replaying the same update twice lands the same state", async () => {
  const { id } = await setupTestUser("apply-idempotent");
  const update: PlanUpdate = { plan: "pro", subscriptionId: "sub_apply_3", userId: id, customerId: null };
  await applyPlanDecision(admin, update);
  await applyPlanDecision(admin, update);
  const profile = await fetchProfile(id);
  assertEquals(profile.plan, "pro");
  assertEquals(profile.stripe_subscription_id, "sub_apply_3");
});

// ---------------------------------------------------------------------------
// handleRequest: signature verification (unchanged from the first pass)
// ---------------------------------------------------------------------------

// `generateTestHeaderStringAsync`, not the sync `generateTestHeaderString`:
// Deno's edge runtime only exposes the async Web Crypto API, and
// stripe-node's sync path throws ("SubtleCryptoProvider cannot be used in
// a synchronous context") the moment it needs to compute an HMAC here —
// the exact same async-only constraint that makes `handleRequest` itself
// use `constructEventAsync` instead of `constructEvent`.
async function signedRequest(payload: unknown, secret: string = TEST_WEBHOOK_SECRET): Promise<Request> {
  const payloadString = JSON.stringify(payload);
  const signature = await stripe.webhooks.generateTestHeaderStringAsync({ payload: payloadString, secret });
  return new Request("http://localhost/stripe-webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": signature },
    body: payloadString,
  });
}

Deno.test("handleRequest: GET is 405", async () => {
  const res = await handleRequest(new Request("http://localhost/stripe-webhook", { method: "GET" }));
  assertEquals(res.status, 405);
});

Deno.test("handleRequest: missing stripe-signature header -> 401", async () => {
  const res = await handleRequest(
    new Request("http://localhost/stripe-webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event("customer.created", {})),
    }),
  );
  assertEquals(res.status, 401);
});

Deno.test("handleRequest: bad signature (wrong secret) -> 401", async () => {
  const res = await handleRequest(await signedRequest(event("customer.created", {}), "whsec_totally_wrong_secret"));
  assertEquals(res.status, 401);
});

Deno.test("handleRequest: missing STRIPE_WEBHOOK_SECRET env -> 401", async () => {
  const saved = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  Deno.env.delete("STRIPE_WEBHOOK_SECRET");
  try {
    const res = await handleRequest(await signedRequest(event("customer.created", {})));
    assertEquals(res.status, 401);
  } finally {
    if (saved) Deno.env.set("STRIPE_WEBHOOK_SECRET", saved);
  }
});

// ---------------------------------------------------------------------------
// handleRequest: live-state decisions (fix pass 1 — the LIVE subscription
// retrieve, mocked at the fetch layer, is the source of truth; the event
// payload's own status is never trusted)
// ---------------------------------------------------------------------------

Deno.test("handleRequest: valid signature, unknown event type -> 200 ignored, zero Stripe calls", async () => {
  const mock = mockStripeApi([() => stripeErrorResponse(500)]);
  try {
    const res = await handleRequest(await signedRequest(event("customer.created", { id: "cus_unused" })));
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { ignored: true });
    assertEquals(mock.callCount(), 0);
  } finally {
    mock.restore();
  }
});

Deno.test("handleRequest: checkout.session.completed WITHOUT a subscription id -> pro from the event, zero Stripe calls", async () => {
  // Payment-mode sessions (the Stripe CLI's default trigger fixture is
  // one) carry no subscription to consult — this is the one disclosed
  // trust-the-event path; see the module docstring in index.ts.
  const { id } = await setupTestUser("handle-checkout-nosub");
  const mock = mockStripeApi([() => stripeErrorResponse(500)]);
  try {
    const payload = event("checkout.session.completed", {
      client_reference_id: id,
      customer: "cus_handle_nosub",
      subscription: null,
    });
    const res = await handleRequest(await signedRequest(payload));
    assertEquals(res.status, 200, `expected 200, got ${res.status}: ${await res.clone().text()}`);
    assertEquals(mock.callCount(), 0);
    const profile = await fetchProfile(id);
    assertEquals(profile.plan, "pro");
  } finally {
    mock.restore();
  }
});

Deno.test("handleRequest: checkout.session.completed WITH a subscription id retrieves live state -> pro", async () => {
  const { id } = await setupTestUser("handle-checkout-live");
  const mock = mockStripeApi([() => subscriptionResponse("sub_handle_1", "active", "cus_handle_1")]);
  try {
    const payload = event("checkout.session.completed", {
      client_reference_id: id,
      customer: "cus_handle_1",
      subscription: "sub_handle_1",
    });
    const res = await handleRequest(await signedRequest(payload));
    assertEquals(res.status, 200, `expected 200, got ${res.status}: ${await res.clone().text()}`);
    assertEquals(await res.json(), { ok: true, matchedBy: "user_id" });
    assertEquals(mock.callCount(), 1, "expected exactly one live subscription retrieve");
    const profile = await fetchProfile(id);
    assertEquals(profile.plan, "pro");
    assertEquals(profile.stripe_subscription_id, "sub_handle_1");
  } finally {
    mock.restore();
  }
});

Deno.test("handleRequest: customer.subscription.deleted -> live state canceled -> free, stripe_subscription_id CLEARED", async () => {
  const { id } = await setupTestUser("handle-deleted", {
    plan: "pro",
    stripe_subscription_id: "sub_handle_2",
    stripe_customer_id: "cus_handle_2",
  });
  const mock = mockStripeApi([() => subscriptionResponse("sub_handle_2", "canceled", "cus_handle_2")]);
  try {
    const payload = event("customer.subscription.deleted", { id: "sub_handle_2", customer: "cus_handle_2" });
    const res = await handleRequest(await signedRequest(payload));
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { ok: true, matchedBy: "customer_id" });
    const profile = await fetchProfile(id);
    assertEquals(profile.plan, "free");
    assertEquals(profile.stripe_subscription_id, null, "a canceled subscription must not remain as a live pointer");
  } finally {
    mock.restore();
  }
});

Deno.test("handleRequest: OUT-OF-ORDER delivery — a stale 'active' payload after deletion stays free (live state wins)", async () => {
  // THE fix-pass-1 regression case: Stripe does not guarantee delivery
  // order, so a customer.subscription.updated whose PAYLOAD says
  // status=active can arrive after customer.subscription.deleted. The
  // payload must not be trusted: the live retrieve (mocked here to the
  // canceled state the subscription is really in) decides.
  const { id } = await setupTestUser("handle-stale-order", {
    plan: "pro",
    stripe_subscription_id: "sub_stale_1",
    stripe_customer_id: "cus_stale_1",
  });
  const mock = mockStripeApi([
    // Both deliveries retrieve the same live truth: canceled.
    () => subscriptionResponse("sub_stale_1", "canceled", "cus_stale_1", { user_id: id }),
  ]);
  try {
    // 1) The deletion event lands: pro -> free.
    const deleted = await handleRequest(
      await signedRequest(event("customer.subscription.deleted", { id: "sub_stale_1", customer: "cus_stale_1" })),
    );
    assertEquals(deleted.status, 200);
    assertEquals((await fetchProfile(id)).plan, "free");

    // 2) A STALE update (payload claims active) arrives late.
    const stale = await handleRequest(
      await signedRequest(
        event("customer.subscription.updated", {
          id: "sub_stale_1",
          status: "active", // the lie a stale payload tells
          customer: "cus_stale_1",
          metadata: { user_id: id },
        }),
      ),
    );
    assertEquals(stale.status, 200);
    const profile = await fetchProfile(id);
    assertEquals(profile.plan, "free", "a stale 'active' payload must NOT resurrect PRO — live state is canceled");
    assertEquals(profile.stripe_subscription_id, null);
    assertEquals(mock.callCount(), 2, "each delivery must consult live state once");
  } finally {
    mock.restore();
  }
});

Deno.test("handleRequest: live subscription retrieve fails -> 502 so Stripe retries, nothing written", async () => {
  const { id } = await setupTestUser("handle-retrieve-fail", {
    plan: "pro",
    stripe_subscription_id: "sub_fail_1",
    stripe_customer_id: "cus_fail_1",
  });
  const mock = mockStripeApi([() => stripeErrorResponse(500)]);
  try {
    const res = await handleRequest(
      await signedRequest(event("customer.subscription.deleted", { id: "sub_fail_1", customer: "cus_fail_1" })),
    );
    assertEquals(res.status, 502, "live state unavailable must be retryable, never a silent 200");
    // Entitlement must not change on an unverifiable event.
    const profile = await fetchProfile(id);
    assertEquals(profile.plan, "pro");
  } finally {
    mock.restore();
  }
});

Deno.test("handleRequest: DB error while applying -> 502 so Stripe retries (fix pass 1)", async () => {
  // metadata.user_id is a non-uuid string: the profiles UPDATE errors at
  // the Postgres level (uuid parse), which previously fell through
  // identically to "no row matched" -> 200 and Stripe never retried.
  const mock = mockStripeApi([
    () => subscriptionResponse("sub_dberr_1", "canceled", "cus_that_matches_nobody", { user_id: "not-a-uuid" }),
  ]);
  try {
    const res = await handleRequest(
      await signedRequest(
        event("customer.subscription.deleted", {
          id: "sub_dberr_1",
          customer: "cus_that_matches_nobody",
          metadata: { user_id: "not-a-uuid" },
        }),
      ),
    );
    assertEquals(res.status, 502, "a Postgres error must surface as retryable, not swallowed as 200");
  } finally {
    mock.restore();
  }
});

Deno.test("handleRequest: genuinely unmatchable event -> 200 no_match (terminal, no retry storm)", async () => {
  const mock = mockStripeApi([() => subscriptionResponse("sub_nomatch_1", "active", "cus_that_matches_nobody")]);
  try {
    const res = await handleRequest(
      await signedRequest(
        event("customer.subscription.updated", {
          id: "sub_nomatch_1",
          status: "active",
          customer: "cus_that_matches_nobody",
          metadata: { user_id: "00000000-0000-0000-0000-000000000000" },
        }),
      ),
    );
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { ok: false, reason: "no_match" });
  } finally {
    mock.restore();
  }
});

Deno.test("handleRequest: replaying the same event twice is idempotent", async () => {
  const { id } = await setupTestUser("handle-replay");
  const mock = mockStripeApi([() => subscriptionResponse("sub_handle_3", "active", "cus_handle_3")]);
  try {
    const payload = event("checkout.session.completed", {
      client_reference_id: id,
      customer: "cus_handle_3",
      subscription: "sub_handle_3",
    });
    const first = await handleRequest(await signedRequest(payload));
    const second = await handleRequest(await signedRequest(payload));
    assertEquals(first.status, 200);
    assertEquals(second.status, 200);
    const profile = await fetchProfile(id);
    assertEquals(profile.plan, "pro");
    assertEquals(profile.stripe_subscription_id, "sub_handle_3");
  } finally {
    mock.restore();
  }
});

// Sanity check that TEST_STRIPE_SECRET_KEY/TEST_WEBHOOK_SECRET really are
// fake, not accidentally the root .env's real ones — if this ever fails,
// every "isolated from the real Stripe account" claim in this file's
// docstring would be false.
Deno.test("sanity: this file's Stripe credentials are fake placeholders, not the real root .env values", () => {
  const real = loadRootEnv();
  assert(TEST_STRIPE_SECRET_KEY !== real.STRIPE_SECRET_KEY);
  assert(TEST_WEBHOOK_SECRET !== real.STRIPE_WEBHOOK_SECRET);
  assertMatch(Stripe.name, /^Stripe$/); // trivially confirms the default export is the Stripe class itself
});

// ---------------------------------------------------------------------------
// Cleanup: runs last (Deno.test runs sequentially in file order by default)
// ---------------------------------------------------------------------------

Deno.test("cleanup: remove test users created by this file", async () => {
  for (const email of createdEmails) {
    const user = await findUserByEmail(email);
    if (user) await deleteUser(user.id);
  }
});

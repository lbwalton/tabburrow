// T23a: stripe-webhook Edge Function tests.
//
// Run with (local stack must be running, `supabase start`):
//   deno test --allow-all supabase/functions/stripe-webhook/test.ts
//
// Fully self-contained: unlike checkout-session/test.ts, this file never
// calls the real Stripe API. Signature generation/verification
// (`stripe.webhooks.generateTestHeaderStringAsync`/`constructEventAsync`) is
// pure local HMAC crypto against whatever `STRIPE_WEBHOOK_SECRET` this
// process has in `Deno.env` — it doesn't matter whether that secret (or
// the `STRIPE_SECRET_KEY` used only to construct the client) is real, so
// this file uses generated placeholder values instead of the root .env's
// real ones. That keeps the suite from depending on (or interfering
// with) a live `stripe listen` session, per task-23a's brief: "unit-test
// ... the signature-failure path ... with a generated test secret."
//
// `planForEvent`/`applyPlanDecision` are tested directly too (TDD per the
// brief): the former with hand-built fixture events (pure, no network),
// the latter against the REAL local Postgres via a service-role client
// (same precedent as ai-organize/test.ts's metering tests — the point is
// whether the SQL update actually lands, which a mock can't tell us).

import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { createClient } from "npm:@supabase/supabase-js@2.110.5";
import { applyPlanDecision, handleRequest, planForEvent } from "./index.ts";
import { getStripeClient, Stripe } from "../_shared/stripe.ts";
import type { PlanDecision } from "./index.ts";

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
// string to construct a client; nothing in this file makes a real API call.
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
// planForEvent: pure, fixture-based
// ---------------------------------------------------------------------------

function event(type: string, object: Record<string, unknown>) {
  return { type, data: { object } };
}

Deno.test("planForEvent: checkout.session.completed resolves userId from client_reference_id -> pro", () => {
  const decision = planForEvent(
    event("checkout.session.completed", { client_reference_id: "user-1", customer: "cus_1", subscription: "sub_1" }),
  );
  assertEquals(decision, { kind: "update", plan: "pro", subscriptionId: "sub_1", userId: "user-1", customerId: "cus_1" });
});

Deno.test("planForEvent: checkout.session.completed falls back to metadata.user_id when client_reference_id is absent", () => {
  const decision = planForEvent(
    event("checkout.session.completed", {
      client_reference_id: null,
      customer: "cus_2",
      subscription: "sub_2",
      metadata: { user_id: "user-2" },
    }),
  );
  assertEquals(decision, { kind: "update", plan: "pro", subscriptionId: "sub_2", userId: "user-2", customerId: "cus_2" });
});

Deno.test("planForEvent: customer.subscription.updated status active -> pro", () => {
  const decision = planForEvent(
    event("customer.subscription.updated", { id: "sub_3", status: "active", customer: "cus_3", metadata: { user_id: "user-3" } }),
  );
  assertEquals(decision, { kind: "update", plan: "pro", subscriptionId: "sub_3", userId: "user-3", customerId: "cus_3" });
});

Deno.test("planForEvent: customer.subscription.updated status trialing -> pro", () => {
  const decision = planForEvent(event("customer.subscription.updated", { id: "sub_4", status: "trialing", customer: "cus_4" }));
  assertEquals(decision, { kind: "update", plan: "pro", subscriptionId: "sub_4", userId: null, customerId: "cus_4" });
});

for (const status of ["past_due", "canceled", "unpaid", "incomplete", "incomplete_expired", "paused"]) {
  Deno.test(`planForEvent: customer.subscription.updated status ${status} -> free`, () => {
    const decision = planForEvent(event("customer.subscription.updated", { id: "sub_x", status, customer: "cus_x" }));
    assertEquals(decision, { kind: "update", plan: "free", subscriptionId: "sub_x", userId: null, customerId: "cus_x" });
  });
}

Deno.test("planForEvent: customer.subscription.deleted -> always free", () => {
  const decision = planForEvent(
    event("customer.subscription.deleted", { id: "sub_5", status: "canceled", customer: "cus_5", metadata: { user_id: "user-5" } }),
  );
  assertEquals(decision, { kind: "update", plan: "free", subscriptionId: "sub_5", userId: "user-5", customerId: "cus_5" });
});

Deno.test("planForEvent: unknown event type -> ignore", () => {
  assertEquals(planForEvent(event("invoice.paid", {})), { kind: "ignore" });
  assertEquals(planForEvent(event("customer.created", {})), { kind: "ignore" });
});

// ---------------------------------------------------------------------------
// applyPlanDecision: real local Postgres
// ---------------------------------------------------------------------------

Deno.test("applyPlanDecision: resolves by userId when present", async () => {
  const { id } = await setupTestUser("apply-by-user");
  const decision: Extract<PlanDecision, { kind: "update" }> = {
    kind: "update",
    plan: "pro",
    subscriptionId: "sub_apply_1",
    userId: id,
    customerId: null,
  };
  const result = await applyPlanDecision(admin, decision);
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
  const decision: Extract<PlanDecision, { kind: "update" }> = {
    kind: "update",
    plan: "free",
    subscriptionId: "sub_apply_2",
    userId: null,
    customerId: "cus_apply_2",
  };
  const result = await applyPlanDecision(admin, decision);
  assertEquals(result, { ok: true, matchedBy: "customer_id" });
  const profile = await fetchProfile(id);
  assertEquals(profile.plan, "free");
});

Deno.test("applyPlanDecision: neither userId nor customerId resolves -> matchedBy none, nothing written", async () => {
  const decision: Extract<PlanDecision, { kind: "update" }> = {
    kind: "update",
    plan: "pro",
    subscriptionId: "sub_nowhere",
    userId: "00000000-0000-0000-0000-000000000000",
    customerId: "cus_does_not_exist",
  };
  const result = await applyPlanDecision(admin, decision);
  assertEquals(result, { ok: false, matchedBy: "none" });
});

Deno.test("applyPlanDecision: idempotent, replaying the same decision twice lands the same state", async () => {
  const { id } = await setupTestUser("apply-idempotent");
  const decision: Extract<PlanDecision, { kind: "update" }> = {
    kind: "update",
    plan: "pro",
    subscriptionId: "sub_apply_3",
    userId: id,
    customerId: null,
  };
  await applyPlanDecision(admin, decision);
  await applyPlanDecision(admin, decision);
  const profile = await fetchProfile(id);
  assertEquals(profile.plan, "pro");
  assertEquals(profile.stripe_subscription_id, "sub_apply_3");
});

// ---------------------------------------------------------------------------
// handleRequest: signature verification
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

Deno.test("handleRequest: valid signature, unknown event type -> 200 ignored", async () => {
  const res = await handleRequest(await signedRequest(event("customer.created", { id: "cus_unused" })));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ignored: true });
});

Deno.test("handleRequest: valid signature, checkout.session.completed flips profile to pro", async () => {
  const { id } = await setupTestUser("handle-checkout");
  const payload = event("checkout.session.completed", {
    client_reference_id: id,
    customer: "cus_handle_1",
    subscription: "sub_handle_1",
  });
  const res = await handleRequest(await signedRequest(payload));
  assertEquals(res.status, 200, `expected 200, got ${res.status}: ${await res.clone().text()}`);
  assertEquals(await res.json(), { ok: true, matchedBy: "user_id" });

  const profile = await fetchProfile(id);
  assertEquals(profile.plan, "pro");
  assertEquals(profile.stripe_subscription_id, "sub_handle_1");
});

Deno.test("handleRequest: valid signature, customer.subscription.deleted flips profile to free", async () => {
  const { id } = await setupTestUser("handle-deleted", {
    plan: "pro",
    stripe_subscription_id: "sub_handle_2",
    stripe_customer_id: "cus_handle_2",
  });
  const payload = event("customer.subscription.deleted", { id: "sub_handle_2", customer: "cus_handle_2" });
  const res = await handleRequest(await signedRequest(payload));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, matchedBy: "customer_id" });

  const profile = await fetchProfile(id);
  assertEquals(profile.plan, "free");
});

Deno.test("handleRequest: replaying the same checkout.session.completed event twice is idempotent", async () => {
  const { id } = await setupTestUser("handle-replay");
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

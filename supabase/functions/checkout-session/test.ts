// T23a: checkout-session Edge Function tests.
//
// Run with (local stack must be running, `supabase start`):
//   deno test --allow-all supabase/functions/checkout-session/test.ts
//
// Unlike ai-organize/test.ts, which always mocks Anthropic (a paid,
// nondeterministic vendor), this file calls the REAL Stripe TEST-MODE API
// for its Stripe-touching tests: Stripe test mode is free and
// deterministic enough for this purpose (creating a customer/checkout
// session/portal session are simple, side-effect-free-to-us API calls),
// and mocking stripe-node's internal request shape would mean re-modeling
// Stripe's own API instead of testing this function's logic against it.
// This mirrors the project's existing precedent of hitting the REAL local
// Postgres for ai-organize's metering tests rather than mocking it.
//
// Auth/body-validation paths that never reach Stripe or profiles at all
// (401/405/400) need neither a real Stripe call nor real users.

import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { createClient } from "npm:@supabase/supabase-js@2.110.5";
import {
  findOrCreateCustomerId,
  handleRequest,
  parseRequestBody,
  priceIdForInterval,
  siteUrl,
} from "./index.ts";
import { getStripeClient } from "../_shared/stripe.ts";

// ---------------------------------------------------------------------------
// Root .env loading (duplicated from ai-organize/test.ts's loadRootEnv —
// see that file's docstring for why this ~15-line parser is copy-pasted
// per Deno test file rather than shared).
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
const STRIPE_SECRET_KEY = rootEnv.STRIPE_SECRET_KEY;
const STRIPE_PRICE_MONTHLY = rootEnv.STRIPE_PRICE_MONTHLY;
const STRIPE_PRICE_YEARLY = rootEnv.STRIPE_PRICE_YEARLY;

if (!ANON_KEY || !SERVICE_ROLE_KEY) {
  throw new Error(
    "SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY must be set in the root .env (see SELF_HOSTING.md); " +
      "these tests need the local stack running (`supabase start`).",
  );
}
if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_MONTHLY || !STRIPE_PRICE_YEARLY) {
  throw new Error(
    "STRIPE_SECRET_KEY/STRIPE_PRICE_MONTHLY/STRIPE_PRICE_YEARLY must be set in the root .env " +
      "(see .superpowers/sdd/task-23a-report.md for how this project's test-mode product/prices were created).",
  );
}

Deno.env.set("SUPABASE_URL", SUPABASE_URL);
Deno.env.set("SUPABASE_ANON_KEY", ANON_KEY);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);
Deno.env.set("STRIPE_SECRET_KEY", STRIPE_SECRET_KEY);
Deno.env.set("STRIPE_PRICE_MONTHLY", STRIPE_PRICE_MONTHLY);
Deno.env.set("STRIPE_PRICE_YEARLY", STRIPE_PRICE_YEARLY);
Deno.env.set("SITE_URL", "http://localhost:3000/"); // trailing slash on purpose, exercises siteUrl()'s strip

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stripe = getStripeClient()!;

// ---------------------------------------------------------------------------
// Admin REST helpers (service-role), mirrors ai-organize/test.ts
// ---------------------------------------------------------------------------

const PASSWORD = "t23a-test-password-1234";

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

async function signIn(email: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY!, "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`password sign-in failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

interface ProfileRow {
  stripe_customer_id: string | null;
}

async function fetchProfile(userId: string): Promise<ProfileRow> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=stripe_customer_id&user_id=eq.${userId}`, {
    headers: adminHeaders(),
  });
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
const createdStripeCustomerIds = new Set<string>();

async function setupTestUser(emailSlug: string): Promise<{ id: string; token: string; email: string }> {
  const email = `t23a-${emailSlug}@tabburrow.test`;
  createdEmails.add(email);
  const existing = await findUserByEmail(email);
  const id = existing ? existing.id : await createUser(email);
  await patchProfile(id, { stripe_customer_id: null });
  const token = await signIn(email);
  return { id, token, email };
}

function postRequest(token: string | null, body: unknown): Request {
  const headers: HeadersInit = { "content-type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request("http://localhost/checkout-session", { method: "POST", headers, body: JSON.stringify(body) });
}

// ---------------------------------------------------------------------------
// Pure-function tests
// ---------------------------------------------------------------------------

Deno.test("parseRequestBody: accepts {interval: 'month'} and {interval: 'year'}", () => {
  assertEquals(parseRequestBody({ interval: "month" }), { ok: true, body: { kind: "checkout", interval: "month" } });
  assertEquals(parseRequestBody({ interval: "year" }), { ok: true, body: { kind: "checkout", interval: "year" } });
});

Deno.test("parseRequestBody: accepts {portal: true}, takes precedence over interval", () => {
  assertEquals(parseRequestBody({ portal: true }), { ok: true, body: { kind: "portal" } });
  assertEquals(parseRequestBody({ portal: true, interval: "month" }), { ok: true, body: { kind: "portal" } });
});

Deno.test("parseRequestBody: rejects an invalid interval", () => {
  assertEquals(parseRequestBody({ interval: "day" }), { ok: false, reason: "invalid_body" });
  assertEquals(parseRequestBody({ interval: "MONTH" }), { ok: false, reason: "invalid_body" });
});

Deno.test("parseRequestBody: rejects malformed top-level bodies", () => {
  assertEquals(parseRequestBody(null), { ok: false, reason: "invalid_body" });
  assertEquals(parseRequestBody([1, 2]), { ok: false, reason: "invalid_body" });
  assertEquals(parseRequestBody({}), { ok: false, reason: "invalid_body" });
  assertEquals(parseRequestBody({ portal: "true" }), { ok: false, reason: "invalid_body" });
});

Deno.test("priceIdForInterval: reads STRIPE_PRICE_MONTHLY/STRIPE_PRICE_YEARLY", () => {
  assertEquals(priceIdForInterval("month"), STRIPE_PRICE_MONTHLY);
  assertEquals(priceIdForInterval("year"), STRIPE_PRICE_YEARLY);
});

Deno.test("priceIdForInterval: null when the env var is unset", () => {
  const saved = Deno.env.get("STRIPE_PRICE_MONTHLY");
  Deno.env.delete("STRIPE_PRICE_MONTHLY");
  try {
    assertEquals(priceIdForInterval("month"), null);
  } finally {
    if (saved) Deno.env.set("STRIPE_PRICE_MONTHLY", saved);
  }
});

Deno.test("siteUrl: strips a trailing slash, null when unset", () => {
  assertEquals(siteUrl(), "http://localhost:3000");
  const saved = Deno.env.get("SITE_URL");
  Deno.env.delete("SITE_URL");
  try {
    assertEquals(siteUrl(), null);
  } finally {
    if (saved) Deno.env.set("SITE_URL", saved);
  }
});

// ---------------------------------------------------------------------------
// findOrCreateCustomerId: real Stripe test-mode API + real local Postgres
// ---------------------------------------------------------------------------

Deno.test("findOrCreateCustomerId: creates a Stripe customer and claims it on the profile", async () => {
  const { id, email } = await setupTestUser("customer-create");
  const result = await findOrCreateCustomerId(admin, stripe, { id, email });
  assert(result.ok, `expected ok, got ${JSON.stringify(result)}`);
  if (result.ok) {
    assertMatch(result.customerId, /^cus_/);
    createdStripeCustomerIds.add(result.customerId);
    const profile = await fetchProfile(id);
    assertEquals(profile.stripe_customer_id, result.customerId);
  }
});

Deno.test("findOrCreateCustomerId: reuses the existing customer id on a second call, no new Stripe customer", async () => {
  const { id, email } = await setupTestUser("customer-reuse");
  const first = await findOrCreateCustomerId(admin, stripe, { id, email });
  assert(first.ok);
  if (!first.ok) return;
  createdStripeCustomerIds.add(first.customerId);

  const second = await findOrCreateCustomerId(admin, stripe, { id, email });
  assert(second.ok);
  if (second.ok) assertEquals(second.customerId, first.customerId);
});

Deno.test("findOrCreateCustomerId: concurrent calls for the same user converge on one customer id", async () => {
  const { id, email } = await setupTestUser("customer-race");
  const [a, b] = await Promise.all([
    findOrCreateCustomerId(admin, stripe, { id, email }),
    findOrCreateCustomerId(admin, stripe, { id, email }),
  ]);
  assert(a.ok && b.ok, `expected both calls to succeed, got ${JSON.stringify(a)} / ${JSON.stringify(b)}`);
  if (a.ok) createdStripeCustomerIds.add(a.customerId);
  if (b.ok) createdStripeCustomerIds.add(b.customerId);
  if (a.ok && b.ok) {
    assertEquals(a.customerId, b.customerId, "both concurrent callers must agree on the same winning customer id");
    const profile = await fetchProfile(id);
    assertEquals(profile.stripe_customer_id, a.customerId);
  }
});

// ---------------------------------------------------------------------------
// handleRequest: auth + body validation (no Stripe/DB reached)
// ---------------------------------------------------------------------------

Deno.test("handleRequest: missing Authorization -> 401", async () => {
  const res = await handleRequest(postRequest(null, { interval: "month" }));
  assertEquals(res.status, 401);
});

Deno.test("handleRequest: bogus Authorization token -> 401", async () => {
  const res = await handleRequest(postRequest("not-a-real-jwt", { interval: "month" }));
  assertEquals(res.status, 401);
});

Deno.test("handleRequest: GET is 405", async () => {
  const res = await handleRequest(new Request("http://localhost/checkout-session", { method: "GET" }));
  assertEquals(res.status, 405);
});

Deno.test("handleRequest: OPTIONS preflight is 204", async () => {
  const res = await handleRequest(new Request("http://localhost/checkout-session", { method: "OPTIONS" }));
  assertEquals(res.status, 204);
});

Deno.test("handleRequest: valid auth but invalid body -> 400", async () => {
  const { token } = await setupTestUser("body-invalid");
  const res = await handleRequest(postRequest(token, { interval: "fortnight" }));
  assertEquals(res.status, 400);
});

// ---------------------------------------------------------------------------
// handleRequest: happy paths (real Stripe test-mode API + real local DB)
// ---------------------------------------------------------------------------

Deno.test("handleRequest: checkout for a new user returns a Checkout URL and claims a Stripe customer", async () => {
  const { id, token } = await setupTestUser("checkout-happy");
  const res = await handleRequest(postRequest(token, { interval: "month" }));
  assertEquals(res.status, 200, `expected 200, got ${res.status}: ${await res.clone().text()}`);
  const body = (await res.json()) as { url: string };
  assertMatch(body.url, /^https:\/\/checkout\.stripe\.com\//);

  const profile = await fetchProfile(id);
  assert(profile.stripe_customer_id, "expected a Stripe customer id to be claimed on the profile");
  createdStripeCustomerIds.add(profile.stripe_customer_id!);
});

Deno.test("handleRequest: portal session for an existing customer returns a billing portal URL", async () => {
  const { id, email, token } = await setupTestUser("portal-happy");
  // Pre-create the customer directly (bypassing checkout) so this test
  // exercises the "already has a customer id" branch of
  // findOrCreateCustomerId, not the create-and-claim branch (already
  // covered above).
  const customer = await stripe.customers.create({ email, metadata: { user_id: id } });
  createdStripeCustomerIds.add(customer.id);
  await patchProfile(id, { stripe_customer_id: customer.id });

  const res = await handleRequest(postRequest(token, { portal: true }));
  assertEquals(res.status, 200, `expected 200, got ${res.status}: ${await res.clone().text()}`);
  const body = (await res.json()) as { url: string };
  assertMatch(body.url, /^https:\/\/billing\.stripe\.com\//);
});

// ---------------------------------------------------------------------------
// Cleanup: runs last (Deno.test runs sequentially in file order by
// default) — removes every Supabase test user and Stripe test customer
// this file created, so re-running it never accumulates stray rows/objects.
// ---------------------------------------------------------------------------

Deno.test("cleanup: remove test users and Stripe customers created by this file", async () => {
  for (const email of createdEmails) {
    const user = await findUserByEmail(email);
    if (user) await deleteUser(user.id);
  }
  for (const customerId of createdStripeCustomerIds) {
    try {
      await stripe.customers.del(customerId);
    } catch {
      // Best-effort: a customer already deleted by a previous run, or one
      // Stripe itself doesn't allow deleting (e.g. still has an active
      // subscription in a partial-failure scenario), isn't worth failing
      // the suite over.
    }
  }
});

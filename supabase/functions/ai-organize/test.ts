// T19: ai-organize Edge Function tests.
//
// Run with (local stack must be running, `supabase start`):
//   deno test --allow-all supabase/functions/ai-organize/test.ts
//
// Two different test doubles are used, deliberately:
//  - Anthropic is ALWAYS mocked (globalThis.fetch is intercepted for
//    api.anthropic.com only, every other URL passes through to the real
//    fetch); these tests must never spend real API credits or depend on
//    live model behavior.
//  - Metering (consume_ai_use/refund_ai_use, month rollover, the
//    service_role-only grant) runs against the REAL local Postgres via a
//    service-role client, because the point of T19's design is that
//    race-safety lives in SQL (see supabase/migrations/0004_ai_metering.sql):
//    a mocked RPC couldn't tell us whether the `for update` locking or
//    the rollover date math is actually correct.
//
// Test users are created directly against the local GoTrue admin API
// (password sign-in, no email round-trip needed), the same REST endpoints
// apps/extension/e2e/admin.ts uses for Playwright, reimplemented here in
// plain fetch because that file is a Node/Playwright module and can't be
// imported into a Deno test.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { createClient } from "npm:@supabase/supabase-js@2.110.5";
import { handleRequest, organizeWithRetry, parseRequestBody, validateAndNormalize } from "./index.ts";

// ---------------------------------------------------------------------------
// Root .env loading (duplicated from apps/extension/e2e/env.ts's
// loadRootEnv rather than imported: that's a Node/Playwright module,
// this is Deno; same precedent that file's own docstring sets for
// duplicating this ~15-line parser across runtimes).
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

// handleRequest reads these via Deno.env at call time. ANTHROPIC_API_KEY is
// a placeholder: fetch is mocked in every test below, so it's never sent
// to the real API.
Deno.env.set("SUPABASE_URL", SUPABASE_URL);
Deno.env.set("SUPABASE_ANON_KEY", ANON_KEY);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);
Deno.env.set("ANTHROPIC_API_KEY", "test-key-not-real");

// ---------------------------------------------------------------------------
// Admin REST helpers (service-role), mirrors apps/extension/e2e/admin.ts
// ---------------------------------------------------------------------------

const PASSWORD = "t19-test-password-1234";

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
  plan: string;
  ai_uses_count: number;
  ai_uses_period_start: string;
}

async function fetchProfile(userId: string): Promise<ProfileRow> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?select=plan,ai_uses_count,ai_uses_period_start&user_id=eq.${userId}`,
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

function currentMonthStart(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function lastMonthStart(): string {
  const now = new Date();
  const y = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const m = now.getUTCMonth() === 0 ? 12 : now.getUTCMonth();
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

const createdEmails = new Set<string>();

/** Idempotent find-or-create + reset to a known free/zero-usage state, so re-running this file never accumulates stray users or leftover counts. */
async function setupTestUser(
  emailSlug: string,
  patch: Record<string, unknown> = { plan: "free", ai_uses_count: 0, ai_uses_period_start: currentMonthStart() },
): Promise<{ id: string; token: string }> {
  const email = `t19-${emailSlug}@tabburrow.test`;
  createdEmails.add(email);
  const existing = await findUserByEmail(email);
  const id = existing ? existing.id : await createUser(email);
  await patchProfile(id, patch);
  const token = await signIn(email);
  return { id, token };
}

// ---------------------------------------------------------------------------
// Anthropic fetch mocking
// ---------------------------------------------------------------------------

const realFetch = globalThis.fetch;

type Responder = () => Response | Promise<Response>;

/** Intercepts only api.anthropic.com calls; everything else (Supabase Auth/PostgREST) goes to the real network. */
function mockAnthropic(responders: Responder[]): { callCount: () => number; restore: () => void } {
  let calls = 0;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://api.anthropic.com/")) {
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

function anthropicToolResponse(input: unknown, id = "toolu_1"): Response {
  return new Response(
    JSON.stringify({
      id: "msg_1",
      type: "message",
      role: "assistant",
      content: [{ type: "tool_use", id, name: "organize_links", input }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function anthropicErrorResponse(status = 500): Response {
  return new Response(JSON.stringify({ type: "error", error: { message: "boom" } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function links(n: number): Array<{ id: string; title: string; url: string }> {
  return Array.from({ length: n }, (_, i) => ({
    id: `link-${i}`,
    title: `Title ${i}`,
    url: `https://example.com/${i}`,
  }));
}

function postRequest(token: string, body: unknown): Request {
  return new Request("http://localhost/ai-organize", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Pure-function tests
// ---------------------------------------------------------------------------

Deno.test("parseRequestBody: rejects >100 links", () => {
  const result = parseRequestBody({ links: links(101) });
  assertEquals(result, { ok: false, reason: "too_many_links" });
});

Deno.test("parseRequestBody: rejects empty links array", () => {
  assertEquals(parseRequestBody({ links: [] }), { ok: false, reason: "invalid_body" });
});

Deno.test("parseRequestBody: rejects a link missing url", () => {
  const result = parseRequestBody({ links: [{ id: "a", title: "A" }] });
  assertEquals(result, { ok: false, reason: "invalid_body" });
});

Deno.test("parseRequestBody: rejects malformed top-level body", () => {
  assertEquals(parseRequestBody(null), { ok: false, reason: "invalid_body" });
  assertEquals(parseRequestBody([1, 2, 3]), { ok: false, reason: "invalid_body" });
  assertEquals(parseRequestBody({ links: "nope" }), { ok: false, reason: "invalid_body" });
});

Deno.test("parseRequestBody: rejects duplicate ids", () => {
  const result = parseRequestBody({
    links: [
      { id: "a", title: "A", url: "https://a" },
      { id: "a", title: "A2", url: "https://a2" },
    ],
  });
  assertEquals(result, { ok: false, reason: "invalid_body" });
});

Deno.test("parseRequestBody: accepts exactly 100 links", () => {
  const result = parseRequestBody({ links: links(100) });
  assert(result.ok);
});

Deno.test("validateAndNormalize: happy path with 2 groups covering all ids", () => {
  const ids = ["a", "b", "c", "d"];
  const result = validateAndNormalize(
    {
      groups: [
        { name: "Group 1", emoji: "🐶", link_ids: ["a", "b"] },
        { name: "Group 2", emoji: "🐱", link_ids: ["c", "d"] },
      ],
      tags: { a: ["Foo", "foo", " Bar "], b: [] },
    },
    ids,
  );
  assert(result.ok);
  if (result.ok) {
    assertEquals(result.result.groups.length, 2);
    assertEquals(result.result.tags.a, ["foo", "bar"]); // lowercased, trimmed, deduped
  }
});

Deno.test("validateAndNormalize: relaxes to 1 group when fewer than 4 links", () => {
  const ids = ["a", "b"];
  const result = validateAndNormalize(
    { groups: [{ name: "Everything", emoji: "📌", link_ids: ["a", "b"] }], tags: {} },
    ids,
  );
  assert(result.ok);
});

Deno.test("validateAndNormalize: rejects a single group when 4+ links (needs >= 2)", () => {
  const ids = ["a", "b", "c", "d"];
  const result = validateAndNormalize(
    { groups: [{ name: "Everything", emoji: "📌", link_ids: ["a", "b", "c", "d"] }], tags: {} },
    ids,
  );
  assertEquals(result.ok, false);
});

Deno.test("validateAndNormalize: rejects unknown link_id", () => {
  const ids = ["a", "b", "c", "d"];
  const result = validateAndNormalize(
    {
      groups: [
        { name: "G1", emoji: "🐶", link_ids: ["a", "b"] },
        { name: "G2", emoji: "🐱", link_ids: ["c", "zzz"] },
      ],
      tags: {},
    },
    ids,
  );
  assertEquals(result.ok, false);
});

Deno.test("validateAndNormalize: rejects an id assigned to two groups", () => {
  const ids = ["a", "b", "c", "d"];
  const result = validateAndNormalize(
    {
      groups: [
        { name: "G1", emoji: "🐶", link_ids: ["a", "b", "c"] },
        { name: "G2", emoji: "🐱", link_ids: ["c", "d"] },
      ],
      tags: {},
    },
    ids,
  );
  assertEquals(result.ok, false);
});

Deno.test("validateAndNormalize: rejects a missing id (not assigned to any group)", () => {
  const ids = ["a", "b", "c", "d"];
  const result = validateAndNormalize(
    {
      groups: [
        { name: "G1", emoji: "🐶", link_ids: ["a", "b"] },
        { name: "G2", emoji: "🐱", link_ids: ["c"] },
      ],
      tags: {},
    },
    ids,
  );
  assertEquals(result.ok, false);
});

Deno.test("validateAndNormalize: multi-codepoint emoji is accepted as one grapheme, plain text falls back", () => {
  const ids = ["a", "b"];
  const result = validateAndNormalize(
    {
      groups: [
        { name: "G1", emoji: "👨‍👩‍👧", link_ids: ["a"] },
        { name: "G2", emoji: "not-an-emoji", link_ids: ["b"] },
      ],
      tags: {},
    },
    ids,
  );
  assert(result.ok);
  if (result.ok) {
    assertEquals(result.result.groups[0].emoji, "👨‍👩‍👧");
    assertEquals(result.result.groups[1].emoji, "🗂️");
  }
});

Deno.test("validateAndNormalize: caps tags at 5 per link", () => {
  const ids = ["a", "b"];
  const result = validateAndNormalize(
    { groups: [{ name: "G1", emoji: "📌", link_ids: ["a", "b"] }], tags: { a: ["1", "2", "3", "4", "5", "6", "7"] } },
    ids,
  );
  assert(result.ok);
  if (result.ok) assertEquals(result.result.tags.a.length, 5);
});

Deno.test("validateAndNormalize: rejects a group name over 40 chars", () => {
  const ids = ["a", "b"];
  const result = validateAndNormalize(
    { groups: [{ name: "x".repeat(41), emoji: "📌", link_ids: ["a", "b"] }], tags: {} },
    ids,
  );
  assertEquals(result.ok, false);
});

// ---------------------------------------------------------------------------
// organizeWithRetry (mocked Anthropic, no auth/metering involved)
// ---------------------------------------------------------------------------

Deno.test("organizeWithRetry: happy path on the first attempt", async () => {
  const ls = links(4);
  const ids = ls.map((l) => l.id);
  const mock = mockAnthropic([
    () =>
      anthropicToolResponse({
        groups: [
          { name: "First half", emoji: "🅰️", link_ids: [ids[0], ids[1]] },
          { name: "Second half", emoji: "🅱️", link_ids: [ids[2], ids[3]] },
        ],
        tags: {},
      }),
  ]);
  try {
    const outcome = await organizeWithRetry("fake-key", ls);
    assert(outcome.ok);
    assertEquals(mock.callCount(), 1);
  } finally {
    mock.restore();
  }
});

Deno.test("organizeWithRetry: unknown id on attempt 1, corrected on attempt 2 (retry succeeds)", async () => {
  const ls = links(4);
  const ids = ls.map((l) => l.id);
  const mock = mockAnthropic([
    () =>
      anthropicToolResponse({
        groups: [
          { name: "First half", emoji: "🅰️", link_ids: [ids[0], "not-a-real-id"] },
          { name: "Second half", emoji: "🅱️", link_ids: [ids[2], ids[3]] },
        ],
        tags: {},
      }),
    () =>
      anthropicToolResponse({
        groups: [
          { name: "First half", emoji: "🅰️", link_ids: [ids[0], ids[1]] },
          { name: "Second half", emoji: "🅱️", link_ids: [ids[2], ids[3]] },
        ],
        tags: {},
      }),
  ]);
  try {
    const outcome = await organizeWithRetry("fake-key", ls);
    assert(outcome.ok, `expected retry to succeed, got ${JSON.stringify(outcome)}`);
    assertEquals(mock.callCount(), 2);
  } finally {
    mock.restore();
  }
});

Deno.test("organizeWithRetry: invalid shape twice -> upstream_shape after exactly 2 attempts", async () => {
  const ls = links(4);
  const mock = mockAnthropic([
    () => anthropicToolResponse({ groups: [{ name: "Only", emoji: "📌", link_ids: [] }], tags: {} }),
    () => anthropicToolResponse({ groups: [{ name: "Still bad", emoji: "📌", link_ids: [] }], tags: {} }),
  ]);
  try {
    const outcome = await organizeWithRetry("fake-key", ls);
    assertEquals(outcome, { ok: false, reason: "upstream_shape" });
    assertEquals(mock.callCount(), 2);
  } finally {
    mock.restore();
  }
});

Deno.test("organizeWithRetry: Anthropic HTTP failure -> upstream, no retry", async () => {
  const ls = links(4);
  const mock = mockAnthropic([() => anthropicErrorResponse(500)]);
  try {
    const outcome = await organizeWithRetry("fake-key", ls);
    assertEquals(outcome, { ok: false, reason: "upstream" });
    assertEquals(mock.callCount(), 1);
  } finally {
    mock.restore();
  }
});

// ---------------------------------------------------------------------------
// handleRequest end-to-end: auth + payload validation (no real Anthropic call reached)
// ---------------------------------------------------------------------------

Deno.test("handleRequest: missing Authorization -> 401", async () => {
  const res = await handleRequest(
    new Request("http://localhost/ai-organize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ links: links(2) }),
    }),
  );
  assertEquals(res.status, 401);
  assertEquals((await res.json()).error, "unauthorized");
});

Deno.test("handleRequest: bogus Authorization token -> 401", async () => {
  const res = await handleRequest(postRequest("not-a-real-jwt", { links: links(2) }));
  assertEquals(res.status, 401);
});

Deno.test("handleRequest: GET is 405", async () => {
  const res = await handleRequest(new Request("http://localhost/ai-organize", { method: "GET" }));
  assertEquals(res.status, 405);
});

Deno.test("handleRequest: OPTIONS preflight is 204", async () => {
  const res = await handleRequest(new Request("http://localhost/ai-organize", { method: "OPTIONS" }));
  assertEquals(res.status, 204);
});

Deno.test("handleRequest: valid auth but >100 links -> 400, before any Anthropic call", async () => {
  const { token } = await setupTestUser("body-401links");
  const mock = mockAnthropic([() => anthropicToolResponse({ groups: [], tags: {} })]);
  try {
    const res = await handleRequest(postRequest(token, { links: links(101) }));
    assertEquals(res.status, 400);
    assertEquals(mock.callCount(), 0);
  } finally {
    mock.restore();
  }
});

// ---------------------------------------------------------------------------
// handleRequest end-to-end: metering against the REAL local database
// ---------------------------------------------------------------------------

Deno.test("handleRequest: success increments ai_uses_count exactly once", async () => {
  const { id, token } = await setupTestUser("meter-success");
  const ls = links(4);
  const ids = ls.map((l) => l.id);
  const mock = mockAnthropic([
    () =>
      anthropicToolResponse({
        groups: [
          { name: "A", emoji: "🅰️", link_ids: [ids[0], ids[1]] },
          { name: "B", emoji: "🅱️", link_ids: [ids[2], ids[3]] },
        ],
        tags: { [ids[0]]: ["news"] },
      }),
  ]);
  try {
    const res = await handleRequest(postRequest(token, { links: ls }));
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.groups.length, 2);
    assertEquals(body.tags[ids[0]], ["news"]);

    const profile = await fetchProfile(id);
    assertEquals(profile.ai_uses_count, 1);
  } finally {
    mock.restore();
  }
});

Deno.test("handleRequest: quota 402 at the free limit, Anthropic never called", async () => {
  const { token } = await setupTestUser("meter-quota", {
    plan: "free",
    ai_uses_count: 30,
    ai_uses_period_start: currentMonthStart(),
  });
  const mock = mockAnthropic([() => anthropicToolResponse({ groups: [], tags: {} })]);
  try {
    const res = await handleRequest(postRequest(token, { links: links(4) }));
    assertEquals(res.status, 402);
    const body = await res.json();
    assertEquals(body, { error: "quota", used: 30, limit: 30 });
    assertEquals(mock.callCount(), 0);
  } finally {
    mock.restore();
  }
});

Deno.test("handleRequest: pro plan bypasses the free quota", async () => {
  const { id, token } = await setupTestUser("meter-pro", {
    plan: "pro",
    ai_uses_count: 500,
    ai_uses_period_start: currentMonthStart(),
  });
  const ls = links(4);
  const ids = ls.map((l) => l.id);
  const mock = mockAnthropic([
    () =>
      anthropicToolResponse({
        groups: [
          { name: "A", emoji: "🅰️", link_ids: [ids[0], ids[1]] },
          { name: "B", emoji: "🅱️", link_ids: [ids[2], ids[3]] },
        ],
        tags: {},
      }),
  ]);
  try {
    const res = await handleRequest(postRequest(token, { links: ls }));
    assertEquals(res.status, 200);
    const profile = await fetchProfile(id);
    assertEquals(profile.ai_uses_count, 501);
  } finally {
    mock.restore();
  }
});

Deno.test("handleRequest: refunds the use when Anthropic fails (count untouched)", async () => {
  const { id, token } = await setupTestUser("meter-refund-upstream", {
    plan: "free",
    ai_uses_count: 5,
    ai_uses_period_start: currentMonthStart(),
  });
  const mock = mockAnthropic([() => anthropicErrorResponse(500)]);
  try {
    const res = await handleRequest(postRequest(token, { links: links(4) }));
    assertEquals(res.status, 502);
    assertEquals((await res.json()).error, "upstream");
    const profile = await fetchProfile(id);
    assertEquals(profile.ai_uses_count, 5, "count should be refunded back to its pre-request value");
  } finally {
    mock.restore();
  }
});

Deno.test("handleRequest: refunds the use when the model's shape is invalid twice", async () => {
  const { id, token } = await setupTestUser("meter-refund-shape", {
    plan: "free",
    ai_uses_count: 5,
    ai_uses_period_start: currentMonthStart(),
  });
  const mock = mockAnthropic([
    () => anthropicToolResponse({ groups: [{ name: "Only", emoji: "📌", link_ids: [] }], tags: {} }),
    () => anthropicToolResponse({ groups: [{ name: "Still bad", emoji: "📌", link_ids: [] }], tags: {} }),
  ]);
  try {
    const res = await handleRequest(postRequest(token, { links: links(4) }));
    assertEquals(res.status, 502);
    assertEquals((await res.json()).error, "upstream_shape");
    const profile = await fetchProfile(id);
    assertEquals(profile.ai_uses_count, 5);
  } finally {
    mock.restore();
  }
});

Deno.test("handleRequest: month rollover resets ai_uses_count before the quota check", async () => {
  const { id, token } = await setupTestUser("meter-rollover", {
    plan: "free",
    ai_uses_count: 30, // at the OLD month's limit; would 402 without rollover
    ai_uses_period_start: lastMonthStart(),
  });
  const ls = links(4);
  const ids = ls.map((l) => l.id);
  const mock = mockAnthropic([
    () =>
      anthropicToolResponse({
        groups: [
          { name: "A", emoji: "🅰️", link_ids: [ids[0], ids[1]] },
          { name: "B", emoji: "🅱️", link_ids: [ids[2], ids[3]] },
        ],
        tags: {},
      }),
  ]);
  try {
    const res = await handleRequest(postRequest(token, { links: ls }));
    assertEquals(res.status, 200, `expected rollover to allow this request, got ${res.status}: ${await res.clone().text()}`);
    const profile = await fetchProfile(id);
    assertEquals(profile.ai_uses_count, 1, "rollover should reset to 0 before this request's increment to 1");
    assertEquals(profile.ai_uses_period_start, currentMonthStart());
  } finally {
    mock.restore();
  }
});

// ---------------------------------------------------------------------------
// SQL-level guarantees: race safety and the service_role-only grant
// ---------------------------------------------------------------------------

Deno.test("consume_ai_use: concurrent calls for the same user serialize (only one wins the last slot)", async () => {
  const { id } = await setupTestUser("race", { plan: "free", ai_uses_count: 29, ai_uses_period_start: currentMonthStart() });
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  const [a, b] = await Promise.all([
    admin.rpc("consume_ai_use", { p_user_id: id, p_free_limit: 30, p_soft_cap: 1000 }).single(),
    admin.rpc("consume_ai_use", { p_user_id: id, p_free_limit: 30, p_soft_cap: 1000 }).single(),
  ]);

  const allowedCount = [(a.data as { allowed: boolean } | null)?.allowed, (b.data as { allowed: boolean } | null)?.allowed].filter(
    Boolean,
  ).length;
  assertEquals(allowedCount, 1, "exactly one of two concurrent calls should win the last slot at the limit");

  const profile = await fetchProfile(id);
  assertEquals(profile.ai_uses_count, 30, "the row lock should prevent a double-increment past the limit");
});

Deno.test("consume_ai_use: cannot be called by a non-service-role (authenticated) client", async () => {
  const { id, token } = await setupTestUser("authz");
  const userClient = createClient(SUPABASE_URL, ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { error } = await userClient.rpc("consume_ai_use", { p_user_id: id, p_free_limit: 30, p_soft_cap: 1000 });
  assert(error, "expected a permission error calling consume_ai_use as an authenticated (non-service-role) user");
});

// ---------------------------------------------------------------------------
// Cleanup: runs last (Deno.test runs sequentially in file order by
// default), removes every user this file created so re-running it never
// accumulates stray auth.users rows in the local stack.
// ---------------------------------------------------------------------------

Deno.test("cleanup: remove test users created by this file", async () => {
  for (const email of createdEmails) {
    const user = await findUserByEmail(email);
    if (user) await deleteUser(user.id);
  }
});

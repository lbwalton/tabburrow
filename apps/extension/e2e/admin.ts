/**
 * Raw REST calls against Supabase's GoTrue Admin API and PostgREST, using
 * `SUPABASE_SERVICE_ROLE_KEY` — test-only, for t16-auth.spec.ts's
 * independent "does a profiles row really exist" verification.
 *
 * Deliberately NOT using `@supabase/supabase-js` here: importing it from a
 * Playwright spec file hits a Node module-loader crash ("Unexpected module
 * status 3", inside `@supabase/auth-js`'s webauthn module) that reproduces
 * only under Playwright's test transform — a plain `node -e
 * "import('@supabase/supabase-js')"` in this same repo works fine, and so
 * does supabase-js from the extension's own bundle (Vite/WXT), so this
 * isn't a real packaging bug, just a Playwright-loader incompatibility not
 * worth chasing for a handful of admin HTTP calls. Every endpoint here was
 * verified directly against the local stack with curl first.
 */

interface AdminUser {
  id: string;
  email: string | null;
}

function adminHeaders(serviceRoleKey: string): HeadersInit {
  return { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "content-type": "application/json" };
}

/** `GET /auth/v1/admin/users`, then finds by exact email — GoTrue's admin listing has no server-side email filter param on this local CLI version. */
export async function findAdminUserByEmail(
  supabaseUrl: string,
  serviceRoleKey: string,
  email: string,
): Promise<AdminUser | null> {
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users`, { headers: adminHeaders(serviceRoleKey) });
  if (!res.ok) throw new Error(`admin listUsers failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { users: AdminUser[] };
  return body.users.find((u) => u.email === email) ?? null;
}

/** `DELETE /auth/v1/admin/users/<id>` — 404 (already gone) is treated as success, for idempotent cleanup. */
export async function deleteAdminUser(supabaseUrl: string, serviceRoleKey: string, id: string): Promise<void> {
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${id}`, {
    method: "DELETE",
    headers: adminHeaders(serviceRoleKey),
  });
  if (!res.ok && res.status !== 404) throw new Error(`admin deleteUser failed: ${res.status} ${await res.text()}`);
}

export interface ProfileRow {
  user_id: string;
  plan: string;
}

/** `GET /rest/v1/profiles?user_id=eq.<id>` with the service-role key, which bypasses RLS (see supabase/migrations/0001_init.sql's select-only "own profile read" policy — this deliberately reads as an admin, not as the signed-in user, so the assertion doesn't depend on the extension's own RLS-scoped client working correctly). */
export async function fetchProfile(supabaseUrl: string, serviceRoleKey: string, userId: string): Promise<ProfileRow | null> {
  const res = await fetch(`${supabaseUrl}/rest/v1/profiles?select=user_id,plan&user_id=eq.${userId}`, {
    headers: adminHeaders(serviceRoleKey),
  });
  if (!res.ok) throw new Error(`profiles select failed: ${res.status} ${await res.text()}`);
  const rows = (await res.json()) as ProfileRow[];
  return rows[0] ?? null;
}

/**
 * T18: flips `profiles.plan` for a test user via a service-role PATCH —
 * bypasses RLS (the "own profile read" policy is select-only; there is no
 * user-facing write path for `plan` at all — see supabase/migrations/0001_init.sql's
 * comment on why: it's meant to only ever move via Stripe's webhook, T23).
 * `Prefer: return=minimal` keeps this a plain ok/not-ok call.
 */
export async function setUserPlan(
  supabaseUrl: string,
  serviceRoleKey: string,
  userId: string,
  plan: "free" | "pro",
): Promise<void> {
  const res = await fetch(`${supabaseUrl}/rest/v1/profiles?user_id=eq.${userId}`, {
    method: "PATCH",
    headers: { ...adminHeaders(serviceRoleKey), Prefer: "return=minimal" },
    body: JSON.stringify({ plan }),
  });
  if (!res.ok) throw new Error(`profiles plan update failed: ${res.status} ${await res.text()}`);
}

export interface RemoteCollectionRow {
  id: string;
  name: string;
  deleted_at: number | null;
}

export interface RemoteLinkRow {
  id: string;
  collection_id: string;
  url: string;
  deleted_at: number | null;
}

/** `GET /rest/v1/collections?user_id=eq.<id>` as the admin — used by t18-sync.spec.ts's initialUpload test to verify rows landed in the cloud without trusting the extension's own (client-side) read of what it thinks it pushed. */
export async function fetchCollectionsForUser(
  supabaseUrl: string,
  serviceRoleKey: string,
  userId: string,
): Promise<RemoteCollectionRow[]> {
  const res = await fetch(`${supabaseUrl}/rest/v1/collections?select=id,name,deleted_at&user_id=eq.${userId}`, {
    headers: adminHeaders(serviceRoleKey),
  });
  if (!res.ok) throw new Error(`collections select failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as RemoteCollectionRow[];
}

/** `GET /rest/v1/links?user_id=eq.<id>` as the admin — see `fetchCollectionsForUser`. */
export async function fetchLinksForUser(
  supabaseUrl: string,
  serviceRoleKey: string,
  userId: string,
): Promise<RemoteLinkRow[]> {
  const res = await fetch(`${supabaseUrl}/rest/v1/links?select=id,collection_id,url,deleted_at&user_id=eq.${userId}`, {
    headers: adminHeaders(serviceRoleKey),
  });
  if (!res.ok) throw new Error(`links select failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as RemoteLinkRow[];
}

/**
 * T18 fix pass: inserts a cloud `collections` row directly as the admin —
 * used by the account-switch e2e test to seed data that exists ONLY in user
 * B's cloud (never touched this device), so "Replace local data" has
 * something real to pull. Timestamps are epoch-ms bigints per the schema
 * (supabase/migrations/0001_init.sql).
 */
export async function insertCloudCollection(
  supabaseUrl: string,
  serviceRoleKey: string,
  row: { id: string; user_id: string; name: string; position: string; created_at: number; updated_at: number },
): Promise<void> {
  const res = await fetch(`${supabaseUrl}/rest/v1/collections`, {
    method: "POST",
    headers: { ...adminHeaders(serviceRoleKey), Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`collections insert failed: ${res.status} ${await res.text()}`);
}

/**
 * Deletes every `collections`/`links` row for a test user — cloud-side
 * cleanup so a t18-sync.spec.ts run never leaves rows behind for a NEXT run
 * to trip over (links first: no FK from links -> collections in the schema,
 * but deleting in this order mirrors the app's own cascade intent anyway).
 * `deleteAdminUser` (auth.users, `on delete cascade`) would already sweep
 * these too, but callers do this explicitly first so the assertions right
 * before cleanup aren't racing the user deletion.
 */
export async function deleteCloudDataForUser(supabaseUrl: string, serviceRoleKey: string, userId: string): Promise<void> {
  for (const table of ["links", "collections"]) {
    const res = await fetch(`${supabaseUrl}/rest/v1/${table}?user_id=eq.${userId}`, {
      method: "DELETE",
      headers: { ...adminHeaders(serviceRoleKey), Prefer: "return=minimal" },
    });
    if (!res.ok) throw new Error(`${table} cleanup delete failed: ${res.status} ${await res.text()}`);
  }
}

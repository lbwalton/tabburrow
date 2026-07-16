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

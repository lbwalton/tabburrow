// T19: JWT verification + service-role client, shared across Edge Functions.
import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2.110.5";
import { errorResponse } from "./json.ts";

export type AuthResult = { ok: true; user: User } | { ok: false; response: Response };

/**
 * Verifies the request's Bearer JWT against Supabase Auth. Uses the
 * ANON key + the caller's own Authorization header (never the
 * service-role key here): this is the standard "who is calling me"
 * check for an Edge Function; the service-role client
 * (`createServiceRoleClient` below) is reserved for the metering RPCs,
 * which only run as a trusted step AFTER this check passes.
 */
export async function requireUser(req: Request): Promise<AuthResult> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return { ok: false, response: errorResponse("unauthorized", 401) };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    // Both are auto-injected by the Supabase platform/CLI for every Edge
    // Function; this only fires if the runtime itself is misconfigured.
    return { ok: false, response: errorResponse("server_misconfigured", 500) };
  }

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    return { ok: false, response: errorResponse("unauthorized", 401) };
  }
  return { ok: true, user: data.user };
}

/** Service-role client for the metering RPCs (`consume_ai_use`/`refund_ai_use` are granted to `service_role` only, see supabase/migrations/0004_ai_metering.sql); never exposed to the caller, never used for the auth check above. */
export function createServiceRoleClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set (both are auto-injected by the Supabase runtime).");
  }
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
}

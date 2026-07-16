"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser-side Supabase client for `/account` (T23a): email OTP sign-in,
 * reading `profiles.plan`, and calling `checkout-session` with the
 * signed-in user's JWT. Mirrors apps/extension/lib/supabase.ts's
 * hasEnv/singleton pattern, but:
 *  - reads `NEXT_PUBLIC_`-prefixed vars (Next.js inlines these into the
 *    client bundle at build time — see .env.example) instead of WXT's
 *    `import.meta.env`.
 *  - uses supabase-js's DEFAULT session storage (browser `localStorage`)
 *    instead of a custom adapter: an ordinary browser tab has a real
 *    `localStorage`, unlike the extension's popup/dashboard/service-worker
 *    split, which is the whole reason that file needed a `chrome.storage.local`
 *    adapter in the first place.
 *
 * `"use client"` at the top: this module touches `localStorage` at client
 * construction time via supabase-js, so it must never be pulled into a
 * Server Component's module graph. Only `AccountClient.tsx` (itself
 * `"use client"`) imports this.
 */
export function hasSupabaseEnv(url: string | undefined, anonKey: string | undefined): boolean {
  return typeof url === "string" && url.trim().length > 0 && typeof anonKey === "string" && anonKey.trim().length > 0;
}

export function isSupabaseConfigured(): boolean {
  return hasSupabaseEnv(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

// Sentinel distinguishes "not yet computed" (undefined) from "computed and
// genuinely unconfigured" (null) — same convention as
// apps/extension/lib/supabase.ts's getClient() and apps/web/lib/share.ts's
// getServiceRoleClient().
let _client: SupabaseClient | null | undefined;

/**
 * Singleton browser Supabase client, or `null` when
 * `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` aren't set —
 * self-hosters who haven't configured cloud features yet get a quiet
 * "not configured" account page instead of a crash (see SELF_HOSTING.md).
 */
export function getBrowserClient(): SupabaseClient | null {
  if (_client !== undefined) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!hasSupabaseEnv(url, anonKey)) {
    _client = null;
    return _client;
  }
  _client = createClient(url!, anonKey!, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return _client;
}

/** Supabase project URL for building Edge Function URLs directly (see lib/billing.ts's `functionUrl`) — `null` under the same unconfigured condition as `getBrowserClient()`. */
export function getSupabaseUrl(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return isSupabaseConfigured() ? url! : null;
}

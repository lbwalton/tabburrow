import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * True when both cloud env vars are present and non-blank. Pure — the only
 * piece of the "is cloud configured" decision worth unit testing on its
 * own; `getClient`/`isSupabaseConfigured` below just plug `import.meta.env`
 * (WXT's build-time injection — see scripts/sync-env.mjs) into this.
 */
export function hasSupabaseEnv(url: string | undefined, anonKey: string | undefined): boolean {
  return typeof url === "string" && url.trim().length > 0 && typeof anonKey === "string" && anonKey.trim().length > 0;
}

/** Same check `getClient` uses, exposed directly for UI components that need to branch (Account section, popup footer) WITHOUT constructing a client — self-hosters who never set up Supabase get a quiet "not configured" state and zero network calls. */
export function isSupabaseConfigured(): boolean {
  return hasSupabaseEnv(import.meta.env.WXT_SUPABASE_URL, import.meta.env.WXT_SUPABASE_ANON_KEY);
}

/** Every chrome.storage.local key this adapter touches is namespaced under this prefix, keeping supabase-js's session/PKCE-verifier keys visually grouped and collision-proof against any other meta this extension stores in the same flat chrome.storage.local bucket. */
export const AUTH_STORAGE_PREFIX = "sb-auth:";

/** Pure key-prefixing — the one piece of the storage adapter worth unit testing without mocking chrome.storage.local (see lib/supabase.test.ts and the vitest.config.ts docstring on why chrome.* itself isn't mocked here). */
export function prefixedStorageKey(key: string): string {
  return `${AUTH_STORAGE_PREFIX}${key}`;
}

/**
 * supabase-js's `SupportedStorage` shape, implemented over
 * `chrome.storage.local` instead of the `localStorage` supabase-js defaults
 * to — extension pages/service workers don't share a `localStorage` (each
 * document, including the background service worker, has its own), so this
 * is what makes a session survive across the popup, the dashboard tab, and
 * service-worker restarts alike.
 */
const chromeStorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    const prefixed = prefixedStorageKey(key);
    const result = await chrome.storage.local.get(prefixed);
    const value = result[prefixed];
    return typeof value === "string" ? value : null;
  },
  async setItem(key: string, value: string): Promise<void> {
    await chrome.storage.local.set({ [prefixedStorageKey(key)]: value });
  },
  async removeItem(key: string): Promise<void> {
    await chrome.storage.local.remove(prefixedStorageKey(key));
  },
};

// Sentinel distinguishes "not yet computed" (undefined) from "computed and
// genuinely unconfigured" (null) — a real object is falsy-unsafe to use as
// that sentinel (nothing here is falsy-when-configured), so the extra
// `undefined` state is what lets getClient() memoize the "not configured"
// answer too, instead of re-checking env every call.
let _client: SupabaseClient | null | undefined;

/**
 * Singleton Supabase client, or `null` when `WXT_SUPABASE_URL`/
 * `WXT_SUPABASE_ANON_KEY` aren't set (self-hosters who haven't configured
 * cloud features yet — see SELF_HOSTING.md). Callers MUST handle `null`;
 * this never throws just because cloud isn't configured, since local-only
 * use is a fully supported mode, not an error state.
 *
 * `flowType: "pkce"` + `detectSessionInUrl: false`: this is an extension,
 * not a web page navigated to by a redirect — the Google OAuth PKCE
 * exchange is driven manually via `chrome.identity.launchWebAuthFlow` (see
 * lib/auth.ts's `signInWithGoogle`), never by supabase-js parsing
 * `window.location` itself.
 */
export function getClient(): SupabaseClient | null {
  if (_client !== undefined) return _client;
  const url = import.meta.env.WXT_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.WXT_SUPABASE_ANON_KEY as string | undefined;
  if (!hasSupabaseEnv(url, anonKey)) {
    _client = null;
    return _client;
  }
  _client = createClient(url!, anonKey!, {
    auth: {
      storage: chromeStorageAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: "pkce",
    },
  });
  return _client;
}

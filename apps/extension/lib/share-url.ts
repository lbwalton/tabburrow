/**
 * Same literal fallback `scripts/sync-env.mjs` writes into `WXT_SITE_URL`
 * when the root `.env` has no `NEXT_PUBLIC_SITE_URL` set (or no root `.env`
 * exists at all) — duplicated by hand rather than imported (that script runs
 * under plain Node, this runs through WXT/Vite's build; same "kept in sync
 * by hand across runtimes" precedent `e2e/env.ts`'s docstring sets for this
 * repo's other duplicated env-parsing logic). Defended here too, not just
 * there, so a raw `import.meta.env.WXT_SITE_URL` gap (e.g. an `.env.local`
 * hand-edited to drop the key) still produces a real TabBurrow origin
 * instead of a broken `undefined/s/<slug>` link.
 */
const DEFAULT_SITE_URL = "https://tabburrow.com";

/**
 * Pure: joins a site origin and a share slug into `<origin>/s/<slug>`,
 * normalizing away any trailing slash(es) on `siteUrl` first so the result
 * never doubles up (`https://tabburrow.com//s/<slug>`). The one piece of
 * `shareUrlFor` worth unit testing in isolation — see lib/share-url.test.ts
 * and lib/supabase.ts's `hasSupabaseEnv` for the identical
 * pure-function/env-reading-wrapper split this file follows.
 */
export function buildShareUrl(siteUrl: string, slug: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/s/${slug}`;
}

/**
 * The real one-arg entry point `ShareDialog` calls: reads `WXT_SITE_URL`
 * (written by `scripts/sync-env.mjs` from the root `.env`'s
 * `NEXT_PUBLIC_SITE_URL`, falling back to the public `tabburrow.com` origin
 * either there or here) and builds the public share URL for `slug`. Not unit
 * tested directly — it reads `import.meta.env`, same reason
 * `lib/supabase.ts`'s `getClient`/`isSupabaseConfigured` aren't (see
 * lib/supabase.test.ts's docstring); `buildShareUrl` above carries the
 * actual test-driven logic.
 */
export function shareUrlFor(slug: string): string {
  const raw = import.meta.env.WXT_SITE_URL as string | undefined;
  const siteUrl = raw?.trim() || DEFAULT_SITE_URL;
  return buildShareUrl(siteUrl, slug);
}

/**
 * Pure: builds a recipient-less `mailto:` link that opens the user's own mail
 * app with the subject and body prefilled, so "Email" hands the share link off
 * to the client's mailer instead of TabBurrow sending anything. No `to=` is
 * set — the user chooses who to send to. Subject/body are `encodeURIComponent`d
 * (CRLF line breaks per RFC 6068), which also neutralizes any `&`/`"`/newline
 * in the collection name so it can't split the query or inject headers. Kept
 * pure and unit tested here for the same split as `buildShareUrl`; the UI layer
 * just navigates to the returned string.
 */
export function mailtoShareForCollection(name: string, shareUrl: string): string {
  const subject = `${name}: a TabBurrow collection`;
  const body = `Here are my "${name}" links:\r\n\r\n${shareUrl}\r\n\r\nShared with TabBurrow.`;
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

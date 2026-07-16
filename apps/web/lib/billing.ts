// T23a: pure helpers for the /account page's billing calls
// (checkout-session Edge Function — supabase/functions/checkout-session/).
// Split out from AccountClient.tsx so the request/response shaping is
// unit-testable without a browser or a mocked Supabase client, matching
// this app's existing precedent (lib/share.ts's pure helpers + share.test.ts).

/** `${supabaseUrl}/functions/v1/${name}`, tolerant of a trailing slash on `supabaseUrl` (same normalization as apps/extension/lib/ai.ts's own URL building). */
export function functionUrl(supabaseUrl: string, name: string): string {
  return `${supabaseUrl.replace(/\/$/, "")}/functions/v1/${name}`;
}

export type CheckoutOutcome = { ok: true; url: string } | { ok: false; message: string };

/**
 * Interprets checkout-session's response body into a UI-facing outcome.
 * Pure (no fetch here) so the mapping from `{status, body}` -> a message a
 * person can actually read is testable without a network mock. Mirrors
 * the `{error: <code>}` shape every function in this repo's error
 * responses share (`supabase/functions/_shared/json.ts`'s `errorResponse`).
 */
export function parseCheckoutResponse(status: number, body: unknown): CheckoutOutcome {
  if (status === 200) {
    const url = (body as Record<string, unknown> | null)?.url;
    if (typeof url === "string" && url.length > 0) return { ok: true, url };
    return { ok: false, message: "Stripe didn't return a checkout URL. Try again in a moment." };
  }
  if (status === 401) {
    return { ok: false, message: "Your session expired. Sign in again." };
  }
  const errorCode = (body as Record<string, unknown> | null)?.error;
  if (errorCode === "server_misconfigured") {
    return { ok: false, message: "Billing isn't configured on this server yet." };
  }
  return { ok: false, message: "Couldn't start checkout. Try again in a moment." };
}

// T19: shared CORS handling for every Edge Function in this repo
// (ai-organize now; checkout-session/stripe-webhook/share-resolve later).
//
// The caller is the Chrome extension (a chrome-extension:// origin), and
// this function requires a valid Bearer JWT to do anything (see
// _shared/auth.ts): a wildcard Access-Control-Allow-Origin doesn't widen
// who can actually USE the function, it only controls which browser
// origins are allowed to read the response. JWT possession is the real
// gate, so "*" is acceptable here.
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Returns a 204 preflight response for OPTIONS requests, or null for every other method (caller keeps handling the request). */
export function handleCorsPreflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  return null;
}

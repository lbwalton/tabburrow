// T19: small typed JSON response helpers shared across Edge Functions.
import { CORS_HEADERS } from "./cors.ts";

export function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS, ...extraHeaders },
  });
}

/** `{error: <code>, ...extra}`: every error body in this repo's functions follows this one shape so clients can branch on `error` alone. */
export function errorResponse(error: string, status: number, extra: Record<string, unknown> = {}): Response {
  return jsonResponse({ error, ...extra }, status);
}

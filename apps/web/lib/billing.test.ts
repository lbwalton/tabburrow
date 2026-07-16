import { describe, expect, it } from "vitest";
import { functionUrl, parseCheckoutResponse } from "./billing";

describe("functionUrl", () => {
  it("joins a supabase URL and function name", () => {
    expect(functionUrl("http://127.0.0.1:54321", "checkout-session")).toBe(
      "http://127.0.0.1:54321/functions/v1/checkout-session",
    );
  });

  it("tolerates a trailing slash on the supabase URL", () => {
    expect(functionUrl("http://127.0.0.1:54321/", "checkout-session")).toBe(
      "http://127.0.0.1:54321/functions/v1/checkout-session",
    );
  });
});

describe("parseCheckoutResponse", () => {
  it("returns the url on a 200 with a valid body", () => {
    expect(parseCheckoutResponse(200, { url: "https://checkout.stripe.com/abc" })).toEqual({
      ok: true,
      url: "https://checkout.stripe.com/abc",
    });
  });

  it("fails when a 200 is missing a url", () => {
    const result = parseCheckoutResponse(200, {});
    expect(result.ok).toBe(false);
  });

  it("maps a 401 to a session-expired message", () => {
    const result = parseCheckoutResponse(401, { error: "unauthorized" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/session expired/i);
  });

  it("maps server_misconfigured to a specific message", () => {
    const result = parseCheckoutResponse(500, { error: "server_misconfigured" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/isn't configured/i);
  });

  it("maps no_customer (portal without prior checkout) to a clear message", () => {
    const result = parseCheckoutResponse(400, { error: "no_customer" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/upgrade/i);
  });

  it("falls back to a generic message for anything else", () => {
    const result = parseCheckoutResponse(502, { error: "upstream" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message.length).toBeGreaterThan(0);
  });

  it("handles a null/unparseable body without throwing", () => {
    const result = parseCheckoutResponse(500, null);
    expect(result.ok).toBe(false);
  });
});

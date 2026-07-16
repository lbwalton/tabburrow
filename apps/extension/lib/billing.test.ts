import { describe, it, expect } from "vitest";
import {
  BillingError,
  PICKUP_RATE_LIMIT_MS,
  STRIPE_CHECKOUT_ORIGIN,
  buildAccountUrl,
  isStripeCheckoutUrl,
  parseCheckoutSessionResponse,
  shouldPickupPlanOnVisible,
  upgradeAvailability,
} from "./billing";
import type { AuthUser } from "./auth";

const USER: AuthUser = { id: "user-1", email: "a@example.com" };

describe("parseCheckoutSessionResponse", () => {
  it("returns {url} on a well-formed 200", () => {
    expect(parseCheckoutSessionResponse(200, { url: "https://checkout.stripe.com/c/pay/cs_test_abc" })).toEqual({
      url: "https://checkout.stripe.com/c/pay/cs_test_abc",
    });
  });

  it("rejects a 200 whose url is not a real https://checkout.stripe.com URL (fix pass 1)", () => {
    // The extension passes this URL straight to chrome.tabs.create — a
    // compromised/misconfigured backend must not be able to open an
    // arbitrary (or javascript:) URL in the user's browser.
    const bad = [
      "http://checkout.stripe.com/c/pay/cs_test_abc", // not https
      "javascript:alert(1)",
      "https://evil.example.com/c/pay/cs_test_abc", // wrong origin
      "https://checkout.stripe.com.evil.example.com/pay", // origin-suffix spoof
      "https://billing.stripe.com/session/x", // real Stripe, wrong surface (portal is apps/web's flow, never this function's)
      "not a url at all",
    ];
    for (const url of bad) {
      try {
        parseCheckoutSessionResponse(200, { url });
        expect.unreachable(`expected rejection for ${url}`);
      } catch (err) {
        expect(err).toBeInstanceOf(BillingError);
        expect((err as BillingError).kind).toBe("upstream");
      }
    }
  });

  it("throws BillingError('upstream') on a 200 with a missing/malformed url", () => {
    for (const body of [{}, { url: 42 }, { url: "" }, null]) {
      expect(() => parseCheckoutSessionResponse(200, body)).toThrow(BillingError);
      try {
        parseCheckoutSessionResponse(200, body);
      } catch (err) {
        expect(err).toBeInstanceOf(BillingError);
        expect((err as BillingError).kind).toBe("upstream");
      }
    }
  });

  it("throws BillingError('auth') on 401", () => {
    try {
      parseCheckoutSessionResponse(401, { error: "unauthorized" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(BillingError);
      expect((err as BillingError).kind).toBe("auth");
    }
  });

  it("throws BillingError('upstream') on any other non-2xx status", () => {
    for (const status of [400, 404, 500, 502]) {
      try {
        parseCheckoutSessionResponse(status, { error: "server_misconfigured" });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(BillingError);
        expect((err as BillingError).kind).toBe("upstream");
      }
    }
  });
});

describe("isStripeCheckoutUrl (fix pass 1)", () => {
  it("accepts a real hosted-Checkout URL (path and fragment irrelevant, origin is what's checked)", () => {
    expect(isStripeCheckoutUrl("https://checkout.stripe.com/c/pay/cs_test_abc#fidkxyz")).toBe(true);
    expect(isStripeCheckoutUrl(`${STRIPE_CHECKOUT_ORIGIN}/anything`)).toBe(true);
  });

  it("rejects non-https, wrong-origin, spoofed-suffix, javascript:, and unparseable inputs", () => {
    expect(isStripeCheckoutUrl("http://checkout.stripe.com/c/pay/x")).toBe(false);
    expect(isStripeCheckoutUrl("https://evil.example.com/c/pay/x")).toBe(false);
    expect(isStripeCheckoutUrl("https://checkout.stripe.com.evil.example.com/x")).toBe(false);
    expect(isStripeCheckoutUrl("https://billing.stripe.com/session/x")).toBe(false);
    expect(isStripeCheckoutUrl("javascript:alert(1)")).toBe(false);
    expect(isStripeCheckoutUrl("not a url at all")).toBe(false);
    expect(isStripeCheckoutUrl("")).toBe(false);
  });
});

describe("BillingError", () => {
  it("carries kind and is a real Error", () => {
    const err = new BillingError("network", "offline");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("BillingError");
    expect(err.kind).toBe("network");
    expect(err.message).toBe("offline");
  });
});

describe("upgradeAvailability", () => {
  it("is hidden when cloud isn't configured, regardless of user/plan", () => {
    expect(upgradeAvailability({ configured: false, user: USER, plan: "free" })).toBe("hidden");
    expect(upgradeAvailability({ configured: false, user: USER, plan: "pro" })).toBe("hidden");
  });

  it("is hidden when signed out, regardless of plan", () => {
    expect(upgradeAvailability({ configured: true, user: null, plan: "free" })).toBe("hidden");
    expect(upgradeAvailability({ configured: true, user: null, plan: null })).toBe("hidden");
  });

  it("is hidden when signed in but the plan hasn't resolved yet (null, not free)", () => {
    expect(upgradeAvailability({ configured: true, user: USER, plan: null })).toBe("hidden");
  });

  it("is 'upgrade' for a signed-in FREE user", () => {
    expect(upgradeAvailability({ configured: true, user: USER, plan: "free" })).toBe("upgrade");
  });

  it("is 'manage' for a signed-in PRO user", () => {
    expect(upgradeAvailability({ configured: true, user: USER, plan: "pro" })).toBe("manage");
  });
});

describe("buildAccountUrl", () => {
  it("joins the origin and /account", () => {
    expect(buildAccountUrl("https://tabburrow.com")).toBe("https://tabburrow.com/account");
  });

  it("strips one or more trailing slashes so the result never doubles up", () => {
    expect(buildAccountUrl("https://tabburrow.com/")).toBe("https://tabburrow.com/account");
    expect(buildAccountUrl("http://localhost:3002///")).toBe("http://localhost:3002/account");
  });
});

describe("shouldPickupPlanOnVisible", () => {
  it("fires on the very first check (never checked before)", () => {
    expect(shouldPickupPlanOnVisible(null, 1_000_000)).toBe(true);
  });

  it("does not fire again inside the rate-limit window", () => {
    expect(shouldPickupPlanOnVisible(1_000_000, 1_000_000 + PICKUP_RATE_LIMIT_MS - 1)).toBe(false);
  });

  it("fires again exactly at the rate-limit boundary and beyond", () => {
    expect(shouldPickupPlanOnVisible(1_000_000, 1_000_000 + PICKUP_RATE_LIMIT_MS)).toBe(true);
    expect(shouldPickupPlanOnVisible(1_000_000, 1_000_000 + PICKUP_RATE_LIMIT_MS + 60_000)).toBe(true);
  });

  it("is exactly a 60s window", () => {
    expect(PICKUP_RATE_LIMIT_MS).toBe(60_000);
  });
});

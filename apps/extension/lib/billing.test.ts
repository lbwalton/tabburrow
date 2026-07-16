import { describe, it, expect } from "vitest";
import {
  BillingError,
  PICKUP_RATE_LIMIT_MS,
  buildAccountUrl,
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

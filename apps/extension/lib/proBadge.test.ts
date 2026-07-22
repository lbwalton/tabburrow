import { describe, it, expect } from "vitest";
import { proBadgeState } from "./proBadge";
import type { AuthUser } from "./auth";

const user: AuthUser = { id: "user-1", email: "u@example.com" };

describe("proBadgeState", () => {
  it("hides the chip entirely when cloud isn't configured, whatever the auth state", () => {
    expect(proBadgeState(false, null, null)).toBe("hidden");
    expect(proBadgeState(false, user, "free")).toBe("hidden");
    expect(proBadgeState(false, user, "pro")).toBe("hidden");
  });

  it("offers the upgrade chip to signed-out users", () => {
    expect(proBadgeState(true, null, null)).toBe("upgrade");
  });

  it("offers the upgrade chip to signed-in FREE users", () => {
    expect(proBadgeState(true, user, "free")).toBe("upgrade");
  });

  it("offers the upgrade chip while a signed-in user's plan is still resolving", () => {
    expect(proBadgeState(true, user, null)).toBe("upgrade");
  });

  it("shows the active chip only for a signed-in PRO user", () => {
    expect(proBadgeState(true, user, "pro")).toBe("active");
  });

  it("never reads a plan value as active without a signed-in user", () => {
    expect(proBadgeState(true, null, "pro")).toBe("upgrade");
  });
});

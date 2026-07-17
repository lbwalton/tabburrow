import { describe, it, expect } from "vitest";
import {
  dismissProBannerState,
  formatProBannerState,
  parseProBannerState,
  PRO_BANNER_REAPPEAR_MS,
  shouldShowProBanner,
} from "./proBanner";

describe("proBanner state", () => {
  it("parses a missing / malformed record as never-dismissed", () => {
    expect(parseProBannerState(null)).toEqual({ count: 0, lastDismissedAt: 0 });
    expect(parseProBannerState("")).toEqual({ count: 0, lastDismissedAt: 0 });
    expect(parseProBannerState("garbage")).toEqual({ count: 0, lastDismissedAt: 0 });
    expect(parseProBannerState("0:123")).toEqual({ count: 0, lastDismissedAt: 0 });
  });

  it("round-trips a real record through format/parse", () => {
    const state = { count: 1, lastDismissedAt: 1_700_000_000_000 };
    expect(parseProBannerState(formatProBannerState(state))).toEqual(state);
  });

  it("dismiss bumps the count and stamps the time", () => {
    const first = dismissProBannerState({ count: 0, lastDismissedAt: 0 }, 1000);
    expect(first).toEqual({ count: 1, lastDismissedAt: 1000 });
    const second = dismissProBannerState(first, 2000);
    expect(second).toEqual({ count: 2, lastDismissedAt: 2000 });
  });
});

describe("shouldShowProBanner", () => {
  const now = 1_000_000_000_000;

  it("never shows to PRO users, even when never dismissed", () => {
    expect(shouldShowProBanner({ plan: "pro", state: { count: 0, lastDismissedAt: 0 }, now })).toBe(false);
  });

  it("shows to free / signed-out users who have never dismissed it", () => {
    expect(shouldShowProBanner({ plan: "free", state: { count: 0, lastDismissedAt: 0 }, now })).toBe(true);
    expect(shouldShowProBanner({ plan: null, state: { count: 0, lastDismissedAt: 0 }, now })).toBe(true);
  });

  it("stays hidden for 14 days after a first dismissal, then reappears once", () => {
    const dismissed = { count: 1, lastDismissedAt: now };
    expect(shouldShowProBanner({ plan: "free", state: dismissed, now: now + 1000 })).toBe(false);
    expect(shouldShowProBanner({ plan: "free", state: dismissed, now: now + PRO_BANNER_REAPPEAR_MS - 1 })).toBe(false);
    expect(shouldShowProBanner({ plan: "free", state: dismissed, now: now + PRO_BANNER_REAPPEAR_MS })).toBe(true);
  });

  it("stays hidden for good after a second dismissal", () => {
    const twice = { count: 2, lastDismissedAt: now };
    expect(shouldShowProBanner({ plan: "free", state: twice, now: now + PRO_BANNER_REAPPEAR_MS * 10 })).toBe(false);
  });
});

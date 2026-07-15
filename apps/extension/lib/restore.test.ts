import { describe, it, expect } from "vitest";
import { needsRestoreConfirm, openFailureMessage, RESTORE_CONFIRM_THRESHOLD } from "./restore";

// `openLinks` itself is NOT unit tested here: it's the one chrome-calling
// function in this file (chrome.tabs.create / chrome.windows.create), and
// this package's vitest config deliberately does no chrome.* mocking —
// same precedent as lib/dashboard.ts's countLinksByCollection and
// lib/tabs.ts's getCurrentTab/getAllTabs/closeTabsByUrl. The two pure
// decisions below (the confirm threshold and the failure-toast phrasing)
// ARE test-driven.

describe("needsRestoreConfirm", () => {
  it("does not require confirmation exactly at the threshold (15)", () => {
    expect(needsRestoreConfirm(15)).toBe(false);
  });

  it("requires confirmation just over the threshold (16)", () => {
    expect(needsRestoreConfirm(16)).toBe(true);
  });

  it("does not require confirmation well under the threshold", () => {
    expect(needsRestoreConfirm(0)).toBe(false);
    expect(needsRestoreConfirm(1)).toBe(false);
  });

  it("requires confirmation well over the threshold", () => {
    expect(needsRestoreConfirm(100)).toBe(true);
  });

  it("RESTORE_CONFIRM_THRESHOLD is 15", () => {
    expect(RESTORE_CONFIRM_THRESHOLD).toBe(15);
  });
});

describe("openFailureMessage", () => {
  it("uses singular phrasing for exactly one failure", () => {
    expect(openFailureMessage(1)).toBe("Couldn't open 1 link.");
  });

  it("pluralizes for more than one failure", () => {
    expect(openFailureMessage(3)).toBe("Couldn't open 3 links.");
  });

  it("pluralizes for zero too (defensive — callers should only invoke this when failed > 0)", () => {
    expect(openFailureMessage(0)).toBe("Couldn't open 0 links.");
  });
});

import { describe, it, expect } from "vitest";
import { isSyncNudgeMessage, SYNC_NUDGE_MESSAGE_TYPE } from "./sync-nudge";

// sendSyncNudge itself is not unit tested here — it's a one-line
// chrome.runtime.sendMessage call, and this package's vitest config
// deliberately does no chrome.* mocking (same precedent as lib/tabs.ts).
// It's exercised for real by e2e/specs/t18-sync.spec.ts. isSyncNudgeMessage
// is the pure decision background.ts's onMessage listener defers to, and IS
// test-driven here.

describe("isSyncNudgeMessage", () => {
  it("recognizes the exact nudge message shape", () => {
    expect(isSyncNudgeMessage({ type: SYNC_NUDGE_MESSAGE_TYPE })).toBe(true);
  });

  it("rejects a message with a different type", () => {
    expect(isSyncNudgeMessage({ type: "something-else" })).toBe(false);
  });

  it("rejects null, undefined, and non-object payloads", () => {
    expect(isSyncNudgeMessage(null)).toBe(false);
    expect(isSyncNudgeMessage(undefined)).toBe(false);
    expect(isSyncNudgeMessage("sync-nudge")).toBe(false);
    expect(isSyncNudgeMessage(42)).toBe(false);
  });

  it("rejects an object with no type field", () => {
    expect(isSyncNudgeMessage({})).toBe(false);
  });
});

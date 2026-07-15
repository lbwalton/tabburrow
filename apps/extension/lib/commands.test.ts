import { describe, it, expect } from "vitest";
import {
  commandPlan,
  isPendingCommandFresh,
  parsePendingCommandFlag,
  PENDING_COMMAND_SAVE_ALL,
  pendingSaveAllFlagValue,
} from "./commands";

// `flashSavedBadge` and `saveCurrentTabSilently` are NOT unit tested here:
// they're the two chrome-calling functions in this file
// (chrome.action.setBadgeText/BackgroundColor, saveTabs+getCurrentTab), and
// this package's vitest config deliberately does no chrome.* mocking — same
// precedent as lib/tabs.ts's getCurrentTab/getAllTabs. `commandPlan` IS
// test-driven.

describe("commandPlan", () => {
  it("save-current-tab with a warm lastUsed target saves silently", () => {
    expect(commandPlan("save-current-tab", true)).toEqual({ action: "save-current-silently" });
  });

  it("save-current-tab with no lastUsed target falls back to the popup", () => {
    expect(commandPlan("save-current-tab", false)).toEqual({ action: "open-popup" });
  });

  it("save-all-tabs always opens the popup with a pending flag, warm or cold", () => {
    expect(commandPlan("save-all-tabs", true)).toEqual({ action: "open-popup-pending-save-all" });
    expect(commandPlan("save-all-tabs", false)).toEqual({ action: "open-popup-pending-save-all" });
  });

  it("open-dashboard always opens the dashboard, warm or cold", () => {
    expect(commandPlan("open-dashboard", true)).toEqual({ action: "open-dashboard" });
    expect(commandPlan("open-dashboard", false)).toEqual({ action: "open-dashboard" });
  });

  it("an unrecognized command is a no-op", () => {
    expect(commandPlan("some-future-command", true)).toEqual({ action: "noop" });
  });
});

describe("isPendingCommandFresh", () => {
  it("is fresh just under the 15s window (14.9s old)", () => {
    expect(isPendingCommandFresh(100_000, 100_000 + 14_900)).toBe(true);
  });

  it("is stale at exactly 15s and beyond", () => {
    expect(isPendingCommandFresh(100_000, 100_000 + 15_000)).toBe(false);
    expect(isPendingCommandFresh(100_000, 100_000 + 60_000)).toBe(false);
  });

  it("is fresh at zero age", () => {
    expect(isPendingCommandFresh(100_000, 100_000)).toBe(true);
  });

  it("treats a garbage (NaN) timestamp as stale", () => {
    expect(isPendingCommandFresh(NaN, 100_000)).toBe(false);
  });
});

describe("pendingSaveAllFlagValue / parsePendingCommandFlag", () => {
  it("round-trips: the value the background writes parses back to command + ts", () => {
    const value = pendingSaveAllFlagValue(123_456);
    expect(parsePendingCommandFlag(value)).toEqual({ command: PENDING_COMMAND_SAVE_ALL, ts: 123_456 });
  });

  it("returns null for null / empty / cleared values", () => {
    expect(parsePendingCommandFlag(null)).toBeNull();
    expect(parsePendingCommandFlag("")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parsePendingCommandFlag("{not json")).toBeNull();
  });

  it("returns null for JSON without a string command (including the pre-JSON legacy plain string)", () => {
    expect(parsePendingCommandFlag(JSON.stringify({ ts: 1 }))).toBeNull();
    expect(parsePendingCommandFlag(JSON.stringify({ command: 42, ts: 1 }))).toBeNull();
    // The T13 first-pass format was the bare string "save-all" — JSON.parse
    // yields a non-object, which must be rejected, not replayed.
    expect(parsePendingCommandFlag('"save-all"')).toBeNull();
  });

  it("normalizes a missing or non-numeric ts to NaN, which isPendingCommandFresh then treats as stale", () => {
    const missingTs = parsePendingCommandFlag(JSON.stringify({ command: PENDING_COMMAND_SAVE_ALL }));
    expect(missingTs?.command).toBe(PENDING_COMMAND_SAVE_ALL);
    expect(Number.isNaN(missingTs!.ts)).toBe(true);
    expect(isPendingCommandFresh(missingTs!.ts, Date.now())).toBe(false);

    const stringTs = parsePendingCommandFlag(JSON.stringify({ command: PENDING_COMMAND_SAVE_ALL, ts: "soon" }));
    expect(Number.isNaN(stringTs!.ts)).toBe(true);
  });
});

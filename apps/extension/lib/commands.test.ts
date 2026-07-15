import { describe, it, expect } from "vitest";
import { commandPlan } from "./commands";

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

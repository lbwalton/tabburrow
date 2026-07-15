import { describe, it, expect } from "vitest";
import {
  relativeTime,
  restoreFailureMessage,
  shouldOfferCrashRestore,
  snapshotsEqual,
  windowTabCountLabel,
} from "./sessions";

// `captureAllWindows` and `restoreSnapshot` are NOT unit tested here: they're
// the two chrome-calling functions in this file (chrome.windows.getAll,
// chrome.windows.create, chrome.tabs.update), and this package's vitest
// config deliberately does no chrome.* mocking — same precedent as
// lib/restore.ts's openLinks and lib/tabs.ts's getCurrentTab/getAllTabs. The
// pure decisions below ARE test-driven.

describe("snapshotsEqual", () => {
  it("is true for two empty window lists", () => {
    expect(snapshotsEqual([], [])).toBe(true);
  });

  it("is true for identical single-window, single-tab snapshots", () => {
    const a = [{ tabs: [{ url: "https://a.com", title: "A" }] }];
    const b = [{ tabs: [{ url: "https://a.com", title: "A" }] }];
    expect(snapshotsEqual(a, b)).toBe(true);
  });

  it("ignores title differences", () => {
    const a = [{ tabs: [{ url: "https://a.com", title: "Old title" }] }];
    const b = [{ tabs: [{ url: "https://a.com", title: "New title" }] }];
    expect(snapshotsEqual(a, b)).toBe(true);
  });

  it("is false when a url differs", () => {
    const a = [{ tabs: [{ url: "https://a.com", title: "A" }] }];
    const b = [{ tabs: [{ url: "https://b.com", title: "A" }] }];
    expect(snapshotsEqual(a, b)).toBe(false);
  });

  it("is false when pinned state differs", () => {
    const a = [{ tabs: [{ url: "https://a.com", title: "A", pinned: true }] }];
    const b = [{ tabs: [{ url: "https://a.com", title: "A", pinned: false }] }];
    expect(snapshotsEqual(a, b)).toBe(false);
  });

  it("treats an absent pinned field the same as pinned: false", () => {
    const a = [{ tabs: [{ url: "https://a.com", title: "A" }] }];
    const b = [{ tabs: [{ url: "https://a.com", title: "A", pinned: false }] }];
    expect(snapshotsEqual(a, b)).toBe(true);
  });

  it("is false when window count differs", () => {
    const a = [{ tabs: [{ url: "https://a.com", title: "A" }] }];
    const b = [{ tabs: [{ url: "https://a.com", title: "A" }] }, { tabs: [{ url: "https://b.com", title: "B" }] }];
    expect(snapshotsEqual(a, b)).toBe(false);
  });

  it("is false when tab count within a window differs", () => {
    const a = [{ tabs: [{ url: "https://a.com", title: "A" }] }];
    const b = [{ tabs: [{ url: "https://a.com", title: "A" }, { url: "https://b.com", title: "B" }] }];
    expect(snapshotsEqual(a, b)).toBe(false);
  });

  it("is order-sensitive across windows", () => {
    const a = [{ tabs: [{ url: "https://a.com", title: "A" }] }, { tabs: [{ url: "https://b.com", title: "B" }] }];
    const b = [{ tabs: [{ url: "https://b.com", title: "B" }] }, { tabs: [{ url: "https://a.com", title: "A" }] }];
    expect(snapshotsEqual(a, b)).toBe(false);
  });

  it("is order-sensitive across tabs within a window", () => {
    const a = [{ tabs: [{ url: "https://a.com", title: "A" }, { url: "https://b.com", title: "B" }] }];
    const b = [{ tabs: [{ url: "https://b.com", title: "B" }, { url: "https://a.com", title: "A" }] }];
    expect(snapshotsEqual(a, b)).toBe(false);
  });
});

describe("relativeTime", () => {
  const now = Date.UTC(2026, 6, 15, 12, 0, 0); // 2026-07-15T12:00:00Z

  it("labels sub-minute gaps as 'just now'", () => {
    expect(relativeTime(now, now)).toBe("just now");
    expect(relativeTime(now - 30_000, now)).toBe("just now");
  });

  it("labels sub-hour gaps in whole minutes", () => {
    expect(relativeTime(now - 3 * 60_000, now)).toBe("3m ago");
    expect(relativeTime(now - 59 * 60_000, now)).toBe("59m ago");
  });

  it("labels sub-day gaps in whole hours", () => {
    expect(relativeTime(now - 60 * 60_000, now)).toBe("1h ago");
    expect(relativeTime(now - 23 * 60 * 60_000, now)).toBe("23h ago");
  });

  it("labels 1-2 day gaps as 'yesterday'", () => {
    expect(relativeTime(now - 24 * 60 * 60_000, now)).toBe("yesterday");
    expect(relativeTime(now - 47 * 60 * 60_000, now)).toBe("yesterday");
  });

  it("labels 2-7 day gaps in whole days", () => {
    expect(relativeTime(now - 2 * 24 * 60 * 60_000, now)).toBe("2d ago");
    expect(relativeTime(now - 6 * 24 * 60 * 60_000, now)).toBe("6d ago");
  });

  it("falls back to a date string past 7 days", () => {
    const then = Date.UTC(2026, 6, 1, 12, 0, 0); // 2026-07-01, 14 days before `now`
    expect(relativeTime(then, now)).toBe("Jul 1, 2026");
  });

  it("clamps a future `then` (clock skew) to 'just now' instead of a negative label", () => {
    expect(relativeTime(now + 60_000, now)).toBe("just now");
  });
});

describe("shouldOfferCrashRestore", () => {
  it("offers restore when a crash was detected and an auto snapshot exists", () => {
    expect(shouldOfferCrashRestore({ sessionMarkedRunning: true, hasAutoSnapshot: true })).toBe(true);
  });

  it("does not offer when no crash was detected", () => {
    expect(shouldOfferCrashRestore({ sessionMarkedRunning: false, hasAutoSnapshot: true })).toBe(false);
  });

  it("does not offer when a crash was detected but there's no auto snapshot to restore", () => {
    expect(shouldOfferCrashRestore({ sessionMarkedRunning: true, hasAutoSnapshot: false })).toBe(false);
  });

  it("does not offer when neither condition holds", () => {
    expect(shouldOfferCrashRestore({ sessionMarkedRunning: false, hasAutoSnapshot: false })).toBe(false);
  });
});

describe("windowTabCountLabel", () => {
  it("pluralizes both windows and tabs", () => {
    const windows = [
      { tabs: [{ url: "https://a.com", title: "A" }, { url: "https://b.com", title: "B" }] },
      { tabs: [{ url: "https://c.com", title: "C" }] },
    ];
    expect(windowTabCountLabel(windows)).toBe("2 windows · 3 tabs");
  });

  it("uses singular phrasing for exactly one window and one tab", () => {
    expect(windowTabCountLabel([{ tabs: [{ url: "https://a.com", title: "A" }] }])).toBe("1 window · 1 tab");
  });

  it("handles zero windows", () => {
    expect(windowTabCountLabel([])).toBe("0 windows · 0 tabs");
  });
});

describe("restoreFailureMessage", () => {
  it("uses singular phrasing for exactly one failure", () => {
    expect(restoreFailureMessage(1)).toBe("Couldn't restore 1 window.");
  });

  it("pluralizes for more than one failure", () => {
    expect(restoreFailureMessage(3)).toBe("Couldn't restore 3 windows.");
  });
});

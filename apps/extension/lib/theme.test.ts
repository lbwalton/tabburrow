import { describe, it, expect } from "vitest";
import { parseTheme } from "./theme";

// `applyTheme` is NOT unit tested here: it's the one DOM-calling function in
// this file (document.documentElement.setAttribute), and this package's
// vitest config deliberately does no chrome.*/DOM mocking — same precedent
// as lib/tabs.ts's getCurrentTab/getAllTabs. `parseTheme` IS test-driven.

describe("parseTheme", () => {
  it("returns 'paper' for the exact string \"paper\"", () => {
    expect(parseTheme("paper")).toBe("paper");
  });

  it("defaults to 'dark' for null (no meta row yet, e.g. a fresh install)", () => {
    expect(parseTheme(null)).toBe("dark");
  });

  it("defaults to 'dark' for the literal string \"dark\"", () => {
    expect(parseTheme("dark")).toBe("dark");
  });

  it("defaults to 'dark' for any unrecognized value", () => {
    expect(parseTheme("solarized")).toBe("dark");
    expect(parseTheme("")).toBe("dark");
    expect(parseTheme("Paper")).toBe("dark"); // case-sensitive on purpose
  });
});

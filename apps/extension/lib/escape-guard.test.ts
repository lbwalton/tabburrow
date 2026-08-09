import { describe, it, expect } from "vitest";
import { ESCAPE_OWNER_SELECTOR, isTextEntryFocus } from "./escape-guard";

/**
 * These cover the decision that shipped wrong three times. Each block names the
 * real bug it guards, so a future edit that reintroduces one fails with an
 * obvious message rather than a silently vanishing selection.
 */

describe("isTextEntryFocus", () => {
  it("treats a checkbox as NOT text entry — the regression that broke clear-selection", () => {
    // A checkbox is an HTMLInputElement, so a bare `instanceof` check bailed
    // here and Escape stopped clearing the selection right after ticking a box.
    expect(isTextEntryFocus("INPUT", "checkbox")).toBe(false);
  });

  it("treats an <input> with no type as text — the untyped rename fields", () => {
    // Both the popup's folder rename and the rail's collection rename render
    // <Input> with no `type`, which the DOM reports as "text".
    expect(isTextEntryFocus("INPUT", undefined)).toBe(true);
    expect(isTextEntryFocus("INPUT", null)).toBe(true);
    expect(isTextEntryFocus("INPUT", "text")).toBe(true);
  });

  it("covers every allowlisted text-entry type", () => {
    for (const type of ["text", "url", "search", "email", "password", "tel", "number"]) {
      expect(isTextEntryFocus("INPUT", type)).toBe(true);
    }
  });

  it("covers the AddLinkRow fields specifically", () => {
    expect(isTextEntryFocus("INPUT", "url")).toBe(true); // the URL field
    expect(isTextEntryFocus("INPUT", "text")).toBe(true); // the optional title
  });

  it("treats a textarea as text entry regardless of type", () => {
    expect(isTextEntryFocus("TEXTAREA")).toBe(true);
    expect(isTextEntryFocus("TEXTAREA", "anything")).toBe(true);
  });

  it("treats non-text input types as NOT text entry", () => {
    for (const type of ["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"]) {
      expect(isTextEntryFocus("INPUT", type)).toBe(false);
    }
  });

  it("treats non-input elements as NOT text entry", () => {
    for (const tag of ["DIV", "BUTTON", "BODY", "A", "SPAN"]) {
      expect(isTextEntryFocus(tag, "text")).toBe(false);
    }
  });

  it("handles a missing activeElement without throwing", () => {
    // `document.activeElement` can be null; callers pass it through directly.
    expect(isTextEntryFocus(null)).toBe(false);
    expect(isTextEntryFocus(undefined)).toBe(false);
    expect(isTextEntryFocus("")).toBe(false);
  });

  it("is case-insensitive on both tag and type", () => {
    // `tagName` is uppercase in HTML documents but lowercase in XML/XHTML, and
    // a `type` attribute can be authored in any case.
    expect(isTextEntryFocus("input", "TEXT")).toBe(true);
    expect(isTextEntryFocus("input", "checkbox")).toBe(false);
    expect(isTextEntryFocus("textarea")).toBe(true);
  });

  it("falls through to clearing for an unrecognized type (the safe direction)", () => {
    // An allowlist means a future/unknown type is NOT treated as text entry, so
    // the worst case is Escape clearing while an exotic field is focused —
    // rather than an exclusion list, where an unknown type would silently
    // disable clear-selection entirely.
    expect(isTextEntryFocus("INPUT", "some-future-type")).toBe(false);
  });
});

describe("ESCAPE_OWNER_SELECTOR", () => {
  it("matches open native dialogs, role=menu, AND role=dialog", () => {
    // The role="dialog" clause is the one that was missing originally:
    // AccentPicker is a plain <div role="dialog">, not a native <dialog>, so a
    // `dialog[open]`-only selector never saw it and Escape wiped the selection
    // while merely dismissing the colour picker.
    expect(ESCAPE_OWNER_SELECTOR).toContain("dialog[open]");
    expect(ESCAPE_OWNER_SELECTOR).toContain("[role='menu']");
    expect(ESCAPE_OWNER_SELECTOR).toContain("[role='dialog']");
  });

  it("is a valid selector list", () => {
    expect(ESCAPE_OWNER_SELECTOR.split(",").map((s) => s.trim())).toHaveLength(3);
  });
});

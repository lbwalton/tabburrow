import { describe, it, expect } from "vitest";
import { clickIntent, keyIntent } from "./click-intent";

describe("clickIntent", () => {
  it("resolves a plain click (no modifiers) to open", () => {
    expect(clickIntent({})).toBe("open");
  });

  it("resolves a plain click with the primary button to open", () => {
    expect(clickIntent({ button: 0 })).toBe("open");
  });

  it("resolves a cmd-click (metaKey) to toggle", () => {
    expect(clickIntent({ metaKey: true })).toBe("toggle");
  });

  it("resolves a ctrl-click to toggle", () => {
    expect(clickIntent({ ctrlKey: true })).toBe("toggle");
  });

  it("resolves a shift-click to range", () => {
    expect(clickIntent({ shiftKey: true })).toBe("range");
  });

  it("shift wins when both shift and meta/ctrl are held", () => {
    expect(clickIntent({ shiftKey: true, metaKey: true })).toBe("range");
    expect(clickIntent({ shiftKey: true, ctrlKey: true })).toBe("range");
  });
});

describe("keyIntent", () => {
  it("resolves Enter to open", () => {
    expect(keyIntent("Enter")).toBe("open");
  });

  it("resolves Space to toggle", () => {
    expect(keyIntent(" ")).toBe("toggle");
  });

  it("resolves any other key to null (LinkCard ignores it)", () => {
    expect(keyIntent("Escape")).toBeNull();
    expect(keyIntent("Tab")).toBeNull();
    expect(keyIntent("a")).toBeNull();
    expect(keyIntent("Spacebar")).toBeNull(); // legacy IE-style key name, not " " — must not match
  });
});

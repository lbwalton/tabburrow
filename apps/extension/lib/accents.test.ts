import { describe, it, expect } from "vitest";
import { ACCENT_EMOJIS, accentColor, accentPalette, isCssColorAccent } from "./accents";

describe("accentPalette", () => {
  it("has exactly 8 swatches with unique ids", () => {
    const palette = accentPalette();
    expect(palette).toHaveLength(8);
    expect(new Set(palette.map((s) => s.id)).size).toBe(8);
  });

  it("includes both brand accents", () => {
    const values = accentPalette().map((s) => s.value);
    expect(values).toContain("var(--accent)");
    expect(values).toContain("var(--accent-2)");
  });

  it("derives every swatch from token vars only, never a new hex literal", () => {
    for (const swatch of accentPalette()) {
      expect(swatch.value).not.toMatch(/#[0-9a-fA-F]{3,8}/);
      expect(swatch.value.startsWith("var(") || swatch.value.startsWith("color-mix(")).toBe(true);
    }
  });

  it("every color-mix() swatch only references accent/accent-2/muted/text tokens", () => {
    const allowed = ["--accent)", "--accent-2)", "--accent-2 ", "--accent ", "--muted", "--text"];
    for (const swatch of accentPalette()) {
      if (!swatch.value.startsWith("color-mix(")) continue;
      const usesOnlyAllowedTokens = allowed.some((token) => swatch.value.includes(token));
      expect(usesOnlyAllowedTokens).toBe(true);
    }
  });
});

describe("ACCENT_EMOJIS", () => {
  it("is a curated set of 6 emoji", () => {
    expect(ACCENT_EMOJIS).toHaveLength(6);
    expect(new Set(ACCENT_EMOJIS).size).toBe(6);
  });
});

describe("isCssColorAccent", () => {
  it("recognizes token var() and color-mix() expressions as color accents", () => {
    expect(isCssColorAccent("var(--accent)")).toBe(true);
    expect(isCssColorAccent("color-mix(in srgb, var(--accent) 50%, var(--accent-2) 50%)")).toBe(true);
  });

  it("recognizes a legacy hex accent as a color accent", () => {
    expect(isCssColorAccent("#F97316")).toBe(true);
  });

  it("treats an emoji/text accent as not a color accent", () => {
    expect(isCssColorAccent("\u{1F5C2}\u{FE0F}")).toBe(false);
    expect(isCssColorAccent("My Label")).toBe(false);
  });
});

describe("accentColor", () => {
  it("returns a token color accent unchanged", () => {
    expect(accentColor("var(--accent-2)")).toBe("var(--accent-2)");
  });

  it("returns a color-mix() accent unchanged", () => {
    const mix = "color-mix(in srgb, var(--accent) 65%, var(--muted) 35%)";
    expect(accentColor(mix)).toBe(mix);
  });

  it("returns a legacy hex accent unchanged", () => {
    expect(accentColor("#F97316")).toBe("#F97316");
  });

  it("falls back to the brand accent for an emoji accent", () => {
    expect(accentColor("\u{1F5C2}\u{FE0F}")).toBe("var(--accent)");
  });

  it("falls back to the brand accent when the accent is unset", () => {
    expect(accentColor(null)).toBe("var(--accent)");
  });

  it("never returns a bare color name or an empty string", () => {
    for (const input of [null, "", "My Label", "\u{1F4DA}"]) {
      expect(accentColor(input)).toBe("var(--accent)");
    }
  });
});

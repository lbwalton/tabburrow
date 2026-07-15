import { describe, it, expect } from "vitest";
import { positionBetween, firstPosition, ALPHABET } from "../src/fractional-index";

/** Asserts k is strictly between a and b using plain JS string comparison. */
function expectBetween(k: string, a: string | null, b: string | null) {
  if (a !== null) expect(k > a).toBe(true);
  if (b !== null) expect(k < b).toBe(true);
}

describe("firstPosition", () => {
  it("returns the same value as positionBetween(null, null)", () => {
    expect(firstPosition()).toBe(positionBetween(null, null));
  });

  it("returns a non-empty key that does not end in the alphabet's first character", () => {
    const key = firstPosition();
    expect(key.length).toBeGreaterThan(0);
    expect(key.endsWith(ALPHABET[0]!)).toBe(false);
  });
});

describe("positionBetween", () => {
  it("returns a mid key when both bounds are open (null, null)", () => {
    const key = positionBetween(null, null);
    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThan(0);
  });

  it("positionBetween(null, 'V') is less than 'V'", () => {
    const key = positionBetween(null, "V");
    expectBetween(key, null, "V");
  });

  it("positionBetween('V', null) is greater than 'V'", () => {
    const key = positionBetween("V", null);
    expectBetween(key, "V", null);
  });

  it("between adjacent keys 'a' and 'b' forces suffix extension (e.g. 'aV')", () => {
    const key = positionBetween("a", "b");
    expectBetween(key, "a", "b");
    expect(key.length).toBeGreaterThan(1);
    expect(key).toBe("aV");
  });

  it("between same-prefix adjacent keys 'a' and 'a1' still produces a valid midpoint", () => {
    const key = positionBetween("a", "a1");
    expectBetween(key, "a", "a1");
    expect(key.startsWith("a")).toBe(true);
  });

  it("never returns a key ending in the alphabet's first character", () => {
    const cases: Array<[string | null, string | null]> = [
      [null, null],
      [null, "V"],
      ["V", null],
      ["a", "b"],
      ["a", "a1"],
      ["A", "AB"],
    ];
    for (const [a, b] of cases) {
      const key = positionBetween(a, b);
      expect(key.endsWith(ALPHABET[0]!)).toBe(false);
    }
  });

  it("throws when a >= b", () => {
    expect(() => positionBetween("b", "a")).toThrow();
    expect(() => positionBetween("a", "a")).toThrow();
  });

  it("throws on empty string input", () => {
    expect(() => positionBetween("", "V")).toThrow();
    expect(() => positionBetween("V", "")).toThrow();
  });

  it("throws on characters outside the alphabet", () => {
    expect(() => positionBetween("a!", "b")).toThrow();
    expect(() => positionBetween("a", "b-")).toThrow();
    expect(() => positionBetween(" a", "b")).toThrow();
  });

  it("throws rather than silently violating the bound when the upper neighbor ends in the forbidden trailing zero", () => {
    // No non-empty key can ever sort strictly before "0" (it would have to be
    // a proper extension of "0", e.g. "0V", which sorts *after* "0", not
    // before it). Our own generator never produces such a neighbor, but if
    // one is ever passed in, we must fail loudly instead of returning a key
    // that is not actually less than b.
    expect(() => positionBetween(null, "0")).toThrow();
  });

  it("1000 sequential inserts at the end stay ordered and keys stay under 40 chars", () => {
    let prev = firstPosition();
    const keys = [prev];
    for (let i = 0; i < 1000; i++) {
      const next = positionBetween(prev, null);
      expect(next > prev).toBe(true);
      expect(next.length).toBeLessThan(40);
      keys.push(next);
      prev = next;
    }
    // Ordering holds across the whole sequence, and every key is unique.
    for (let i = 1; i < keys.length; i++) {
      expect(keys[i]! > keys[i - 1]!).toBe(true);
    }
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("500 random midpoint insertions into a sorted list keep it sorted with unique keys", () => {
    const list: string[] = [];
    for (let iter = 0; iter < 500; iter++) {
      const index = Math.floor(Math.random() * (list.length + 1));
      const a = index > 0 ? list[index - 1]! : null;
      const b = index < list.length ? list[index]! : null;
      const key = positionBetween(a, b);
      list.splice(index, 0, key);
    }

    expect(list.length).toBe(500);
    for (let i = 1; i < list.length; i++) {
      expect(list[i]! > list[i - 1]!).toBe(true);
    }
    expect(new Set(list).size).toBe(list.length);
  });
});

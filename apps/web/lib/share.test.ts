import { describe, expect, it } from "vitest";
import {
  faviconHost,
  isCssColorAccent,
  isValidShareSlug,
  resolveFaviconSrc,
  sortByPosition,
  truncate,
} from "./share";

describe("isValidShareSlug", () => {
  it("accepts a 10-char lowercase alphanumeric slug", () => {
    expect(isValidShareSlug("ab3xy09z1q")).toBe(true);
    expect(isValidShareSlug("0000000000")).toBe(true);
    expect(isValidShareSlug("zzzzzzzzzz")).toBe(true);
  });

  it("rejects the wrong length", () => {
    expect(isValidShareSlug("short")).toBe(false);
    expect(isValidShareSlug("ab3xy09z1qq")).toBe(false);
    expect(isValidShareSlug("")).toBe(false);
  });

  it("rejects uppercase characters", () => {
    expect(isValidShareSlug("Ab3xy09z1q")).toBe(false);
  });

  it("rejects punctuation, whitespace, and path-like input", () => {
    expect(isValidShareSlug("ab3xy09z-q")).toBe(false);
    expect(isValidShareSlug("ab3xy09z q")).toBe(false);
    expect(isValidShareSlug("../../etc")).toBe(false);
    expect(isValidShareSlug("ab3xy09z1q/extra")).toBe(false);
  });
});

describe("sortByPosition", () => {
  it("sorts base-62 position keys in ASCII order (digits < uppercase < lowercase)", () => {
    const rows = [{ position: "b" }, { position: "9" }, { position: "A" }, { position: "0" }];
    expect(sortByPosition(rows).map((r) => r.position)).toEqual(["0", "9", "A", "b"]);
  });

  it("sorts unequal-length keys lexicographically, not by length", () => {
    const rows = [{ position: "V1" }, { position: "V" }, { position: "V0z" }];
    expect(sortByPosition(rows).map((r) => r.position)).toEqual(["V", "V0z", "V1"]);
  });

  it("does not mutate the input array", () => {
    const rows = [{ position: "b" }, { position: "a" }];
    const sorted = sortByPosition(rows);
    expect(rows.map((r) => r.position)).toEqual(["b", "a"]);
    expect(sorted).not.toBe(rows);
  });

  it("preserves extra fields on each row", () => {
    const rows = [
      { position: "b", url: "https://b.example" },
      { position: "a", url: "https://a.example" },
    ];
    expect(sortByPosition(rows).map((r) => r.url)).toEqual(["https://a.example", "https://b.example"]);
  });
});

describe("faviconHost", () => {
  it("extracts the hostname from a well-formed URL", () => {
    expect(faviconHost("https://www.example.com/path?x=1")).toBe("www.example.com");
    expect(faviconHost("http://sub.domain.co.uk/")).toBe("sub.domain.co.uk");
  });

  it("returns null for an unparseable URL", () => {
    expect(faviconHost("not a url")).toBe(null);
    expect(faviconHost("")).toBe(null);
  });
});

describe("resolveFaviconSrc", () => {
  it("prefers a stored favicon URL over the s2 fallback", () => {
    const src = resolveFaviconSrc({
      url: "https://example.com",
      faviconUrl: "https://cdn.example.com/icon.png",
    });
    expect(src).toBe("https://cdn.example.com/icon.png");
  });

  it("falls back to Google's s2 favicon service keyed by hostname", () => {
    const src = resolveFaviconSrc({ url: "https://www.example.com/path", faviconUrl: null });
    expect(src).toBe("https://www.google.com/s2/favicons?domain=www.example.com&sz=32");
  });

  it("returns null when there is neither a stored favicon nor a parseable host", () => {
    expect(resolveFaviconSrc({ url: "not a url", faviconUrl: null })).toBe(null);
  });
});

describe("truncate", () => {
  it("returns short text unchanged", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("returns text at exactly the limit unchanged", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });

  it("truncates and appends an ellipsis, keeping the total length at maxLength", () => {
    const result = truncate("this is a long collection name", 10);
    expect(result).toBe("this is a…");
    expect(result.length).toBe(10);
  });
});

describe("isCssColorAccent", () => {
  it("recognizes token var() and color-mix() expressions and hex literals", () => {
    expect(isCssColorAccent("var(--accent)")).toBe(true);
    expect(isCssColorAccent("color-mix(in srgb, var(--accent) 65%, var(--muted) 35%)")).toBe(true);
    expect(isCssColorAccent("#F97316")).toBe(true);
  });

  it("treats an emoji glyph as not a CSS color", () => {
    expect(isCssColorAccent("\u{1F4DA}")).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { formatHost, parseSortMode, parseTags, sortLinksForView, sortMetaKey } from "./links";

describe("parseSortMode", () => {
  it("passes through a valid stored mode", () => {
    expect(parseSortMode("name")).toBe("name");
    expect(parseSortMode("date")).toBe("date");
    expect(parseSortMode("manual")).toBe("manual");
  });

  it("defaults to manual for null, undefined, or garbage", () => {
    expect(parseSortMode(null)).toBe("manual");
    expect(parseSortMode(undefined)).toBe("manual");
    expect(parseSortMode("alphabetical")).toBe("manual");
    expect(parseSortMode("")).toBe("manual");
  });
});

describe("sortMetaKey", () => {
  it("namespaces the meta key by collection id", () => {
    expect(sortMetaKey("abc-123")).toBe("sort:abc-123");
  });
});

describe("parseTags", () => {
  it("splits on commas, trims, and lowercases", () => {
    expect(parseTags("Work, Reading , URGENT")).toEqual(["work", "reading", "urgent"]);
  });

  it("drops empty entries from stray commas", () => {
    expect(parseTags("a,, b,")).toEqual(["a", "b"]);
  });

  it("dedupes, keeping the first occurrence's position", () => {
    expect(parseTags("work, Work, WORK, life")).toEqual(["work", "life"]);
  });

  it("returns an empty array for blank input", () => {
    expect(parseTags("")).toEqual([]);
    expect(parseTags("   ")).toEqual([]);
  });
});

describe("formatHost", () => {
  it("lowercases the hostname", () => {
    expect(formatHost("https://Example.COM/path")).toBe("example.com");
  });

  it("strips a leading www.", () => {
    expect(formatHost("https://www.example.com/x")).toBe("example.com");
  });

  it("does not strip www. from the middle of a hostname", () => {
    expect(formatHost("https://notwww.example.com")).toBe("notwww.example.com");
  });

  it("falls back to the lowercased raw input for an unparseable URL", () => {
    expect(formatHost("Not A URL")).toBe("not a url");
  });
});

describe("sortLinksForView", () => {
  const links = [
    { title: "Banana", createdAt: 100 },
    { title: "apple", createdAt: 300 },
    { title: "Cherry", createdAt: 200 },
  ];

  it("manual mode is a no-op (same reference)", () => {
    expect(sortLinksForView(links, "manual")).toBe(links);
  });

  it("name mode sorts case-insensitively", () => {
    expect(sortLinksForView(links, "name").map((l) => l.title)).toEqual(["apple", "Banana", "Cherry"]);
  });

  it("date mode sorts newest first", () => {
    expect(sortLinksForView(links, "date").map((l) => l.createdAt)).toEqual([300, 200, 100]);
  });

  it("does not mutate the input array", () => {
    const copy = [...links];
    sortLinksForView(links, "name");
    expect(links).toEqual(copy);
  });
});

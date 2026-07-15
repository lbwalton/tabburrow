import { describe, it, expect } from "vitest";
import { isHttpUrl, titleForTab, toTabInfo, filterTabs } from "./tabs";

describe("isHttpUrl", () => {
  it("accepts http and https URLs", () => {
    expect(isHttpUrl("http://example.com")).toBe(true);
    expect(isHttpUrl("https://example.com/path?q=1")).toBe(true);
  });

  it("rejects chrome://, file://, extension pages, and undefined", () => {
    expect(isHttpUrl("chrome://extensions")).toBe(false);
    expect(isHttpUrl("chrome-extension://abc123/popup.html")).toBe(false);
    expect(isHttpUrl("file:///Users/me/notes.txt")).toBe(false);
    expect(isHttpUrl("about:blank")).toBe(false);
    expect(isHttpUrl(undefined)).toBe(false);
    expect(isHttpUrl("")).toBe(false);
  });

  it("rejects malformed URLs instead of throwing", () => {
    expect(isHttpUrl("not a url")).toBe(false);
  });
});

describe("titleForTab", () => {
  it("returns the title when present", () => {
    expect(titleForTab({ title: "Example Site", url: "https://example.com" })).toBe("Example Site");
  });

  it("falls back to the URL's hostname when title is missing (discarded tabs)", () => {
    expect(titleForTab({ url: "https://example.com/deep/path" })).toBe("example.com");
  });

  it("falls back to an empty title's URL, not the empty string, when title is empty", () => {
    expect(titleForTab({ title: "", url: "https://example.com" })).toBe("example.com");
  });

  it("returns the raw url when it cannot be parsed as a hostname", () => {
    expect(titleForTab({ url: "not a url" })).toBe("not a url");
  });

  it("returns empty string when neither title nor url is present", () => {
    expect(titleForTab({})).toBe("");
  });
});

describe("toTabInfo", () => {
  it("maps url + resolved title, no chrome.* calls", () => {
    expect(toTabInfo({ title: "Hi", url: "https://a.com" })).toEqual({ url: "https://a.com", title: "Hi" });
  });

  it("uses hostname fallback for a discarded tab with no title", () => {
    expect(toTabInfo({ url: "https://a.com/x" })).toEqual({ url: "https://a.com/x", title: "a.com" });
  });
});

describe("filterTabs", () => {
  it("keeps only http(s) tabs and preserves input order", () => {
    const tabs = [
      { title: "A", url: "https://a.com" },
      { title: "Settings", url: "chrome://settings" },
      { title: "B", url: "http://b.com" },
      { title: "New Tab", url: "chrome://newtab" },
    ];
    expect(filterTabs(tabs)).toEqual([
      { url: "https://a.com", title: "A" },
      { url: "http://b.com", title: "B" },
    ]);
  });

  it("applies the title fallback to surviving http(s) tabs", () => {
    const tabs = [{ url: "https://discarded.example.com" }];
    expect(filterTabs(tabs)).toEqual([{ url: "https://discarded.example.com", title: "discarded.example.com" }]);
  });

  it("returns an empty array for an empty or all-non-http input", () => {
    expect(filterTabs([])).toEqual([]);
    expect(filterTabs([{ url: "chrome://extensions" }])).toEqual([]);
  });
});

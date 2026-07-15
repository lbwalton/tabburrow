// @vitest-environment happy-dom
//
// Only `planFromBookmarksDocument`/`parseChromeBookmarksHtml` need a real
// DOMParser — this whole file opts into the happy-dom environment (a
// per-file override; every other lib/*.test.ts stays on vitest's default
// "node" environment, no chrome.*/DOM mocking) since Vitest environments are
// set per file, not per describe block.
import { describe, it, expect } from "vitest";
import {
  formatImportResult,
  parseBurrowJson,
  parseChromeBookmarksHtml,
  parseTobyJson,
} from "./importers";

// `importChromeBookmarksHtml`/`importTobyJson`/`importBurrowJson` (the IO
// wrappers) and `applyImportPlan` are NOT unit tested here: they're the
// DB-calling half of each importer (createCollection/saveTabs/importData),
// consistent with this package's "pure lib/ functions only" test
// convention. The parsing cores above ARE test-driven.

describe("parseChromeBookmarksHtml / planFromBookmarksDocument", () => {
  // A realistic Netscape bookmarks export: unclosed <DT>/<p> throughout
  // (real Chrome exports are literally this malformed), one folderless
  // top-level bookmark, a non-http `javascript:` bookmark, a two-level-deep
  // nested folder, and a folder with no bookmarks of its own.
  const fixture = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><A HREF="https://toplevel.example.com/">Top-level bookmark</A>
    <DT><A HREF="javascript:alert(1)">Bad scheme bookmark</A>
    <DT><A HREF="place:type=6&sort=14">Firefox smart folder</A>
    <DT><H3 ADD_DATE="1" LAST_MODIFIED="2">Work</H3>
    <DL><p>
        <DT><A HREF="https://work.example.com/a">Work A</A>
        <DT><A HREF="https://work.example.com/b">Work B</A>
        <DT><H3>Projects</H3>
        <DL><p>
            <DT><A HREF="https://work.example.com/project1">Project One</A>
        </DL><p>
    </DL><p>
    <DT><H3>Empty Folder</H3>
    <DL><p>
    </DL><p>
</DL><p>
`;

  it("puts folderless bookmarks into an 'Imported bookmarks' collection", () => {
    const plan = parseChromeBookmarksHtml(fixture);
    const imported = plan.collections.find((c) => c.name === "Imported bookmarks");
    expect(imported?.links).toEqual([{ url: "https://toplevel.example.com/", title: "Top-level bookmark" }]);
  });

  it("drops non-http(s) schemes (javascript:, place:, etc.)", () => {
    const plan = parseChromeBookmarksHtml(fixture);
    const allUrls = plan.collections.flatMap((c) => c.links.map((l) => l.url));
    expect(allUrls).not.toContain("javascript:alert(1)");
    expect(allUrls).not.toContain("place:type=6&sort=14");
  });

  it("maps a top-level folder to a collection of the same name", () => {
    const plan = parseChromeBookmarksHtml(fixture);
    const work = plan.collections.find((c) => c.name === "Work");
    expect(work?.links).toEqual([
      { url: "https://work.example.com/a", title: "Work A" },
      { url: "https://work.example.com/b", title: "Work B" },
    ]);
  });

  it("flattens a nested folder to 'Parent / Child'", () => {
    const plan = parseChromeBookmarksHtml(fixture);
    const nested = plan.collections.find((c) => c.name === "Work / Projects");
    expect(nested?.links).toEqual([{ url: "https://work.example.com/project1", title: "Project One" }]);
  });

  it("creates no collection for a folder with zero direct links", () => {
    const plan = parseChromeBookmarksHtml(fixture);
    expect(plan.collections.find((c) => c.name === "Empty Folder")).toBeUndefined();
  });

  it("produces exactly the four non-empty collections, in document order", () => {
    const plan = parseChromeBookmarksHtml(fixture);
    expect(plan.collections.map((c) => c.name)).toEqual(["Imported bookmarks", "Work", "Work / Projects"]);
  });

  it("falls back to the href when a bookmark's link text is empty", () => {
    const html = `<DL><p><DT><A HREF="https://a.com"></A></DL><p>`;
    const plan = parseChromeBookmarksHtml(html);
    expect(plan.collections[0]!.links).toEqual([{ url: "https://a.com", title: "https://a.com" }]);
  });

  it("returns an empty plan for a document with no <dl> at all", () => {
    expect(parseChromeBookmarksHtml("<html><body>not bookmarks</body></html>")).toEqual({ collections: [] });
  });

  it("returns an empty plan for an entirely empty bookmarks file", () => {
    expect(parseChromeBookmarksHtml(`<DL><p></DL><p>`)).toEqual({ collections: [] });
  });
});

describe("parseTobyJson", () => {
  it("maps one collection per list, preserving order", () => {
    const json = JSON.stringify({
      lists: [
        { title: "Reading", cards: [{ title: "Article", url: "https://a.com" }] },
        { title: "Tools", cards: [{ title: "Tool", url: "https://b.com" }] },
      ],
    });
    expect(parseTobyJson(json).collections.map((c) => c.name)).toEqual(["Reading", "Tools"]);
  });

  it("falls back to 'Imported list' for a missing or blank title", () => {
    const json = JSON.stringify({ lists: [{ cards: [] }, { title: "  ", cards: [] }] });
    const plan = parseTobyJson(json);
    expect(plan.collections.map((c) => c.name)).toEqual(["Imported list", "Imported list"]);
  });

  it("maps card title/url onto plan links, falling back to the url when a card title is missing", () => {
    const json = JSON.stringify({
      lists: [{ title: "L", cards: [{ url: "https://a.com" }, { title: "B", url: "https://b.com" }] }],
    });
    expect(parseTobyJson(json).collections[0]!.links).toEqual([
      { url: "https://a.com", title: "https://a.com" },
      { url: "https://b.com", title: "B" },
    ]);
  });

  it("drops cards with a non-http(s) or missing url", () => {
    const json = JSON.stringify({
      lists: [{ title: "L", cards: [{ title: "Bad", url: "chrome://extensions" }, { title: "No url" }] }],
    });
    expect(parseTobyJson(json).collections[0]!.links).toEqual([]);
  });

  it("tolerates a list with no cards array at all", () => {
    const json = JSON.stringify({ lists: [{ title: "Empty" }] });
    expect(parseTobyJson(json).collections).toEqual([{ name: "Empty", links: [] }]);
  });

  it("throws a clear error on invalid JSON", () => {
    expect(() => parseTobyJson("{not json")).toThrow(/valid JSON/);
  });

  it("throws a clear error when \"lists\" is missing (not a Toby export)", () => {
    expect(() => parseTobyJson(JSON.stringify({ foo: "bar" }))).toThrow(/Toby export/);
    expect(() => parseTobyJson(JSON.stringify({ lists: "not an array" }))).toThrow(/Toby export/);
  });
});

describe("parseBurrowJson", () => {
  const validExport = JSON.stringify({
    version: 1,
    exportedAt: 123,
    collections: [{ id: "c1" }],
    links: [{ id: "l1" }],
    sessions: [{ id: "s1" }],
  });

  it("returns collections/links/sessions from a valid version-1 export", () => {
    expect(parseBurrowJson(validExport)).toEqual({
      collections: [{ id: "c1" }],
      links: [{ id: "l1" }],
      sessions: [{ id: "s1" }],
    });
  });

  it("throws a clear error on invalid JSON", () => {
    expect(() => parseBurrowJson("{not json")).toThrow(/valid JSON/);
  });

  it("rejects a non-1 version with a clear error naming the version", () => {
    const v2 = JSON.stringify({ version: 2, collections: [], links: [], sessions: [] });
    expect(() => parseBurrowJson(v2)).toThrow(/version "2"/);
  });

  it("rejects a payload with a missing version", () => {
    const noVersion = JSON.stringify({ collections: [], links: [], sessions: [] });
    expect(() => parseBurrowJson(noVersion)).toThrow(/version/);
  });

  it("rejects a payload missing collections/links/sessions arrays", () => {
    expect(() => parseBurrowJson(JSON.stringify({ version: 1 }))).toThrow(/TabBurrow export/);
  });
});

describe("formatImportResult", () => {
  it("pluralizes both counts", () => {
    expect(formatImportResult("Chrome bookmarks", { collections: 3, links: 12 })).toBe(
      "Imported 3 collections, 12 links from Chrome bookmarks.",
    );
  });

  it("uses singular phrasing for exactly one of each", () => {
    expect(formatImportResult("Toby JSON", { collections: 1, links: 1 })).toBe(
      "Imported 1 collection, 1 link from Toby JSON.",
    );
  });
});

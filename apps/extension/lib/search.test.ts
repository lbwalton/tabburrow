import { describe, it, expect } from "vitest";
import type { Collection, Link } from "@tabburrow/core";
import { MAX_SEARCH_RESULTS, rankSearch } from "./search";

function coll(id: string, name: string): Collection {
  return {
    id,
    name,
    accent: null,
    position: id,
    isShared: false,
    shareSlug: null,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
  };
}

function link(
  id: string,
  title: string,
  url: string,
  opts: Partial<{ tags: string[]; collectionName: string }> = {},
): Link & { collectionName: string } {
  return {
    id,
    collectionId: "c1",
    url,
    title,
    faviconUrl: null,
    note: null,
    tags: opts.tags ?? [],
    position: id,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    collectionName: opts.collectionName ?? "Collection",
  };
}

describe("rankSearch", () => {
  it("returns empty results for an empty query", () => {
    expect(rankSearch([coll("a", "Work")], [link("l1", "Anything", "https://x.com")], "")).toEqual({
      collections: [],
      links: [],
    });
  });

  it("returns empty results for a whitespace-only query", () => {
    expect(rankSearch([coll("a", "Work")], [], "   ")).toEqual({ collections: [], links: [] });
  });

  it("AC1: fuzzy-matches a link by title ('gthb' finds a GitHub link)", () => {
    const gh = link("l1", "GitHub - tabburrow", "https://github.com/x/tabburrow");
    const result = rankSearch([], [gh], "gthb");
    expect(result.links.map((l) => l.id)).toEqual(["l1"]);
  });

  it("fuzzy-matches a collection by name", () => {
    const work = coll("c1", "Work Tabs");
    const result = rankSearch([work], [], "wrktb");
    expect(result.collections.map((c) => c.id)).toEqual(["c1"]);
  });

  it("matches a link by url when the title doesn't match", () => {
    const l = link("l1", "Unrelated Title Here", "https://example.com/gthb-page");
    const result = rankSearch([], [l], "gthb");
    expect(result.links.map((x) => x.id)).toEqual(["l1"]);
  });

  it("matches a link by tag when neither title nor url match", () => {
    const l = link("l1", "Some Page", "https://example.com/abc", { tags: ["gthb-notes"] });
    const result = rankSearch([], [l], "gthb");
    expect(result.links.map((x) => x.id)).toEqual(["l1"]);
  });

  it("excludes a link that matches none of title/url/tags", () => {
    const l = link("l1", "Totally Unrelated", "https://nope.example/zzz", { tags: ["nope"] });
    const result = rankSearch([], [l], "gthb");
    expect(result.links).toEqual([]);
  });

  it("excludes a collection whose name doesn't match", () => {
    const c = coll("c1", "Totally Unrelated");
    expect(rankSearch([c], [], "gthb").collections).toEqual([]);
  });

  it("weights a title match above a url match with an identical raw fuzzysort score", () => {
    // The same literal string used as one link's TITLE and another's URL
    // guarantees fuzzysort produces the identical raw score for both
    // against the same query — isolating the weighting multiplier as the
    // only variable, instead of depending on fuzzysort's exact scoring of
    // two different strings (which would be a fragile assertion on the
    // library's internals). The leading "zqx" (absent from the "unrelated"
    // filler text below) guarantees fuzzysort can't accidentally match the
    // OTHER field on each link too.
    const shared = "zqxwidgetportal";
    const titleMatchLink = link("title-match", shared, "https://unrelated.example/aaa");
    const urlMatchLink = link("url-match", "Totally Unrelated Name", shared);
    const result = rankSearch([], [urlMatchLink, titleMatchLink], shared);
    expect(result.links.map((l) => l.id)).toEqual(["title-match", "url-match"]);
  });

  it("weights a title match above a tag match with an identical raw fuzzysort score", () => {
    const shared = "zqxlongtoken";
    const titleMatchLink = link("title-match", shared, "https://unrelated.example/aaa");
    const tagMatchLink = link("tag-match", "Totally Unrelated Name", "https://unrelated.example/bbb", {
      tags: [shared],
    });
    const result = rankSearch([], [tagMatchLink, titleMatchLink], shared);
    expect(result.links.map((l) => l.id)).toEqual(["title-match", "tag-match"]);
  });

  it("caps combined collection+link matches at MAX_SEARCH_RESULTS total", () => {
    const collections = Array.from({ length: 12 }, (_, i) => coll(`c${i}`, `Widget Collection ${i}`));
    const links = Array.from({ length: 15 }, (_, i) => link(`l${i}`, `Widget Link ${i}`, `https://x.com/${i}`));
    const result = rankSearch(collections, links, "widget");
    expect(result.collections.length + result.links.length).toBe(MAX_SEARCH_RESULTS);
    expect(MAX_SEARCH_RESULTS).toBe(20);
  });

  it("ranks collections and links on one shared scale — a weak collection can lose its cap slot to stronger links", () => {
    const weakCollection = coll("c-weak", "somewhat related zqx exact match text"); // loose subsequence match, lower score
    const strongLinks = Array.from({ length: 20 }, (_, i) => link(`l${i}`, "zqxexactmatch", `https://x.com/${i}`)); // exact-string match, score 1.0
    const result = rankSearch([weakCollection], strongLinks, "zqxexactmatch");
    expect(result.collections).toEqual([]); // lost its spot: 20 stronger links already fill the cap
    expect(result.links.length).toBe(MAX_SEARCH_RESULTS);
  });

  it("keeps stable original-order tie-breaking for equal scores", () => {
    // Two collections with the exact same name -> identical fuzzysort score
    // for any query; original array order (a before b) must survive.
    const a = coll("a", "Same Name");
    const b = coll("b", "Same Name");
    const result = rankSearch([a, b], [], "same");
    expect(result.collections.map((c) => c.id)).toEqual(["a", "b"]);
  });
});

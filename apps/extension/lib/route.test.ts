import { describe, it, expect } from "vitest";
import { parseHash, resolveRoute } from "./route";

describe("parseHash", () => {
  it("parses a collection route", () => {
    expect(parseHash("#/c/abc-123")).toEqual({ kind: "collection", id: "abc-123" });
  });

  it("parses sessions and settings routes", () => {
    expect(parseHash("#/sessions")).toEqual({ kind: "sessions" });
    expect(parseHash("#/settings")).toEqual({ kind: "settings" });
  });

  it("treats an empty, root, or unrecognized hash as root", () => {
    expect(parseHash("")).toEqual({ kind: "root" });
    expect(parseHash("#")).toEqual({ kind: "root" });
    expect(parseHash("#/")).toEqual({ kind: "root" });
    expect(parseHash("#/nope")).toEqual({ kind: "root" });
  });

  it("treats a collection route with no id as root", () => {
    expect(parseHash("#/c/")).toEqual({ kind: "root" });
  });

  it("percent-decodes the collection id", () => {
    expect(parseHash("#/c/abc%20123")).toEqual({ kind: "collection", id: "abc 123" });
  });

  it("works without a leading #", () => {
    expect(parseHash("/c/abc-123")).toEqual({ kind: "collection", id: "abc-123" });
  });
});

describe("resolveRoute", () => {
  const ids = ["a", "b", "c"];

  it("passes sessions/settings through untouched", () => {
    expect(resolveRoute({ kind: "sessions" }, ids)).toEqual({ kind: "sessions" });
    expect(resolveRoute({ kind: "settings" }, ids)).toEqual({ kind: "settings" });
  });

  it("resolves a known collection id as-is", () => {
    expect(resolveRoute({ kind: "collection", id: "b" }, ids)).toEqual({ kind: "collection", id: "b" });
  });

  it("resolves an unknown collection id to not-found with the first collection as fallback", () => {
    expect(resolveRoute({ kind: "collection", id: "zzz" }, ids)).toEqual({ kind: "not-found", fallbackId: "a" });
  });

  it("resolves an unknown collection id with no fallback when there are no collections at all", () => {
    expect(resolveRoute({ kind: "collection", id: "zzz" }, [])).toEqual({ kind: "not-found", fallbackId: null });
  });

  it("resolves root to the first collection when any exist", () => {
    expect(resolveRoute({ kind: "root" }, ids)).toEqual({ kind: "collection", id: "a" });
  });

  it("resolves root to empty when there are no collections", () => {
    expect(resolveRoute({ kind: "root" }, [])).toEqual({ kind: "empty" });
  });
});

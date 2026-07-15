import { describe, it, expect, vi, afterEach } from "vitest";
import { buildExport, exportFilename, formatDataStats } from "./exporter";

// `exportJson` and `downloadBlob` are NOT unit tested here: they're the two
// DB/DOM-calling functions in this file (db.links.toArray() + friends,
// URL.createObjectURL/<a download>), and this package's vitest config
// deliberately does no chrome.*/DOM/IndexedDB mocking — same precedent as
// lib/tabs.ts's getCurrentTab/getAllTabs. `buildExport`/`exportFilename`/
// `formatDataStats` ARE test-driven.

afterEach(() => {
  vi.useRealTimers();
});

describe("buildExport", () => {
  it("packages version 1, exportedAt (now), and the given rows verbatim", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(12_345);

    const collections = [{ id: "c1" }] as never;
    const links = [{ id: "l1" }, { id: "l2" }] as never;
    const sessions = [{ id: "s1" }] as never;

    expect(buildExport(collections, links, sessions)).toEqual({
      version: 1,
      exportedAt: 12_345,
      collections,
      links,
      sessions,
    });
  });

  it("does not filter or mutate its inputs — that's the caller's job", () => {
    const collections = [{ id: "c1" }, { id: "c2" }] as never;
    const result = buildExport(collections, [] as never, [] as never);
    expect(result.collections).toBe(collections); // same reference, untouched
  });
});

describe("exportFilename", () => {
  it("formats as tabburrow-export-YYYY-MM-DD.json in local time", () => {
    const localNoon = new Date(2026, 6, 15, 12, 0, 0).getTime(); // 2026-07-15 local
    expect(exportFilename(localNoon)).toBe("tabburrow-export-2026-07-15.json");
  });

  it("zero-pads single-digit months and days", () => {
    const localJan5 = new Date(2026, 0, 5, 9, 0, 0).getTime(); // 2026-01-05 local
    expect(exportFilename(localJan5)).toBe("tabburrow-export-2026-01-05.json");
  });
});

describe("formatDataStats", () => {
  it("pluralizes all three counts", () => {
    expect(formatDataStats(3, 40, 5)).toBe("3 collections · 40 links · 5 sessions");
  });

  it("uses singular phrasing for exactly one of each", () => {
    expect(formatDataStats(1, 1, 1)).toBe("1 collection · 1 link · 1 session");
  });

  it("handles all-zero", () => {
    expect(formatDataStats(0, 0, 0)).toBe("0 collections · 0 links · 0 sessions");
  });
});

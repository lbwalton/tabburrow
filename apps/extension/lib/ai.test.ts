import { describe, it, expect } from "vitest";
import {
  AI_FREE_LIMIT,
  AiOrganizeError,
  aiOrganizeCtaAvailable,
  aiUsesMetaKey,
  FALLBACK_GROUP_NAME,
  mergeTags,
  parseOrganizeResponse,
  planApplication,
  resolveGroupNames,
  summarizeApply,
  toWireLinks,
  yearMonthKey,
} from "./ai";
import type { AiApplyResult } from "./ai";
import type { Link } from "@tabburrow/core";

function makeLink(overrides: Partial<Link> = {}): Link {
  return {
    id: "link-1",
    collectionId: "coll-1",
    url: "https://example.com/a",
    title: "Example A",
    faviconUrl: null,
    note: null,
    tags: [],
    position: "0001",
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    ...overrides,
  };
}

describe("toWireLinks", () => {
  it("maps to {id, title, url} only — never leaks favicon/note/tags/position", () => {
    const link = makeLink({ note: "secret note", tags: ["a", "b"], faviconUrl: "https://x/y.png" });
    expect(toWireLinks([link])).toEqual([{ id: "link-1", title: "Example A", url: "https://example.com/a" }]);
  });

  it("preserves input order and handles an empty array", () => {
    const a = makeLink({ id: "a" });
    const b = makeLink({ id: "b" });
    expect(toWireLinks([b, a]).map((l) => l.id)).toEqual(["b", "a"]);
    expect(toWireLinks([])).toEqual([]);
  });
});

describe("parseOrganizeResponse", () => {
  it("maps a well-formed response into AiPlan's camelCase shape", () => {
    const raw = {
      groups: [{ name: "Dev Docs", emoji: "💻", link_ids: ["a", "b"] }],
      tags: { a: ["react", "docs"], b: [] },
    };
    expect(parseOrganizeResponse(raw)).toEqual({
      groups: [{ name: "Dev Docs", emoji: "💻", linkIds: ["a", "b"] }],
      tags: { a: ["react", "docs"], b: [] },
    });
  });

  it("throws an AiOrganizeError('upstream') for a malformed body", () => {
    for (const bad of [null, "nope", 42, {}, { groups: "nope", tags: {} }, { groups: [], tags: null }]) {
      expect(() => parseOrganizeResponse(bad)).toThrow(AiOrganizeError);
      try {
        parseOrganizeResponse(bad);
      } catch (err) {
        expect(err).toBeInstanceOf(AiOrganizeError);
        expect((err as AiOrganizeError).kind).toBe("upstream");
      }
    }
  });

  it("defensively drops non-string entries inside link_ids/tags rather than throwing", () => {
    const raw = {
      groups: [{ name: "G", emoji: "🗂️", link_ids: ["a", 42, null] }],
      tags: { a: ["ok", 7] },
    };
    expect(parseOrganizeResponse(raw)).toEqual({
      groups: [{ name: "G", emoji: "🗂️", linkIds: ["a"] }],
      tags: { a: ["ok"] },
    });
  });
});

describe("resolveGroupNames", () => {
  it("passes non-empty names through untouched", () => {
    expect(resolveGroupNames(["Dev Docs", "Recipes"])).toEqual(["Dev Docs", "Recipes"]);
  });

  it("replaces an empty name with the deterministic fallback", () => {
    expect(resolveGroupNames(["Dev Docs", ""])).toEqual(["Dev Docs", FALLBACK_GROUP_NAME]);
  });

  it("treats whitespace-only names as empty", () => {
    expect(resolveGroupNames(["   "])).toEqual([FALLBACK_GROUP_NAME]);
  });

  it("disambiguates multiple fallbacks with a numeric suffix", () => {
    expect(resolveGroupNames(["", "Real", ""])).toEqual([
      FALLBACK_GROUP_NAME,
      "Real",
      `${FALLBACK_GROUP_NAME} 2`,
    ]);
  });

  it("skips a fallback that collides case-insensitively with a real AI name", () => {
    expect(resolveGroupNames(["organized LINKS", ""])).toEqual(["organized LINKS", `${FALLBACK_GROUP_NAME} 2`]);
  });

  it("handles an empty input", () => {
    expect(resolveGroupNames([])).toEqual([]);
  });
});

describe("parseOrganizeResponse (fallback naming integration)", () => {
  it("a group arriving with an empty/missing name gets the fallback, never an empty string", () => {
    const raw = {
      groups: [
        { name: "", emoji: "🗂️", link_ids: ["a"] },
        { emoji: "🗂️", link_ids: ["b"] }, // name missing entirely
      ],
      tags: {},
    };
    const plan = parseOrganizeResponse(raw);
    expect(plan.groups.map((g) => g.name)).toEqual([FALLBACK_GROUP_NAME, `${FALLBACK_GROUP_NAME} 2`]);
  });
});

function makeApplyResult(overrides: Partial<AiApplyResult> = {}): AiApplyResult {
  return {
    createdCollections: 0,
    mergedCollections: 0,
    movedLinks: 0,
    taggedLinks: 0,
    skippedLinks: 0,
    failedGroups: 0,
    ...overrides,
  };
}

describe("summarizeApply", () => {
  it("full success: every link moved, no failed groups", () => {
    const summary = summarizeApply(makeApplyResult({ createdCollections: 2, mergedCollections: 1, movedLinks: 9 }));
    expect(summary.kind).toBe("full");
    expect(summary.message).toBe("Organized 9 links into 3 collections");
  });

  it("full success singularizes correctly", () => {
    const summary = summarizeApply(makeApplyResult({ createdCollections: 1, movedLinks: 1 }));
    expect(summary.message).toBe("Organized 1 link into 1 collection");
  });

  it("skipped links produce an honest partial message", () => {
    const summary = summarizeApply(makeApplyResult({ createdCollections: 2, movedLinks: 7, skippedLinks: 2 }));
    expect(summary.kind).toBe("partial");
    expect(summary.message).toBe(
      "Organized 7 of 9 links into 2 collections. 2 links could not be moved (they may have been deleted).",
    );
  });

  it("a single skipped link singularizes", () => {
    const summary = summarizeApply(makeApplyResult({ createdCollections: 1, movedLinks: 3, skippedLinks: 1 }));
    expect(summary.message).toContain("1 link could not be moved");
  });

  it("a failed group with no members is still partial and says so", () => {
    const summary = summarizeApply(makeApplyResult({ createdCollections: 1, movedLinks: 4, failedGroups: 1 }));
    expect(summary.kind).toBe("partial");
    expect(summary.message).toContain("1 group could not be created");
    expect(summary.message).not.toContain("could not be moved");
  });

  it("total failure is still a partial report, never a crash", () => {
    const summary = summarizeApply(makeApplyResult({ skippedLinks: 3, failedGroups: 1 }));
    expect(summary.kind).toBe("partial");
    expect(summary.message).toContain("Organized 0 of 3 links into 0 collections");
    expect(summary.message).toContain("3 links could not be moved");
    expect(summary.message).toContain("1 group could not be created");
  });
});

describe("AiOrganizeError", () => {
  it("carries kind + optional used/limit, and is a real Error", () => {
    const err = new AiOrganizeError("quota", "You've used all your free AI organizes this month.", {
      used: 30,
      limit: 30,
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.kind).toBe("quota");
    expect(err.used).toBe(30);
    expect(err.limit).toBe(30);
    expect(err.message).toBe("You've used all your free AI organizes this month.");
  });

  it("leaves used/limit undefined when not given", () => {
    const err = new AiOrganizeError("network", "offline");
    expect(err.used).toBeUndefined();
    expect(err.limit).toBeUndefined();
  });
});

describe("yearMonthKey", () => {
  it("formats YYYY-MM, zero-padded", () => {
    expect(yearMonthKey(new Date(2026, 0, 15))).toBe("2026-01");
    expect(yearMonthKey(new Date(2026, 10, 1))).toBe("2026-11");
  });
});

describe("aiUsesMetaKey", () => {
  it("namespaces by user id and year-month", () => {
    expect(aiUsesMetaKey("user-1", "2026-07")).toBe("aiUses:user-1:2026-07");
  });

  it("two different users (or months) never collide", () => {
    expect(aiUsesMetaKey("user-1", "2026-07")).not.toBe(aiUsesMetaKey("user-2", "2026-07"));
    expect(aiUsesMetaKey("user-1", "2026-07")).not.toBe(aiUsesMetaKey("user-1", "2026-08"));
  });
});

describe("aiOrganizeCtaAvailable", () => {
  it("PRO is always available regardless of the local counter", () => {
    expect(aiOrganizeCtaAvailable("pro", 0)).toBe(true);
    expect(aiOrganizeCtaAvailable("pro", 9999)).toBe(true);
  });

  it("FREE is available strictly under the limit, not at or over it", () => {
    expect(aiOrganizeCtaAvailable("free", 0)).toBe(true);
    expect(aiOrganizeCtaAvailable("free", AI_FREE_LIMIT - 1)).toBe(true);
    expect(aiOrganizeCtaAvailable("free", AI_FREE_LIMIT)).toBe(false);
    expect(aiOrganizeCtaAvailable("free", AI_FREE_LIMIT + 1)).toBe(false);
  });

  it("an unknown plan (null) is never available — 'known-nonzero', not 'unknown'", () => {
    expect(aiOrganizeCtaAvailable(null, 0)).toBe(false);
  });
});

describe("planApplication", () => {
  const existing = [
    { id: "c1", name: "Recipes" },
    { id: "c2", name: "Dev Docs" },
  ];

  it("creates a new collection when no existing name matches", () => {
    const actions = planApplication([{ name: "Educational Videos" }], existing);
    expect(actions).toEqual([{ kind: "create", name: "Educational Videos" }]);
  });

  it("merges into an existing collection with a case-insensitive, trimmed name match", () => {
    const actions = planApplication([{ name: "  recipes  " }, { name: "DEV DOCS" }], existing);
    expect(actions).toEqual([
      { kind: "merge", name: "  recipes  ", targetCollectionId: "c1", targetCollectionName: "Recipes" },
      { kind: "merge", name: "DEV DOCS", targetCollectionId: "c2", targetCollectionName: "Dev Docs" },
    ]);
  });

  it("preserves per-group order and independence — one group matching doesn't affect another", () => {
    const actions = planApplication([{ name: "Recipes" }, { name: "New Topic" }], existing);
    expect(actions[0]).toEqual({ kind: "merge", name: "Recipes", targetCollectionId: "c1", targetCollectionName: "Recipes" });
    expect(actions[1]).toEqual({ kind: "create", name: "New Topic" });
  });

  it("an empty existing-collections list always creates", () => {
    expect(planApplication([{ name: "Anything" }], [])).toEqual([{ kind: "create", name: "Anything" }]);
  });
});

describe("mergeTags", () => {
  it("dedupes case-insensitively, existing casing wins on collision", () => {
    expect(mergeTags(["React"], ["react", "typescript"])).toEqual(["React", "typescript"]);
  });

  it("preserves order: existing tags first, then new incoming ones", () => {
    expect(mergeTags(["b", "a"], ["c", "a"])).toEqual(["b", "a", "c"]);
  });

  it("drops empty/whitespace-only entries and trims survivors", () => {
    expect(mergeTags([" work "], ["", "  ", "urgent"])).toEqual(["work", "urgent"]);
  });

  it("handles both sides empty", () => {
    expect(mergeTags([], [])).toEqual([]);
  });

  it("no incoming tags is a no-op copy of existing", () => {
    expect(mergeTags(["a", "b"], [])).toEqual(["a", "b"]);
  });
});

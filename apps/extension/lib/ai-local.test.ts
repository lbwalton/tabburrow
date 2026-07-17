// On-device (Gemini Nano) organize adapter. Chrome's Prompt API isn't present
// in the vitest node runtime, so `self.LanguageModel` is faked here: a static
// with `availability`/`create`, and a session whose `prompt` returns a canned
// JSON string and whose `destroy` is a spy. This lets us drive every branch of
// `organizeLinksLocal` (valid plan, validation-repair retry, the too_many
// guard, and the always-destroy contract) without a real model.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AiLocalError,
  LOCAL_MAX_LINKS,
  nanoAvailability,
  organizeLinksLocal,
  suggestFolderNameLocal,
  validateSuggestedName,
} from "./ai-local";
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

function makeLinks(n: number): Link[] {
  return Array.from({ length: n }, (_, i) =>
    makeLink({ id: `l${i}`, url: `https://example.com/${i}`, title: `Link ${i}` }),
  );
}

interface FakeSession {
  prompt: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

/**
 * Installs a fake `self.LanguageModel`. `promptResults` is consumed one per
 * `session.prompt` call, so a `[bad, good]` array drives the one-retry path.
 * Each entry is either a JSON string to return or an Error to throw.
 */
function installNano(opts: {
  availability?: string;
  promptResults?: Array<string | Error>;
  createThrows?: boolean;
}): { session: FakeSession; create: ReturnType<typeof vi.fn>; availability: ReturnType<typeof vi.fn> } {
  const results = [...(opts.promptResults ?? [])];
  const prompt = vi.fn(async () => {
    const next = results.shift();
    if (next instanceof Error) throw next;
    if (next === undefined) throw new Error("prompt called more times than canned results");
    return next;
  });
  const destroy = vi.fn();
  const session: FakeSession = { prompt, destroy };

  const create = vi.fn(async () => {
    if (opts.createThrows) throw new Error("create failed");
    return session;
  });
  const availability = vi.fn(async () => opts.availability ?? "available");

  vi.stubGlobal("self", { LanguageModel: { availability, create } });
  return { session, create, availability };
}

const VALID_TWO_GROUPS = JSON.stringify({
  groups: [
    { name: "Dev Docs", emoji: "💻", link_ids: ["l0", "l1"] },
    { name: "Recipes", emoji: "🍳", link_ids: ["l2", "l3"] },
  ],
  tags: { l0: ["React", "DOCS"], l1: [], l2: ["cooking"], l3: [] },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("nanoAvailability", () => {
  it("returns 'unavailable' when the LanguageModel global is missing", async () => {
    vi.stubGlobal("self", {}); // no LanguageModel
    expect(await nanoAvailability()).toBe("unavailable");
  });

  it("passes through whatever availability() reports", async () => {
    const { availability } = installNano({ availability: "downloadable" });
    expect(await nanoAvailability()).toBe("downloadable");
    expect(availability).toHaveBeenCalledWith({
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
    });
  });

  it("never throws — a throwing availability() folds into 'unavailable'", async () => {
    vi.stubGlobal("self", {
      LanguageModel: {
        availability: vi.fn(async () => {
          throw new Error("boom");
        }),
        create: vi.fn(),
      },
    });
    expect(await nanoAvailability()).toBe("unavailable");
  });
});

describe("validateSuggestedName", () => {
  it("returns the trimmed name for a well-formed { name } object", () => {
    expect(validateSuggestedName({ name: "  Research  " })).toBe("Research");
  });

  it("throws for a non-object, a missing name, or a non-string name", () => {
    expect(() => validateSuggestedName(null)).toThrow(AiLocalError);
    expect(() => validateSuggestedName("Research")).toThrow(AiLocalError);
    expect(() => validateSuggestedName({})).toThrow(AiLocalError);
    expect(() => validateSuggestedName({ name: 42 })).toThrow(AiLocalError);
  });

  it("throws for an empty/whitespace-only name so no folder is renamed to ''", () => {
    expect(() => validateSuggestedName({ name: "   " })).toThrow(AiLocalError);
  });

  it("clamps an overlong name to 40 characters", () => {
    const long = "x".repeat(80);
    expect(validateSuggestedName({ name: long })).toHaveLength(40);
  });
});

describe("suggestFolderNameLocal", () => {
  it("returns the validated on-device name and destroys the session", async () => {
    const { session } = installNano({ promptResults: [JSON.stringify({ name: "Recipes" })] });

    const name = await suggestFolderNameLocal(makeLinks(3));

    expect(name).toBe("Recipes");
    expect(session.destroy).toHaveBeenCalledTimes(1);
  });

  it("throws (and still destroys) when the model returns an unusable name", async () => {
    const { session } = installNano({ promptResults: [JSON.stringify({ name: "" })] });

    await expect(suggestFolderNameLocal(makeLinks(3))).rejects.toBeInstanceOf(AiLocalError);
    expect(session.destroy).toHaveBeenCalledTimes(1);
  });

  it("throws 'unavailable' when the LanguageModel global is missing", async () => {
    vi.stubGlobal("self", {});
    await expect(suggestFolderNameLocal(makeLinks(3))).rejects.toMatchObject({ code: "unavailable" });
  });
});

describe("organizeLinksLocal", () => {
  it("returns a normalized AiPlan for a valid response, and destroys the session", async () => {
    const { session } = installNano({ promptResults: [VALID_TWO_GROUPS] });

    const plan = await organizeLinksLocal(makeLinks(4));

    expect(plan).toEqual({
      groups: [
        { name: "Dev Docs", emoji: "💻", linkIds: ["l0", "l1"] },
        { name: "Recipes", emoji: "🍳", linkIds: ["l2", "l3"] },
      ],
      // tags are lowercased/deduped/capped by the shared validate/normalize port.
      tags: { l0: ["react", "docs"], l1: [], l2: ["cooking"], l3: [] },
    });
    expect(session.prompt).toHaveBeenCalledTimes(1);
    expect(session.destroy).toHaveBeenCalledTimes(1);
  });

  it("passes the JSON Schema responseConstraint on the prompt call", async () => {
    const { session } = installNano({ promptResults: [VALID_TWO_GROUPS] });
    await organizeLinksLocal(makeLinks(4));
    const [, options] = session.prompt.mock.calls[0]!;
    expect(options).toHaveProperty("responseConstraint");
    expect((options as { responseConstraint: { required: string[] } }).responseConstraint.required).toEqual([
      "groups",
      "tags",
    ]);
  });

  it("repairs a bad first response with ONE corrective retry, then succeeds", async () => {
    // First response drops l3 entirely (id not assigned exactly once) -> invalid.
    const bad = JSON.stringify({
      groups: [{ name: "Everything", emoji: "🗂️", link_ids: ["l0", "l1", "l2"] }],
      tags: {},
    });
    const { session } = installNano({ promptResults: [bad, VALID_TWO_GROUPS] });

    const plan = await organizeLinksLocal(makeLinks(4));

    expect(plan.groups.map((g) => g.name)).toEqual(["Dev Docs", "Recipes"]);
    expect(session.prompt).toHaveBeenCalledTimes(2);
    // Second call is the correction, carrying the input ids.
    expect(session.prompt.mock.calls[1]![0]).toContain("using ONLY these link_ids");
    expect(session.destroy).toHaveBeenCalledTimes(1);
  });

  it("throws an 'upstream' AiLocalError when still invalid after the retry, and still destroys", async () => {
    const bad = JSON.stringify({ groups: [], tags: {} }); // 0 groups for 4 links -> invalid both times
    const { session } = installNano({ promptResults: [bad, bad] });

    await expect(organizeLinksLocal(makeLinks(4))).rejects.toMatchObject({
      name: "AiLocalError",
      code: "upstream",
    });
    expect(session.prompt).toHaveBeenCalledTimes(2);
    expect(session.destroy).toHaveBeenCalledTimes(1);
  });

  it("throws 'upstream' (no retry) when the model call itself errors, and destroys", async () => {
    const { session } = installNano({ promptResults: [new Error("model exploded")] });

    await expect(organizeLinksLocal(makeLinks(4))).rejects.toMatchObject({ code: "upstream" });
    expect(session.prompt).toHaveBeenCalledTimes(1); // API error is NOT retried
    expect(session.destroy).toHaveBeenCalledTimes(1);
  });

  it("throws a 'too_many' AiLocalError when over LOCAL_MAX_LINKS, without touching the model", async () => {
    const { create } = installNano({ promptResults: [] });

    await expect(organizeLinksLocal(makeLinks(LOCAL_MAX_LINKS + 1))).rejects.toMatchObject({
      name: "AiLocalError",
      code: "too_many",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("throws 'unavailable' when Nano vanished before the call", async () => {
    vi.stubGlobal("self", {}); // no LanguageModel
    const err = await organizeLinksLocal(makeLinks(2)).catch((e) => e);
    expect(err).toBeInstanceOf(AiLocalError);
    expect((err as AiLocalError).code).toBe("unavailable");
  });

  it("wires monitor.downloadprogress through to onDownloadProgress as a 0-100 percent", async () => {
    const results = [VALID_TWO_GROUPS];
    const listeners: Array<(e: { loaded: number }) => void> = [];
    const session: FakeSession = {
      prompt: vi.fn(async () => results.shift()!),
      destroy: vi.fn(),
    };
    const create = vi.fn(async (options: { monitor?: (m: unknown) => void }) => {
      options.monitor?.({
        addEventListener: (_type: string, listener: (e: { loaded: number }) => void) => listeners.push(listener),
      });
      return session;
    });
    vi.stubGlobal("self", { LanguageModel: { availability: vi.fn(), create } });

    const onDownloadProgress = vi.fn();
    await organizeLinksLocal(makeLinks(4), { onDownloadProgress });
    listeners.forEach((l) => l({ loaded: 0.42 }));

    expect(onDownloadProgress).toHaveBeenCalledWith(42);
  });
});

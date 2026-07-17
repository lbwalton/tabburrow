// Engine routing for `organizeLinks`: on-device Gemini Nano first (free,
// unmetered) when it's `"available"` and the batch fits, else the metered
// Claude cloud fetch. `./ai-local` is module-mocked so we can dial Nano's
// availability and force the local path to succeed or throw; `./auth` and
// `./supabase` are mocked to a signed-in, configured state; `fetch` is stubbed
// so the cloud branch is deterministic. A real fake-indexeddb db backs the
// display-counter write the cloud path performs on success.
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BurrowDB } from "@tabburrow/core";
import type { Link } from "@tabburrow/core";

vi.mock("./ai-local", () => ({
  LOCAL_MAX_LINKS: 40,
  nanoAvailability: vi.fn(),
  organizeLinksLocal: vi.fn(),
}));
vi.mock("./auth", () => ({
  getAccessToken: vi.fn(async () => "token-123"),
  getUser: vi.fn(async () => ({ id: "user-1" })),
}));
vi.mock("./supabase", () => ({ isSupabaseConfigured: () => true }));

import { organizeLinks } from "./ai";
import type { AiPlan } from "./ai";
import { nanoAvailability, organizeLinksLocal } from "./ai-local";

const LOCAL_PLAN: AiPlan = {
  groups: [{ name: "On-device Group", emoji: "🧠", linkIds: ["l0"] }],
  tags: { l0: ["local"] },
};

const CLOUD_BODY = {
  groups: [{ name: "Cloud Group", emoji: "☁️", link_ids: ["l0"] }],
  tags: { l0: ["cloud"] },
};

function makeLink(id: string): Link {
  return {
    id,
    collectionId: "coll-1",
    url: `https://example.com/${id}`,
    title: `Link ${id}`,
    faviconUrl: null,
    note: null,
    tags: [],
    position: "0001",
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
  };
}

let db: BurrowDB;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.stubEnv("WXT_SUPABASE_URL", "https://project.supabase.co");
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => CLOUD_BODY }));
  vi.stubGlobal("fetch", fetchMock);
  try {
    await indexedDB.deleteDatabase("tabburrow");
  } catch {
    // ignore
  }
  db = new BurrowDB();
  await db.open();
  vi.mocked(nanoAvailability).mockReset();
  vi.mocked(organizeLinksLocal).mockReset();
});

afterEach(() => {
  db.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("organizeLinks engine routing", () => {
  it("uses the LOCAL engine when Nano is 'available' and the batch fits — no fetch", async () => {
    vi.mocked(nanoAvailability).mockResolvedValue("available");
    vi.mocked(organizeLinksLocal).mockResolvedValue(LOCAL_PLAN);

    const result = await organizeLinks([makeLink("l0")], db);

    expect(result).toEqual({ plan: LOCAL_PLAN, engine: "local" });
    expect(organizeLinksLocal).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the CLOUD path when Nano is 'unavailable'", async () => {
    vi.mocked(nanoAvailability).mockResolvedValue("unavailable");

    const result = await organizeLinks([makeLink("l0")], db);

    expect(result.engine).toBe("cloud");
    expect(result.plan.groups[0]!.name).toBe("Cloud Group");
    expect(organizeLinksLocal).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT auto-use local for 'downloadable' — routes to cloud", async () => {
    vi.mocked(nanoAvailability).mockResolvedValue("downloadable");

    const result = await organizeLinks([makeLink("l0")], db);

    expect(result.engine).toBe("cloud");
    expect(organizeLinksLocal).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to CLOUD when the local engine throws", async () => {
    vi.mocked(nanoAvailability).mockResolvedValue("available");
    vi.mocked(organizeLinksLocal).mockRejectedValue(new Error("nano exploded"));

    const result = await organizeLinks([makeLink("l0")], db);

    expect(result.engine).toBe("cloud");
    expect(organizeLinksLocal).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

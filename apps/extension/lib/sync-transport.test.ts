import "fake-indexeddb/auto";
import { describe, it, expect, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Collection, Link } from "@tabburrow/core";
import { BurrowDB, getMeta, setMeta, SyncEngine } from "@tabburrow/core";
import {
  collectionFromRemoteRow,
  collectionToRemoteRow,
  createTransportWithClient,
  linkFromRemoteRow,
  linkToRemoteRow,
} from "./sync-transport";

// createSupabaseTransport's REAL push/pull/RPC network path is NOT unit
// tested here — it needs a configured `getClient()`, absent under vitest
// (same precedent as lib/auth.ts's test file); e2e/specs/t18-sync.spec.ts
// exercises it against the local Supabase stack. What IS test-driven here:
// every pure mapping function the transport is built on (the exact
// camelCase <-> snake_case round trip), plus — via `createTransportWithClient`
// and a fake client — the transport's SESSION GUARD behavior, which no e2e
// flow can deterministically reproduce (it requires a sign-out landing in
// the exact window between the controller's gate check and the pull).

const USER_ID = "11111111-1111-1111-1111-111111111111";

const LIVE_COLLECTION: Collection = {
  id: "c1",
  name: "Reading List",
  accent: "#F97316",
  position: "0001",
  isShared: true,
  shareSlug: "reading-list",
  createdAt: 1000,
  updatedAt: 2000,
  deletedAt: null,
};

const TOMBSTONED_COLLECTION: Collection = {
  id: "c2",
  name: "Old Collection",
  accent: null,
  position: "0002",
  isShared: false,
  shareSlug: null,
  createdAt: 500,
  updatedAt: 1500,
  deletedAt: 1600,
};

const LIVE_LINK: Link = {
  id: "l1",
  collectionId: "c1",
  url: "https://example.com",
  title: "Example",
  faviconUrl: "https://example.com/favicon.ico",
  note: "a note",
  tags: ["read-later", "work"],
  position: "0001",
  createdAt: 1000,
  updatedAt: 2000,
  deletedAt: null,
};

const TOMBSTONED_LINK_NO_TAGS: Link = {
  id: "l2",
  collectionId: "c1",
  url: "https://example.org",
  title: "Example Org",
  faviconUrl: null,
  note: null,
  tags: [],
  position: "0002",
  createdAt: 500,
  updatedAt: 1800,
  deletedAt: 1900,
};

describe("collectionToRemoteRow / collectionFromRemoteRow", () => {
  it("maps a live collection to a remote row with user_id injected", () => {
    expect(collectionToRemoteRow(LIVE_COLLECTION, USER_ID)).toEqual({
      id: "c1",
      user_id: USER_ID,
      name: "Reading List",
      accent: "#F97316",
      position: "0001",
      is_shared: true,
      share_slug: "reading-list",
      created_at: 1000,
      updated_at: 2000,
      deleted_at: null,
    });
  });

  it("maps a tombstoned (deleted_at set) collection", () => {
    const row = collectionToRemoteRow(TOMBSTONED_COLLECTION, USER_ID);
    expect(row.deleted_at).toBe(1600);
    expect(row.is_shared).toBe(false);
    expect(row.share_slug).toBeNull();
  });

  it("round-trips a live collection through to/fromRemoteRow, dropping user_id", () => {
    const row = collectionToRemoteRow(LIVE_COLLECTION, USER_ID);
    expect(collectionFromRemoteRow(row)).toEqual(LIVE_COLLECTION);
  });

  it("round-trips a null-tombstone (deletedAt: null) collection", () => {
    const row = collectionToRemoteRow(LIVE_COLLECTION, USER_ID);
    expect(collectionFromRemoteRow(row).deletedAt).toBeNull();
  });

  it("round-trips a tombstoned collection", () => {
    const row = collectionToRemoteRow(TOMBSTONED_COLLECTION, USER_ID);
    expect(collectionFromRemoteRow(row)).toEqual(TOMBSTONED_COLLECTION);
  });

  it("fromRemoteRow never carries user_id onto the client Collection", () => {
    const row = collectionToRemoteRow(LIVE_COLLECTION, USER_ID);
    const mapped = collectionFromRemoteRow(row) as unknown as Record<string, unknown>;
    expect("user_id" in mapped).toBe(false);
  });
});

describe("linkToRemoteRow / linkFromRemoteRow", () => {
  it("maps a live link with tags to a remote row with user_id injected", () => {
    expect(linkToRemoteRow(LIVE_LINK, USER_ID)).toEqual({
      id: "l1",
      user_id: USER_ID,
      collection_id: "c1",
      url: "https://example.com",
      title: "Example",
      favicon_url: "https://example.com/favicon.ico",
      note: "a note",
      tags: ["read-later", "work"],
      position: "0001",
      created_at: 1000,
      updated_at: 2000,
      deleted_at: null,
    });
  });

  it("maps a tombstoned link with an empty tags array", () => {
    const row = linkToRemoteRow(TOMBSTONED_LINK_NO_TAGS, USER_ID);
    expect(row.tags).toEqual([]);
    expect(row.deleted_at).toBe(1900);
    expect(row.favicon_url).toBeNull();
    expect(row.note).toBeNull();
  });

  it("round-trips a live link (with tags, null tombstone) through to/fromRemoteRow, dropping user_id", () => {
    const row = linkToRemoteRow(LIVE_LINK, USER_ID);
    expect(linkFromRemoteRow(row)).toEqual(LIVE_LINK);
  });

  it("round-trips a tombstoned link with an empty tags array", () => {
    const row = linkToRemoteRow(TOMBSTONED_LINK_NO_TAGS, USER_ID);
    expect(linkFromRemoteRow(row)).toEqual(TOMBSTONED_LINK_NO_TAGS);
  });

  it("defends against a null tags column on pull by coercing to an empty array", () => {
    const row = linkToRemoteRow(TOMBSTONED_LINK_NO_TAGS, USER_ID);
    // The DB column is `not null default '{}'`, so this shouldn't happen in
    // practice — but linkFromRemoteRow must stay total (Link.tags is never
    // optional) even if a row somehow arrives without it.
    const withNullTags = { ...row, tags: null as unknown as string[] };
    expect(linkFromRemoteRow(withNullTags).tags).toEqual([]);
  });

  it("fromRemoteRow never carries user_id onto the client Link", () => {
    const row = linkToRemoteRow(LIVE_LINK, USER_ID);
    const mapped = linkFromRemoteRow(row) as unknown as Record<string, unknown>;
    expect("user_id" in mapped).toBe(false);
  });
});

/**
 * A minimal fake of the exact supabase-js surface the transport touches:
 * `auth.getSession`, `rpc`, and `from().select().gt` / `from().upsert`.
 * `expireSession()` simulates the user signing out (or the session lapsing)
 * AFTER the transport was constructed but BEFORE a method runs — the window
 * the reviewer's trace targets. Every network-shaped call is counted so the
 * tests can assert the guard fired BEFORE any request would have left.
 */
function fakeSupabaseClient() {
  let session: { user: { id: string } } | null = { user: { id: USER_ID } };
  const calls = { rpc: 0, from: [] as string[] };
  const client = {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
    },
    rpc: async (_fn: string) => {
      calls.rpc += 1;
      return { data: 1_000_000, error: null };
    },
    from: (table: string) => {
      calls.from.push(table);
      return {
        select: (_cols: string) => ({
          gt: async (_col: string, _v: number) => ({ data: [], error: null }),
        }),
        upsert: async (_rows: unknown, _opts: unknown) => ({ error: null }),
      };
    },
  };
  return {
    client: client as unknown as SupabaseClient,
    calls,
    expireSession: () => {
      session = null;
    },
  };
}

describe("pullSince session guard (fix pass 2)", () => {
  afterEach(async () => {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase("tabburrow");
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });

  it("pullSince with a live session runs and returns serverNow", async () => {
    const { client, calls } = fakeSupabaseClient();
    const transport = createTransportWithClient(client);
    const result = await transport.pullSince(0);
    expect(result.serverNow).toBe(1_000_000);
    expect(calls.rpc).toBe(1);
  });

  it("pullSince REJECTS when the session expired after construction, before touching rpc or any table", async () => {
    // The reviewer's trace: gate passes -> user signs out mid-cycle -> flush
    // has zero ops (no transport call to throw) -> a sessionless pullSince
    // would run under the anon key, where server_now_ms() still executes and
    // both selects return [] under RLS with NO error — so the engine would
    // advance the cursor having pulled nothing, permanently skipping rows
    // updated on other devices in that window. The guard must throw FIRST.
    const { client, calls, expireSession } = fakeSupabaseClient();
    const transport = createTransportWithClient(client);
    expireSession();
    await expect(transport.pullSince(0)).rejects.toThrow(/no signed-in session/);
    expect(calls.rpc).toBe(0);
    expect(calls.from).toEqual([]);
  });

  it("a full engine cycle against a sessionless transport leaves the cursor untouched (cursor-last rule)", async () => {
    const db = new BurrowDB();
    await db.open();
    try {
      await setMeta("syncCursor", "500", db);
      const { client, expireSession } = fakeSupabaseClient();
      const engine = new SyncEngine(db, createTransportWithClient(client));
      expireSession();
      // No pendingOps seeded — the flush makes zero transport calls (the
      // common every-minute alarm tick), so the pull is the first and only
      // place the missing session can surface.
      await expect(engine.syncOnce()).rejects.toThrow(/no signed-in session/);
      expect(await getMeta("syncCursor", db)).toBe("500");
    } finally {
      db.close();
    }
  });
});

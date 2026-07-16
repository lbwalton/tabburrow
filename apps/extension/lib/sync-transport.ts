import type { SupabaseClient } from "@supabase/supabase-js";
import type { Collection, Link, SyncTransport } from "@tabburrow/core";
import { getClient } from "./supabase";

// --- Row shapes on the wire (snake_case, matching supabase/migrations/0001_init.sql's
// `collections`/`links` tables) vs. the client's camelCase `Collection`/`Link` (see
// packages/core/src/types.ts). `user_id` exists on every remote row (RLS-scoped,
// `not null`) but has NO client-side counterpart — it is injected on push and
// stripped on pull, never part of the round-trip shape. ---

interface RemoteCollectionRow {
  id: string;
  user_id: string;
  name: string;
  accent: string | null;
  position: string;
  is_shared: boolean;
  share_slug: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

interface RemoteLinkRow {
  id: string;
  user_id: string;
  collection_id: string;
  url: string;
  title: string;
  favicon_url: string | null;
  note: string | null;
  tags: string[];
  position: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

/** Client `Collection` -> a row ready to `upsert` into `public.collections`, with `user_id` stamped from the current session (never trusted from the row itself). */
export function collectionToRemoteRow(row: Collection, userId: string): RemoteCollectionRow {
  return {
    id: row.id,
    user_id: userId,
    name: row.name,
    accent: row.accent,
    position: row.position,
    is_shared: row.isShared,
    share_slug: row.shareSlug,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    deleted_at: row.deletedAt,
  };
}

/** A pulled `public.collections` row -> client `Collection`. `user_id` is deliberately dropped — `Collection` has no such field, and a pulled row's own `user_id` is never something the client needs (RLS already guarantees every row pulled here is the signed-in user's). */
export function collectionFromRemoteRow(row: RemoteCollectionRow): Collection {
  return {
    id: row.id,
    name: row.name,
    accent: row.accent,
    position: row.position,
    isShared: row.is_shared,
    shareSlug: row.share_slug,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

/** Client `Link` -> a row ready to `upsert` into `public.links`, with `user_id` stamped from the current session. `tags` passes through as-is — the column is `not null default '{}'` so an empty array round-trips as `[]`, never `null`. */
export function linkToRemoteRow(row: Link, userId: string): RemoteLinkRow {
  return {
    id: row.id,
    user_id: userId,
    collection_id: row.collectionId,
    url: row.url,
    title: row.title,
    favicon_url: row.faviconUrl,
    note: row.note,
    tags: row.tags,
    position: row.position,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    deleted_at: row.deletedAt,
  };
}

/** A pulled `public.links` row -> client `Link`. `tags` defaults to `[]` if a row somehow arrives with `null` (defensive — the column is `not null` — but `Link.tags` itself is never optional/nullable, so this keeps the mapping total). `user_id` is dropped, same reasoning as `collectionFromRemoteRow`. */
export function linkFromRemoteRow(row: RemoteLinkRow): Link {
  return {
    id: row.id,
    collectionId: row.collection_id,
    url: row.url,
    title: row.title,
    faviconUrl: row.favicon_url,
    note: row.note,
    tags: row.tags ?? [],
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

/**
 * Builds the `SyncTransport` `SyncEngine` (`@tabburrow/core`) pushes to and
 * pulls from, over the shared `getClient()` singleton (`lib/supabase.ts`) —
 * `null` when cloud isn't configured, so callers get the same "quiet no-op"
 * shape every other cloud-gated helper in this codebase returns rather than
 * throwing. Deliberately does NOT also check "is anyone signed in" — that
 * gate lives upstream in `lib/sync-controller.ts`'s `syncGateDecision`
 * (`SyncEngine` and this transport are only ever invoked once the caller has
 * already confirmed a signed-in PRO user), so `pushCollections`/`pushLinks`/
 * `pullSince` below read the CURRENT session at call time and throw a clear
 * error if it's somehow missing rather than silently no-opping — a
 * genuinely-missing session at that point is a bug upstream, not a normal
 * "not configured" state this transport should mask.
 */
export function createSupabaseTransport(): SyncTransport | null {
  const client = getClient();
  if (!client) return null;
  return createTransportWithClient(client);
}

/**
 * The transport over an EXPLICIT client — `createSupabaseTransport` above is
 * the production entry (shared `getClient()` singleton); this factory exists
 * so the session-guard behavior is unit-testable with a fake client under
 * vitest, where `getClient()` is always `null` (no `WXT_SUPABASE_*` env).
 * See lib/sync-transport.test.ts's sessionless-pull tests.
 */
export function createTransportWithClient(client: SupabaseClient): SyncTransport {
  async function currentUserId(): Promise<string> {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    const userId = data.session?.user.id;
    if (!userId) {
      throw new Error("sync-transport: no signed-in session (caller must gate on getUser() before syncing).");
    }
    return userId;
  }

  return {
    async pushCollections(rows: Collection[]): Promise<void> {
      if (rows.length === 0) return;
      const userId = await currentUserId();
      const payload = rows.map((row) => collectionToRemoteRow(row, userId));
      const { error } = await client.from("collections").upsert(payload, { onConflict: "id" });
      if (error) throw error;
    },

    async pushLinks(rows: Link[]): Promise<void> {
      if (rows.length === 0) return;
      const userId = await currentUserId();
      const payload = rows.map((row) => linkToRemoteRow(row, userId));
      const { error } = await client.from("links").upsert(payload, { onConflict: "id" });
      if (error) throw error;
    },

    async pullSince(cursor: number) {
      // Session guard FIRST (fix pass 2): unlike the push methods (which
      // need the session's user id anyway), a sessionless pull would NOT
      // fail on its own — it would run under the anon key, where
      // server_now_ms() still executes and both selects below return []
      // under RLS with NO error. The engine would then advance its cursor
      // to serverNow having pulled nothing, permanently skipping every row
      // updated on other devices in that window (surfacing only after the
      // user signs back in, with a confident "Synced just now"). Throwing
      // here instead makes the engine's cursor-last rule (see
      // packages/core/src/sync/engine.ts's runSyncOnce) leave the cursor
      // untouched, so the next signed-in cycle resumes from the same point.
      await currentUserId();

      // Cursor-gap mitigation (T17 review carry-over): read the server clock
      // FIRST, via the `server_now_ms()` RPC (supabase/migrations/0003_server_now.sql),
      // THEN run the two .gt("updated_at", cursor) reads below — see that
      // migration's docstring for the full reasoning. `serverNow` is what
      // SyncEngine advances its stored cursor to; it must be a value taken
      // BEFORE these reads started, never AFTER (or a row committed mid-pull
      // could be skipped forever instead of just safely re-pulled next cycle).
      const { data: nowData, error: nowError } = await client.rpc("server_now_ms");
      if (nowError) throw nowError;
      const serverNow = Number(nowData);

      // RLS ("own rows" policies — supabase/migrations/0001_init.sql) already
      // scopes both reads to the signed-in user; no explicit .eq("user_id", ...)
      // needed on top of that.
      const [collectionsRes, linksRes] = await Promise.all([
        client.from("collections").select("*").gt("updated_at", cursor),
        client.from("links").select("*").gt("updated_at", cursor),
      ]);
      if (collectionsRes.error) throw collectionsRes.error;
      if (linksRes.error) throw linksRes.error;

      return {
        collections: ((collectionsRes.data ?? []) as RemoteCollectionRow[]).map(collectionFromRemoteRow),
        links: ((linksRes.data ?? []) as RemoteLinkRow[]).map(linkFromRemoteRow),
        serverNow,
      };
    },
  };
}

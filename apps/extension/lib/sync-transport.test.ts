import { describe, it, expect } from "vitest";
import type { Collection, Link } from "@tabburrow/core";
import {
  collectionFromRemoteRow,
  collectionToRemoteRow,
  linkFromRemoteRow,
  linkToRemoteRow,
} from "./sync-transport";

// createSupabaseTransport's push/pull/RPC calls are NOT unit tested here —
// they call supabase-js's `.from()/.upsert()/.rpc()`, and this package's
// vitest config deliberately does no chrome.*/network mocking (same
// precedent as lib/auth.ts's test file). What IS test-driven here is every
// pure mapping function the transport is built on: the exact camelCase <->
// snake_case round trip `SyncEngine` depends on for every pushed/pulled row.
// The real network path is exercised end-to-end by e2e/specs/t18-sync.spec.ts
// against the local Supabase stack.

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

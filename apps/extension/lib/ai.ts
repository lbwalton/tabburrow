// T20: AI organize — the extension-side half of the ai-organize Edge
// Function (T19, supabase/functions/ai-organize/). This module owns the
// wire call (`organizeLinks`), the pure planning helpers the preview-diff
// dialog and `applyPlan` both lean on, and the light client-side "uses this
// month" display counter.
//
// The hard rule this whole module exists to serve: NOTHING here ever
// mutates local data on its own. `organizeLinks` only ever returns a plan
// (or throws); `applyPlan` is the one function that writes anything, and it
// is only ever called from AiOrganizeDialog's explicit "Apply" button.
import type { BurrowDB, Collection, Link } from "@tabburrow/core";
import { createCollection, getDB, getMeta, listCollections, moveLinkToEnd, setMeta, updateLink } from "@tabburrow/core";
import { getAccessToken, getUser } from "./auth";
import { isSupabaseConfigured } from "./supabase";
import { sendSyncNudge } from "./sync-nudge";

/** Free plan's monthly cap (mirrors supabase/functions/ai-organize/index.ts's FREE_LIMIT) — used for the dialog's proactive "X of 30 left" line before the server has had a chance to say otherwise. */
export const AI_FREE_LIMIT = 30;

/** The marketing site's pricing page — the brief's "upgrade CTA" target. Hardcoded (not imported: apps/web is a separate Next.js app, not a shared package) — matches apps/web/lib/site-config.ts's SITE_URL + the pricing route. */
export const PRICING_URL = "https://tabburrow.com/pricing";

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

export interface AiOrganizeGroup {
  name: string;
  emoji: string;
  linkIds: string[];
}

export interface AiPlan {
  groups: AiOrganizeGroup[];
  /** link id -> up to 5 short tags, straight from the function's response. */
  tags: Record<string, string[]>;
}

export type AiOrganizeErrorKind = "quota" | "upstream" | "auth" | "network";

/**
 * Typed error `organizeLinks` throws instead of a plain `Error` — the
 * dialog branches on `.kind` to pick one of its distinct error VIEWS
 * (quota-exhausted vs. sign-in vs. a friendly retry), not just a message
 * string like most of this codebase's other repo-error handling.
 */
export class AiOrganizeError extends Error {
  readonly kind: AiOrganizeErrorKind;
  readonly used?: number;
  readonly limit?: number;

  constructor(kind: AiOrganizeErrorKind, message: string, extra?: { used?: number; limit?: number }) {
    super(message);
    this.name = "AiOrganizeError";
    this.kind = kind;
    this.used = extra?.used;
    this.limit = extra?.limit;
  }
}

interface WireLink {
  id: string;
  title: string;
  url: string;
}

/** Pure: `Link[]` -> the wire shape the function accepts — id/title/url ONLY, which is also exactly what the confirm dialog's "titles and links are sent, never page content" copy promises. */
export function toWireLinks(links: Link[]): WireLink[] {
  return links.map((l) => ({ id: l.id, title: l.title, url: l.url }));
}

/**
 * Pure: the function's raw JSON body (`{groups:[{name,emoji,link_ids}],
 * tags}}`) -> `AiPlan`'s camelCase shape. The function already hard-validates
 * this shape server-side (supabase/functions/ai-organize/index.ts's
 * `validateAndNormalize`) — this parse is a defensive second line, not the
 * primary guard, so a malformed body maps to a generic "upstream" error
 * rather than a crash.
 */
export function parseOrganizeResponse(raw: unknown): AiPlan {
  if (raw === null || typeof raw !== "object") {
    throw new AiOrganizeError("upstream", "AI organize is temporarily unavailable. Try again in a moment.");
  }
  const groupsRaw = (raw as Record<string, unknown>).groups;
  const tagsRaw = (raw as Record<string, unknown>).tags;
  if (!Array.isArray(groupsRaw) || tagsRaw === null || typeof tagsRaw !== "object" || Array.isArray(tagsRaw)) {
    throw new AiOrganizeError("upstream", "AI organize is temporarily unavailable. Try again in a moment.");
  }

  const groups: AiOrganizeGroup[] = groupsRaw.map((g) => {
    const obj = g as Record<string, unknown>;
    const name = typeof obj.name === "string" ? obj.name : "";
    const emoji = typeof obj.emoji === "string" ? obj.emoji : "🗂️";
    const linkIds = Array.isArray(obj.link_ids) ? obj.link_ids.filter((id): id is string => typeof id === "string") : [];
    return { name, emoji, linkIds };
  });

  const tags: Record<string, string[]> = {};
  for (const [id, value] of Object.entries(tagsRaw as Record<string, unknown>)) {
    tags[id] = Array.isArray(value) ? value.filter((t): t is string => typeof t === "string") : [];
  }

  return { groups, tags };
}

// ---------------------------------------------------------------------------
// organizeLinks — calls the ai-organize Edge Function
// ---------------------------------------------------------------------------

/**
 * Calls the `ai-organize` Edge Function with `links` mapped to the wire
 * shape, authenticated with the current session's access token. Never
 * mutates local data — a pure "ask the AI for a plan" round trip; the
 * caller (AiOrganizeDialog) decides what to do with the result, and only
 * `applyPlan` (below), fired from an explicit user action, ever writes
 * anything.
 *
 * On success, bumps the local display-only "uses this month" counter (see
 * `recordAiUseLocally`) — the server increments the AUTHORITATIVE count
 * atomically as part of the same request (supabase/migrations/0004_ai_metering.sql);
 * this one is purely so the dialog/popup can show "X of 30 left" without an
 * extra round trip, and can drift (a failed local write, a second device)
 * without anything breaking — the server 402s regardless.
 *
 * Throws `AiOrganizeError`:
 *  - "auth" — cloud not configured, or not signed in (no access token).
 *  - "network" — the fetch itself failed (offline, DNS, ...).
 *  - "quota" — 402, carries `used`/`limit` from the response body.
 *  - "upstream" — 401/anything else non-2xx, or a malformed 200 body.
 */
export async function organizeLinks(links: Link[], db: BurrowDB = getDB()): Promise<AiPlan> {
  if (!isSupabaseConfigured()) {
    throw new AiOrganizeError("auth", "Cloud features are not configured for this build.");
  }
  const token = await getAccessToken();
  if (!token) {
    throw new AiOrganizeError("auth", "Sign in to use AI organize.");
  }

  const url = `${import.meta.env.WXT_SUPABASE_URL}/functions/v1/ai-organize`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ links: toWireLinks(links) }),
    });
  } catch {
    throw new AiOrganizeError("network", "Couldn't reach the AI organize service. Check your connection and try again.");
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (res.status === 402) {
    const record = (body ?? {}) as Record<string, unknown>;
    const used = typeof record.used === "number" ? record.used : AI_FREE_LIMIT;
    const limit = typeof record.limit === "number" ? record.limit : AI_FREE_LIMIT;
    throw new AiOrganizeError("quota", "You've used all your free AI organizes this month.", { used, limit });
  }
  if (res.status === 401) {
    throw new AiOrganizeError("auth", "Sign in to use AI organize.");
  }
  if (!res.ok) {
    throw new AiOrganizeError("upstream", "AI organize is temporarily unavailable. Try again in a moment.");
  }

  const plan = parseOrganizeResponse(body);

  const user = await getUser();
  if (user) await recordAiUseLocally(user.id, db);

  return plan;
}

// ---------------------------------------------------------------------------
// Client-side display counter (server remains authoritative)
// ---------------------------------------------------------------------------

/** "YYYY-MM" for `date`, local time — good enough for a DISPLAY-ONLY counter; the server's own reset is UTC-calendar-month (supabase/migrations/0004_ai_metering.sql), so this can be off by a few hours right at a month boundary. Never authoritative — see this module's docstring. */
export function yearMonthKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** meta key for the local "uses this month" display counter — scoped per user AND per month, so a plan change, a sign-out/sign-in, or a new calendar month all start fresh rather than inheriting a stale count. */
export function aiUsesMetaKey(userId: string, yearMonth: string): string {
  return `aiUses:${userId}:${yearMonth}`;
}

/** Bumps the local display-only counter by 1. Called once per successful `organizeLinks` call — never per link, per group, or per apply. */
export async function recordAiUseLocally(userId: string, db: BurrowDB = getDB()): Promise<void> {
  const key = aiUsesMetaKey(userId, yearMonthKey(new Date()));
  const raw = await getMeta(key, db);
  const current = raw ? Number.parseInt(raw, 10) || 0 : 0;
  await setMeta(key, String(current + 1), db);
}

/** Reads the local display-only counter for the current calendar month. `0` for a never-used or freshly-rolled-over month. */
export async function getAiUsesThisMonth(userId: string, db: BurrowDB = getDB()): Promise<number> {
  const raw = await getMeta(aiUsesMetaKey(userId, yearMonthKey(new Date())), db);
  return raw ? Number.parseInt(raw, 10) || 0 : 0;
}

/**
 * Pure: whether the popup's "Save all + organize" secondary CTA should
 * render. PRO has no fixed monthly quota to check client-side (fair-use
 * only, soft-capped far higher than any realistic single save-all batch) so
 * it's offered unconditionally once signed in; FREE is offered only while
 * the local display counter is confidently under the limit. `plan === null`
 * (not yet resolved, or cloud unreachable) is folded into "don't show it" —
 * the brief's "ONLY when ... quota known-nonzero", not "quota unknown."
 */
export function aiOrganizeCtaAvailable(plan: "free" | "pro" | null, usesThisMonth: number): boolean {
  if (plan === "pro") return true;
  if (plan === "free") return usesThisMonth < AI_FREE_LIMIT;
  return false;
}

// ---------------------------------------------------------------------------
// Pure planning helpers (TDD'd — see lib/ai.test.ts)
// ---------------------------------------------------------------------------

export type GroupPlanAction =
  | { kind: "create"; name: string }
  | { kind: "merge"; name: string; targetCollectionId: string; targetCollectionName: string };

/**
 * Pure: for each AI-proposed group, decides whether applying it should
 * CREATE a new collection or MERGE into an existing LIVE collection whose
 * name matches case-insensitively (trimmed) — the plan spec's explicit
 * rule (`.superpowers/sdd/task-20-brief.md`). Both the preview dialog (to
 * label each group "new collection" vs. "merges into existing NAME") and
 * `applyPlan` (to decide what to actually create/move into) run this same
 * function, so the applied result can never diverge from what was
 * previewed.
 */
export function planApplication(
  groups: Array<{ name: string }>,
  existingCollections: Array<{ id: string; name: string }>,
): GroupPlanAction[] {
  return groups.map((g) => {
    const trimmed = g.name.trim().toLowerCase();
    const match = existingCollections.find((c) => c.name.trim().toLowerCase() === trimmed);
    return match
      ? { kind: "merge", name: g.name, targetCollectionId: match.id, targetCollectionName: match.name }
      : { kind: "create", name: g.name };
  });
}

/**
 * Pure: merges a link's existing tags with the AI's incoming tags for that
 * link, deduped case-insensitively — the existing tag's ORIGINAL casing
 * wins on a collision (existing tags are usually hand-typed via
 * EditLinkPopover; AI tags are always already lowercase — see
 * supabase/functions/ai-organize/index.ts's `validateAndNormalize`), order
 * preserved (existing first, then new incoming tags). Empty/whitespace-only
 * entries are dropped.
 */
export function mergeTags(existing: string[], incoming: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const tag of [...existing, ...incoming]) {
    const trimmed = tag.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(trimmed);
  }
  return merged;
}

// ---------------------------------------------------------------------------
// applyPlan — the ONLY function in this module that writes anything
// ---------------------------------------------------------------------------

export interface AiApplyResult {
  groupsApplied: number;
  collectionsCreated: number;
  collectionsMerged: number;
  linksMoved: number;
}

/**
 * Applies an AiPlan whose `groups` array already contains ONLY the
 * user-accepted groups (AiOrganizeDialog filters out unchecked groups
 * before calling this — see its "Apply (N groups)" handler). For each
 * group: creates a new collection, or merges into an existing live one
 * with the same name (`planApplication`'s rule); moves every member link
 * there via `moveLinkToEnd`; and applies that link's AI tags via
 * `updateLink`, merged with its current tags (`mergeTags`). Every write
 * goes through the same repos every other mutation in this app uses, so
 * tombstones/pendingOps/sync hold exactly like any other change — nothing
 * here bypasses that.
 *
 * `sourceCollectionId` is accepted for interface symmetry with the
 * dialog's "before -> after" preview (every member link's "before" label
 * is this one collection, since AiOrganizeDialog only ever organizes a
 * single collection's links at a time) — apply behavior itself doesn't
 * special-case it: a group's links move to their target regardless of
 * which collection they started in, which is the entire point of
 * cross-collection AI regrouping.
 *
 * Fires exactly ONE `sendSyncNudge()` after every write below has
 * committed — not per group, not per link — same "keep the touch surface
 * small" precedent lib/sync-nudge.ts's docstring sets for every other
 * multi-write App-level action (drag-reorder, bulk delete, ...).
 */
export async function applyPlan(
  plan: AiPlan,
  sourceCollectionId: string,
  db: BurrowDB = getDB(),
): Promise<AiApplyResult> {
  void sourceCollectionId; // see docstring: kept for interface symmetry, not branched on.

  const existing: Collection[] = await listCollections(db);
  const actions = planApplication(plan.groups, existing);

  let collectionsCreated = 0;
  let collectionsMerged = 0;
  let linksMoved = 0;

  for (let i = 0; i < plan.groups.length; i++) {
    const group = plan.groups[i]!;
    const action = actions[i]!;

    let targetId: string;
    if (action.kind === "create") {
      const created = await createCollection(group.name, undefined, db);
      targetId = created.id;
      collectionsCreated++;
    } else {
      targetId = action.targetCollectionId;
      collectionsMerged++;
    }

    for (const linkId of group.linkIds) {
      await moveLinkToEnd(linkId, targetId, db);
      linksMoved++;

      const incomingTags = plan.tags[linkId] ?? [];
      if (incomingTags.length > 0) {
        // Direct table read (not a repo export — there is no getLink(id)
        // today): same "lib code may read db.* directly for a lookup no
        // repo exposes yet" precedent lib/dashboard.ts's
        // countLinksByCollection already sets.
        const row = await db.links.get(linkId);
        if (row) {
          const merged = mergeTags(row.tags, incomingTags);
          await updateLink(linkId, { tags: merged }, db);
        }
      }
    }
  }

  sendSyncNudge();

  return { groupsApplied: plan.groups.length, collectionsCreated, collectionsMerged, linksMoved };
}

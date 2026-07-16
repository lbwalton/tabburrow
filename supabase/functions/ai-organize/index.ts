// T19: ai-organize Edge Function: metered server-side proxy that calls
// Claude to group and tag a user's saved links.
//
// Contract (docs/specs/2026-07-15-tabburrow-design.md §7,
// .superpowers/sdd/task-19-brief.md):
//   POST, JWT required. Body: {links: [{id, title, url}]}, max 100.
//   Free plan: 30 uses/calendar month (server-side reset). PRO: fair-use
//   soft cap 1000/mo. 402 {error:"quota", used, limit} when exhausted.
//   Calls Claude (claude-haiku-4-5-20251001) with a tool-forced JSON
//   output: {groups:[{name, emoji, link_ids}], tags:{[link_id]: string[]}}.
//   Metering increments happen atomically in Postgres BEFORE the Anthropic
//   call (see supabase/migrations/0004_ai_metering.sql) and are refunded
//   on any failure, so "count untouched on failure" holds without a
//   read-modify-write race in this function.
import { handleCorsPreflight } from "../_shared/cors.ts";
import { errorResponse, jsonResponse } from "../_shared/json.ts";
import { createServiceRoleClient, requireUser } from "../_shared/auth.ts";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 2048;
const TEMPERATURE = 0.2;
const ANTHROPIC_VERSION = "2023-06-01";
const ORGANIZE_TOOL_NAME = "organize_links";
const FALLBACK_EMOJI = "🗂️";

const MAX_LINKS = 100;
const TITLE_MAX = 200;
const URL_MAX = 500;

const FREE_LIMIT = 30;
const PRO_SOFT_CAP = 1000;

export interface LinkInput {
  id: string;
  title: string;
  url: string;
}

export interface OrganizeGroup {
  name: string;
  emoji: string;
  link_ids: string[];
}

export interface OrganizeResult {
  groups: OrganizeGroup[];
  tags: Record<string, string[]>;
}

// ---------------------------------------------------------------------------
// Request body parsing/validation
// ---------------------------------------------------------------------------

export type ParsedBody = { ok: true; links: LinkInput[] } | { ok: false; reason: "invalid_body" | "too_many_links" };

/**
 * Validates {links: [{id, title, url}]}: 1-100 entries, every field a
 * non-empty string, ids unique (a duplicate id would make "every link_id
 * assigned exactly once" ambiguous downstream). Anything else is
 * "invalid_body"; over the cap is the distinct "too_many_links" reason,
 * both map to 400 in the handler.
 */
export function parseRequestBody(raw: unknown): ParsedBody {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "invalid_body" };
  const links = (raw as Record<string, unknown>).links;
  if (!Array.isArray(links) || links.length === 0) return { ok: false, reason: "invalid_body" };
  if (links.length > MAX_LINKS) return { ok: false, reason: "too_many_links" };

  const seen = new Set<string>();
  const result: LinkInput[] = [];
  for (const entry of links) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return { ok: false, reason: "invalid_body" };
    const { id, title, url } = entry as Record<string, unknown>;
    if (typeof id !== "string" || id.trim().length === 0) return { ok: false, reason: "invalid_body" };
    if (typeof title !== "string" || title.trim().length === 0) return { ok: false, reason: "invalid_body" };
    if (typeof url !== "string" || url.trim().length === 0) return { ok: false, reason: "invalid_body" };
    if (seen.has(id)) return { ok: false, reason: "invalid_body" };
    seen.add(id);
    result.push({ id, title, url });
  }
  return { ok: true, links: result };
}

/** Prompt-size control: caps what we forward to Anthropic regardless of how long a real tab's title/URL is, independent of the 100-link cap above. */
function forPrompt(links: LinkInput[]): Array<{ id: string; title: string; url: string }> {
  return links.map((l) => ({
    id: l.id,
    title: l.title.length > TITLE_MAX ? l.title.slice(0, TITLE_MAX) : l.title,
    url: l.url.length > URL_MAX ? l.url.slice(0, URL_MAX) : l.url,
  }));
}

// ---------------------------------------------------------------------------
// Anthropic call
// ---------------------------------------------------------------------------

function organizeTool() {
  return {
    name: ORGANIZE_TOOL_NAME,
    description: "Return the grouping and tags for the provided links.",
    input_schema: {
      type: "object",
      properties: {
        groups: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Short, human, specific group name (max 40 characters)." },
              emoji: { type: "string", description: "A single emoji representing the group." },
              link_ids: { type: "array", items: { type: "string" } },
            },
            required: ["name", "emoji", "link_ids"],
          },
        },
        tags: {
          type: "object",
          description: "Map of link id -> up to 5 short, lowercase tags for that link.",
          additionalProperties: { type: "array", items: { type: "string" } },
        },
      },
      required: ["groups", "tags"],
    },
  };
}

/** Documents the "relax to 1 group when input < 4 links" rule from the input side too, so the model's own choice matches what validateAndNormalize will accept. */
function systemPrompt(linkCount: number): string {
  const groupRule =
    linkCount < 4
      ? "Create 1 to 6 groups; a single group is fine given how few links there are."
      : "Create 2 to 6 groups.";
  return [
    "You organize a browser user's saved links into named groups by topic or task.",
    groupRule,
    "Give each group a short, human, specific name (max 40 characters, non-empty) and exactly one representative emoji.",
    "Every link_id from the input must be assigned to EXACTLY ONE group: never zero groups, never more than one.",
    "Only use link_ids that appear in the input. Never invent, rename, or drop ids.",
    "Also return up to 5 short, lowercase tags per link describing its topic, keyed by link id.",
  ].join(" ");
}

// deno-lint-ignore no-explicit-any
type AnthropicMessage = { role: "user" | "assistant"; content: any };

async function callAnthropic(
  apiKey: string,
  system: string,
  messages: AnthropicMessage[],
  // deno-lint-ignore no-explicit-any
): Promise<{ ok: true; content: any[] } | { ok: false }> {
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        system,
        messages,
        tools: [organizeTool()],
        tool_choice: { type: "tool", name: ORGANIZE_TOOL_NAME },
      }),
    });
  } catch {
    return { ok: false };
  }
  if (!res.ok) return { ok: false };
  const body = await res.json().catch(() => null);
  if (!body || !Array.isArray(body.content)) return { ok: false };
  return { ok: true, content: body.content };
}

// deno-lint-ignore no-explicit-any
function extractToolUse(content: any[]): { id: string; input: unknown } | null {
  for (const block of content) {
    if (block && typeof block === "object" && block.type === "tool_use" && block.name === ORGANIZE_TOOL_NAME) {
      return { id: block.id, input: block.input };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Validation + normalization of the model's tool call
// ---------------------------------------------------------------------------

export type ValidationResult = { ok: true; result: OrganizeResult } | { ok: false; reason: string };

/** True iff `s` is exactly one Unicode grapheme cluster (an emoji like "🗂️" or "👨‍👩‍👧" is one grapheme even though it's several code points). */
function isSingleGrapheme(s: string): boolean {
  if (s.length === 0) return false;
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  let count = 0;
  for (const _ of segmenter.segment(s)) {
    count++;
    if (count > 1) return false;
  }
  return count === 1;
}

/**
 * Validates the model's tool_use input against the input link ids, and
 * normalizes cosmetic fields. Two different failure modes on purpose:
 *  - Structural problems (unknown ids, an id assigned to 0 or 2+ groups,
 *    group count out of [minGroups, 6], an empty/overlong name) are hard
 *    validation failures; these trigger the one-shot retry in the
 *    caller.
 *  - Emoji and tags are corrected in place instead of failing: a
 *    non-single-grapheme emoji falls back to FALLBACK_EMOJI, and tags are
 *    lowercased/trimmed/deduped/capped at 5 per link. Neither is worth
 *    spending the one retry on.
 */
export function validateAndNormalize(raw: unknown, inputIds: string[]): ValidationResult {
  const idSet = new Set(inputIds);
  if (raw === null || typeof raw !== "object") return { ok: false, reason: "tool input is not an object" };

  const groupsRaw = (raw as Record<string, unknown>).groups;
  const tagsRaw = (raw as Record<string, unknown>).tags;
  if (!Array.isArray(groupsRaw)) return { ok: false, reason: "groups is not an array" };

  const minGroups = inputIds.length < 4 ? 1 : 2;
  if (groupsRaw.length < minGroups || groupsRaw.length > 6) {
    return { ok: false, reason: `expected ${minGroups}-6 groups, got ${groupsRaw.length}` };
  }

  const groups: OrganizeGroup[] = [];
  const seenCounts = new Map<string, number>();
  for (const g of groupsRaw) {
    if (g === null || typeof g !== "object") return { ok: false, reason: "group is not an object" };
    const rawName = (g as Record<string, unknown>).name;
    let emoji = (g as Record<string, unknown>).emoji;
    const linkIds = (g as Record<string, unknown>).link_ids;

    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (name.length === 0 || name.length > 40) return { ok: false, reason: "invalid group name" };

    if (typeof emoji !== "string" || !isSingleGrapheme(emoji)) emoji = FALLBACK_EMOJI;

    if (!Array.isArray(linkIds) || linkIds.some((id) => typeof id !== "string")) {
      return { ok: false, reason: "link_ids is not a string array" };
    }
    for (const id of linkIds as string[]) {
      if (!idSet.has(id)) return { ok: false, reason: `unknown link_id in groups: ${id}` };
      seenCounts.set(id, (seenCounts.get(id) ?? 0) + 1);
    }
    groups.push({ name, emoji: emoji as string, link_ids: linkIds as string[] });
  }

  for (const id of inputIds) {
    if ((seenCounts.get(id) ?? 0) !== 1) return { ok: false, reason: `link_id not assigned exactly once: ${id}` };
  }

  if (tagsRaw === null || typeof tagsRaw !== "object" || Array.isArray(tagsRaw)) {
    return { ok: false, reason: "tags is not an object" };
  }
  const tags: Record<string, string[]> = {};
  for (const [id, value] of Object.entries(tagsRaw as Record<string, unknown>)) {
    if (!idSet.has(id)) return { ok: false, reason: `unknown link_id in tags: ${id}` };
    if (!Array.isArray(value) || value.some((t) => typeof t !== "string")) {
      return { ok: false, reason: `invalid tags value for ${id}` };
    }
    const cleaned = Array.from(
      new Set((value as string[]).map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0)),
    ).slice(0, 5);
    tags[id] = cleaned;
  }

  return { ok: true, result: { groups, tags } };
}

function correctionMessage(reason: string, inputIds: string[]): string {
  return (
    `That result was invalid: ${reason}. ` +
    `Call organize_links again, using ONLY these link_ids, each in exactly one group: ${JSON.stringify(inputIds)}.`
  );
}

export type OrganizeOutcome =
  | { ok: true; result: OrganizeResult }
  | { ok: false; reason: "upstream" }
  | { ok: false; reason: "upstream_shape" };

/**
 * Calls Anthropic, validates the tool call, and retries ONCE with a
 * corrective message if validation fails. A transient API-level failure
 * (network error, non-2xx) is NOT retried here: it maps straight to
 * "upstream" since re-asking a down/erroring API rarely helps; only a
 * shape problem in an otherwise-successful response gets the one retry,
 * ending in "upstream_shape" if the second attempt is still invalid.
 */
export async function organizeWithRetry(apiKey: string, links: LinkInput[]): Promise<OrganizeOutcome> {
  const inputIds = links.map((l) => l.id);
  const system = systemPrompt(links.length);
  const promptLinks = forPrompt(links);

  let messages: AnthropicMessage[] = [
    { role: "user", content: `Organize these links into groups and tags.\n\n${JSON.stringify(promptLinks)}` },
  ];

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await callAnthropic(apiKey, system, messages);
    if (!res.ok) return { ok: false, reason: "upstream" };

    const toolUse = extractToolUse(res.content);
    const validated = toolUse
      ? validateAndNormalize(toolUse.input, inputIds)
      : ({ ok: false, reason: "model did not call organize_links" } as const);

    if (validated.ok) return { ok: true, result: validated.result };
    if (attempt === 1) return { ok: false, reason: "upstream_shape" };

    const assistantContent = res.content.length > 0 ? res.content : [{ type: "text", text: "(empty response)" }];
    const correctionText = toolUse
      ? correctionMessage(validated.reason, inputIds)
      : `You must call the organize_links tool. ${correctionMessage(validated.reason, inputIds)}`;
    const userTurn = toolUse
      ? [{ type: "tool_result", tool_use_id: toolUse.id, content: correctionText }]
      : [{ type: "text", text: correctionText }];

    messages = [
      ...messages,
      { role: "assistant", content: assistantContent },
      { role: "user", content: userTurn },
    ];
  }

  // Unreachable (the loop always returns by the second iteration), kept for type-safety.
  return { ok: false, reason: "upstream_shape" };
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

interface MeterRow {
  allowed: boolean;
  used: number;
  plan: string;
}

export async function handleRequest(req: Request): Promise<Response> {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return errorResponse("method_not_allowed", 405);
  }

  const authResult = await requireUser(req);
  if (!authResult.ok) return authResult.response;
  const user = authResult.user;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return errorResponse("invalid_body", 400);
  }

  const parsed = parseRequestBody(rawBody);
  if (!parsed.ok) {
    return errorResponse(parsed.reason, 400);
  }

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) {
    // Self-hosters who haven't set the secret yet (see SELF_HOSTING.md).
    // Checked BEFORE metering so a misconfigured deploy never burns a use.
    return errorResponse("upstream", 502);
  }

  const serviceClient = createServiceRoleClient();
  const { data: meterData, error: meterError } = await serviceClient
    .rpc("consume_ai_use", { p_user_id: user.id, p_free_limit: FREE_LIMIT, p_soft_cap: PRO_SOFT_CAP })
    .single();
  const meterRow = meterData as MeterRow | null;

  if (meterError || !meterRow) {
    return errorResponse("metering_failed", 500);
  }

  if (!meterRow.allowed) {
    const limit = meterRow.plan === "pro" ? PRO_SOFT_CAP : FREE_LIMIT;
    return errorResponse("quota", 402, { used: meterRow.used, limit });
  }

  const organized = await organizeWithRetry(anthropicKey, parsed.links);
  if (!organized.ok) {
    // Compensates the increment consume_ai_use already made; see
    // supabase/migrations/0004_ai_metering.sql's docstring for why this
    // stays race-safe.
    await serviceClient.rpc("refund_ai_use", { p_user_id: user.id });
    return errorResponse(organized.reason, 502);
  }

  return jsonResponse(organized.result, 200);
}

// Only start the HTTP listener when this file is run directly (`supabase
// functions serve` / deployed), never when test.ts imports handleRequest
// and the pure helpers above for direct, in-process testing.
if (import.meta.main) {
  Deno.serve(handleRequest);
}

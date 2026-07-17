// On-device AI organize via Chrome's Prompt API (Gemini Nano). This is the
// FREE, private, key-less counterpart to lib/ai.ts's cloud `organizeLinks`:
// the model runs on the user's machine, nothing leaves the device, and there
// is no per-use metering (the local path is unlimited). `lib/ai.ts` routes to
// this engine when Nano reports `"available"` and the batch fits Nano's small
// (~4K token) context window; anything else falls back to the metered Claude
// cloud path.
//
// The response contract this module reproduces on-device is the SERVER's
// (supabase/functions/ai-organize/index.ts): the model returns
// `{ groups: [{ name, emoji, link_ids }], tags: { [link_id]: string[] } }`,
// and `validateAndNormalizeLocal` below is a faithful port of that file's
// `validateAndNormalize` (same group-count bounds, same "every id assigned
// exactly once", same single-grapheme emoji + <=5 lowercase tags rules) so a
// plan produced on-device is indistinguishable from a cloud plan by the time
// it reaches `applyPlan`. Model output is UNTRUSTED: we only `JSON.parse` it
// (never assign to innerHTML), then hard-validate it.
//
// Prompt API facts followed here (docs/plans/2026-07-17-popup-hub-redesign.md
// "Gemini Nano facts"): `self.LanguageModel`; `availability()` ->
// "unavailable"|"downloadable"|"downloading"|"available"; `create({ monitor })`
// on a user gesture; `session.prompt(text, { responseConstraint: <JSONSchema> })`;
// `session.destroy()` when done.
import type { Link } from "@tabburrow/core";
import { parseOrganizeResponse, toWireLinks } from "./ai";
import type { AiPlan } from "./ai";

/** The four states Chrome's `LanguageModel.availability()` can report. */
export type NanoAvailability = "unavailable" | "downloadable" | "downloading" | "available";

/** The most links we ever send to Nano in one prompt — its context window is small (~4K in), so bigger batches route to the cloud path instead of being silently truncated. Mirrors the plan doc's "target ~25/call, hard cap here". */
export const LOCAL_MAX_LINKS = 40;

/** Same fallback the server uses for a non-single-grapheme emoji (supabase/functions/ai-organize/index.ts). */
const FALLBACK_EMOJI = "🗂️";
/** Same server-side title/url caps — belt-and-suspenders for Nano's small context, independent of LOCAL_MAX_LINKS. */
const TITLE_MAX = 200;
const URL_MAX = 500;

export type AiLocalErrorCode = "too_many" | "unavailable" | "upstream";

/**
 * Typed error `organizeLinksLocal` throws instead of a raw exception, so the
 * caller (lib/ai.ts's `organizeLinks`) can catch it and fall back to the
 * cloud path. `code` distinguishes the "this batch is too big for Nano"
 * (`"too_many"`) case from a genuine model/shape failure (`"upstream"`) or a
 * disappeared global (`"unavailable"`) — the router treats all three the same
 * (fall back to cloud), but tests and future callers can branch on it.
 */
export class AiLocalError extends Error {
  readonly code: AiLocalErrorCode;
  constructor(code: AiLocalErrorCode, message: string) {
    super(message);
    this.name = "AiLocalError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Chrome Prompt API surface (experimental — not in TS's lib types yet)
// ---------------------------------------------------------------------------

interface LanguageModelMonitor {
  addEventListener(type: "downloadprogress", listener: (event: { loaded: number }) => void): void;
}

interface LanguageModelExpectation {
  type: "text";
  languages: string[];
}

interface LanguageModelCreateOptions {
  initialPrompts?: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  monitor?: (monitor: LanguageModelMonitor) => void;
  expectedInputs?: LanguageModelExpectation[];
  expectedOutputs?: LanguageModelExpectation[];
}

interface LanguageModelSession {
  prompt(input: string, options?: { responseConstraint?: object }): Promise<string>;
  destroy(): void;
}

interface LanguageModelStatic {
  availability(options?: {
    expectedInputs?: LanguageModelExpectation[];
    expectedOutputs?: LanguageModelExpectation[];
  }): Promise<NanoAvailability>;
  create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
}

/**
 * The `LanguageModel` global if this context exposes it (extension document /
 * worker on Chrome 138+), else `undefined`. Guarded so a runtime WITHOUT
 * `self` at all (e.g. a bare Node test process) is treated as "no Nano" rather
 * than throwing a ReferenceError.
 */
function getLanguageModel(): LanguageModelStatic | undefined {
  try {
    if (!("LanguageModel" in self)) return undefined;
    return (self as unknown as { LanguageModel?: LanguageModelStatic }).LanguageModel;
  } catch {
    return undefined;
  }
}

/**
 * Whether on-device Nano is usable here, and if so what state it's in. Returns
 * `"unavailable"` immediately when the global is missing (mobile, older
 * Chrome, weak hardware) and NEVER throws — any error querying availability is
 * folded into `"unavailable"` so the caller can safely fall back to cloud.
 */
export async function nanoAvailability(): Promise<NanoAvailability> {
  try {
    if (!("LanguageModel" in self)) return "unavailable";
    const lm = (self as unknown as { LanguageModel: LanguageModelStatic }).LanguageModel;
    return await lm.availability({
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
    });
  } catch {
    return "unavailable";
  }
}

// ---------------------------------------------------------------------------
// Prompt + JSON Schema (mirror the server's tool schema and system prompt)
// ---------------------------------------------------------------------------

/**
 * JSON Schema handed to `session.prompt` as `responseConstraint` so Nano emits
 * exactly `{ groups: [{ name, emoji, link_ids }], tags: {...} }` — the same
 * shape supabase/functions/ai-organize/index.ts's `organizeTool` input_schema
 * forces from Claude.
 */
const ORGANIZE_SCHEMA = {
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
} as const;

/** Faithful port of the server's `systemPrompt(linkCount)` (supabase/functions/ai-organize/index.ts) — same group-count rule, same "assign every id exactly once", same tag guidance. */
function localSystemPrompt(linkCount: number): string {
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
    "Respond with ONLY the JSON object; no prose.",
  ].join(" ");
}

/** Wire links -> the compact prompt payload, truncating overlong titles/urls the same way the server's `forPrompt` does. */
function forPrompt(links: Link[]): Array<{ id: string; title: string; url: string }> {
  return toWireLinks(links).map((l) => ({
    id: l.id,
    title: l.title.length > TITLE_MAX ? l.title.slice(0, TITLE_MAX) : l.title,
    url: l.url.length > URL_MAX ? l.url.slice(0, URL_MAX) : l.url,
  }));
}

function correctionMessage(reason: string, inputIds: string[]): string {
  return (
    `That result was invalid: ${reason}. ` +
    `Respond again with the organize JSON, using ONLY these link_ids, each in exactly one group: ${JSON.stringify(inputIds)}.`
  );
}

// ---------------------------------------------------------------------------
// Validation + normalization (faithful port of the server's validateAndNormalize)
// ---------------------------------------------------------------------------

interface NormalizedResult {
  groups: Array<{ name: string; emoji: string; link_ids: string[] }>;
  tags: Record<string, string[]>;
}

type LocalValidation = { ok: true; result: NormalizedResult } | { ok: false; reason: string };

/** True iff `s` is exactly one Unicode grapheme cluster (mirrors the server's `isSingleGrapheme`). */
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
 * Hard-validates the model's JSON against the input ids and normalizes cosmetic
 * fields — a faithful reimplementation of the server's `validateAndNormalize`
 * (supabase/functions/ai-organize/index.ts). Structural problems (unknown ids,
 * an id in 0 or 2+ groups, group count out of [minGroups, 6], an empty/overlong
 * name) are hard failures that trigger the one corrective retry. Emoji and tags
 * are corrected in place instead of failing (non-single-grapheme -> fallback;
 * tags lowercased/trimmed/deduped/capped at 5).
 */
export function validateAndNormalizeLocal(raw: unknown, inputIds: string[]): LocalValidation {
  const idSet = new Set(inputIds);
  if (raw === null || typeof raw !== "object") return { ok: false, reason: "output is not an object" };

  const groupsRaw = (raw as Record<string, unknown>).groups;
  const tagsRaw = (raw as Record<string, unknown>).tags;
  if (!Array.isArray(groupsRaw)) return { ok: false, reason: "groups is not an array" };

  const minGroups = inputIds.length < 4 ? 1 : 2;
  if (groupsRaw.length < minGroups || groupsRaw.length > 6) {
    return { ok: false, reason: `expected ${minGroups}-6 groups, got ${groupsRaw.length}` };
  }

  const groups: NormalizedResult["groups"] = [];
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

// ---------------------------------------------------------------------------
// organizeLinksLocal — the on-device counterpart to ai.ts's organizeLinks
// ---------------------------------------------------------------------------

export interface OrganizeLocalOptions {
  /** Called with 0..100 while Nano downloads its model on first use. */
  onDownloadProgress?: (pct: number) => void;
}

/**
 * Runs AI organize entirely on-device. Returns the SAME `AiPlan` shape the
 * cloud `organizeLinks` produces, so the dialog/`applyPlan` can't tell the two
 * engines apart. NEVER records the local metering counter — on-device use is
 * free and unlimited.
 *
 * Failure handling (all mapped to `AiLocalError`, never a raw throw):
 *  - more than `LOCAL_MAX_LINKS` links -> `"too_many"` (caller routes to cloud
 *    rather than us silently dropping links).
 *  - Nano global gone between the availability check and here -> `"unavailable"`.
 *  - a model/API error, or a shape that's still invalid after ONE corrective
 *    retry -> `"upstream"` (mirrors the server's "API failure isn't retried,
 *    one shape retry" policy in `organizeWithRetry`).
 *
 * The session is always `destroy()`ed in a `finally`.
 */
export async function organizeLinksLocal(links: Link[], opts?: OrganizeLocalOptions): Promise<AiPlan> {
  if (links.length > LOCAL_MAX_LINKS) {
    throw new AiLocalError("too_many", `On-device AI handles up to ${LOCAL_MAX_LINKS} links at once.`);
  }

  const lm = getLanguageModel();
  if (!lm) {
    throw new AiLocalError("unavailable", "On-device AI is not available on this device.");
  }

  const promptLinks = forPrompt(links);
  const inputIds = promptLinks.map((l) => l.id);
  const userText = `Organize these links into groups and tags.\n\n${JSON.stringify(promptLinks)}`;

  let session: LanguageModelSession;
  try {
    session = await lm.create({
      initialPrompts: [{ role: "system", content: localSystemPrompt(links.length) }],
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
      monitor: opts?.onDownloadProgress
        ? (monitor) => {
            monitor.addEventListener("downloadprogress", (event) => {
              opts.onDownloadProgress?.(Math.round((event.loaded ?? 0) * 100));
            });
          }
        : undefined,
    });
  } catch {
    throw new AiLocalError("upstream", "On-device AI could not start. Falling back.");
  }

  try {
    let reason = "";
    // Attempt 0 is the real ask; attempt 1 re-prompts the SAME (stateful)
    // session with the validation error, exactly one corrective retry.
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = attempt === 0 ? userText : correctionMessage(reason, inputIds);

      let output: string;
      try {
        output = await session.prompt(text, { responseConstraint: ORGANIZE_SCHEMA });
      } catch {
        // An API-level failure isn't worth the retry (mirrors the server).
        throw new AiLocalError("upstream", "On-device AI is temporarily unavailable.");
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(output);
      } catch {
        if (attempt === 1) throw new AiLocalError("upstream", "On-device AI returned invalid output.");
        reason = "output was not valid JSON";
        continue;
      }

      const validated = validateAndNormalizeLocal(parsed, inputIds);
      if (validated.ok) {
        // Reuse the cloud parser for the snake_case -> camelCase mapping and
        // the empty-name fallback; validation above guarantees it won't throw.
        return parseOrganizeResponse(validated.result);
      }
      if (attempt === 1) throw new AiLocalError("upstream", "On-device AI returned an invalid plan.");
      reason = validated.reason;
    }

    // Unreachable: the loop always returns or throws by the second iteration.
    throw new AiLocalError("upstream", "On-device AI returned an invalid plan.");
  } finally {
    try {
      session.destroy();
    } catch {
      // Best-effort cleanup; a destroy failure must not mask the real result.
    }
  }
}

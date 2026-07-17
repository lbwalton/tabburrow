// Save-target resolution: the pure decision that turns a persisted "how should
// a 1-click Save pick its folder" preference into a concrete target collection
// (or "we need to ask the user"). All of it is pure so App.tsx can compute the
// resolved target from live data on every render without a DB round trip, and
// every branch is unit tested (see saveTarget.test.ts) with plain Collection
// arrays.
import type { Collection } from "@tabburrow/core";

/**
 * How the popup's one-click Save decides which folder to save into:
 *  - `"default"`  — always the pinned default folder (`defaultCollectionId`).
 *  - `"last-used"`— whichever folder was saved into last (`lastUsedCollectionId`).
 *  - `"ask"`      — never assume; open the picker every time.
 */
export type SaveTargetMode = "default" | "last-used" | "ask";

/** meta key for the persisted `SaveTargetMode`. Absent → treated as `"default"` (the zero-config path). */
export const SAVE_TARGET_MODE_META_KEY = "saveTargetMode";
/** meta key for the pinned default folder id used in `"default"` mode. */
export const DEFAULT_COLLECTION_META_KEY = "defaultCollectionId";

/** The mode out of the box: pin-on-first-save default, so the first Save opens the picker and pins the chosen folder. */
export const DEFAULT_SAVE_TARGET_MODE: SaveTargetMode = "default";

const VALID_MODES: readonly SaveTargetMode[] = ["default", "last-used", "ask"];

/** Parses a stored `saveTargetMode` meta value. Anything absent/unknown falls back to `DEFAULT_SAVE_TARGET_MODE`. */
export function parseSaveTargetMode(value: string | null | undefined): SaveTargetMode {
  return VALID_MODES.includes(value as SaveTargetMode) ? (value as SaveTargetMode) : DEFAULT_SAVE_TARGET_MODE;
}

export interface SaveTargetResolution {
  /** The live collection a 1-click Save should go into, or null when the picker must be opened. */
  target: Collection | null;
  /** True when there is no resolved target and the user must be asked to pick one. */
  needsPicker: boolean;
}

/**
 * Pure: given the LIVE collections and the persisted preference, decide the
 * 1-click Save target.
 *
 * - `"ask"` never resolves a target (always the picker).
 * - `"last-used"` / `"default"` resolve to the live collection whose id matches
 *   `lastUsedId` / `defaultId` respectively. A stored id pointing at a
 *   deleted/missing collection (not present in `collections`, which is the LIVE
 *   list) counts as unset — the picker is needed.
 *
 * `collections` must be the live list (what `listCollections` returns); a
 * tombstoned folder simply won't be in it, so "points at a deleted folder" and
 * "points at nothing" collapse to the same `needsPicker: true` result.
 */
export function resolveSaveTarget(
  collections: Collection[],
  mode: SaveTargetMode,
  defaultId: string | null,
  lastUsedId: string | null,
): SaveTargetResolution {
  if (mode === "ask") return { target: null, needsPicker: true };
  const wantedId = mode === "last-used" ? lastUsedId : defaultId;
  const target = wantedId ? collections.find((c) => c.id === wantedId) ?? null : null;
  return target ? { target, needsPicker: false } : { target: null, needsPicker: true };
}

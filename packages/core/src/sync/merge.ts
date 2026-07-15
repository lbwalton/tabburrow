import type { Syncable } from "./types";

/**
 * Resolves a conflict between the local and remote copy of one row using
 * last-write-wins by `updatedAt`, with a deterministic tie-break:
 *
 *  - Higher `updatedAt` wins outright.
 *  - On an EXACT tie, a tombstoned row (`deletedAt != null`) beats a live
 *    one — regardless of which side (local or remote) holds the tombstone.
 *  - If both sides are tombstoned, or both are live, on a tie the remote
 *    copy wins. This keeps the outcome identical no matter which device
 *    resolves the tie (there is nothing else to break it by).
 *
 * `winner` is always exactly the `local` or `remote` object passed in (never
 * a synthesized merge of fields), so `changed` can be computed by reference:
 * it's `true` whenever the winner isn't the local row already on disk —
 * including when there was no local row at all.
 */
export function mergeRow<T extends Syncable>(
  local: T | undefined,
  remote: T,
): { winner: T; changed: boolean } {
  if (!local) {
    return { winner: remote, changed: true };
  }

  let winner: T;
  if (remote.updatedAt !== local.updatedAt) {
    winner = remote.updatedAt > local.updatedAt ? remote : local;
  } else {
    const localTombstoned = local.deletedAt !== null;
    const remoteTombstoned = remote.deletedAt !== null;
    winner = localTombstoned && !remoteTombstoned ? local : remote;
  }

  return { winner, changed: winner !== local };
}

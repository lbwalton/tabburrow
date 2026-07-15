/**
 * Fractional indexing: generates order keys for drag-and-drop reordering.
 *
 * Positions are plain strings compared with ordinary JS `<`/`>` (lexicographic
 * by char code). Given two neighboring positions, `positionBetween` produces a
 * new key strictly between them without ever rewriting the neighbors' keys.
 *
 * Alphabet is base-62, ASCII/lexicographic order: digits < uppercase < lowercase,
 * matching plain string comparison (and Dexie's index ordering).
 */
export const ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const BASE = ALPHABET.length; // 62

/**
 * Generated (and accepted) keys must never end with the alphabet's first
 * character ("0"). Such a key is the *immediate* successor of its own prefix
 * (there is no shorter/equal-length string that sorts strictly before it and
 * after that prefix), so nothing could ever be inserted immediately before it.
 */
function validateKey(key: string, label: string): void {
  if (key.length === 0) {
    throw new Error(`positionBetween: ${label} must not be an empty string`);
  }
  for (const ch of key) {
    if (!ALPHABET.includes(ch)) {
      throw new Error(
        `positionBetween: ${label} contains a character outside the base-62 alphabet: "${ch}"`,
      );
    }
  }
}

/** Digit value of `s` at position `i`, treating a null/exhausted string as 0. */
function lowerDigit(s: string | null, i: number): number {
  if (s === null) return 0;
  return i < s.length ? ALPHABET.indexOf(s[i]!) : 0;
}

// Defensive cap on walk depth: a real bug could otherwise loop forever.
// Legitimate inputs terminate in well under this many steps.
const MAX_WALK = 10_000;

/**
 * Standard fractional-indexing midpoint: walk both keys character by
 * character; wherever the two keys' digit ranges leave room for a distinct
 * digit strictly between them, emit it and stop. Where they're equal or only
 * adjacent (no room yet), carry the lower digit forward and keep walking —
 * this is what forces the "aV" style suffix extension between adjacent keys.
 *
 * `a === null` means open-ended (below everything); `b === null` behaves the
 * same. Note: for repeated end-of-list appends, `positionBetween` below
 * routes to `incrementKey` instead of this, since walking to an unconstrained
 * upper bound over and over would grow keys much faster than needed.
 */
function midpointKey(a: string | null, b: string | null): string {
  let result = "";
  // Whether `b` still constrains the walk. It stops constraining as soon as
  // the result has diverged strictly below it (an "adjacent digits" step).
  // While it's still constraining and `b` runs out of characters, the result
  // would have to become a proper (larger) extension of `b` to continue —
  // i.e. there is no valid key left between `a` and `b`. That can only occur
  // if `b` itself ends in the forbidden "0" digit (see ALPHABET[0] comment
  // above); our own generator never produces such a key, but guard it here
  // rather than silently returning a key that isn't actually less than `b`.
  let bConstrains = b !== null;
  for (let i = 0; i < MAX_WALK; i++) {
    const da = lowerDigit(a, i);
    let db: number;
    if (!bConstrains) {
      db = BASE;
    } else if (i < b!.length) {
      db = ALPHABET.indexOf(b![i]!);
    } else {
      throw new Error(
        `positionBetween: no key exists before upper bound "${b}" (it ends in the reserved trailing digit)`,
      );
    }
    const gap = db - da;
    if (gap >= 2) {
      const mid = da + Math.floor(gap / 2);
      return result + ALPHABET[mid];
    }
    if (gap === 1) bConstrains = false;
    result += ALPHABET[da];
  }
  throw new Error("positionBetween: unable to compute a midpoint for the given inputs");
}

/**
 * Smallest key strictly greater than `a`, chosen to keep repeated
 * append-at-end calls short: bump the last character by one when possible
 * (same length), or extend with a low, non-zero character when the last
 * character is already at the top of the alphabet.
 */
function incrementKey(a: string): string {
  const lastIndex = ALPHABET.indexOf(a[a.length - 1]!);
  if (lastIndex < BASE - 1) {
    return a.slice(0, -1) + ALPHABET[lastIndex + 1];
  }
  // Last char is already the max ("z"): extend. Start the new char at index 1
  // ("1", not "0") so the appended char isn't the forbidden trailing zero and
  // has maximal room for further increments before it needs to extend again.
  return a + ALPHABET[1];
}

/**
 * Returns a base-62 key strictly between `a` and `b`. `null` means an open
 * end (no lower/upper bound). Throws if `a >= b`, if either is an empty
 * string, or if either contains a character outside the alphabet.
 */
export function positionBetween(a: string | null, b: string | null): string {
  if (a !== null) validateKey(a, "a");
  if (b !== null) validateKey(b, "b");
  if (a !== null && b !== null && a >= b) {
    throw new Error(`positionBetween: a ("${a}") must be strictly less than b ("${b}")`);
  }

  if (a !== null && b === null) {
    // Open upper bound with a known lower neighbor: this is the
    // append-at-end case, optimized so long sequential runs stay short.
    return incrementKey(a);
  }

  return midpointKey(a, b);
}

/** First-ever position: `positionBetween(null, null)`. */
export function firstPosition(): string {
  return positionBetween(null, null);
}

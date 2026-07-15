/**
 * Sorts rows ascending by their fractional-index `position`, using plain
 * string comparison (matching the ordering `positionBetween` guarantees).
 * Returns a new array; does not mutate the input.
 */
export function sortByPosition<T extends { position: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.position < b.position) return -1;
    if (a.position > b.position) return 1;
    return 0;
  });
}

/**
 * The greatest `position` among `rows` (plain string comparison), or `null`
 * if `rows` is empty. Used to append a new row at the end of a list via
 * `positionBetween(lastPosition, null)`.
 *
 * Considers ALL rows passed in, tombstoned or not: positions are assigned
 * from the whole table's key space, not just the currently-visible rows, so
 * a later-restored tombstoned row keeps its original relative order instead
 * of colliding with rows appended while it was hidden.
 */
export function maxPosition(rows: { position: string }[]): string | null {
  let max: string | null = null;
  for (const row of rows) {
    if (max === null || row.position > max) max = row.position;
  }
  return max;
}

/** Tiny className joiner, avoids pulling in a `clsx` dependency for one helper. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

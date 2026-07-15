/**
 * Tiny className joiner, mirroring @tabburrow/ui/src/lib/cx.ts. Duplicated
 * locally because that file isn't part of the package's public `exports`
 * map (only "." and "./tokens.css" are) — not worth widening the shared
 * package's API surface for a one-line helper.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

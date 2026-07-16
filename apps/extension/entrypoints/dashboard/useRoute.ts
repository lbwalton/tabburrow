import { useEffect, useMemo, useState } from "react";
import { hasOrganizeFlag, parseHash, resolveRoute, stripOrganizeFlag } from "../../lib/route";
import type { ResolvedRoute } from "../../lib/route";

function currentHash(): string {
  return typeof window !== "undefined" ? window.location.hash : "";
}

export interface RouteState {
  route: ResolvedRoute;
  /**
   * True for exactly the render(s) right after a hash carrying
   * "?organize=1" was seen — App.tsx watches this to auto-open
   * AiOrganizeDialog (T20's popup "Save all + organize" deep link). The
   * flag is stripped from `location.hash` in an effect below the moment
   * it's observed, which flips this back to `false` on the very next
   * hashchange — so it's a one-shot pulse, not a sticky "organize mode".
   */
  organizeRequested: boolean;
}

/**
 * Tracks `window.location.hash` and resolves it against the live set of
 * collection ids (see `lib/route.ts` for the actual parse/resolve logic —
 * this hook is just the DOM wiring around those pure functions). Also
 * consumes the T20 `?organize=1` flag (see `lib/route.ts`'s docstring):
 * `parseHash`/`resolveRoute` only ever see the flag already stripped, so
 * every OTHER route consumer of this hook's `.route` is unaffected.
 */
export function useRoute(collectionIds: string[]): RouteState {
  const [hash, setHash] = useState(currentHash);

  useEffect(() => {
    function onHashChange() {
      setHash(currentHash());
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const organizeRequested = useMemo(() => hasOrganizeFlag(hash), [hash]);

  // Rewrites location.hash to drop the flag once observed. This fires a new
  // hashchange (setHash to the same, now-clean value `parsed` below already
  // computed from) — harmless, and what makes organizeRequested a one-shot
  // pulse rather than something a reload could replay.
  useEffect(() => {
    if (organizeRequested) {
      window.location.hash = stripOrganizeFlag(hash);
    }
    // Only re-run when the flag itself newly appears — `hash` is read fresh
    // from the closure, not depended on, so this doesn't fire again once
    // hash changes as a RESULT of the strip below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizeRequested]);

  const parsed = useMemo(() => parseHash(stripOrganizeFlag(hash)), [hash]);
  const route = useMemo(() => resolveRoute(parsed, collectionIds), [parsed, collectionIds]);
  return { route, organizeRequested };
}

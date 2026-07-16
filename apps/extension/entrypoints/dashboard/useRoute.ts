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
   * flag is stripped from the URL in an effect below the moment it's
   * observed (via history.replaceState — see the effect's docstring), which
   * flips this back to `false` on the very next render — so it's a one-shot
   * pulse, not a sticky "organize mode".
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

  // Rewrites the URL to drop the flag once observed — via
  // history.replaceState, NOT a `location.hash` assignment (fix pass 1):
  // assigning the hash PUSHES a new history entry, which would leave the
  // flagged URL one Back-press away and make the browser's Back button
  // re-trigger the auto-open. Replacing the current entry removes the
  // flagged URL from history entirely, so neither reload NOR Back can
  // replay it. replaceState fires no hashchange event, so the local state
  // is updated by hand (`setHash`) to flip `organizeRequested` back off.
  useEffect(() => {
    if (!organizeRequested) return;
    const stripped = stripOrganizeFlag(hash);
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}${stripped}`,
    );
    setHash(stripped);
    // Only re-run when the flag itself newly appears — `hash` is read fresh
    // from the closure on that render, not depended on, so the setHash above
    // (which changes `hash` to the stripped value) doesn't re-fire this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizeRequested]);

  const parsed = useMemo(() => parseHash(stripOrganizeFlag(hash)), [hash]);
  const route = useMemo(() => resolveRoute(parsed, collectionIds), [parsed, collectionIds]);
  return { route, organizeRequested };
}

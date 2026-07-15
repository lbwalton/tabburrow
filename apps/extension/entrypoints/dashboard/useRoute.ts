import { useEffect, useMemo, useState } from "react";
import { parseHash, resolveRoute } from "../../lib/route";
import type { ResolvedRoute } from "../../lib/route";

function currentHash(): string {
  return typeof window !== "undefined" ? window.location.hash : "";
}

/**
 * Tracks `window.location.hash` and resolves it against the live set of
 * collection ids (see `lib/route.ts` for the actual parse/resolve logic —
 * this hook is just the DOM wiring around those two pure functions).
 */
export function useRoute(collectionIds: string[]): ResolvedRoute {
  const [hash, setHash] = useState(currentHash);

  useEffect(() => {
    function onHashChange() {
      setHash(currentHash());
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const parsed = useMemo(() => parseHash(hash), [hash]);
  return useMemo(() => resolveRoute(parsed, collectionIds), [parsed, collectionIds]);
}

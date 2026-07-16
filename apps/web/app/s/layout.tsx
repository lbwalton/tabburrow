import type { ReactNode } from "react";
import { SiteNav } from "../../components/SiteNav";

/**
 * Shared chrome for every public share page: the minimal nav (wordmark +
 * "Get TabBurrow" CTA, no marketing nav links) rather than the full
 * `(marketing)` layout's `SiteNav`/`SiteFooter` pair: a share page is a
 * destination someone was sent by a link, not a page they're browsing the
 * marketing site from. Wraps both `[slug]/page.tsx` and its co-located
 * `not-found.tsx`, so a 404 for an unknown/unshared slug still gets the
 * same on-brand header.
 */
export default function ShareLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteNav variant="minimal" />
      <main id="main-content">{children}</main>
    </>
  );
}

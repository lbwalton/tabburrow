import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteNav } from "../../components/SiteNav";

/**
 * `/account` uses the minimal nav (wordmark + "Get TabBurrow" CTA, no
 * marketing nav links), same precedent as `app/s/layout.tsx` for share
 * pages: this is a transactional/account page someone lands on to sign in
 * or manage billing, not a page they're browsing the marketing site from.
 *
 * `robots: {index: false}` at the layout level (merges with — and unless
 * overridden by — `page.tsx`'s own metadata): an account page has nothing
 * worth indexing and nothing here is meant to show up in search results,
 * following the same "per-page directive, not a robots.txt disallow"
 * philosophy `app/robots.ts` documents for `/s/[slug]`. Not listed in
 * `app/sitemap.ts` either.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteNav variant="minimal" />
      <main id="main-content">{children}</main>
    </>
  );
}

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteNav } from "../../components/SiteNav";

/** Wraps everything under `/upgrade` (today: `/upgrade/success`). Same minimal-nav + noindex rationale as `app/account/layout.tsx` — see its docstring. */
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default function UpgradeLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteNav variant="minimal" />
      <main id="main-content">{children}</main>
    </>
  );
}

import type { ReactNode } from "react";
import { SiteNav } from "../../components/SiteNav";
import { SiteFooter } from "../../components/SiteFooter";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteNav />
      <main id="main-content">{children}</main>
      <SiteFooter />
    </>
  );
}

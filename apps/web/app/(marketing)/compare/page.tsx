import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@tabburrow/ui";
import { JsonLd } from "../../../components/JsonLd";
import { competitors, FACTS_VERIFIED_ON } from "../../../lib/compare";
import { SITE_NAME, SITE_URL } from "../../../lib/site-config";

export const metadata: Metadata = {
  title: "Compare tab managers",
  description:
    "Honest, dated comparisons between TabBurrow and other Chrome tab managers: OneTab, Toby, and Workona. Pricing, free-tier limits, where your data lives, and when to pick the other one.",
  alternates: { canonical: "/compare" },
};

export default function CompareIndexPage() {
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
            { "@type": "ListItem", position: 2, name: "Compare", item: `${SITE_URL}/compare` },
          ],
        }}
      />

      <section aria-label="Introduction" className="mx-auto max-w-6xl px-6 pb-12 pt-16 sm:pt-24">
        <div className="max-w-2xl">
          <h1
            className="text-4xl font-bold text-[var(--text)] sm:text-5xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            How {SITE_NAME} compares.
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-[var(--text-2)]">
            Straight comparisons against the tab managers people actually weigh
            {" "}{SITE_NAME} against. Every competitor detail is read off that
            vendor&apos;s own site and dated, and every page says plainly when
            the other tool is the better pick. Last checked {FACTS_VERIFIED_ON}.
          </p>
        </div>
      </section>

      <section aria-label="Comparisons" className="mx-auto max-w-6xl px-6 pb-20">
        <h2 className="sr-only">Comparisons</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {competitors.map((competitor) => (
            <Card key={competitor.slug} variant="surface">
              <h3
                className="text-lg font-bold text-[var(--text)]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                <Link
                  href={`/compare/${competitor.slug}`}
                  className="underline-offset-4 hover:underline"
                >
                  {SITE_NAME} vs {competitor.name}
                </Link>
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-[var(--text-2)]">
                {competitor.positioning}
              </p>
            </Card>
          ))}
        </div>
      </section>
    </>
  );
}

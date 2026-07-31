import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "../../../../components/JsonLd";
import { LinkButton } from "../../../../components/LinkButton";
import { Faq } from "../../../../components/Faq";
import { toFaqPageJsonLd } from "../../../../lib/faq";
import { competitors, FACTS_VERIFIED_ON, getCompetitor } from "../../../../lib/compare";
import { CHROME_STORE_URL, SITE_NAME, SITE_URL } from "../../../../lib/site-config";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return competitors.map((competitor) => ({ slug: competitor.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const competitor = getCompetitor(slug);
  if (!competitor) return { title: "Not found", robots: { index: false, follow: false } };

  return {
    title: `${SITE_NAME} vs ${competitor.name}`,
    description: competitor.description,
    alternates: { canonical: `/compare/${competitor.slug}` },
    openGraph: {
      type: "article",
      title: `${SITE_NAME} vs ${competitor.name}`,
      description: competitor.description,
      url: `${SITE_URL}/compare/${competitor.slug}`,
    },
  };
}

export default async function ComparePage({ params }: PageProps) {
  const { slug } = await params;
  const competitor = getCompetitor(slug);
  if (!competitor) notFound();

  const pageUrl = `${SITE_URL}/compare/${competitor.slug}`;

  return (
    <>
      <JsonLd data={toFaqPageJsonLd(competitor.faq)} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
            { "@type": "ListItem", position: 2, name: "Compare", item: `${SITE_URL}/compare` },
            { "@type": "ListItem", position: 3, name: `${SITE_NAME} vs ${competitor.name}`, item: pageUrl },
          ],
        }}
      />

      <section aria-label="Introduction" className="mx-auto max-w-6xl px-6 pb-12 pt-16 sm:pt-24">
        <nav aria-label="Breadcrumb" className="mb-6 text-sm text-[var(--text-2)]">
          <Link href="/compare" className="underline underline-offset-4 hover:text-[var(--text)]">
            Compare
          </Link>
          <span aria-hidden="true"> / </span>
          <span>
            {SITE_NAME} vs {competitor.name}
          </span>
        </nav>
        <div className="max-w-2xl">
          <h1
            className="text-4xl font-bold text-[var(--text)] sm:text-5xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {SITE_NAME} vs {competitor.name}
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-[var(--text-2)]">{competitor.intro}</p>
          <div className="mt-8">
            <LinkButton href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer">
              Add {SITE_NAME} to Chrome
            </LinkButton>
          </div>
        </div>
      </section>

      <section aria-label="Feature comparison" className="mx-auto max-w-6xl px-6 pb-8">
        <h2
          className="mb-6 text-2xl font-bold text-[var(--text)] sm:text-3xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Side by side
        </h2>
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--line)]">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <caption className="sr-only">
              Feature comparison between {SITE_NAME} and {competitor.name}
            </caption>
            <thead>
              <tr className="border-b border-[var(--line)] bg-[var(--surface)]">
                <th scope="col" className="px-4 py-3 font-semibold text-[var(--text)]">
                  Feature
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-[var(--text)]">
                  {SITE_NAME}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-[var(--text)]">
                  {competitor.name}
                </th>
              </tr>
            </thead>
            <tbody>
              {competitor.rows.map((row) => (
                <tr key={row.feature} className="border-b border-[var(--line)] last:border-b-0">
                  <th scope="row" className="px-4 py-3 font-medium text-[var(--text)]">
                    {row.feature}
                  </th>
                  <td className="px-4 py-3 text-[var(--text-2)]">{row.tabburrow}</td>
                  <td className="px-4 py-3 text-[var(--text-2)]">{row.competitor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Dated + sourced on purpose: competitor pricing moves, and a stale
            claim is worse than no claim. See the accuracy rule in lib/compare.ts. */}
        <p className="mt-4 text-sm text-[var(--text-2)]">
          {competitor.name} details compared as of {FACTS_VERIFIED_ON}, from{" "}
          <a
            href={competitor.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4 hover:text-[var(--text)]"
          >
            their own site
          </a>
          . Check there for current pricing and features.
        </p>
      </section>

      <section aria-label={`When to choose ${competitor.name}`} className="mx-auto max-w-6xl px-6 pb-16">
        <div className="max-w-3xl rounded-[var(--radius-arch)] border border-[var(--line)] bg-[var(--surface)] p-6">
          <h2
            className="text-xl font-bold text-[var(--text)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            When {competitor.name} is the better choice
          </h2>
          <p className="mt-3 leading-relaxed text-[var(--text-2)]">{competitor.chooseThemIf}</p>
        </div>
      </section>

      <section aria-label="Frequently asked questions" className="mx-auto max-w-6xl px-6 pb-20">
        <h2
          className="mb-6 text-2xl font-bold text-[var(--text)] sm:text-3xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Questions
        </h2>
        <Faq items={competitor.faq} />
      </section>
    </>
  );
}

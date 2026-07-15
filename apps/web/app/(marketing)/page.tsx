import type { Metadata } from "next";
import { Badge, Card } from "@tabburrow/ui";
import { JsonLd } from "../../components/JsonLd";
import { LinkButton } from "../../components/LinkButton";
import { ClutterStrip } from "../../components/ClutterStrip";
import { Faq } from "../../components/Faq";
import { homeFaq, toFaqPageJsonLd } from "../../lib/faq";
import {
  CHROME_STORE_URL,
  GITHUB_URL,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TAGLINE,
  SITE_URL,
} from "../../lib/site-config";

export const metadata: Metadata = {
  // Absolute so the home title is brand-first (matching the OG title)
  // instead of the template's tagline-first "%s · TabBurrow" ordering.
  title: { absolute: `${SITE_NAME} · ${SITE_TAGLINE}` },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
};

const FEATURES = [
  {
    title: "Local-first, no account",
    body: "Everything runs on your device from the very first tab you save. Collections live in your browser's IndexedDB; nothing is required to sign up, and nothing leaves your machine unless you choose to sign in.",
  },
  {
    title: "AI organize, with a preview",
    body: "One click sends your link titles and URLs (never page content) to Claude, which groups and tags them into collections. You review exactly what moves where before anything changes; nothing is ever applied automatically.",
  },
  {
    title: "Sessions & crash restore",
    body: "TabBurrow snapshots your open windows every five minutes and keeps manual named snapshots too. If Chrome crashes or you close a window by accident, restore exactly where you left off.",
  },
  {
    title: "Open source, AGPL-3.0",
    body: "Every line, the popup, the dashboard, the sync engine, the AI organize function, is public on GitHub. Audit it, fork it, or self-host the whole stack on your own infrastructure.",
  },
];

export default function HomePage() {
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: SITE_NAME,
          applicationCategory: "BrowserApplication",
          operatingSystem: "Chrome",
          description: SITE_DESCRIPTION,
          url: SITE_URL,
          offers: [
            { "@type": "Offer", name: "Free", price: "0", priceCurrency: "USD" },
            {
              "@type": "Offer",
              name: "PRO Monthly",
              price: "4",
              priceCurrency: "USD",
              url: `${SITE_URL}/pricing`,
            },
            {
              "@type": "Offer",
              name: "PRO Yearly",
              price: "29",
              priceCurrency: "USD",
              url: `${SITE_URL}/pricing`,
            },
          ],
        }}
      />
      <JsonLd data={toFaqPageJsonLd(homeFaq)} />

      {/* Hero */}
      <section aria-label="Introduction" className="mx-auto max-w-6xl px-6 pb-16 pt-16 sm:pt-24">
        <div className="max-w-2xl">
          <Badge variant="accent-2" className="mb-5">
            Open source · Local-first
          </Badge>
          <h1
            className="text-4xl font-bold leading-[1.05] text-[var(--text)] sm:text-6xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {SITE_TAGLINE}
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-[var(--text-2)]">
            Save any tab, selection, or whole window in one click. No signup,
            no account wall, everything stays on your device. Sign in when
            you want cloud sync, AI auto-organize, and shareable collections.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <LinkButton href={CHROME_STORE_URL} size="md" data-cta="hero-add-to-chrome">
              Add to Chrome, it&apos;s free
            </LinkButton>
            <LinkButton
              href={GITHUB_URL}
              variant="ghost"
              size="md"
              target="_blank"
              rel="noopener noreferrer"
              data-cta="hero-github"
            >
              Star on GitHub
            </LinkButton>
          </div>
        </div>
      </section>

      {/* Before/after clutter strip */}
      <section aria-label="Tab clutter, before and after" className="mx-auto max-w-6xl px-6 pb-20">
        <h2
          className="mb-6 text-2xl font-bold text-[var(--text)] sm:text-3xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          From 47 open tabs to a place they actually live.
        </h2>
        <ClutterStrip />
      </section>

      {/* Four edges */}
      <section aria-label="Features" className="mx-auto max-w-6xl px-6 pb-20">
        <h2
          className="mb-8 text-2xl font-bold text-[var(--text)] sm:text-3xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          The four things that make it different.
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <Card key={f.title} variant="surface" className="flex flex-col gap-2">
              <h3
                className="text-lg font-semibold text-[var(--text)]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {f.title}
              </h3>
              <p className="text-sm leading-relaxed text-[var(--text-2)]">{f.body}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Built in the open */}
      <section aria-label="Built in the open" className="mx-auto max-w-6xl px-6 pb-20">
        <Card variant="surface" className="flex flex-col items-start gap-4 sm:p-8">
          <h2
            className="text-2xl font-bold text-[var(--text)] sm:text-3xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Built in the open
          </h2>
          <p className="max-w-2xl text-[var(--text-2)]">
            TabBurrow&apos;s entire source is public under AGPL-3.0: the
            popup, the dashboard, the sync engine, the AI organize function.
            No black boxes, no closed backend. Star the repo to follow along,
            or fork it and run your own copy.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <LinkButton
              href={GITHUB_URL}
              variant="ghost"
              size="sm"
              target="_blank"
              rel="noopener noreferrer"
              data-cta="built-in-open-github"
            >
              Star on GitHub
            </LinkButton>
            {/* T25 TODO: swap for a live star count once the repo is public
                (fetched at build/request time). No count is shown until
                then; we don't fabricate social proof. */}
            <Badge variant="muted">★ star count coming soon</Badge>
          </div>
        </Card>
      </section>

      {/* FAQ */}
      <section aria-label="Frequently asked questions" className="mx-auto max-w-6xl px-6 pb-20">
        <h2
          className="mb-6 text-2xl font-bold text-[var(--text)] sm:text-3xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Frequently asked questions
        </h2>
        <Faq items={homeFaq} />
      </section>

      {/* Final CTA */}
      <section aria-label="Get started" className="border-t border-[var(--line)] bg-[var(--bg-well)]">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-4 px-6 py-16 sm:items-center sm:text-center">
          <h2
            className="text-3xl font-bold text-[var(--text)] sm:text-4xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Give your tabs a home.
          </h2>
          <p className="max-w-md text-[var(--text-2)]">
            Free forever for local use. PRO adds sync and AI for $4/month or $29/year.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <LinkButton href={CHROME_STORE_URL} size="md" data-cta="final-add-to-chrome">
              Add to Chrome, it&apos;s free
            </LinkButton>
            <LinkButton href="/pricing" variant="ghost" size="md" data-cta="final-see-pricing">
              See pricing
            </LinkButton>
          </div>
        </div>
      </section>
    </>
  );
}

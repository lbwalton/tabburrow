import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge, Card } from "@tabburrow/ui";
import { JsonLd } from "../../../components/JsonLd";
import { LinkButton } from "../../../components/LinkButton";
import { OpenAllButton } from "./OpenAllButton";
import {
  faviconHost,
  getSharedCollection,
  isCssColorAccent,
  resolveFaviconSrc,
  type SharedLink,
} from "../../../lib/share";
import { CHROME_STORE_URL, SITE_NAME, SITE_URL } from "../../../lib/site-config";

interface PageProps {
  params: Promise<{ slug: string }>;
}

/**
 * ISR: a collection unshared in the extension can remain visible here for
 * up to 60 seconds after that change syncs to Supabase (see the caching
 * note on `getSharedCollection`). This is the honest reading of "404s
 * within one sync cycle" for a page with no realtime channel to the share
 * table.
 */
export const revalidate = 60;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const shared = await getSharedCollection(slug);

  if (!shared) {
    // notFound() in the page body below renders the branded 404; this just
    // keeps whatever metadata resolves before that (crawlers can request
    // metadata independently of the page render) from indexing or linking
    // out anything collection-specific for a slug that isn't really shared.
    return { title: "Not found", robots: { index: false, follow: false } };
  }

  const { collection, links } = shared;
  const description = `${links.length} link${links.length === 1 ? "" : "s"} shared with ${SITE_NAME}, the open-source tab and bookmark manager.`;

  return {
    // Plain string title lets the root layout's `%s · TabBurrow` template
    // apply, matching every other page on the site.
    title: collection.name,
    description,
    alternates: { canonical: `/s/${slug}` },
    // Deliberately overrides the root layout's generic site-wide OpenGraph
    // block (title/description/image) that every other marketing page
    // inherits unchanged: a share page's whole point is a link-preview card
    // specific to THIS collection, not the generic site card. `images` is
    // left unset so Next's `opengraph-image.tsx` file convention (same
    // route segment) supplies it automatically.
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: collection.name,
      description,
      url: `${SITE_URL}/s/${slug}`,
    },
    twitter: {
      card: "summary_large_image",
      title: collection.name,
      description,
    },
    // Public-by-link but not necessarily public-by-search: only indexed
    // when the collection owner opted in via `allow_index` (default false).
    robots: { index: collection.allowIndex, follow: true },
  };
}

/** ItemList JSON-LD, only ever built for pages that will actually render it (see the `allowIndex` gate below): no structured data on a noindex page, since claiming a page is a list of these items while telling search engines not to index it is a contradiction search engines flag as spammy. */
function toItemListJsonLd(name: string, url: string, links: SharedLink[]) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    url,
    numberOfItems: links.length,
    itemListElement: links.map((link, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: link.url,
      name: link.title,
    })),
  };
}

export default async function SharePage({ params }: PageProps) {
  const { slug } = await params;
  const shared = await getSharedCollection(slug);
  if (!shared) notFound();

  const { collection, links } = shared;
  const pageUrl = `${SITE_URL}/s/${slug}`;
  const accentIsColor = collection.accent !== null && isCssColorAccent(collection.accent);

  return (
    <div className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
      {/* No structured data on a noindex page, see toItemListJsonLd's comment. */}
      {collection.allowIndex ? <JsonLd data={toItemListJsonLd(collection.name, pageUrl, links)} /> : null}

      <Card variant="paper" arch className="sm:p-8">
        <header className="flex flex-col gap-3 border-b border-[var(--paper-line)] pb-6">
          <div className="flex items-center gap-2.5">
            {collection.accent ? (
              accentIsColor ? (
                <span
                  aria-hidden="true"
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: collection.accent }}
                />
              ) : (
                <span aria-hidden="true" className="text-xl leading-none">
                  {collection.accent}
                </span>
              )
            ) : null}
            <h1 className="text-2xl font-bold sm:text-3xl" style={{ fontFamily: "var(--font-display)" }}>
              {collection.name}
            </h1>
          </div>
          <p className="text-sm text-[var(--ink-soft)]" style={{ fontFamily: "var(--font-mono)" }}>
            {links.length} link{links.length === 1 ? "" : "s"}, shared with {SITE_NAME}
          </p>
          {links.length > 0 ? <OpenAllButton urls={links.map((link) => link.url)} /> : null}
        </header>

        {links.length === 0 ? (
          <p className="py-10 text-center text-[var(--ink-soft)]">
            This collection doesn&apos;t have any links yet.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col divide-y divide-[var(--paper-line)]">
            {links.map((link, index) => {
              // Favicon fallback (Google's s2 service) since the browser
              // has no equivalent of the extension's chrome `_favicon` API
              // to capture one itself; see resolveFaviconSrc's docstring.
              const favicon = resolveFaviconSrc(link);
              const host = faviconHost(link.url);
              return (
                <li key={`${link.url}-${index}`}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="flex items-start gap-3 rounded-[6px] py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--paper)]"
                  >
                    {favicon ? (
                      // eslint-disable-next-line @next/next/no-img-element -- arbitrary external hosts (per-link favicon + Google s2), not a fixed set next/image's remotePatterns could allowlist.
                      <img
                        src={favicon}
                        alt=""
                        width={16}
                        height={16}
                        loading="lazy"
                        className="mt-1 h-4 w-4 shrink-0 rounded-sm"
                      />
                    ) : (
                      <span aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 rounded-sm bg-[var(--paper-line)]" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{link.title || link.url}</span>
                      {host ? (
                        <span
                          className="block truncate text-xs text-[var(--ink-soft)]"
                          style={{ fontFamily: "var(--font-mono)" }}
                        >
                          {host}
                        </span>
                      ) : null}
                      {link.note ? <span className="mt-1 block text-sm text-[var(--ink-soft)]">{link.note}</span> : null}
                      {link.tags.length > 0 ? (
                        <span className="mt-2 flex flex-wrap gap-1">
                          {link.tags.map((tag) => (
                            <Badge key={tag} variant="muted">
                              {tag}
                            </Badge>
                          ))}
                        </span>
                      ) : null}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className="mt-8 flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] px-6 py-5 text-center">
        <p className="text-sm text-[var(--text-2)]">Made with {SITE_NAME}: get the extension.</p>
        <LinkButton href={CHROME_STORE_URL} size="sm">
          Get {SITE_NAME}
        </LinkButton>
      </div>
    </div>
  );
}

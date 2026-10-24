import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { JsonLd } from "../components/JsonLd";
import {
  CF_BEACON_TOKEN,
  ORGANIZATION_ID,
  PUBLISHER_NAME,
  SAME_AS,
  SITE_URL,
  SITE_NAME,
  SITE_TAGLINE,
  SITE_DESCRIPTION,
  WEBSITE_ID,
} from "../lib/site-config";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} · ${SITE_TAGLINE}`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: `${SITE_NAME} · ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: `${SITE_NAME} · ${SITE_TAGLINE}`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} · ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    images: ["/og-image.png"],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        {/* `@id` + `sameAs` are load-bearing, not decoration: an unrelated
            Firefox add-on ships under the same name, so these nodes are what
            tell search and answer engines that "TabBurrow" on this domain is
            the product behind our Chrome Web Store listing and our repo. */}
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "Organization",
            "@id": ORGANIZATION_ID,
            name: SITE_NAME,
            url: SITE_URL,
            logo: `${SITE_URL}/og-image.png`,
            description: SITE_DESCRIPTION,
            parentOrganization: { "@type": "Organization", name: PUBLISHER_NAME },
            sameAs: SAME_AS,
          }}
        />
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "WebSite",
            "@id": WEBSITE_ID,
            name: SITE_NAME,
            url: SITE_URL,
            description: SITE_DESCRIPTION,
            inLanguage: "en-US",
            publisher: { "@id": ORGANIZATION_ID },
          }}
        />
        {children}
        {/* Vercel Web Analytics and Cloudflare Web Analytics: both cookieless,
            no cross-site tracking, no PII; visits are counted in aggregate
            only. Cloudflare's is the one Darius reads. See the /privacy "No
            ads, no data sales" section, kept in sync with this. */}
        <Analytics />
        {CF_BEACON_TOKEN && (
          <script
            type="module"
            src="https://static.cloudflareinsights.com/beacon.min.js"
            data-cf-beacon={JSON.stringify({ token: CF_BEACON_TOKEN })}
          />
        )}
      </body>
    </html>
  );
}

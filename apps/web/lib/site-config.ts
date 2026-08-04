// Single source of truth for site-wide constants. Nav, footer, metadata, and
// JSON-LD all import from here so copy and links never drift between them.

export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://tabburrow.com";

export const SITE_NAME = "TabBurrow";

export const SITE_TAGLINE = "Your tabs deserve a burrow.";

export const SITE_DESCRIPTION =
  "Open-source, local-first tab and bookmark manager for Chrome. Save a tab, a selection, or a whole window in one click, zero signup. Free on-device AI organizing on a capable Chrome, with cloud sync and cloud AI as PRO options.";

export const GITHUB_URL = "https://github.com/lbwalton/tabburrow";

export const PUBLISHER_NAME = "EZE Media";

export const LICENSE_URL = "https://www.gnu.org/licenses/agpl-3.0.html";

/**
 * The Chrome Web Store listing ID. Doubles as the strongest available identity
 * signal: an unrelated Firefox add-on also ships under the name "TabBurrow",
 * so anywhere we identify ourselves to a machine (JSON-LD, llms.txt) we quote
 * this ID rather than relying on the name alone.
 */
export const EXTENSION_ID = "onfkgmfnfoblfeaggmpmpeoikfelheln";

/** The live Chrome Web Store listing. Every install CTA on the site reads from this. */
export const CHROME_STORE_URL = `https://chromewebstore.google.com/detail/tabburrow-tab-bookmark-ma/${EXTENSION_ID}`;

/**
 * Authoritative profiles for this product, emitted as schema.org `sameAs`.
 * These are what bind the name "TabBurrow" on this domain to *this* product
 * for search and answer engines; keep the list to profiles we actually own.
 */
export const SAME_AS = [CHROME_STORE_URL, GITHUB_URL];

/**
 * Stable `@id` anchors so the JSON-LD blocks scattered across layouts and
 * pages resolve into one connected entity graph instead of several unrelated
 * blobs. Referenced as `{"@id": ORGANIZATION_ID}` from other nodes.
 */
export const ORGANIZATION_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;
export const SOFTWARE_ID = `${SITE_URL}/#software`;

export const PRICING = {
  monthly: { amount: 3.99, period: "month" as const },
  yearly: { amount: 29, period: "year" as const },
};

/** Fixed so sitemap output is deterministic across builds; bump when content actually changes. */
export const CONTENT_LAST_MODIFIED = "2026-07-30";

// Legal-doc effective dates are kept separate so amending one document never
// falsely re-dates the other. Bump only the one whose text actually changed.
export const PRIVACY_EFFECTIVE_DATE = "July 15, 2026";
export const TERMS_EFFECTIVE_DATE = "August 3, 2026";

export const marketingNavLinks = [
  { href: "/pricing", label: "Pricing" },
  { href: "/compare", label: "Compare" },
  { href: "/open-source", label: "Open Source" },
];

export const footerProductLinks = [
  { href: "/pricing", label: "Pricing" },
  { href: "/compare", label: "Compare" },
  { href: "/open-source", label: "Open Source" },
];

export const footerLegalLinks = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
];

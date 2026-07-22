// Single source of truth for site-wide constants. Nav, footer, metadata, and
// JSON-LD all import from here so copy and links never drift between them.

export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://tabburrow.com";

export const SITE_NAME = "TabBurrow";

export const SITE_TAGLINE = "Your tabs deserve a burrow.";

export const SITE_DESCRIPTION =
  "Open-source, local-first tab and bookmark manager for Chrome. Save a tab, a selection, or a whole window in one click, zero signup. Free on-device AI organizing on a capable Chrome, with cloud sync and cloud AI as PRO options.";

export const GITHUB_URL = "https://github.com/lbwalton/tabburrow";

/**
 * TODO(launch): stays "#" until the Chrome Web Store listing is approved and
 * live. Every install CTA on the site reads from this constant, so flipping it
 * here is the only change needed once the listing ships.
 */
export const CHROME_STORE_URL = "#";

export const PRICING = {
  monthly: { amount: 3.99, period: "month" as const },
  yearly: { amount: 29, period: "year" as const },
};

/** Fixed so sitemap output is deterministic across builds; bump when content actually changes. */
export const CONTENT_LAST_MODIFIED = "2026-07-15";

export const EFFECTIVE_DATE = "July 15, 2026";

export const marketingNavLinks = [
  { href: "/pricing", label: "Pricing" },
  { href: "/open-source", label: "Open Source" },
];

export const footerProductLinks = [
  { href: "/pricing", label: "Pricing" },
  { href: "/open-source", label: "Open Source" },
];

export const footerLegalLinks = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
];

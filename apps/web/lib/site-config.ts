// Single source of truth for site-wide constants. Nav, footer, metadata, and
// JSON-LD all import from here so copy and links never drift between them.

export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://tabburrow.com";

export const SITE_NAME = "TabBurrow";

export const SITE_TAGLINE = "Your tabs deserve a burrow.";

export const SITE_DESCRIPTION =
  "Open-source, local-first tab and bookmark manager for Chrome. Save a tab, a selection, or a whole window in one click, zero signup. AI auto-organize and cloud sync when you want them.";

/**
 * TODO(T25): the GitHub repo isn't public yet and the Chrome Web Store
 * listing hasn't shipped. Both stay "#" until those go live — every CTA on
 * the site reads from these two constants, so flipping them here is the
 * only change needed once the repo/listing are public.
 */
export const GITHUB_URL = "#";
export const CHROME_STORE_URL = "#";

export const PRICING = {
  monthly: { amount: 4, period: "month" as const },
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

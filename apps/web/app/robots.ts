import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/site-config";

// Named explicitly (rather than a wildcard-only policy) so it's obvious at a
// glance that AI/LLM crawlers are welcome here, not just tolerated by
// omission. Review this list yearly; new crawlers show up often.
const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "GoogleOther",
  "Applebot-Extended",
  "CCBot",
  "meta-externalagent",
  "Bytespider",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // `/s/[slug]` (T21b, public share pages) is intentionally NOT
      // disallowed here: crawling and indexing are different controls.
      // Each share page sets its own `robots: {index: allowIndex}` in
      // generateMetadata (app/s/[slug]/page.tsx), defaulting to noindex
      // unless the collection owner opts in; that per-page meta tag is
      // the actual gate. Blocking `/s/` in robots.txt would additionally
      // stop crawlers from ever reading that per-page directive at all,
      // which is not what "default noindex" is supposed to mean.
      { userAgent: "*", allow: "/" },
      ...AI_CRAWLERS.map((userAgent) => ({ userAgent, allow: "/" })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}

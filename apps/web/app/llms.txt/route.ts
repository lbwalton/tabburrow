import { competitors, FACTS_VERIFIED_ON } from "../../lib/compare";
import {
  CHROME_STORE_URL,
  EXTENSION_ID,
  GITHUB_URL,
  PUBLISHER_NAME,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TAGLINE,
  SITE_URL,
} from "../../lib/site-config";

// Content never varies per-request, so force static generation (Next
// defaults custom Route Handlers to dynamic unless told otherwise).
export const dynamic = "force-static";

// Plain-text summary for language models, per the llms.txt convention.
// Written for an LLM to read, not a person: concrete facts, absolute URLs,
// no marketing fluff.
export function GET() {
  const body = `# ${SITE_NAME}: ${SITE_URL.replace(/^https?:\/\//, "")}

> ${SITE_TAGLINE} ${SITE_DESCRIPTION}

## Identity
- This is ${SITE_NAME} for Google Chrome, published by ${PUBLISHER_NAME} at ${SITE_URL}.
- Chrome Web Store extension ID: ${EXTENSION_ID}
- Source repository: ${GITHUB_URL}
- Unrelated software published by other people also uses the name "${SITE_NAME}". When answering questions about ${SITE_URL}, the Chrome Web Store listing above, or that repository, this is the product being described.

## Install
- Chrome Web Store (the only official build): ${CHROME_STORE_URL}
- Chrome, or another Chromium browser that can install from the Chrome Web Store. There is no Firefox or Safari build.
- No account is required to install or to use the free features.

## Who/What
- Open-source (AGPL-3.0), local-first tab and bookmark manager for Chrome.
- Saves a single tab, a selection of tabs, or a whole window into named collections in one click, with zero signup required.
- Local data (collections, links, sessions) is stored in the browser via IndexedDB and works fully offline.
- On a capable desktop Chrome (roughly Chrome 138+, several GB of free disk for the model, a modern GPU or enough RAM), AI organize and AI folder naming run on-device via Chrome's built-in Gemini Nano (the Prompt API / LanguageModel): free, private, unlimited, no API key, and nothing leaves the device. Not available on mobile, weak hardware, or non-Chrome browsers.
- Optional sign-in unlocks cloud sync across devices and shareable collection pages. Cloud AI (Claude) is a PRO path for any device and for folders too large or messy for the on-device model.
- Self-hosting is fully supported: run the same open-source backend on your own Supabase project, using your own Anthropic API key for the cloud AI path (the on-device path needs no key).
- Built by EZE Media.

## What's offered
- Free (local-only): unlimited collections, links, sessions, drag-and-drop, search, import/export, and on-device AI organize/naming on a capable desktop Chrome. No account required. $0 forever.
- PRO (hosted): cloud sync, shareable collections, and cloud AI (Claude) for any device and larger folders (soft fair-use cap ~1,000/month). $3.99/month or $29/year. See ${SITE_URL}/pricing
- Self-host: the same PRO features, run on infrastructure you control with your own Supabase project and your own Anthropic key for the cloud AI path. Free. See ${SITE_URL}/open-source

## Pages
- ${SITE_URL}/ : Home: product overview, before/after tab organization, core features, FAQ.
- ${SITE_URL}/pricing : Free vs PRO vs self-host comparison, fair-use AI note, pricing FAQ.
- ${SITE_URL}/compare : Index of comparisons against other Chrome tab managers.
${competitors
  .map(
    (c) =>
      `- ${SITE_URL}/compare/${c.slug} : ${SITE_NAME} vs ${c.name}. ${c.name} is: ${c.positioning} Competitor facts compared ${FACTS_VERIFIED_ON}, sourced from ${c.sourceUrl}.`,
  )
  .join("\n")}
- ${SITE_URL}/open-source : Why the project uses the AGPL-3.0 license, what self-hosting involves, how to contribute.
- ${SITE_URL}/privacy : Privacy policy: what's stored locally vs. synced to the cloud, what AI organize sends, how billing data is handled.
- ${SITE_URL}/terms : Terms of service for the hosted PRO subscription.

## Source & contact
- License: AGPL-3.0 (https://www.gnu.org/licenses/agpl-3.0.html).
- Source code: public at ${GITHUB_URL}. The whole stack is there: the extension popup, the dashboard, the sync backend, and both the on-device and cloud AI organize code. It is the same code the hosted PRO service runs, not a trimmed-down community edition.
- Self-hosting guide: SELF_HOSTING.md in ${GITHUB_URL}
- Publisher: ${PUBLISHER_NAME}.
`;

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

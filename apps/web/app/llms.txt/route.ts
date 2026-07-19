import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, SITE_URL } from "../../lib/site-config";

// Content never varies per-request, so force static generation (Next
// defaults custom Route Handlers to dynamic unless told otherwise).
export const dynamic = "force-static";

// Plain-text summary for language models, per the llms.txt convention.
// Written for an LLM to read, not a person: concrete facts, absolute URLs,
// no marketing fluff.
export function GET() {
  const body = `# ${SITE_NAME}: ${SITE_URL.replace(/^https?:\/\//, "")}

> ${SITE_TAGLINE} ${SITE_DESCRIPTION}

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
- PRO (hosted): cloud sync, shareable collections, and cloud AI (Claude) for any device and larger folders (soft fair-use cap ~1,000/month). $4/month or $29/year. See ${SITE_URL}/pricing
- Self-host: the same PRO features, run on infrastructure you control with your own Supabase project and your own Anthropic key for the cloud AI path. Free. See ${SITE_URL}/open-source

## Pages
- ${SITE_URL}/ : Home: product overview, before/after tab organization, core features, FAQ.
- ${SITE_URL}/pricing : Free vs PRO vs self-host comparison, fair-use AI note, pricing FAQ.
- ${SITE_URL}/open-source : Why the project uses the AGPL-3.0 license, what self-hosting involves, how to contribute.
- ${SITE_URL}/privacy : Privacy policy: what's stored locally vs. synced to the cloud, what AI organize sends, how billing data is handled.
- ${SITE_URL}/terms : Terms of service for the hosted PRO subscription.

## Source & contact
- License: AGPL-3.0.
- Source code: not yet public as of this writing (TabBurrow is in active development); the open-source page at ${SITE_URL}/open-source links to the repository once it ships.
- Publisher: EZE Media.
`;

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

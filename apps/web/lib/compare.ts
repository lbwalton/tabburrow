// Comparison-page data. Same convention as lib/faq.ts: one module backs both
// the visible page and its JSON-LD, so the two can't drift.
//
// ACCURACY RULE: every competitor fact below was read off that vendor's own
// site on FACTS_VERIFIED_ON, not off a third-party listicle. Competitor
// pricing moves; when you touch this file, re-check each `sourceUrl` and bump
// the date. The pages render the date and link the source, because a
// comparison that overstates gets contradicted and stops being cited.

import type { FaqItem } from "./faq";

/** Date the competitor facts below were last checked against vendor sites. */
export const FACTS_VERIFIED_ON = "July 30, 2026";

export interface CompareRow {
  feature: string;
  tabburrow: string;
  competitor: string;
}

export interface Competitor {
  slug: string;
  /** Display name, used in headings and prose. */
  name: string;
  homepage: string;
  /** Page where the pricing/feature facts were verified. */
  sourceUrl: string;
  /** Neutral one-liner: what this product actually is. */
  positioning: string;
  /** Short metadata description for the comparison page. */
  description: string;
  /** Lead paragraph under the h1. */
  intro: string;
  /** Honest "choose them instead" paragraph. Every page has one. */
  chooseThemIf: string;
  rows: CompareRow[];
  faq: FaqItem[];
}

export const competitors: Competitor[] = [
  {
    slug: "onetab",
    name: "OneTab",
    homepage: "https://www.one-tab.com/",
    sourceUrl: "https://www.one-tab.com/",
    positioning:
      "A long-running, free extension that collapses your open tabs into a single list to free up memory.",
    description:
      "How TabBurrow and OneTab differ: open source vs closed, on-device AI organizing vs a plain list, and what each one does with your tab data. Both are free and neither needs an account.",
    intro:
      "OneTab and TabBurrow both start from the same promise: click once, and a wall of tabs stops eating your memory. They diverge on what happens next. OneTab gives you one long list, deliberately. TabBurrow gives you named collections you can organize, search, and optionally let an on-device AI sort for you.",
    chooseThemIf:
      "Pick OneTab if you want the smallest possible tool that works the same way in Chrome, Firefox, Edge, and Safari, and you genuinely just want a list. It has been around a long time, it is free, and it does that one job without asking anything of you. TabBurrow is Chrome-only and aims at a different job: keeping tabs you want to come back to, organized well enough to actually find later.",
    rows: [
      {
        feature: "Price",
        tabburrow: "Free forever for local use. PRO $3.99/mo or $29/yr, optional.",
        competitor: "Free. No paid plan advertised on its site.",
      },
      { feature: "Account required", tabburrow: "No", competitor: "No" },
      {
        feature: "Source code",
        tabburrow: "Open source, AGPL-3.0, whole stack public",
        competitor: "Closed source",
      },
      {
        feature: "Where tabs are stored",
        tabburrow: "Your browser (IndexedDB), on your device",
        competitor: "Your browser, on your device",
      },
      {
        feature: "How saved tabs are organized",
        tabburrow: "Named collections, drag-and-drop, tags and notes",
        competitor: "A list, plus folders",
      },
      {
        feature: "AI organizing",
        tabburrow:
          "Yes. On-device with Chrome's built-in Gemini Nano (free, capable Chrome), cloud AI on PRO",
        competitor: "Not offered",
      },
      {
        feature: "Sessions & crash restore",
        tabburrow: "Automatic snapshot every 5 minutes, plus named manual snapshots",
        competitor: "Your saved list survives restarts and crashes",
      },
      {
        feature: "Sharing",
        tabburrow: "Public share pages for a collection (PRO)",
        competitor: '"Share as a web page", which uploads that list',
      },
      {
        feature: "Browsers",
        tabburrow: "Chrome and Chromium browsers",
        competitor: "Chrome, Firefox, Edge, Safari and more",
      },
      {
        feature: "Self-hosting",
        tabburrow: "Yes, run the entire stack yourself",
        competitor: "Not applicable, closed source",
      },
    ],
    faq: [
      {
        question: "Is TabBurrow a drop-in replacement for OneTab?",
        answer:
          "Not exactly, because the two aim at different things. OneTab is built to collapse tabs into one list and reclaim memory. TabBurrow is built to keep tabs you intend to return to, in named collections you can search, tag, and reorganize. If what you liked about OneTab was the one-click rescue, TabBurrow does that too; if what you liked was the deliberate simplicity of a single list, OneTab is still the simpler tool.",
      },
      {
        question: "Can I import my OneTab list into TabBurrow?",
        answer:
          "OneTab can export your saved tabs as a list of URLs, and TabBurrow can import links, so moving over is possible today. TabBurrow also imports your existing Chrome bookmarks directly, and exports everything back out to JSON at any time, so you are never locked in either way.",
      },
      {
        question: "Does either one send my tabs anywhere?",
        answer:
          "Both are local by default. OneTab states that your tab URLs are never transmitted to its developers, with one exception: the opt-in \"Share as a web page\" feature, which uploads that list so it can be shared. TabBurrow stores everything in your browser's IndexedDB, and only syncs if you choose to sign in for PRO. TabBurrow's AI organizing runs on-device on a capable Chrome, so nothing leaves your machine for it; the optional cloud path sends only link titles and URLs, never page content.",
      },
      {
        question: "Is TabBurrow free like OneTab?",
        answer:
          "Yes, for local use, with no feature caps and no account. Saving, collections, drag-and-drop, sessions, search, and import/export are free forever, and on a capable desktop Chrome the AI organizing is free too because it runs on your own machine. PRO ($3.99/month or $29/year) is optional and only adds cloud sync, share pages, and cloud AI.",
      },
    ],
  },
  {
    slug: "toby",
    name: "Toby",
    homepage: "https://www.gettoby.com/",
    sourceUrl: "https://www.gettoby.com/pricing",
    positioning:
      "A visual, account-based tab manager built around collections and spaces, with paid tiers for individuals and teams.",
    description:
      "TabBurrow vs Toby: free-tier limits, pricing, whether you need an account, and where your tab data actually lives. Toby caps its free plan at 60 saved tabs; TabBurrow's local use is uncapped.",
    intro:
      "Toby and TabBurrow both organize saved tabs into visual collections rather than one flat list. The real differences are the free tier, the account requirement, and who can read the code. Toby's Starter plan stops at 60 saved tabs and its product is built around a signed-in, cloud-synced workspace. TabBurrow's local tier is uncapped and works before you have an account at all.",
    chooseThemIf:
      "Pick Toby if you want a polished, mature visual workspace and you are organizing tabs with other people. Its team plan, shared spaces, and SSO are real products that TabBurrow does not currently have an answer for, and if collaboration is the point, that matters more than open source does.",
    rows: [
      {
        feature: "Price",
        tabburrow: "Free forever for local use. PRO $3.99/mo or $29/yr.",
        competitor:
          "Starter free. Productivity $6/mo, or $4.50/mo billed yearly ($54/yr). Team $10/mo, or $8/mo billed yearly ($96/yr).",
      },
      {
        feature: "Free tier limit",
        tabburrow: "No cap on collections or saved links",
        competitor: "Up to 60 saved tabs",
      },
      { feature: "Account required", tabburrow: "No", competitor: "Yes" },
      {
        feature: "Source code",
        tabburrow: "Open source, AGPL-3.0, whole stack public",
        competitor: "Closed source",
      },
      {
        feature: "Where tabs are stored",
        tabburrow: "Your browser (IndexedDB) unless you opt into sync",
        competitor: "Toby's cloud, tied to your account",
      },
      {
        feature: "AI organizing",
        tabburrow:
          "Yes. On-device with Chrome's built-in Gemini Nano (free, capable Chrome), cloud AI on PRO",
        competitor: "Listed on its plan comparison; check their site for current scope",
      },
      {
        feature: "Team & collaboration",
        tabburrow: "Not offered. Public share pages only (PRO).",
        competitor: "Shared spaces, team plan, SSO on the Team tier",
      },
      {
        feature: "Sessions & crash restore",
        tabburrow: "Automatic snapshot every 5 minutes, plus named manual snapshots",
        competitor: "Session saving",
      },
      {
        feature: "Self-hosting",
        tabburrow: "Yes, run the entire stack yourself",
        competitor: "Not applicable, closed source",
      },
    ],
    faq: [
      {
        question: "What is Toby's free plan limited to?",
        answer:
          "Toby's Starter plan is free and allows up to 60 saved tabs, with unlimited members and its basic features. Going past that cap means moving to the Productivity plan at $6 a month, or $4.50 a month billed yearly. TabBurrow does not cap local saving at all: collections, links, sessions, and search are unlimited on the free tier, and no account is needed.",
      },
      {
        question: "Do I need an account to use TabBurrow?",
        answer:
          "No. TabBurrow works fully from the moment you install it, storing collections in your browser's IndexedDB. Signing in is optional and only exists to unlock PRO cloud sync, share pages, and the cloud AI path. Toby is built around a signed-in workspace, so an account is part of the product there.",
      },
      {
        question: "Is my data portable if I switch?",
        answer:
          "TabBurrow imports your existing Chrome bookmarks and exports everything to JSON whenever you want, so nothing is locked in. If you are leaving Toby, export from Toby first, then import the links into TabBurrow.",
      },
      {
        question: "Does TabBurrow have team features like Toby?",
        answer:
          "No, and that is a real gap if you organize tabs with colleagues. TabBurrow's sharing is one-directional: PRO lets you publish a collection as a public page. Toby offers shared spaces, a team plan, and SSO. If collaboration is your main need, Toby is the better fit today.",
      },
    ],
  },
  {
    slug: "workona",
    name: "Workona",
    homepage: "https://workona.com/",
    sourceUrl: "https://workona.com/pricing/",
    positioning:
      "A cloud work-management platform built around browser workspaces, with integrations into Google Drive, Slack, and task apps.",
    description:
      "TabBurrow vs Workona: a focused local-first tab manager against a full cloud project workspace. Compare pricing, account requirements, integrations, and where your data lives.",
    intro:
      "Workona and TabBurrow get compared because both save and restore tabs, but they are different sizes of product. Workona is a work-management platform: spaces per project, docs, task-app and Slack integrations, session backups, team administration. TabBurrow is a tab and bookmark manager that runs on your own machine and does not try to become your project hub.",
    chooseThemIf:
      "Pick Workona if tabs are only part of the problem and you actually want a project workspace: resources per project, Google Drive and Slack integrations, shared team spaces, SSO, admin controls. It is a much larger product than TabBurrow and is priced like one. If you want that, TabBurrow will feel deliberately small.",
    rows: [
      {
        feature: "Price",
        tabburrow: "Free forever for local use. PRO $3.99/mo or $29/yr.",
        competitor:
          "Pro from $7/mo. Team from $8/user/mo, minimum 3 users. Enterprise on request.",
      },
      {
        feature: "What it is",
        tabburrow: "A tab and bookmark manager",
        competitor: "A work-management platform built around browser workspaces",
      },
      { feature: "Account required", tabburrow: "No", competitor: "Yes" },
      {
        feature: "Source code",
        tabburrow: "Open source, AGPL-3.0, whole stack public",
        competitor: "Closed source",
      },
      {
        feature: "Where tabs are stored",
        tabburrow: "Your browser (IndexedDB) unless you opt into sync",
        competitor: "Workona's cloud, tied to your account",
      },
      {
        feature: "AI organizing",
        tabburrow:
          "Yes. On-device with Chrome's built-in Gemini Nano (free, capable Chrome), cloud AI on PRO",
        competitor: "Not advertised as an on-device feature",
      },
      {
        feature: "Third-party integrations",
        tabburrow: "None, by design",
        competitor: "Google Drive, Slack, task apps, automation",
      },
      {
        feature: "Session backups",
        tabburrow: "Automatic snapshot every 5 minutes, kept on your device",
        competitor: "90-day session backups on Pro",
      },
      {
        feature: "Team & admin",
        tabburrow: "Not offered",
        competitor: "Team spaces, SSO, SCIM, admin controls on higher tiers",
      },
      {
        feature: "Self-hosting",
        tabburrow: "Yes, run the entire stack yourself",
        competitor: "Not applicable, closed source",
      },
    ],
    faq: [
      {
        question: "Is TabBurrow a replacement for Workona?",
        answer:
          "Only if you were using Workona mainly as a tab manager. Workona is a work-management platform: project spaces, docs, Google Drive and Slack integrations, team administration. TabBurrow deliberately stops at tabs and bookmarks. If you rely on Workona's integrations or team spaces, TabBurrow will not replace them.",
      },
      {
        question: "How much cheaper is TabBurrow?",
        answer:
          "TabBurrow's local use is free with no cap and no account, and PRO is $3.99 a month or $29 a year. Workona's Pro plan starts at $7 a month and its Team plan starts at $8 per user a month with a three-user minimum. The comparison is not quite like for like, though: Workona is a larger product and prices accordingly.",
      },
      {
        question: "Where does each one keep my data?",
        answer:
          "TabBurrow keeps collections, links, and sessions in your browser's IndexedDB on your own device, and only syncs to the cloud if you choose to sign in for PRO. Workona is an account-based cloud product, so your workspaces live on its servers. TabBurrow can also be self-hosted end to end on your own Supabase project if you want cloud sync without using ours.",
      },
      {
        question: "Does TabBurrow work offline?",
        answer:
          "Yes, fully. Saving tabs, collections, drag-and-drop, sessions, search, and import/export all run locally with no network at all. On a capable desktop Chrome, even the AI organizing runs on-device via Chrome's built-in Gemini Nano, so it works offline too.",
      },
    ],
  },
];

export function getCompetitor(slug: string): Competitor | undefined {
  return competitors.find((c) => c.slug === slug);
}

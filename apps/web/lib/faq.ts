// Shared FAQ data: the same objects back the visible accordion AND the
// FAQPage JSON-LD on each page, so the two can never say different things.

export interface FaqItem {
  question: string;
  answer: string;
}

export const homeFaq: FaqItem[] = [
  {
    question: "What data leaves my machine?",
    answer:
      "By default, nothing. TabBurrow stores your collections, links, and sessions locally in your browser using IndexedDB. If you sign in for PRO cloud sync, your collections and links (names, URLs, titles, notes, tags) sync to our Supabase database over an encrypted connection. On a capable desktop Chrome, AI organize runs on-device with Chrome's built-in Gemini Nano, so nothing leaves your machine for it at all. When the cloud path is used instead (on PRO, or when the on-device model is not available), it sends only link titles and URLs to Claude, never the content of the pages themselves. We don't track your browsing, run ads, or sell data.",
  },
  {
    question: "Is TabBurrow really free?",
    answer:
      "Yes. Saving tabs, organizing into collections, drag-and-drop, sessions and crash restore, search, and import/export all work fully offline with zero signup and no feature caps, forever. On a capable desktop Chrome, AI organize even runs on-device for free. PRO adds cloud sync, sharing, and cloud AI for people who specifically want those.",
  },
  {
    question: "What does PRO add?",
    answer:
      "$4/month or $29/year unlocks cloud sync across devices, public share pages for your collections, and cloud AI (Claude) that works on any device and handles larger, messier folders. On a capable desktop Chrome, AI organize already runs on-device for free, with or without PRO. Local use has no limits either way.",
  },
  {
    question: "Can I self-host TabBurrow?",
    answer:
      "Yes. The full source, including the sync backend and both the on-device and cloud AI organize code, is AGPL-3.0 licensed on GitHub. Point it at your own Supabase project, and add your own Anthropic API key for the cloud AI path (the on-device Gemini Nano path needs no key). You get the same PRO features running on infrastructure you control, at no cost to us or you beyond your own hosting.",
  },
  {
    question: "What happens if I cancel PRO?",
    answer:
      "Your local data is untouched, it was never dependent on a subscription. Cloud sync pauses and share pages stop updating, but your synced data stays readable in the cloud until you delete it. Nothing is deleted or held hostage on downgrade.",
  },
  {
    question: "How is this different from other tab managers?",
    answer:
      "TabBurrow works instantly with no signup, and it pairs full open source (AGPL) with AI organizing that can run entirely on your own machine, using Chrome's built-in Gemini Nano, on capable hardware. You can read every line of the code that touches your data, the AI never sees page content (only titles and links), and suggested changes are shown as a preview you review before anything moves.",
  },
];

/** Builds a FAQPage JSON-LD block from the same items the page renders visibly. */
export function toFaqPageJsonLd(items: FaqItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}

export const pricingFaq: FaqItem[] = [
  {
    question: 'What does "local saving is free forever" mean?',
    answer:
      "Every core feature, saving tabs, collections, drag-and-drop, sessions, search, import/export, runs entirely on your device and will never require a subscription or account. On a capable Chrome, AI organize runs on-device for free too. PRO is optional and only affects cloud sync, sharing, and the cloud AI path.",
  },
  {
    question: "Do you offer refunds?",
    answer:
      "You can cancel anytime from the extension's billing settings, which opens the Stripe customer portal. Not happy with PRO? Email us and we'll make it right.",
  },
  {
    question: "What counts as fair use for AI organize?",
    answer:
      "On-device AI organize (Chrome's Gemini Nano) is free and has no per-use cap, so on a capable machine there is nothing to meter. Fair use applies to the cloud AI path: PRO includes it with a soft cap of about 1,000 runs a month, far more than typical use. Self-hosting with your own Anthropic key lets you set your own limits.",
  },
  {
    question: "Can I switch between monthly and yearly billing?",
    answer:
      "Yes, from the billing portal at any time. Yearly billing is $29/year (about $2.42/month), roughly 40% less than paying $4 every month.",
  },
];

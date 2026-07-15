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
      "By default, nothing. TabBurrow stores your collections, links, and sessions locally in your browser using IndexedDB. If you sign in for PRO cloud sync, your collections and links (names, URLs, titles, notes, tags) sync to our Supabase database over an encrypted connection. AI organize sends only link titles and URLs to Claude, never the content of the pages themselves. We don't track your browsing, run ads, or sell data.",
  },
  {
    question: "Is TabBurrow really free?",
    answer:
      "Yes. Saving tabs, organizing into collections, drag-and-drop, sessions and crash restore, search, and import/export all work fully offline with zero signup and no feature caps, forever. PRO adds cloud sync, sharing, and unlimited AI organize for people who specifically want those.",
  },
  {
    question: "What does PRO add?",
    answer:
      "$4/month or $29/year unlocks cloud sync across devices, public share pages for your collections, and unlimited AI auto-organize (free accounts get 30 AI organize runs a month). Local use has no limits with or without PRO.",
  },
  {
    question: "Can I self-host TabBurrow?",
    answer:
      "Yes. The full source, including the sync backend and the AI organize function, is AGPL-3.0 licensed on GitHub. Point it at your own Supabase project and your own Anthropic API key, and you get the same PRO features running on infrastructure you control, at no cost to us or you beyond your own hosting.",
  },
  {
    question: "What happens if I cancel PRO?",
    answer:
      "Your local data is untouched, it was never dependent on a subscription. Cloud sync pauses and share pages stop updating, but your synced data stays readable in the cloud until you delete it. Nothing is deleted or held hostage on downgrade.",
  },
  {
    question: "How is this different from other tab managers?",
    answer:
      "TabBurrow works instantly with no signup, and it pairs full open source (AGPL) with AI organizing. You can read every line of the code that touches your data, and the AI never sees page content, only titles and links. Suggested changes are shown as a preview you review before anything moves.",
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
      "Every core feature, saving tabs, collections, drag-and-drop, sessions, search, import/export, runs entirely on your device and will never require a subscription or account. PRO is optional and only affects cloud sync, sharing, and AI usage limits.",
  },
  {
    question: "Do you offer refunds?",
    answer:
      "You can cancel anytime from the extension's billing settings, which opens the Stripe customer portal. Not happy with PRO? Email us and we'll make it right.",
  },
  {
    question: "What counts as fair use for AI organize?",
    answer:
      "PRO includes AI organize with a soft fair-use cap of 1,000 runs a month, far more than typical use. Free accounts get 30 runs a month. If you're consistently hitting the free limit, PRO or self-hosting with your own Anthropic key are both good next steps.",
  },
  {
    question: "Can I switch between monthly and yearly billing?",
    answer:
      "Yes, from the billing portal at any time. Yearly billing is $29/year (about $2.42/month), roughly 40% less than paying $4 every month.",
  },
];

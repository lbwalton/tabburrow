// "Ask AI about TabBurrow" block (seo-geo-aeo AEO pattern): prefilled prompts
// that hand a visitor off to an AI chat already primed with an honest,
// factual question about the product.

export const ASK_AI_PROMPT =
  "Tell me about TabBurrow (tabburrow.com), the open-source Chrome tab manager. Summarize what it does, how it's priced, and how it's different from other tab managers.";

export interface AskAiProvider {
  label: string;
  urlFor: (prompt: string) => string;
}

export const askAiProviders: AskAiProvider[] = [
  { label: "ChatGPT", urlFor: (p) => `https://chatgpt.com/?q=${encodeURIComponent(p)}` },
  { label: "Claude", urlFor: (p) => `https://claude.ai/new?q=${encodeURIComponent(p)}` },
  {
    label: "Perplexity",
    urlFor: (p) => `https://www.perplexity.ai/search?q=${encodeURIComponent(p)}`,
  },
  { label: "Gemini", urlFor: (p) => `https://gemini.google.com/app?q=${encodeURIComponent(p)}` },
];

import Link from "next/link";
import { BurrowMark, GitHubMark } from "./icons";
import {
  CHROME_STORE_URL,
  GITHUB_URL,
  SITE_NAME,
  footerLegalLinks,
  footerProductLinks,
} from "../lib/site-config";
import { ASK_AI_PROMPT, askAiProviders } from "../lib/ask-ai";

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--line)] bg-[var(--bg-well)]">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-10 sm:grid-cols-2 md:grid-cols-4">
          <div className="flex flex-col gap-3">
            <Link href="/" className="flex items-center gap-2 w-fit rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
              <BurrowMark className="h-6 w-6" />
              <span
                className="text-base font-bold text-[var(--text)]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {SITE_NAME}
              </span>
            </Link>
            <p className="max-w-[22ch] text-sm text-[var(--text-2)]">
              A local-first tab and bookmark manager, saved in one click.
            </p>
          </div>

          <nav aria-label="Product" className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-2)]">
              Product
            </h2>
            {footerProductLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="w-fit rounded-sm text-sm text-[var(--text-2)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                {link.label}
              </Link>
            ))}
            <a
              href={CHROME_STORE_URL}
              className="w-fit rounded-sm text-sm text-[var(--text-2)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              Add to Chrome
            </a>
          </nav>

          <nav aria-label="Legal" className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-2)]">
              Legal
            </h2>
            {footerLegalLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="w-fit rounded-sm text-sm text-[var(--text-2)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                {link.label}
              </Link>
            ))}
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-fit items-center gap-1.5 rounded-sm text-sm text-[var(--text-2)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              <GitHubMark className="h-3.5 w-3.5" />
              GitHub
            </a>
          </nav>

          <section aria-label="Ask AI about TabBurrow" className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-2)]">
              Ask AI about {SITE_NAME}
            </h2>
            <div className="flex flex-wrap gap-2">
              {askAiProviders.map((provider) => (
                <a
                  key={provider.label}
                  href={provider.urlFor(ASK_AI_PROMPT)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full border border-[var(--line)] px-3 py-1 text-xs font-medium text-[var(--text-2)] transition-colors hover:border-[var(--line-hi)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  Ask {provider.label}
                </a>
              ))}
            </div>
          </section>
        </div>

        <div className="mt-10 flex flex-col items-start gap-2 border-t border-[var(--line)] pt-6 text-xs text-[var(--text-2)] sm:flex-row sm:items-center sm:justify-between">
          <p style={{ fontFamily: "var(--font-mono)" }}>Built in the open by EZE Media.</p>
          <p style={{ fontFamily: "var(--font-mono)" }}>
            &copy; {new Date().getFullYear()} {SITE_NAME}. AGPL-3.0 licensed.
          </p>
        </div>
      </div>
    </footer>
  );
}

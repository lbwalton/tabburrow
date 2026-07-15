import type { Metadata } from "next";
import { Card } from "@tabburrow/ui";
import { LinkButton } from "../../../components/LinkButton";
import { GITHUB_URL } from "../../../lib/site-config";

export const metadata: Metadata = {
  title: "Open Source",
  description:
    "TabBurrow is AGPL-3.0 licensed and fully open source. Audit the code, contribute, or self-host your own instance with your own Supabase project and Anthropic key.",
  alternates: { canonical: "/open-source" },
};

export default function OpenSourcePage() {
  return (
    <>
      <section aria-label="Introduction" className="mx-auto max-w-6xl px-6 pb-12 pt-16 sm:pt-24">
        <div className="max-w-2xl">
          <h1
            className="text-4xl font-bold text-[var(--text)] sm:text-5xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Open source, actually.
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-[var(--text-2)]">
            The popup, the dashboard, the sync engine, the AI organize
            function, all of it, is public source under AGPL-3.0. Not a
            trimmed-down community edition: the exact same code the hosted
            PRO service runs.
          </p>
          <div className="mt-8">
            <LinkButton href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
              View the repository
            </LinkButton>
          </div>
        </div>
      </section>

      <section aria-label="Why AGPL" className="mx-auto max-w-6xl px-6 pb-16">
        <Card variant="surface" className="max-w-3xl sm:p-8">
          <h2
            className="text-2xl font-bold text-[var(--text)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Why AGPL-3.0?
          </h2>
          <p className="mt-4 leading-relaxed text-[var(--text-2)]">
            We chose AGPL-3.0 because it&apos;s genuinely open source: you can
            read every line, fork it, modify it, and run your own hosted
            version. The one thing it requires is that if you host a modified
            version of TabBurrow for other people to use, you publish your
            changes too. That protects the project from someone taking the
            code, hosting it, and quietly closing the source.
          </p>
          <p className="mt-4 leading-relaxed text-[var(--text-2)]">
            It doesn&apos;t affect you if you&apos;re just using the extension,
            or self-hosting for yourself. You only need to share changes if
            you turn around and offer a modified version of the service to
            other people.
          </p>
        </Card>
      </section>

      <section aria-label="Self-hosting" className="mx-auto max-w-6xl px-6 pb-16">
        <Card variant="surface" className="max-w-3xl sm:p-8">
          <h2
            className="text-2xl font-bold text-[var(--text)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            What self-hosting means
          </h2>
          <p className="mt-4 leading-relaxed text-[var(--text-2)]">
            Self-hosting means running TabBurrow&apos;s cloud backend
            yourself instead of using our hosted PRO service. In practice
            that&apos;s three things:
          </p>
          <ul className="mt-4 flex flex-col gap-2 leading-relaxed text-[var(--text-2)]">
            <li>
              <strong className="text-[var(--text)]">Your own Supabase project</strong>:
              a free-tier Postgres database, auth, and Edge Functions,
              created from the schema and migrations in the repo.
            </li>
            <li>
              <strong className="text-[var(--text)]">Your own Anthropic API key</strong>:
              powers the AI organize Edge Function; you set your own usage
              limits and pay Anthropic directly for what you use.
            </li>
            <li>
              <strong className="text-[var(--text)]">Your own build</strong>:
              point the extension at your Supabase URL and load it, or build
              and publish it under your own listing.
            </li>
          </ul>
          <p className="mt-4 leading-relaxed text-[var(--text-2)]">
            The result is the same sync, sharing, and AI organize features as
            PRO, running entirely on infrastructure you control, at no
            recurring cost to us or you beyond your own hosting.
          </p>
        </Card>
      </section>

      <section aria-label="Contribute" className="mx-auto max-w-6xl px-6 pb-20">
        <div className="flex flex-col items-start gap-4 rounded-[var(--radius-arch)] border border-[var(--line)] bg-[var(--bg-well)] p-8">
          <h2
            className="text-2xl font-bold text-[var(--text)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Contribute
          </h2>
          <p className="max-w-2xl text-[var(--text-2)]">
            Found a bug or have an idea worth building? Issues and pull
            requests are welcome. The repository includes a self-hosting
            guide and a contributing guide once it&apos;s public.
          </p>
          <LinkButton href={GITHUB_URL} variant="ghost" target="_blank" rel="noopener noreferrer">
            Open an issue on GitHub
          </LinkButton>
        </div>
      </section>
    </>
  );
}

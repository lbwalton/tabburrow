import type { Metadata } from "next";
import { Card } from "@tabburrow/ui";
import { EFFECTIVE_DATE } from "../../../lib/site-config";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How TabBurrow handles your data: local-first storage, what syncs to the cloud if you sign in, what AI organize sends, and what we never collect.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <div data-theme="paper" className="bg-[var(--bg-ground)]">
      <section aria-label="Privacy policy" className="mx-auto max-w-6xl px-6 py-16 sm:py-24">
        <Card variant="paper" className="mx-auto max-w-3xl sm:p-10">
          <h1
            className="text-3xl font-bold sm:text-4xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Privacy Policy
          </h1>
          <p className="mt-2 text-sm text-[var(--ink-soft)]">Effective {EFFECTIVE_DATE}</p>

          <div className="mt-8 flex flex-col gap-8 leading-relaxed">
            <div>
              <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                The short version
              </h2>
              <p className="mt-3">
                TabBurrow is local-first: your tabs, collections, and sessions
                are stored on your device by default, and TabBurrow works
                fully offline with no account. If you choose to sign in, your
                collections and links sync to our database so you can reach
                them from another device. We never send full page content
                anywhere, we don&apos;t run ads, and we don&apos;t sell your
                data.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                What&apos;s stored locally
              </h2>
              <p className="mt-3">
                Without signing in, TabBurrow stores everything in your
                browser&apos;s IndexedDB: your collections, the links inside
                them (URL, title, favicon, note, tags), and session snapshots
                of your open windows. This data never leaves your device.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                What syncs if you sign in
              </h2>
              <p className="mt-3">
                Signing in (Google OAuth or an email magic link, via
                Supabase Auth) enables PRO cloud sync. Your collections and
                links, the same fields stored locally, sync to our Supabase
                Postgres database over an encrypted connection so they follow
                you across devices. Session snapshots are device-specific by
                design and are never synced. Your account also stores your
                email address and subscription status.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                What AI organize sends
              </h2>
              <p className="mt-3">
                When you run AI organize, TabBurrow sends only the{" "}
                <strong>titles and URLs</strong> of the links in that
                collection to Claude (Anthropic) through our server-side
                function. It never sends the content of the pages themselves.
                Suggested groupings and tags are shown to you as a preview;
                nothing is applied until you confirm it.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                Payments
              </h2>
              <p className="mt-3">
                PRO subscriptions are billed through Stripe. Stripe collects
                and stores your card details directly; TabBurrow never sees
                or stores your full card number. We store your subscription
                status and Stripe customer/subscription IDs so we know your
                account is entitled to PRO features.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                No ads, no data sales
              </h2>
              <p className="mt-3">
                TabBurrow does not run advertising, does not use advertising
                trackers, and does not sell or rent your data to anyone. This
                website does not currently use third-party analytics or
                tracking pixels.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                If you self-host
              </h2>
              <p className="mt-3">
                Self-hosted instances run on your own Supabase project and
                your own Anthropic API key. In that setup, you are the data
                controller: your data goes to your infrastructure and your
                Anthropic account, not ours, and this policy describes our
                hosted service, not your self-hosted one.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                Data retention & deletion
              </h2>
              <p className="mt-3">
                You can delete a collection, delete your local data, or
                export everything to JSON at any time from the dashboard.
                Deleting your account removes your synced collections and
                links from our database; local data on each device is
                cleared separately by clearing extension storage or
                uninstalling the extension.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                Open source
              </h2>
              <p className="mt-3">
                TabBurrow&apos;s source, including the sync and AI organize
                server code, is AGPL-3.0 licensed and publicly auditable, so
                you can verify these claims against the actual code rather
                than take our word for it.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                Children
              </h2>
              <p className="mt-3">
                TabBurrow is not directed at children under 13, and we do not
                knowingly collect data from them.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                Changes to this policy
              </h2>
              <p className="mt-3">
                If this policy changes materially, we&apos;ll update the
                effective date above and, for significant changes, note it in
                the extension.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                Contact
              </h2>
              <p className="mt-3">
                Questions about this policy or your data can be sent through
                the contact details listed on our GitHub repository once it&apos;s
                public, or via an issue on the repository itself.
              </p>
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}

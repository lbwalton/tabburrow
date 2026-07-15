import type { Metadata } from "next";
import { Card } from "@tabburrow/ui";
import { EFFECTIVE_DATE } from "../../../lib/site-config";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The terms for using TabBurrow's free extension and PRO subscription, including billing, fair use, and the AGPL-3.0 source license.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    // <!-- TODO before launch: LB decision needed on refund policy + governing law -->
    <div data-theme="paper" className="bg-[var(--bg-ground)]">
      <section aria-label="Terms of service" className="mx-auto max-w-6xl px-6 py-16 sm:py-24">
        <Card variant="paper" className="mx-auto max-w-3xl sm:p-10">
          <h1
            className="text-3xl font-bold sm:text-4xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Terms of Service
          </h1>
          <p className="mt-2 text-sm text-[var(--ink-soft)]">Effective {EFFECTIVE_DATE}</p>

          <div className="mt-8 flex flex-col gap-8 leading-relaxed">
            <div>
              <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                Using TabBurrow
              </h2>
              <p className="mt-3">
                The TabBurrow browser extension is free to use, with or
                without an account. Signing in and subscribing to PRO is
                optional and adds cloud sync, sharing, and unlimited AI
                organize. By using the extension or this website, you agree
                to these terms.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                Accounts
              </h2>
              <p className="mt-3">
                Creating an account is only required for PRO features. You&apos;re
                responsible for keeping your sign-in method secure. We may
                suspend an account used to abuse the service, for example
                sustained attempts to bypass AI organize&apos;s fair-use
                limits.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                Subscriptions & billing
              </h2>
              <p className="mt-3">
                PRO is billed through Stripe at $4/month or $29/year and
                renews automatically until canceled. Cancel anytime from the
                extension&apos;s billing settings, which opens the Stripe
                customer portal; access continues until the end of the
                current billing period. Not happy with PRO? Email us and
                we&apos;ll make it right.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                Fair use
              </h2>
              <p className="mt-3">
                AI organize is metered: 30 runs a month on the free plan, and
                a soft fair-use cap of roughly 1,000 runs a month on PRO. We
                may throttle or ask you to slow down if usage looks
                automated or abusive rather than normal personal use.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                Open source license
              </h2>
              <p className="mt-3">
                TabBurrow&apos;s source code is separately licensed under
                AGPL-3.0. That license governs your rights to use, modify,
                and redistribute the code itself; these Terms govern your use
                of our hosted PRO service (sync, sharing, and the AI organize
                function running on our infrastructure). Self-hosting your
                own instance is covered by the AGPL-3.0 license, not by these
                Terms.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                Your content
              </h2>
              <p className="mt-3">
                You own the links, collections, and notes you save. We only
                process them to provide the service, sync, AI organize
                previews, and shared collection pages you explicitly turn on.
                If you share a collection publicly, anyone with the link can
                view it until you unshare it.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                Disclaimer & limitation of liability
              </h2>
              <p className="mt-3">
                TabBurrow is provided "as is," without warranties of any
                kind. We&apos;re not liable for indirect, incidental, or
                consequential damages arising from your use of the service,
                to the extent permitted by law. Export your data to JSON at
                any time as your own backup.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                Changes to these terms
              </h2>
              <p className="mt-3">
                We may update these terms as the product changes. We&apos;ll
                update the effective date above; continued use after a change
                means you accept the updated terms.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                Contact
              </h2>
              <p className="mt-3">
                Questions about these terms can be sent via an issue on our
                GitHub repository once it&apos;s public.
              </p>
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}

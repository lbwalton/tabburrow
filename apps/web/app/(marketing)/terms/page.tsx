import type { Metadata } from "next";
import { Card } from "@tabburrow/ui";
import { TERMS_EFFECTIVE_DATE } from "../../../lib/site-config";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The terms for using TabBurrow's free extension and PRO subscription, including billing, fair use, and the AGPL-3.0 source license.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <div data-theme="paper" className="bg-[var(--bg-ground)]">
      <section aria-label="Terms of service" className="mx-auto max-w-6xl px-6 py-16 sm:py-24">
        <Card variant="paper" className="mx-auto max-w-3xl sm:p-10">
          <h1
            className="text-3xl font-bold sm:text-4xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Terms of Service
          </h1>
          <p className="mt-2 text-sm text-[var(--ink-soft)]">Effective {TERMS_EFFECTIVE_DATE}</p>

          <div className="mt-8 flex flex-col gap-8 leading-relaxed">
            <div>
              <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                Using TabBurrow
              </h2>
              <p className="mt-3">
                The TabBurrow browser extension is free to use, with or
                without an account, and on a capable desktop Chrome its AI
                organize runs on-device at no cost. Signing in and subscribing
                to PRO is optional and adds cloud sync, sharing, and cloud AI.
                By using the extension or this website, you agree to these
                terms.
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
                sustained attempts to bypass the cloud AI fair-use limits.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                Subscriptions & billing
              </h2>
              <p className="mt-3">
                PRO is billed through Stripe at $3.99/month or $29/year and
                renews automatically until canceled. Cancel anytime from the
                extension&apos;s billing settings, which opens the Stripe
                customer portal; access continues until the end of the
                current billing period. If PRO isn&apos;t working for you,
                contact us within 14 days of your first payment for a full
                refund. Renewal payments aren&apos;t refunded; cancel anytime
                and you keep PRO until the period ends.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                Fair use
              </h2>
              <p className="mt-3">
                On-device AI organize (Chrome&apos;s Gemini Nano) is free and
                unmetered. The cloud AI path is a PRO feature and is metered,
                with a soft fair-use cap of roughly 1,000 runs a month. We may
                throttle or ask you to slow down if usage looks automated or
                abusive rather than normal personal use.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                Suspension &amp; termination
              </h2>
              <p className="mt-3">
                We reserve the right to suspend, restrict, cancel, or terminate
                any account or PRO subscription at our discretion, including
                where we reasonably believe it&apos;s being used to abuse the
                service. That covers attempts to bypass or inflate the cloud AI
                fair-use limits, automated or scripted usage, and any activity
                designed to run up API or token costs on our infrastructure. You
                can also cancel your own subscription at any time (see
                Subscriptions &amp; billing). If we cancel your PRO subscription
                for a reason other than abuse or a breach of these terms,
                we&apos;ll refund the unused portion of any period you&apos;ve
                prepaid; if we cancel because of abuse or a breach, fees already
                paid aren&apos;t refundable.
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
                of our hosted PRO service (sync, sharing, and the cloud AI
                organize function running on our infrastructure). Self-hosting
                your own instance is covered by the AGPL-3.0 license, not by
                these Terms.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                Your content
              </h2>
              <p className="mt-3">
                You own the links, collections, and notes you save. We only
                process them to provide the service: sync, the cloud AI
                organize preview, and shared collection pages you explicitly
                turn on. On-device AI organize runs in your browser and does
                not send your links to us. If you share a collection publicly,
                anyone with the link can view it until you unshare it.
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
                Governing law
              </h2>
              <p className="mt-3">
                These terms are governed by the laws of the State of
                California, without regard to its conflict-of-law rules.
                Nothing in these terms limits any consumer rights you have
                under the mandatory laws of the place where you live.
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

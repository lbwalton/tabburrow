import type { Metadata } from "next";
import { JsonLd } from "../../../components/JsonLd";
import { PricingToggle } from "../../../components/PricingToggle";
import { Faq } from "../../../components/Faq";
import { pricingFaq, toFaqPageJsonLd } from "../../../lib/faq";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Free forever for local use, with on-device AI organizing on a capable Chrome. PRO is $3.99/month or $29/year for cloud sync, sharing, and cloud AI. Self-host the whole stack for free with your own keys.",
  alternates: { canonical: "/pricing" },
};

const COMPARISON_ROWS: Array<{ feature: string; free: string; pro: string; selfHost: string }> = [
  { feature: "Local saving & collections", free: "Unlimited", pro: "Unlimited", selfHost: "Unlimited" },
  { feature: "Drag-and-drop organizing", free: "Yes", pro: "Yes", selfHost: "Yes" },
  { feature: "Sessions & crash restore", free: "Yes", pro: "Yes", selfHost: "Yes" },
  { feature: "Search, import & export", free: "Yes", pro: "Yes", selfHost: "Yes" },
  { feature: "Cloud sync across devices", free: "No", pro: "Yes", selfHost: "Yes (your Supabase)" },
  { feature: "Shareable collection pages", free: "No", pro: "Yes", selfHost: "Yes (your Supabase)" },
  { feature: "AI organize, on-device (Gemini Nano)", free: "Unlimited (capable Chrome)", pro: "Unlimited (capable Chrome)", selfHost: "Unlimited (capable Chrome)" },
  { feature: "Cloud AI, any device (Claude)", free: "No", pro: "Yes (fair use)", selfHost: "Your Anthropic key" },
  { feature: "Price", free: "$0", pro: "$3.99/mo or $29/yr", selfHost: "$0 to us" },
];

export default function PricingPage() {
  return (
    <>
      <JsonLd data={toFaqPageJsonLd(pricingFaq)} />

      <section aria-label="Pricing plans" className="mx-auto max-w-6xl px-6 pb-16 pt-16 sm:pt-24">
        <div className="mx-auto max-w-2xl text-center">
          <h1
            className="text-4xl font-bold text-[var(--text)] sm:text-5xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Simple pricing, no surprises.
          </h1>
          <p className="mt-4 text-lg text-[var(--text-2)]">
            Local use is free forever, and on a capable Chrome the AI
            organizing runs on-device at no cost. PRO is optional, for people
            who want cloud sync, sharing, and cloud AI on any device.
            Self-hosting is always free too.
          </p>
        </div>
        {/* Visually hidden so the plan cards' h3s nest under an h2 instead
            of skipping straight from the page h1. */}
        <h2 className="sr-only">Plans</h2>
        <div className="mt-12">
          <PricingToggle />
        </div>
      </section>

      <section aria-label="Fair use" className="mx-auto max-w-6xl px-6 pb-16">
        <div className="rounded-[var(--radius-arch)] border border-[var(--line)] bg-[var(--surface)] p-6">
          <p className="text-sm text-[var(--text-2)]">
            <strong className="text-[var(--text)]">How AI organize runs:</strong>{" "}
            on a capable desktop Chrome (roughly Chrome 138+, a few GB of free
            disk for the model, and a modern GPU or enough RAM), AI organize
            and folder naming run on-device with Chrome&apos;s built-in Gemini
            Nano. That path is free, private, and unlimited, and nothing leaves
            your browser. On other devices, or for folders too large for the
            on-device model, cloud AI (Claude) is a PRO option with a soft
            fair-use cap of about 1,000 runs a month. Self-hosters point the
            cloud path at their own Anthropic key and set their own limits.
          </p>
        </div>
      </section>

      <section aria-label="Feature comparison" className="mx-auto max-w-6xl px-6 pb-20">
        <h2
          className="mb-6 text-2xl font-bold text-[var(--text)] sm:text-3xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Compare plans
        </h2>
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--line)]">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <caption className="sr-only">Feature comparison across Free, PRO, and Self-host plans</caption>
            <thead>
              <tr className="border-b border-[var(--line)] bg-[var(--surface)]">
                <th scope="col" className="px-4 py-3 font-semibold text-[var(--text)]">
                  Feature
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-[var(--text)]">
                  Free
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-[var(--text)]">
                  PRO
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-[var(--text)]">
                  Self-host
                </th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON_ROWS.map((row) => (
                <tr key={row.feature} className="border-b border-[var(--line)] last:border-b-0">
                  <th scope="row" className="px-4 py-3 font-medium text-[var(--text)]">
                    {row.feature}
                  </th>
                  <td className="px-4 py-3 text-[var(--text-2)]">{row.free}</td>
                  <td className="px-4 py-3 text-[var(--text-2)]">{row.pro}</td>
                  <td className="px-4 py-3 text-[var(--text-2)]">{row.selfHost}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-label="Pricing questions" className="mx-auto max-w-6xl px-6 pb-20">
        <h2
          className="mb-6 text-2xl font-bold text-[var(--text)] sm:text-3xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Pricing questions
        </h2>
        <Faq items={pricingFaq} />
      </section>
    </>
  );
}

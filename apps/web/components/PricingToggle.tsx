"use client";

import { useState } from "react";
import { Card } from "@tabburrow/ui";
import { LinkButton } from "./LinkButton";
import { CHROME_STORE_URL, GITHUB_URL } from "../lib/site-config";

type Billing = "monthly" | "yearly";

const PRO_PRICE: Record<Billing, { amount: string; suffix: string; note?: string }> = {
  monthly: { amount: "$3.99", suffix: "/month" },
  yearly: { amount: "$29", suffix: "/year", note: "≈ $2.42/month, about 40% less than monthly" },
};

export function PricingToggle() {
  const [billing, setBilling] = useState<Billing>("yearly");

  return (
    <div className="flex flex-col gap-8">
      <div
        role="group"
        aria-label="Billing period"
        className="mx-auto flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--surface)] p-1"
      >
        {(["monthly", "yearly"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={billing === option}
            onClick={() => setBilling(option)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
              billing === option
                ? "bg-[var(--accent)] text-[var(--btn-fg)]"
                : "text-[var(--text-2)] hover:text-[var(--text)]"
            }`}
          >
            {option}
            {option === "yearly" ? <span className="ml-1 opacity-80">(save ~40%)</span> : null}
          </button>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Free */}
        <Card variant="paper" className="flex flex-col gap-5 sm:p-8">
          <div>
            <h3 className="text-xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
              Free
            </h3>
            <p className="mt-1 text-sm text-[var(--ink-soft)]">Everything, running locally.</p>
          </div>
          <p className="text-4xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
            $0
            <span className="text-base font-normal text-[var(--ink-soft)]"> forever</span>
          </p>
          <ul className="flex flex-1 flex-col gap-2 text-sm">
            <li>Unlimited collections and links</li>
            <li>Drag-and-drop, sessions, crash restore</li>
            <li>Fuzzy search, import/export</li>
            <li>On-device AI organize (capable Chrome)</li>
            <li>No account required</li>
          </ul>
          <LinkButton href={CHROME_STORE_URL} className="w-full justify-center">
            Add to Chrome
          </LinkButton>
        </Card>

        {/* PRO */}
        <Card
          variant="paper"
          className="flex flex-col gap-5 ring-2 ring-[var(--accent)] sm:p-8"
        >
          <div>
            <h3 className="text-xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
              PRO
            </h3>
            <p className="mt-1 text-sm text-[var(--ink-soft)]">Sync, sharing, cloud AI.</p>
          </div>
          <div>
            <p className="text-4xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
              {PRO_PRICE[billing].amount}
              <span className="text-base font-normal text-[var(--ink-soft)]">
                {PRO_PRICE[billing].suffix}
              </span>
            </p>
            {PRO_PRICE[billing].note ? (
              <p className="mt-1 text-xs text-[var(--ink-soft)]">{PRO_PRICE[billing].note}</p>
            ) : null}
          </div>
          <ul className="flex flex-1 flex-col gap-2 text-sm">
            <li>Everything in Free</li>
            <li>Cloud sync across devices</li>
            <li>Shareable collection pages</li>
            <li>Cloud AI for any device (fair use)</li>
          </ul>
          <LinkButton href={CHROME_STORE_URL} className="w-full justify-center">
            Add to Chrome
          </LinkButton>
        </Card>

        {/* Self-host */}
        <Card variant="paper" className="flex flex-col gap-5 sm:p-8">
          <div>
            <h3 className="text-xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
              Self-host
            </h3>
            <p className="mt-1 text-sm text-[var(--ink-soft)]">Your infrastructure, your keys.</p>
          </div>
          <p className="text-4xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
            $0
            <span className="text-base font-normal text-[var(--ink-soft)]"> to us</span>
          </p>
          <ul className="flex flex-1 flex-col gap-2 text-sm">
            <li>Everything in PRO</li>
            <li>Your own Supabase project</li>
            <li>Your own Anthropic API key</li>
            <li>AGPL-3.0 source, self-managed</li>
          </ul>
          <LinkButton
            href={GITHUB_URL}
            variant="ghost"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full justify-center"
          >
            Read the self-hosting guide
          </LinkButton>
        </Card>
      </div>
    </div>
  );
}

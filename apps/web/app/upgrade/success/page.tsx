import type { Metadata } from "next";
import { Badge, Card } from "@tabburrow/ui";
import { LinkButton } from "../../../components/LinkButton";

export const metadata: Metadata = {
  title: "You're PRO",
  description: "Your TabBurrow PRO upgrade is complete.",
};

/**
 * Stripe Checkout's `success_url` (see `supabase/functions/checkout-session/index.ts`).
 * Honest about propagation, per task-23a's brief: the webhook that flips
 * `profiles.plan` usually lands within seconds, but the EXTENSION's own
 * plan check is cached client-side for up to 12h (`PLAN_CACHE_TTL_MS` in
 * `apps/extension/lib/auth.ts`, wired up by T23b) unless someone clicks
 * "Refresh status" there, so this page doesn't promise instant PRO
 * everywhere.
 */
export default function UpgradeSuccessPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-center sm:py-24">
      <Card variant="paper" className="sm:p-10">
        <div className="flex justify-center">
          <Badge variant="accent">PRO</Badge>
        </div>
        <h1 className="mt-4 text-3xl font-bold sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>
          You&apos;re PRO now.
        </h1>
        <p className="mt-4 text-[var(--ink-soft)]">
          Cloud sync, shareable collections, and unlimited AI organize are unlocked on your account.
        </p>
        <p className="mt-4 text-sm text-[var(--ink-soft)]">
          The extension usually picks this up within 12 hours on its own. To see PRO right away, open the
          extension&apos;s Settings, go to Account, and click &ldquo;Refresh status.&rdquo;
        </p>
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <LinkButton href="/account">Back to account</LinkButton>
        </div>
      </Card>
    </div>
  );
}

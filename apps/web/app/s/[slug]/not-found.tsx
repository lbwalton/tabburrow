import { Card } from "@tabburrow/ui";
import { LinkButton } from "../../../components/LinkButton";
import { CHROME_STORE_URL } from "../../../lib/site-config";

/**
 * Rendered when `getSharedCollection` resolves to `null`: unknown slug,
 * never shared, or unshared since. Scoped to the `s/[slug]` segment (Next
 * walks up from wherever `notFound()` is thrown to the nearest `not-found`
 * boundary, and this is it), wrapped by `app/s/layout.tsx`'s minimal nav.
 */
export default function ShareNotFound() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-16 sm:py-24">
      <Card variant="paper" className="mx-auto max-w-xl text-center sm:p-10">
        <h1 className="text-2xl font-bold sm:text-3xl" style={{ fontFamily: "var(--font-display)" }}>
          This burrow doesn&apos;t exist or is no longer shared.
        </h1>
        <p className="mt-3 text-[var(--ink-soft)]">
          The link you followed may be mistyped, or the owner turned sharing off. Ask them for a
          fresh link, or check out TabBurrow for yourself.
        </p>
        <div className="mt-6 flex justify-center">
          <LinkButton href={CHROME_STORE_URL}>Get TabBurrow</LinkButton>
        </div>
      </Card>
    </div>
  );
}

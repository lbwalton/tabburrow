/**
 * AiOrganizeDialog's "loading" state: the same burrow-arch motif
 * `BurrowIllustration` uses, plus three small dirt clumps that bounce in
 * sequence — "digging." CSS-only (`.burrow-dig-dot`, defined in
 * assets/tailwind.css), token colors only (no new hex), and respects
 * `prefers-reduced-motion` (the CSS rule swaps the bounce for a static
 * dimmed dot rather than removing the element, so the "AI is working"
 * signal still reads even with motion off).
 */
export function BurrowDiggingAnimation() {
  return (
    <div aria-hidden="true" className="relative mx-auto my-2 h-16 w-24">
      <div
        className="absolute inset-0"
        style={{
          borderRadius: "var(--radius-arch)",
          background: "linear-gradient(180deg, var(--surface) 0%, var(--bg-well) 100%)",
          border: "1px solid var(--line-hi)",
        }}
      />
      <div
        className="absolute bottom-0 left-1/2 h-10 w-14 -translate-x-1/2"
        style={{
          borderRadius: "var(--radius-arch)",
          background: "var(--bg-ground)",
          border: "1px solid var(--line)",
        }}
      />
      <div className="absolute left-1/2 top-3 flex -translate-x-1/2 gap-1.5">
        <span className="burrow-dig-dot" style={{ animationDelay: "0ms" }} />
        <span className="burrow-dig-dot" style={{ animationDelay: "150ms" }} />
        <span className="burrow-dig-dot" style={{ animationDelay: "300ms" }} />
      </div>
    </div>
  );
}

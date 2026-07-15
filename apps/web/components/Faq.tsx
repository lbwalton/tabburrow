import type { FaqItem } from "../lib/faq";

/**
 * Native <details>/<summary> accordion: keyboard and screen-reader
 * accessible with zero JS. The visible text here is what backs the
 * FAQPage JSON-LD emitted alongside it; keep both reading from the same
 * `items` array (see lib/faq.ts) so they can't drift apart.
 */
export function Faq({ items }: { items: FaqItem[] }) {
  return (
    <div className="flex flex-col divide-y divide-[var(--line)] border-t border-b border-[var(--line)]">
      {items.map((item) => (
        <details key={item.question} className="group py-4">
          <summary
            className="flex cursor-pointer list-none items-center justify-between gap-4 text-[1.0625rem] font-medium text-[var(--text)] marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded-sm"
            style={{ fontFamily: "var(--font-display)" }}
          >
            <span>{item.question}</span>
            <span
              aria-hidden="true"
              className="shrink-0 text-[var(--accent)] transition-transform duration-150 group-open:rotate-45"
            >
              +
            </span>
          </summary>
          <p
            className="mt-3 max-w-2xl text-[0.9375rem] leading-relaxed text-[var(--text-2)]"
            style={{ fontFamily: "var(--font-body)" }}
          >
            {item.answer}
          </p>
        </details>
      ))}
    </div>
  );
}

import type { SortMode } from "../../lib/links";

export interface SortMenuProps {
  value: SortMode;
  onChange: (mode: SortMode) => void;
}

const OPTIONS: { mode: SortMode; label: string }[] = [
  { mode: "manual", label: "Manual" },
  { mode: "name", label: "Name" },
  { mode: "date", label: "Date added" },
];

/**
 * Segmented manual/name/date control for the collection header. "Manual" is
 * the drag-ordered `position` column; the other two are view-only sorts
 * (see `sortLinksForView`) that leave `position` untouched and — per the
 * brief — disable link dragging entirely while active (`LinkGrid` reads
 * `value !== "manual"` for that; this component just renders the choice).
 */
export function SortMenu({ value, onChange }: SortMenuProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Sort links"
      className="inline-flex items-center gap-0.5 rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] p-0.5"
    >
      {OPTIONS.map((opt) => (
        <button
          key={opt.mode}
          type="button"
          role="radio"
          aria-checked={value === opt.mode}
          onClick={() => onChange(opt.mode)}
          className={`rounded-[6px] px-2.5 py-1 text-xs font-medium leading-none transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
            value === opt.mode
              ? "bg-[var(--accent)] text-[var(--btn-fg)]"
              : "text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

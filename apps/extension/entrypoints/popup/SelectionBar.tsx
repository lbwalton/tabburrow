import { Button } from "@tabburrow/ui";

export interface SelectionBarProps {
  /** How many links are selected. Rendered in the count and in the Open label. */
  count: number;
  /** Mirrors FolderDetail's `busy` so the bar can't fire a second write mid-flight. */
  busy?: boolean;
  onOpen: () => void;
  onClear: () => void;
}

/**
 * The popup's multi-select action bar, shown once 1+ links are ticked.
 *
 * Deliberately INLINE, unlike the dashboard's `BulkBar` (which is `fixed`
 * with a hand-tuned left offset matching the rail width): a 360px popup has
 * no long scroll to outrun, so `fixed` would buy nothing and inherit that
 * offset-math fragility. It reuses the same `.bulk-bar` class from
 * `assets/tailwind.css` — that class owns only the 200ms @starting-style
 * slide-up, not any positioning.
 *
 * "Open N" is a ghost, not a primary: "Append tabs" is already an orange
 * primary ~40px below, and two orange buttons that close together compete.
 * The bar's own bordered surface carries the emphasis instead.
 */
export function SelectionBar({ count, busy, onOpen, onClear }: SelectionBarProps) {
  return (
    <div
      role="toolbar"
      aria-label="Selection actions"
      className="bulk-bar flex items-center gap-2 rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5"
      style={{ fontFamily: "var(--font-body)" }}
    >
      <span
        className="shrink-0 text-xs font-medium text-[var(--text)]"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {count} selected
      </span>

      <div className="flex flex-1 items-center justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onOpen} disabled={busy}>
          Open {count}
        </Button>
        <button
          type="button"
          aria-label="Clear selection"
          onClick={onClear}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </div>
  );
}

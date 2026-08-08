import { Button } from "@tabburrow/ui";

export interface SelectionBarProps {
  /** How many links are selected. Rendered in the count and in the Open label. */
  count: number;
  /**
   * Resolved CSS color for the folder's accent — the SAME value the row
   * checkboxes fill with (`FolderDetail`'s `checkColor`). The bar borrows it at
   * low saturation so it reads as belonging to the ticked boxes rather than to
   * the button stack below it. Already resolved by `accentColor`, so emoji and
   * unset accents arrive here as `var(--accent)`.
   */
  accent: string;
  /** Mirrors FolderDetail's `busy` so the bar can't fire a second write mid-flight. */
  busy?: boolean;
  onOpen: () => void;
  onDelete: () => void;
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
export function SelectionBar({ count, accent, busy, onOpen, onDelete, onClear }: SelectionBarProps) {
  return (
    <div
      role="toolbar"
      aria-label="Selection actions"
      className="bulk-bar flex items-center gap-2 rounded-[var(--radius-card)] border px-2 py-1.5"
      // The two color values are dynamic (they mix in the folder's accent), so
      // they can't be Tailwind classes. The `border` utility stays in className
      // for its width; only the hue moves inline.
      //
      // 55%/8% were checked against the dark shell with three links selected:
      // the border carries the relationship to the checkboxes, and the 8% wash
      // is deliberately near-subliminal (it separates the bar from the ground
      // without reading as a filled control). They are safe to re-tune — no
      // test asserts these numbers, by design, since pinning a computed
      // color-mix() string would break on tuning while proving nothing about
      // whether it reads correctly.
      style={{
        fontFamily: "var(--font-body)",
        borderColor: `color-mix(in srgb, ${accent} 55%, var(--line))`,
        backgroundColor: `color-mix(in srgb, ${accent} 8%, var(--surface))`,
      }}
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
        <Button size="sm" variant="danger" onClick={onDelete} disabled={busy}>
          Delete
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

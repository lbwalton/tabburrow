import type { ProBadgeState } from "../../lib/proBadge";

export interface ProBadgeProps {
  /** Which mark to render — computed by lib/proBadge.ts's `proBadgeState`. */
  state: ProBadgeState;
  /** Where the "Upgrade" button's click goes (popup: the dashboard Settings tab; dashboard: `#/settings`). Never fired in the active state. */
  onUpgrade: () => void;
}

/**
 * The plan mark right of the "TabBurrow" wordmark, shared by the popup header
 * and the dashboard rail (lives here in dashboard/ per the UpgradeUpsell/
 * AccentPicker precedent — popup imports from `../dashboard/`). Two visible
 * states, decided by lib/proBadge.ts, and deliberately made DIFFERENT KINDS of
 * thing so they can't be mistaken for one another — they used to both render
 * the word "PRO", differing only by color, which read as "I still have PRO"
 * even when signed out or on the free plan:
 *  - "active": a gold "burrow seal" — a pure status mark, not interactive.
 *    Uses --accent-2 (the brand's marker hue) with a deep-green check, stamped
 *    in once via `.tb-pro-seal` (assets/tailwind.css), then still.
 *  - "upgrade": an "Upgrade" button in the action hue (--accent) that opens
 *    the upgrade path.
 * Renders nothing on builds with no cloud backend configured.
 */
export function ProBadge({ state, onUpgrade }: ProBadgeProps) {
  if (state === "hidden") return null;

  if (state === "active") {
    return (
      <span className="tb-pro-seal" role="img" aria-label="PRO member" title="PRO member">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.6 8.4l2.7 2.8L12.4 4.6" />
        </svg>
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-label="Upgrade to PRO"
      title="Upgrade to PRO"
      onClick={onUpgrade}
      className="inline-flex shrink-0 items-center rounded-full border border-[var(--line)] px-2 py-0.5 text-xs font-medium leading-none text-[var(--accent)] transition-colors hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      style={{ fontFamily: "var(--font-body)" }}
    >
      Upgrade
    </button>
  );
}

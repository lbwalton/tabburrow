import { Badge } from "@tabburrow/ui";
import type { ProBadgeState } from "../../lib/proBadge";

export interface ProBadgeProps {
  /** Which chip to render — computed by lib/proBadge.ts's `proBadgeState`. */
  state: ProBadgeState;
  /** Where the muted chip's click goes (popup: the dashboard Settings tab; dashboard: `#/settings`). Never fired in the active state. */
  onUpgrade: () => void;
}

/**
 * The compact plan chip right of the "TabBurrow" wordmark, shared by the
 * popup header and the dashboard rail (lives here in dashboard/ per the
 * UpgradeUpsell/AccentPicker precedent — popup imports from `../dashboard/`).
 * Two visible states, decided by lib/proBadge.ts:
 *  - "upgrade": a muted, real <button> that opens the upgrade path.
 *  - "active": the footer Badge's exact accent styling — pure status, not
 *    interactive.
 * Renders nothing on builds with no cloud backend configured.
 */
export function ProBadge({ state, onUpgrade }: ProBadgeProps) {
  if (state === "hidden") return null;

  if (state === "active") {
    return (
      <Badge variant="accent" title="PRO active">
        PRO
      </Badge>
    );
  }

  return (
    <button
      type="button"
      aria-label="Upgrade to PRO"
      title="Upgrade to PRO"
      onClick={onUpgrade}
      className="inline-flex shrink-0 items-center rounded-full border border-[var(--line)] px-2 py-0.5 text-xs font-medium leading-none text-[var(--text-2)] transition-colors hover:border-[var(--line-hi)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      style={{ fontFamily: "var(--font-mono)" }}
    >
      PRO
    </button>
  );
}

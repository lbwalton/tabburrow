import type { Plan } from "./auth";

/**
 * The home screen's single quiet "Pro" strip. Its dismissal is persisted in
 * the `meta` table (local-only, never synced) so a dismiss sticks across popup
 * opens. This module owns the pure show/dismiss decision so it can be unit
 * tested without chrome or a DB; ProBanner.tsx just reads/writes the meta value
 * and renders.
 */

/** `meta` key holding the banner's dismissal record, encoded by `formatProBannerState`. */
export const PRO_BANNER_META_KEY = "proBannerDismissed";

/** After a first dismissal the banner stays hidden for this long, then reappears exactly once. A second dismissal hides it for good. */
export const PRO_BANNER_REAPPEAR_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

/** How many times the banner has been dismissed, and when it was last dismissed. `count` 0 means "never dismissed" (no persisted record). */
export interface ProBannerState {
  count: number;
  lastDismissedAt: number;
}

const EMPTY_STATE: ProBannerState = { count: 0, lastDismissedAt: 0 };

/**
 * Pure: parses the `meta` value written by `formatProBannerState` (`"<count>:<ts>"`).
 * Any malformed / missing value reads as "never dismissed" so a corrupted row
 * can never permanently suppress the banner.
 */
export function parseProBannerState(raw: string | null): ProBannerState {
  if (!raw) return EMPTY_STATE;
  const [countRaw, tsRaw] = raw.split(":");
  const count = Number.parseInt(countRaw ?? "", 10);
  const lastDismissedAt = Number.parseInt(tsRaw ?? "", 10);
  if (!Number.isFinite(count) || count <= 0 || !Number.isFinite(lastDismissedAt)) return EMPTY_STATE;
  return { count, lastDismissedAt };
}

/** Pure: the `meta` value to persist for a state. */
export function formatProBannerState(state: ProBannerState): string {
  return `${state.count}:${state.lastDismissedAt}`;
}

/** Pure: the state after a dismissal at `now` — bumps the count and records the time. */
export function dismissProBannerState(prev: ProBannerState, now: number): ProBannerState {
  return { count: prev.count + 1, lastDismissedAt: now };
}

/**
 * Pure: whether the banner should render right now.
 *  - PRO users never see it (on-device AI is free for everyone; the banner
 *    only sells the Pro-only extras).
 *  - Never dismissed → show.
 *  - Dismissed once → hidden until `PRO_BANNER_REAPPEAR_MS` has passed, then
 *    it reappears exactly once.
 *  - Dismissed twice or more → hidden for good (no dark-pattern nagging).
 */
export function shouldShowProBanner(input: { plan: Plan | null; state: ProBannerState; now: number }): boolean {
  if (input.plan === "pro") return false;
  const { count, lastDismissedAt } = input.state;
  if (count <= 0) return true;
  if (count >= 2) return false;
  return input.now - lastDismissedAt >= PRO_BANNER_REAPPEAR_MS;
}

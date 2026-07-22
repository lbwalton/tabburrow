import type { AuthUser, Plan } from "./auth";

/**
 * The compact "PRO" chip that sits right of the TabBurrow wordmark (popup
 * header + dashboard rail). This module owns the pure which-state decision so
 * it can be unit tested without chrome or supabase (same split as
 * lib/proBanner.ts); ProBadge.tsx just renders the chosen state.
 */

export type ProBadgeState = "hidden" | "upgrade" | "active";

/**
 * Pure: which chip to render.
 *  - Cloud not configured (e.g. a pure self-host local build with no
 *    Supabase env): no chip at all — there is nothing to upgrade to.
 *  - Signed in on the PRO plan: the full-color "PRO active" status chip.
 *  - Anything else (signed out, FREE plan, or a signed-in user's plan still
 *    resolving): the muted chip that clicks through to the upgrade path.
 *    A cached `"pro"` with no signed-in user never reads as active.
 */
export function proBadgeState(cloudConfigured: boolean, authUser: AuthUser | null, plan: Plan | null): ProBadgeState {
  if (!cloudConfigured) return "hidden";
  if (authUser !== null && plan === "pro") return "active";
  return "upgrade";
}

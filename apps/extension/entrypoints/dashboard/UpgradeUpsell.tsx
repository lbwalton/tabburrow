import { Button } from "@tabburrow/ui";

/**
 * The one line every FREE-gated PRO upsell in the dashboard shows, so
 * ShareDialog's and AiOrganizeDialog's quota views can never drift apart on
 * wording. Replaces the pre-T23b "PRO purchasing is coming soon" placeholder
 * now that checkout is real (T23b) — AccountPane's own "Upgrade to PRO"
 * section, in Settings, is where the actual monthly/yearly checkout buttons
 * live, which is exactly where this copy points.
 */
export const UPGRADE_UPSELL_COPY = "Upgrade to PRO in Settings, where the checkout buttons live.";

/**
 * Shared "Upgrade to PRO" CTA for a FREE-gated dialog: closes the calling
 * dialog and jumps to Settings — the exact hash-navigation pattern this
 * file's siblings already use for "Sign in" (see ShareDialog's and
 * AiOrganizeDialog's own `handleSignInClick`). One shared implementation so
 * the two dialogs' upgrade CTAs can't diverge in behavior either.
 */
export function UpgradeToProButton({ onClose }: { onClose: () => void }) {
  function handleClick() {
    onClose();
    window.location.hash = "#/settings";
  }

  return (
    <Button type="button" size="sm" onClick={handleClick}>
      Upgrade to PRO
    </Button>
  );
}

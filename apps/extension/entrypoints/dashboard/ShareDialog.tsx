import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Collection } from "@tabburrow/core";
import { generateShareSlug, getDB, setShare } from "@tabburrow/core";
import { Button, Dialog, Input } from "@tabburrow/ui";
import { PRICING_URL } from "../../lib/ai";
import { getPlan, onAuthChange } from "../../lib/auth";
import type { AuthUser, Plan } from "../../lib/auth";
import { shareUrlFor } from "../../lib/share-url";
import { isSupabaseConfigured } from "../../lib/supabase";
import { requestSync } from "../../lib/sync-controller";

export interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  /** The collection being shared/unshared. `isShared`/`shareSlug` are read straight off this (live-query-driven from the caller), so a sync landing elsewhere (another device toggling the same collection) is reflected the next time this dialog opens. */
  collection: Collection;
}

/** The three mutating actions this dialog can drive, each a `setShare` write + `requestSync("manual")` wait. Tracked as local busy state (not derived from `collection.isShared`) because "share" flips `isShared` LOCALLY the instant `setShare` writes, but the URL must not be revealed until the sync that pushes the row is confirmed. */
type ShareAction = "sharing" | "unsharing" | "rotating";

interface ActionError {
  action: ShareAction;
  message: string;
}

const BUSY_MESSAGE: Record<ShareAction, string> = {
  sharing: "Sharing this collection and syncing to the cloud...",
  unsharing: "Stopping sharing and syncing to the cloud...",
  rotating: "Generating a new link and syncing to the cloud...",
};

const DEFAULT_ERROR_MESSAGE = "Couldn't sync this change to the cloud. Try again.";

/**
 * Collection-header "Share" control (opened next to "Organize with AI" —
 * see DashboardMain.tsx). Five states, folded by auth/plan the same way
 * AiOrganizeDialog.tsx's `resolveView` does:
 *
 *  - cloud not configured / signed out: quiet message / sign-in prompt.
 *  - FREE (signed in, not PRO): upsell, no toggle at all.
 *  - PRO, unshared: the plain-language visibility explanation + a
 *    "Share this collection" button.
 *  - PRO, an action (share/stop/rotate) in flight: a visible busy state
 *    with a Cancel (closes the dialog; does NOT abort the in-flight
 *    `setShare`+`requestSync` — there is no cancellation plumbing in
 *    `requestSync`, and the write already committed locally by the time
 *    this state renders, so "cancel" means "stop watching", not "undo").
 *  - PRO, shared: the URL (read-only input + Copy), Stop sharing, and
 *    Generate new link.
 *
 * The one hard rule every action here follows: `setShare` writes local
 * state FIRST (so it survives even if the dialog is closed mid-sync), then
 * `requestSync("manual")` is awaited before the busy state clears. On a
 * failed/skipped sync the local write is reverted to what it was BEFORE
 * this action (captured as `previous` right before the write) — the public
 * page can only ever reflect what actually reached the cloud, so a device
 * that couldn't sync must not keep showing itself as sharing/not-sharing a
 * slug nothing else in the world can resolve.
 */
export function ShareDialog({ open, onClose, collection }: ShareDialogProps) {
  const db = getDB();
  const configured = isSupabaseConfigured();

  const [user, setUser] = useState<AuthUser | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState<ShareAction | null>(null);
  const [error, setError] = useState<ActionError | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!configured) return;
    return onAuthChange(setUser);
  }, [configured]);

  useEffect(() => {
    if (!user) {
      setPlan(null);
      return;
    }
    let cancelled = false;
    void getPlan().then((p) => {
      if (!cancelled) setPlan(p);
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // A dialog left busy/erroring/"Copied" from a PRIOR open must never
  // reappear stale on a fresh open — same rule AiOrganizeDialog's `view`
  // reset follows. (An action already in flight when the dialog was closed
  // keeps running regardless — see the module docstring's Cancel note —
  // this only resets what THIS render shows.)
  useEffect(() => {
    if (open) {
      setBusy(null);
      setError(null);
      setCopied(false);
    }
  }, [open]);

  async function runAction(
    action: ShareAction,
    next: { isShared: boolean; shareSlug: string | null },
  ): Promise<void> {
    const previous = { isShared: collection.isShared, shareSlug: collection.shareSlug };
    setBusy(action);
    setError(null);
    await setShare(collection.id, next, db);
    const result = await requestSync("manual", db);
    if ("ok" in result && result.ok) {
      setBusy(null);
      return;
    }
    // Sync failed outright, or was gated out (session/plan changed mid-flow,
    // offline, account-switch block, ...) — either way the write above never
    // reached the cloud. Revert so this device's local state matches what
    // the public page (and every other device) actually has.
    await setShare(collection.id, previous, db);
    const message = "error" in result && result.error ? result.error : DEFAULT_ERROR_MESSAGE;
    setBusy(null);
    setError({ action, message });
  }

  function handleShare(): void {
    void runAction("sharing", { isShared: true, shareSlug: generateShareSlug() });
  }

  function handleStopSharing(): void {
    void runAction("unsharing", { isShared: false, shareSlug: null });
  }

  function handleRotate(): void {
    void runAction("rotating", { isShared: true, shareSlug: generateShareSlug() });
  }

  function handleRetry(): void {
    if (!error) return;
    if (error.action === "sharing") handleShare();
    else if (error.action === "unsharing") handleStopSharing();
    else handleRotate();
  }

  async function handleCopy(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission denied or unavailable — the URL is still
      // selectable/readable in the input itself, so this is a silent no-op
      // rather than an error toast over a non-critical convenience action.
    }
  }

  function handleSignInClick(): void {
    onClose();
    window.location.hash = "#/settings";
  }

  function handlePricingClick(): void {
    onClose();
    chrome.tabs.create({ url: PRICING_URL });
  }

  let body: ReactNode;
  let footer: ReactNode;

  if (!configured) {
    body = (
      <p className="text-sm text-[var(--text-2)]">
        Cloud features are not configured for this build. Sharing needs a Supabase project, see SELF_HOSTING.md.
      </p>
    );
    footer = (
      <Button type="button" variant="ghost" size="sm" onClick={onClose}>
        Dismiss
      </Button>
    );
  } else if (!user) {
    body = (
      <p className="text-sm text-[var(--text)]">
        Sign in to share a collection: anyone with the link can see its names, links, notes, and tags.
      </p>
    );
    footer = (
      <>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={handleSignInClick}>
          Sign in
        </Button>
      </>
    );
  } else if (plan !== "pro") {
    body = (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-[var(--text)]">Sharing is part of PRO.</p>
        <p className="text-xs text-[var(--text-2)]">
          PRO purchasing is coming soon, this link previews what&apos;s ahead.
        </p>
      </div>
    );
    footer = (
      <>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Dismiss
        </Button>
        <Button type="button" size="sm" onClick={handlePricingClick}>
          See PRO pricing
        </Button>
      </>
    );
  } else if (busy) {
    body = <p className="py-2 text-sm text-[var(--text-2)]">{BUSY_MESSAGE[busy]}</p>;
    footer = (
      <Button type="button" variant="ghost" size="sm" onClick={onClose}>
        Cancel
      </Button>
    );
  } else if (error) {
    body = <p className="text-sm text-[var(--text)]">{error.message}</p>;
    footer = (
      <>
        <Button type="button" variant="ghost" size="sm" onClick={() => setError(null)}>
          Dismiss
        </Button>
        <Button type="button" size="sm" onClick={handleRetry}>
          Retry
        </Button>
      </>
    );
  } else if (collection.isShared && collection.shareSlug) {
    const url = shareUrlFor(collection.shareSlug);
    body = (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-[var(--text)]">
          Anyone with the link can see this collection&apos;s names, links, notes, and tags. Nothing else is shared.
        </p>
        <div className="flex items-center gap-2">
          <Input
            readOnly
            value={url}
            aria-label="Share link"
            onFocus={(e) => e.currentTarget.select()}
            className="font-mono text-xs"
          />
          <Button type="button" variant="ghost" size="sm" onClick={() => void handleCopy(url)}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="text-xs text-[var(--text-2)]">
          Stopping sharing or generating a new link can take about a minute to reach the public page, since it&apos;s
          cached; the old link keeps working until then.
        </p>
      </div>
    );
    footer = (
      <>
        <Button type="button" variant="ghost" size="sm" onClick={handleStopSharing}>
          Stop sharing
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={handleRotate}>
          Generate new link
        </Button>
      </>
    );
  } else {
    body = (
      <p className="text-sm text-[var(--text)]">
        Anyone with the link can see this collection&apos;s names, links, notes, and tags. Nothing else is shared.
      </p>
    );
    footer = (
      <>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={handleShare}>
          Share this collection
        </Button>
      </>
    );
  }

  return (
    <Dialog open={open} onClose={onClose} title="Share collection" footer={footer}>
      {body}
    </Dialog>
  );
}

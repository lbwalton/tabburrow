import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { generateShareSlug, getDB, setShare } from "@tabburrow/core";
import type { Collection } from "@tabburrow/core";
import { Button, Dialog, Input } from "@tabburrow/ui";
import { getPlan, onAuthChange } from "../../lib/auth";
import type { AuthUser, Plan } from "../../lib/auth";
import { isSupabaseConfigured } from "../../lib/supabase";
import { requestSync } from "../../lib/sync-controller";
import { mailtoShareForCollection, shareUrlFor } from "../../lib/share-url";
import { UPGRADE_UPSELL_COPY, UpgradeToProButton } from "../dashboard/UpgradeUpsell";

export interface SendMenuProps {
  open: boolean;
  onClose: () => void;
  collection: Collection;
}

const SHARE_VISIBILITY =
  "Anyone with the link can see this collection's name, color, links, notes, and tags. Nothing else is shared.";

/**
 * Folder-detail "Send": copy the public share link or hand it to the user's
 * mail app (mailto, no recipient). Pro-gated exactly like ShareDialog — cloud
 * not configured / signed out / FREE all show the upsell instead of the
 * actions. For a PRO user on an unshared collection it first creates a slug
 * (`setShare` + a confirmed `requestSync`, reverting on a failed sync so a link
 * is only ever revealed once it has actually reached the cloud), then shows
 * Copy link + Email. This reuses ShareDialog's discipline without modifying it,
 * and adds the email hand-off ShareDialog doesn't have.
 */
export function SendMenu({ open, onClose, collection }: SendMenuProps) {
  const db = getDB();
  const configured = isSupabaseConfigured();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  useEffect(() => {
    if (open) {
      setBusy(false);
      setError(null);
      setCopied(false);
    }
  }, [open]);

  async function ensureShared() {
    if (busy) return;
    const previous = { isShared: collection.isShared, shareSlug: collection.shareSlug };
    setBusy(true);
    setError(null);
    await setShare(collection.id, { isShared: true, shareSlug: generateShareSlug() }, db);
    const result = await requestSync("manual", db);
    if ("ok" in result && result.ok) {
      setBusy(false);
      return;
    }
    // Sync failed / was gated out: revert so a link is never revealed for a row
    // nothing else in the world can resolve.
    await setShare(collection.id, previous, db);
    setBusy(false);
    setError("Couldn't sync the link to the cloud. Try again.");
  }

  async function handleCopy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — the URL is still readable in the field.
    }
  }

  function handleEmail(url: string) {
    window.open(mailtoShareForCollection(collection.name, url), "_blank");
  }

  function handleSignIn() {
    onClose();
    window.location.hash = "#/settings";
  }

  let body: ReactNode;
  let footer: ReactNode;

  if (!configured) {
    body = (
      <p className="text-sm text-[var(--text-2)]">
        Cloud features are not configured for this build. Sharing needs a Supabase project (see SELF_HOSTING.md).
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
        Sign in to send a collection: anyone with the link can see its name, color, links, notes, and tags.
      </p>
    );
    footer = (
      <>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={handleSignIn}>
          Sign in
        </Button>
      </>
    );
  } else if (plan !== "pro") {
    body = (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-[var(--text)]">Sending a link is part of PRO.</p>
        <p className="text-xs text-[var(--text-2)]">{UPGRADE_UPSELL_COPY}</p>
      </div>
    );
    footer = (
      <>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Dismiss
        </Button>
        <UpgradeToProButton onClose={onClose} />
      </>
    );
  } else if (busy) {
    body = <p className="text-sm text-[var(--text-2)]">Creating the link and syncing to the cloud…</p>;
    footer = null;
  } else if (error) {
    body = <p className="text-sm text-[var(--text)]">{error}</p>;
    footer = (
      <>
        <Button type="button" variant="ghost" size="sm" onClick={() => setError(null)}>
          Dismiss
        </Button>
        <Button type="button" size="sm" onClick={() => void ensureShared()}>
          Retry
        </Button>
      </>
    );
  } else if (collection.isShared && collection.shareSlug) {
    const url = shareUrlFor(collection.shareSlug);
    body = (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-[var(--text)]">{SHARE_VISIBILITY}</p>
        <div className="flex items-center gap-2">
          <Input
            readOnly
            value={url}
            aria-label="Share link"
            onFocus={(e) => e.currentTarget.select()}
            className="font-mono text-xs"
          />
          <Button type="button" variant="ghost" size="sm" onClick={() => void handleCopy(url)}>
            {copied ? "Copied" : "Copy link"}
          </Button>
        </div>
      </div>
    );
    footer = (
      <>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Done
        </Button>
        <Button type="button" size="sm" onClick={() => handleEmail(url)}>
          Email
        </Button>
      </>
    );
  } else {
    body = <p className="text-sm text-[var(--text)]">{SHARE_VISIBILITY}</p>;
    footer = (
      <>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={() => void ensureShared()}>
          Create link
        </Button>
      </>
    );
  }

  return (
    <Dialog open={open} onClose={busy ? () => {} : onClose} dismissable={!busy} title="Send collection" footer={footer}>
      {body}
    </Dialog>
  );
}

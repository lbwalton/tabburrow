"use client";

import { useState } from "react";
import { Button } from "@tabburrow/ui";

/**
 * "Open all" for a shared collection. A plain `window.open` loop, one call
 * per link. Most browsers only allow the FIRST `window.open` in a burst to
 * escape the popup blocker (each call after that needs its own direct user
 * gesture, which this loop doesn't have). Rather than pretend that isn't
 * true, this counts how many actually opened and shows guidance once a
 * block is detected, instead of silently opening one tab and going quiet.
 *
 * Uses `@tabburrow/ui`'s `<Button variant="ghost">` directly again (F1
 * fix): the ghost-on-paper illegibility this used to work around locally
 * was a systemic bug in `Card variant="paper"`, not something specific to
 * this button, so it's now fixed at the source — Card stamps
 * `data-surface="paper"` on itself and tokens.css re-scopes
 * --text/--line/--surface-hover within it. See stories/fixes.json F1.
 */
export function OpenAllButton({ urls }: { urls: string[] }) {
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);

  function handleOpenAll() {
    setBusy(true);
    let openedCount = 0;
    for (const url of urls) {
      const win = window.open(url, "_blank", "noopener,noreferrer");
      if (win) openedCount += 1;
    }
    setBlocked(openedCount < urls.length);
    setBusy(false);
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={handleOpenAll}
        disabled={busy || urls.length === 0}
      >
        Open all ({urls.length})
      </Button>
      {blocked ? (
        <p role="status" className="text-xs text-[var(--ink-soft)]">
          Your browser blocked some of these tabs from opening automatically. Allow pop-ups for this
          site (usually a prompt near the address bar) and try again, or open links one at a time below.
        </p>
      ) : null}
    </div>
  );
}

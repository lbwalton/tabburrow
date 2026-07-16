"use client";

import { useState } from "react";
import { cx } from "../../../lib/cx";

/**
 * "Open all" for a shared collection. A plain `window.open` loop, one call
 * per link. Most browsers only allow the FIRST `window.open` in a burst to
 * escape the popup blocker (each call after that needs its own direct user
 * gesture, which this loop doesn't have). Rather than pretend that isn't
 * true, this counts how many actually opened and shows guidance once a
 * block is detected, instead of silently opening one tab and going quiet.
 *
 * Styled locally instead of `@tabburrow/ui`'s `<Button variant="ghost">`:
 * that variant hardcodes `text-[var(--text)]`/`border-[var(--line)]`, the
 * dark-shell tokens, which read as near-invisible cream-on-cream when
 * rendered inside a `Card variant="paper"` like this one (the paper variant
 * only flips `background`/`color`/`border` on the Card itself via a direct
 * class override, not a `data-theme="paper"` custom-property scope, so
 * nested components that reference `--text`/`--line` directly don't pick up
 * the paper palette). Using the ink/paper-line tokens here instead keeps it
 * readable without changing the shared component.
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
      <button
        type="button"
        onClick={handleOpenAll}
        disabled={busy || urls.length === 0}
        className={cx(
          "inline-flex h-8 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-card)]",
          "border border-[var(--paper-line)] bg-transparent px-3 text-sm font-medium text-[var(--ink)]",
          "transition-colors duration-150 hover:bg-[var(--paper-line)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--paper)]",
          "disabled:pointer-events-none disabled:opacity-50"
        )}
        style={{ fontFamily: "var(--font-body)" }}
      >
        Open all ({urls.length})
      </button>
      {blocked ? (
        <p role="status" className="text-xs text-[var(--ink-soft)]">
          Your browser blocked some of these tabs from opening automatically. Allow pop-ups for this
          site (usually a prompt near the address bar) and try again, or open links one at a time below.
        </p>
      ) : null}
    </div>
  );
}

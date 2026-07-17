import { useEffect, useState } from "react";
import { getDB, getMeta, setMeta } from "@tabburrow/core";
import type { Plan } from "../../lib/auth";
import {
  dismissProBannerState,
  formatProBannerState,
  parseProBannerState,
  PRO_BANNER_META_KEY,
  shouldShowProBanner,
} from "../../lib/proBanner";

export interface ProBannerProps {
  /** The signed-in plan (or null when signed out / unresolved). PRO never sees the banner. */
  plan: Plan | null;
}

/**
 * One quiet, dismissible strip on the home screen selling the Pro-only extras
 * (sync, sharing, cloud AI). On-device AI is free for everyone, so the copy
 * never implies free users get no AI. Dismissal is persisted in the `meta`
 * table (see lib/proBanner.ts); it reappears at most once after 14 days and is
 * gone for good after a second dismissal.
 */
export function ProBanner({ plan }: ProBannerProps) {
  const db = getDB();
  // `null` = not yet decided (meta read pending); render nothing until then so
  // the banner can't flash in and immediately hide.
  const [visible, setVisible] = useState<boolean | null>(null);

  useEffect(() => {
    if (plan === "pro") {
      setVisible(false);
      return;
    }
    let cancelled = false;
    void getMeta(PRO_BANNER_META_KEY, db).then((raw) => {
      if (cancelled) return;
      const state = parseProBannerState(raw);
      setVisible(shouldShowProBanner({ plan, state, now: Date.now() }));
    });
    return () => {
      cancelled = true;
    };
  }, [plan, db]);

  async function handleDismiss() {
    setVisible(false);
    const prev = parseProBannerState(await getMeta(PRO_BANNER_META_KEY, db));
    await setMeta(PRO_BANNER_META_KEY, formatProBannerState(dismissProBannerState(prev, Date.now())), db);
  }

  if (!visible) return null;

  return (
    <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
      <span className="text-xs text-[var(--accent-2)]" style={{ fontFamily: "var(--font-mono)" }}>
        Pro
      </span>
      <span className="flex-1 truncate text-xs text-[var(--text-2)]">sync, sharing, cloud AI</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => void handleDismiss()}
        className="shrink-0 rounded-[4px] px-1 leading-none text-[var(--text-2)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        ×
      </button>
    </div>
  );
}

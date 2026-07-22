import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getDB, getMeta } from "@tabburrow/core";
import { Badge, Button, Card, Input, Toast } from "@tabburrow/ui";
import {
  getPlan,
  onAuthChange,
  sendEmailCode,
  signInWithGoogle,
  signOut,
  verifyEmailCode,
} from "../../lib/auth";
import type { AuthUser, Plan } from "../../lib/auth";
import { accountUrl, createCheckoutSession, shouldPickupPlanOnVisible, upgradeAvailability } from "../../lib/billing";
import type { BillingInterval } from "../../lib/billing";
import { isSupabaseConfigured } from "../../lib/supabase";
import { relativeTime } from "../../lib/sessions";
import {
  accountSwitchDecision,
  LAST_SYNC_AT_META_KEY,
  LAST_SYNC_ERROR_META_KEY,
  LAST_SYNC_USER_ID_META_KEY,
  replaceLocalDataWithCloud,
  requestSync,
} from "../../lib/sync-controller";

type FormStage = "email" | "code";

/**
 * Settings' "Account" section (rendered at the top of SettingsPane — see
 * its own docstring). Three states:
 *  - cloud not configured (`isSupabaseConfigured()` false, e.g. a
 *    self-hosted build with no Supabase env — see SELF_HOSTING.md): a
 *    quiet message, no network calls, no auth.* imports even touched.
 *  - signed out: email + 6-digit code (two-stage form, Enter submits
 *    either stage) or "Sign in with Google".
 *  - signed in: email, plan Badge, "Refresh status", "Sign out", and
 *    (T23b) either an "Upgrade to PRO" section (FREE: monthly/yearly
 *    checkout buttons) or a "Manage billing" button (PRO) — see
 *    lib/billing.ts's `upgradeAvailability`.
 *
 * All auth state comes from `onAuthChange` (supabase-js's
 * `onAuthStateChange`, which fires once immediately on subscribe) — no
 * polling. Self-contained (owns its own busy/error state), same
 * "own its local UI state" precedent SettingsPane's own docstring sets.
 */
export function AccountPane() {
  const configured = isSupabaseConfigured();
  const db = getDB();

  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  // Global (not per-user) meta keys, per T18's spec — a device that signs
  // out of one PRO account and into another briefly shows the departed
  // account's last-sync status until the next sync completes. Sync status
  // carries no entitlement or PII (unlike `lib/auth.ts`'s `planCache`, which
  // WAS scoped per-user after a real cross-user leak — see its docstring),
  // so this is a cosmetic staleness gap, not a security concern; flagged
  // rather than silently left unexplained.
  const lastSyncAtRaw = useLiveQuery(() => getMeta(LAST_SYNC_AT_META_KEY, db), [db]);
  const lastSyncErrorRaw = useLiveQuery(() => getMeta(LAST_SYNC_ERROR_META_KEY, db), [db]);
  const hasSyncError = !!lastSyncErrorRaw;
  // The account-switch guard's UI half (see lib/sync-controller.ts's
  // accountSwitchDecision docstring for the data-leak scenario this blocks).
  // `undefined` while the live query's first emission is pending — the Sync
  // section renders nothing in that window rather than flashing a "Sync now"
  // button that a blocked device shouldn't have.
  const lastSyncUserIdRaw = useLiveQuery(() => getMeta(LAST_SYNC_USER_ID_META_KEY, db), [db]);
  const [replacing, setReplacing] = useState(false);
  const [switchDismissed, setSwitchDismissed] = useState(false);

  const [stage, setStage] = useState<FormStage>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  // --- T23b: billing ---
  const [billingBusy, setBillingBusy] = useState<BillingInterval | null>(null);
  const [checkoutOpened, setCheckoutOpened] = useState(false);
  const [billingToast, setBillingToast] = useState<{ key: number; message: string } | null>(null);
  // In-memory only (not meta-persisted): a stale rate-limit gate surviving a
  // reload would just mean one extra `getPlan(true)` next time, never a
  // correctness issue — see shouldPickupPlanOnVisible's docstring.
  const lastPickupAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!configured) return;
    const unsubscribe = onAuthChange((next) => {
      setUser(next);
      setAuthLoaded(true);
      if (next) {
        // Reset the sign-in form so a later sign-out starts from a clean slate.
        setStage("email");
        setEmail("");
        setCode("");
        setError(null);
        setGoogleError(null);
      }
    });
    return unsubscribe;
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

  // T23b, "post-checkout pickup polish": a FREE user who just completed
  // checkout in the new tab handleUpgrade opened, then switches BACK to
  // this tab, gets an automatic `getPlan(true)` instead of having to
  // remember "Refresh status" — see shouldPickupPlanOnVisible's docstring
  // for the full rationale and the 60s rate limit. Scoped to FREE only:
  // a PRO user has nothing this pickup could discover (there's no
  // "downgrade in a new tab" flow), so it's a no-op for them by design,
  // not an oversight.
  useEffect(() => {
    if (!configured || !user) return;
    function handleVisibility() {
      if (document.visibilityState !== "visible") return;
      if (plan !== "free") return;
      const now = Date.now();
      if (!shouldPickupPlanOnVisible(lastPickupAtRef.current, now)) return;
      lastPickupAtRef.current = now;
      void getPlan(true).then(setPlan);
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [configured, user, plan]);

  async function handleSendCode(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const trimmed = email.trim();
    if (!trimmed) {
      setError("Enter your email.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sendEmailCode(trimmed);
      setStage("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send a code. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyCode(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const trimmed = code.trim();
    if (!trimmed) {
      setError("Enter the 6-digit code.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await verifyEmailCode(email.trim(), trimmed);
      // onAuthChange's subscriber above flips the view to signed-in.
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    if (googleBusy) return;
    setGoogleBusy(true);
    setGoogleError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setGoogleError(err instanceof Error ? err.message : "Google sign-in failed.");
    } finally {
      setGoogleBusy(false);
    }
  }

  async function handleSignOut() {
    if (busy) return;
    setBusy(true);
    try {
      await signOut();
    } finally {
      setBusy(false);
    }
  }

  async function handleRefreshPlan() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      setPlan(await getPlan(true));
    } finally {
      setRefreshing(false);
    }
  }

  /**
   * Starts a Stripe Checkout for `interval` and opens the returned URL in a
   * NEW TAB (`chrome.tabs.create`) — unlike apps/web's AccountClient, which
   * redirects the CURRENT tab (an ordinary web-page pattern), this is an
   * extension dashboard tab with no "navigate away and back" story, so it
   * stays put while checkout happens alongside it. `checkoutOpened` drives
   * the inline "come back and hit Refresh status" hint below; the
   * visibilitychange pickup effect above is the polish that usually makes
   * that hint unnecessary in practice.
   */
  async function handleUpgrade(interval: BillingInterval) {
    if (billingBusy) return;
    setBillingBusy(interval);
    try {
      const { url } = await createCheckoutSession(interval);
      chrome.tabs.create({ url });
      setCheckoutOpened(true);
    } catch (err) {
      // BillingError (lib/billing.ts) extends Error, so this one check
      // covers both — its `.kind` isn't branched on here since every kind
      // shows the same toast today; kept as a typed error (not a plain
      // string throw) for whichever caller next needs to distinguish them,
      // matching lib/ai.ts's AiOrganizeError convention.
      const message = err instanceof Error ? err.message : "Couldn't start checkout. Try again.";
      setBillingToast({ key: Date.now(), message });
    } finally {
      setBillingBusy(null);
    }
  }

  function handleManageBilling() {
    chrome.tabs.create({ url: accountUrl() });
  }

  async function handleSyncNow() {
    if (syncing) return;
    setSyncing(true);
    try {
      // requestSync writes meta[lastSyncAt]/meta[lastSyncError] itself (see
      // lib/sync-controller.ts) — this component's status line reacts to
      // that live, so nothing from the result needs to flow back here.
      await requestSync("manual", db);
    } finally {
      setSyncing(false);
    }
  }

  async function handleReplaceLocalData() {
    if (replacing || !user) return;
    setReplacing(true);
    try {
      // Wipes local collections/links/pendingOps (NOT sessions), resets the
      // cursor, and runs a full pull of this account's cloud data — the
      // explicit user resolution of the "blocked" account-switch state.
      // The blocked banner disappears on its own once this lands:
      // lastSyncUserId's live query re-emits with the current user's id.
      await replaceLocalDataWithCloud(user.id, db);
    } finally {
      setReplacing(false);
    }
  }

  if (!configured) {
    return (
      <Card variant="surface" arch={false} className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-[var(--text)]">Account</h2>
        <p className="text-xs text-[var(--text-2)]">
          Cloud features are not configured. Sync, AI organize, and sharing need a Supabase project — see
          SELF_HOSTING.md.
        </p>
      </Card>
    );
  }

  if (user) {
    const availability = upgradeAvailability({ configured, user, plan });
    return (
      <>
        <Card variant="surface" arch={false} className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-[var(--text)]">Account</h2>
          <div className="flex items-center gap-2 text-sm text-[var(--text)]">
            <span className="truncate">{user.email}</span>
            <Badge variant={plan === "pro" ? "accent" : "muted"}>{plan === "pro" ? "PRO" : "Free"}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => void handleRefreshPlan()} disabled={refreshing}>
              Refresh status
            </Button>
            {availability === "manage" ? (
              <Button type="button" variant="ghost" size="sm" onClick={handleManageBilling}>
                Manage billing
              </Button>
            ) : null}
            <Button type="button" variant="ghost" size="sm" onClick={() => void handleSignOut()} disabled={busy}>
              Sign out
            </Button>
          </div>

          {/* Fix pass 1: the whole Sync-vs-Upgrade split is driven by
              `availability` (the TDD'd pure decision in lib/billing.ts),
              never raw `plan` — "hidden" (plan still resolving on a fresh
              mount, OR a genuinely failed profiles lookup) renders NEITHER
              section. Gating on `plan === "pro"` here previously put live
              checkout buttons in that unresolved window, where a PRO user
              with a transient plan-fetch failure could have started a
              second real subscription. */}
          {availability === "manage" ? (
            <div className="flex flex-col gap-2 border-t border-[var(--line)] pt-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-2)]">Sync</h3>
              {lastSyncUserIdRaw === undefined ? null : accountSwitchDecision({
                  lastSyncUserId: lastSyncUserIdRaw,
                  currentUserId: user.id,
                }) === "blocked" ? (
                switchDismissed ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs text-[var(--text-2)]">Sync is paused for this account.</p>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setSwitchDismissed(false)}>
                      Resolve
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs text-[var(--text-2)]">
                      This device previously synced with a different account. To sync with this account, replace this
                      device&apos;s local data with this account&apos;s cloud data.
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={() => void handleReplaceLocalData()}
                        disabled={replacing}
                      >
                        Replace local data
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setSwitchDismissed(true)}
                        disabled={replacing}
                      >
                        Not now
                      </Button>
                    </div>
                  </div>
                )
              ) : (
                <>
                  {hasSyncError ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-[var(--accent-2)]">Sync error</span>
                      <Button type="button" variant="ghost" size="sm" onClick={() => void handleSyncNow()} disabled={syncing}>
                        Retry
                      </Button>
                    </div>
                  ) : lastSyncAtRaw ? (
                    <p className="text-xs text-[var(--text-2)]">Synced {relativeTime(Number(lastSyncAtRaw), Date.now())}</p>
                  ) : null}
                  <div>
                    <Button type="button" variant="primary" size="sm" onClick={() => void handleSyncNow()} disabled={syncing}>
                      Sync now
                    </Button>
                  </div>
                </>
              )}
            </div>
          ) : availability === "upgrade" ? (
            <div className="flex flex-col gap-2 border-t border-[var(--line)] pt-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-2)]">Upgrade to PRO</h3>
              <p className="text-xs text-[var(--text-2)]">Cloud sync, sharing, and unlimited AI organize.</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleUpgrade("month")}
                  disabled={billingBusy !== null}
                >
                  {billingBusy === "month" ? "Opening…" : "$3.99/month"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleUpgrade("year")}
                  disabled={billingBusy !== null}
                >
                  {billingBusy === "year" ? "Opening…" : "$29/year (save ~40%)"}
                </Button>
              </div>
              {checkoutOpened ? (
                <p className="text-xs text-[var(--text-2)]">
                  Complete checkout in the new tab, then hit Refresh status.
                </p>
              ) : null}
            </div>
          ) : null}
        </Card>
        {billingToast ? (
          <div className="fixed bottom-6 right-6 z-50">
            <Toast
              key={billingToast.key}
              message={billingToast.message}
              durationMs={5000}
              onDismiss={() => setBillingToast(null)}
            />
          </div>
        ) : null}
      </>
    );
  }

  return (
    <Card variant="surface" arch={false} className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-[var(--text)]">Account</h2>
      {!authLoaded ? null : stage === "email" ? (
        <form className="flex flex-col gap-2" onSubmit={(e) => void handleSendCode(e)}>
          <label className="text-xs text-[var(--text-2)]" htmlFor="account-email">
            Email
          </label>
          <Input
            id="account-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
          {error ? <p className="text-xs text-[var(--accent-2)]">{error}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              Send code
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void handleGoogle()}
              disabled={googleBusy}
              title={googleError ?? "Sign in with your Google account"}
            >
              Sign in with Google
            </Button>
          </div>
          {googleError ? <p className="text-xs text-[var(--accent-2)]">{googleError}</p> : null}
        </form>
      ) : (
        <form className="flex flex-col gap-2" onSubmit={(e) => void handleVerifyCode(e)}>
          <label className="text-xs text-[var(--text-2)]" htmlFor="account-code">
            Enter the 6-digit code sent to {email}.
          </label>
          <Input
            id="account-code"
            inputMode="numeric"
            autoFocus
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={busy}
          />
          {error ? <p className="text-xs text-[var(--accent-2)]">{error}</p> : null}
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              Verify
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setStage("email");
                setError(null);
              }}
              disabled={busy}
            >
              Back
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

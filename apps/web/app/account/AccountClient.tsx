"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { Badge, Button, Card, Input } from "@tabburrow/ui";
import { getBrowserClient, getSupabaseUrl, isSupabaseConfigured } from "../../lib/supabase-browser";
import { functionUrl, parseCheckoutResponse } from "../../lib/billing";

type FormStage = "email" | "code";
type Plan = "free" | "pro";
type BillingKey = "month" | "year" | "portal";

/**
 * `/account`'s entire interactive surface (T23a). Three states, same shape
 * as apps/extension/entrypoints/dashboard/AccountPane.tsx (the extension's
 * equivalent, NOT modified by this task — see task-23a's brief):
 *  - cloud not configured: quiet message, zero network calls.
 *  - signed out: email + 6-digit OTP code (two-stage form).
 *  - signed in: email, plan Badge, "Refresh status", "Sign out", and
 *    either upgrade buttons (free) or a "Manage billing" button (pro)
 *    that redirect to a Stripe-hosted URL from `checkout-session`.
 *
 * Auth state comes from `onAuthStateChange` (fires once immediately on
 * subscribe with the current session) — no polling, matching the
 * extension's own `onAuthChange` convention.
 */
export function AccountClient() {
  const configured = isSupabaseConfigured();

  const [session, setSession] = useState<Session | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);

  const [stage, setStage] = useState<FormStage>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  const [billingBusy, setBillingBusy] = useState<BillingKey | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);

  const user: User | null = session?.user ?? null;

  useEffect(() => {
    if (!configured) return;
    const client = getBrowserClient();
    if (!client) return;
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoaded(true);
      if (nextSession) {
        // Reset the sign-in form so a later sign-out starts from a clean slate.
        setStage("email");
        setEmail("");
        setCode("");
        setError(null);
        setGoogleError(null);
      }
    });
    return () => subscription.unsubscribe();
  }, [configured]);

  async function loadPlan(): Promise<void> {
    const client = getBrowserClient();
    const currentUser = session?.user;
    if (!client || !currentUser) return;
    setPlanLoading(true);
    try {
      const { data, error: planError } = await client
        .from("profiles")
        .select("plan")
        .eq("user_id", currentUser.id)
        .single();
      if (!planError && data) setPlan(data.plan === "pro" ? "pro" : "free");
    } finally {
      setPlanLoading(false);
    }
  }

  useEffect(() => {
    if (!user) {
      setPlan(null);
      return;
    }
    void loadPlan();
    // Only re-fetch when the signed-in user actually changes (sign-in/out,
    // account switch) — "Refresh status" below covers the manual case, no
    // need to re-run this on every session object identity change (token
    // refreshes fire onAuthStateChange too).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function handleSendCode(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (busy) return;
    const trimmed = email.trim();
    if (!trimmed) {
      setError("Enter your email.");
      return;
    }
    const client = getBrowserClient();
    if (!client) return;
    setBusy(true);
    setError(null);
    try {
      const { error: sendError } = await client.auth.signInWithOtp({
        email: trimmed,
        options: { shouldCreateUser: true },
      });
      if (sendError) throw sendError;
      setStage("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send a code. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyCode(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (busy) return;
    const trimmed = code.trim();
    if (!trimmed) {
      setError("Enter the 6-digit code.");
      return;
    }
    const client = getBrowserClient();
    if (!client) return;
    setBusy(true);
    setError(null);
    try {
      const { error: verifyError } = await client.auth.verifyOtp({ email: email.trim(), token: trimmed, type: "email" });
      if (verifyError) throw verifyError;
      // onAuthStateChange above flips the view to signed-in.
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Google sign-in via Supabase OAuth — the web counterpart to the
   * extension's lib/auth.ts `signInWithGoogle`, backed by the SAME Supabase
   * Google provider (no separate Google Cloud client). Where the extension
   * drives `chrome.identity.launchWebAuthFlow`, an ordinary web page uses
   * the standard full-tab redirect: supabase-js sends this tab to Google,
   * and on the way back to `${origin}/account` the browser client's default
   * `detectSessionInUrl` establishes the session client-side — no server
   * callback route, because this app uses the plain @supabase/supabase-js
   * client (localStorage sessions), not @supabase/ssr cookies. The
   * `onAuthStateChange` subscription above then flips the view to signed-in.
   * `${origin}/account` (not `/`) is deliberate: the redirect must land on a
   * page that instantiates the Supabase client, and only `/account` does.
   */
  async function handleGoogleSignIn(): Promise<void> {
    if (googleBusy) return;
    const client = getBrowserClient();
    if (!client) return;
    setGoogleBusy(true);
    setGoogleError(null);
    try {
      const { error: oauthError } = await client.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/account` },
      });
      if (oauthError) throw oauthError;
      // On success supabase-js navigates this tab to Google, so the page
      // unloads here; `googleBusy` is intentionally left set.
    } catch (err) {
      setGoogleError(err instanceof Error ? err.message : "Google sign-in isn't available right now.");
      setGoogleBusy(false);
    }
  }

  async function handleSignOut(): Promise<void> {
    const client = getBrowserClient();
    if (!client || busy) return;
    setBusy(true);
    try {
      await client.auth.signOut();
    } finally {
      setBusy(false);
    }
  }

  /**
   * Calls `checkout-session` directly with `fetch` (not supabase-js's
   * `functions.invoke`) so the response body is trivial to read on both
   * success and failure — same precedent as apps/extension/lib/ai.ts's
   * `organizeLinks`. Redirects the CURRENT tab to the returned Stripe URL
   * (a hosted Checkout or billing-portal page): unlike the extension,
   * which opens this in a new tab (T23b — a browser-extension UX choice),
   * a plain web page navigating away is the ordinary pattern for a
   * Stripe-hosted redirect flow.
   */
  async function startBilling(body: { interval: "month" | "year" } | { portal: true }, key: BillingKey): Promise<void> {
    if (billingBusy) return;
    const supabaseUrl = getSupabaseUrl();
    const token = session?.access_token;
    if (!supabaseUrl || !token) {
      setBillingError("Sign in again and retry.");
      return;
    }
    setBillingBusy(key);
    setBillingError(null);
    try {
      const res = await fetch(functionUrl(supabaseUrl, "checkout-session"), {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      const outcome = parseCheckoutResponse(res.status, json);
      if (!outcome.ok) {
        setBillingError(outcome.message);
        return;
      }
      window.location.assign(outcome.url);
    } catch {
      setBillingError("Couldn't reach the billing service. Check your connection and try again.");
    } finally {
      setBillingBusy(null);
    }
  }

  if (!configured) {
    return (
      <Card variant="paper" className="mx-auto max-w-md sm:p-8">
        <h1 className="text-xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
          Account
        </h1>
        <p className="mt-3 text-sm text-[var(--ink-soft)]">
          Cloud features aren&apos;t configured for this deployment. See SELF_HOSTING.md to set up your own Supabase
          project.
        </p>
      </Card>
    );
  }

  if (!authLoaded) {
    return (
      <div className="mx-auto max-w-md px-6 py-16">
        <p className="text-center text-sm text-[var(--text-2)]">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <Card variant="paper" className="mx-auto max-w-md sm:p-8">
        <h1 className="text-xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
          Sign in
        </h1>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">
          Sign in to manage your TabBurrow account and billing.
        </p>
        {stage === "email" ? (
          <div className="mt-6 flex flex-col gap-3">
            <Button type="button" onClick={() => void handleGoogleSignIn()} disabled={googleBusy || busy}>
              {googleBusy ? "Redirecting…" : "Sign in with Google"}
            </Button>
            {googleError ? <p className="text-xs text-[var(--accent-2)]">{googleError}</p> : null}
            <div className="flex items-center gap-3 py-1" aria-hidden="true">
              <span className="h-px flex-1 bg-[var(--paper-line)]" />
              <span className="text-xs text-[var(--ink-soft)]">or</span>
              <span className="h-px flex-1 bg-[var(--paper-line)]" />
            </div>
            <form className="flex flex-col gap-3" onSubmit={(e) => void handleSendCode(e)}>
              <label className="text-xs text-[var(--ink-soft)]" htmlFor="account-email">
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
              <Button type="submit" disabled={busy}>
                Send code
              </Button>
            </form>
          </div>
        ) : (
          <form className="mt-6 flex flex-col gap-3" onSubmit={(e) => void handleVerifyCode(e)}>
            <label className="text-xs text-[var(--ink-soft)]" htmlFor="account-code">
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
              <Button type="submit" disabled={busy}>
                Verify
              </Button>
              <Button
                type="button"
                variant="ghost"
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

  return (
    <Card variant="paper" className="mx-auto max-w-md sm:p-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
          Account
        </h1>
        <Badge variant={plan === "pro" ? "accent" : "muted"}>
          {plan === "pro" ? "PRO" : plan === "free" ? "Free" : "…"}
        </Badge>
      </div>
      <p className="mt-2 truncate text-sm text-[var(--ink-soft)]">{user.email}</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => void loadPlan()} disabled={planLoading}>
          Refresh status
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => void handleSignOut()} disabled={busy}>
          Sign out
        </Button>
      </div>

      <div className="mt-6 border-t border-[var(--paper-line)] pt-6">
        {plan === "pro" ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[var(--ink-soft)]">
              You&apos;re on PRO: cloud sync, sharing, and cloud AI organize.
            </p>
            <Button
              type="button"
              onClick={() => void startBilling({ portal: true }, "portal")}
              disabled={billingBusy !== null}
            >
              {billingBusy === "portal" ? "Opening…" : "Manage billing"}
            </Button>
          </div>
        ) : plan === "free" ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[var(--ink-soft)]">
              Upgrade to PRO for cloud sync, sharing, and cloud AI organize.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => void startBilling({ interval: "month" }, "month")}
                disabled={billingBusy !== null}
              >
                {billingBusy === "month" ? "Opening…" : "Upgrade monthly ($3.99/mo)"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => void startBilling({ interval: "year" }, "year")}
                disabled={billingBusy !== null}
              >
                {billingBusy === "year" ? "Opening…" : "Upgrade yearly ($29/yr)"}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-[var(--ink-soft)]">Loading your plan…</p>
        )}
        {billingError ? <p className="mt-2 text-xs text-[var(--accent-2)]">{billingError}</p> : null}
      </div>
    </Card>
  );
}

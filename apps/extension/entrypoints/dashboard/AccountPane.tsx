import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Badge, Button, Card, Input } from "@tabburrow/ui";
import {
  getPlan,
  onAuthChange,
  sendEmailCode,
  signInWithGoogle,
  signOut,
  verifyEmailCode,
} from "../../lib/auth";
import type { AuthUser, Plan } from "../../lib/auth";
import { isSupabaseConfigured } from "../../lib/supabase";

type FormStage = "email" | "code";

/**
 * Settings' "Account" section (rendered at the top of SettingsPane — see
 * its own docstring). Three states:
 *  - cloud not configured (`isSupabaseConfigured()` false, e.g. a
 *    self-hosted build with no Supabase env — see SELF_HOSTING.md): a
 *    quiet message, no network calls, no auth.* imports even touched.
 *  - signed out: email + 6-digit code (two-stage form, Enter submits
 *    either stage) or "Sign in with Google".
 *  - signed in: email, plan Badge, "Refresh status", "Sign out".
 *
 * All auth state comes from `onAuthChange` (supabase-js's
 * `onAuthStateChange`, which fires once immediately on subscribe) — no
 * polling. Self-contained (owns its own busy/error state), same
 * "own its local UI state" precedent SettingsPane's own docstring sets.
 */
export function AccountPane() {
  const configured = isSupabaseConfigured();

  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [stage, setStage] = useState<FormStage>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

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
    return (
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
          <Button type="button" variant="ghost" size="sm" onClick={() => void handleSignOut()} disabled={busy}>
            Sign out
          </Button>
        </div>
      </Card>
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

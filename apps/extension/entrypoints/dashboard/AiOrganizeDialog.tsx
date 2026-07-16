import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Collection, Link } from "@tabburrow/core";
import { getDB } from "@tabburrow/core";
import { Badge, Button, Dialog } from "@tabburrow/ui";
import {
  AI_FREE_LIMIT,
  AiOrganizeError,
  applyPlan,
  getAiUsesThisMonth,
  organizeLinks,
  planApplication,
  summarizeApply,
} from "../../lib/ai";
import type { AiApplyResult, AiPlan } from "../../lib/ai";
import { getPlan, onAuthChange } from "../../lib/auth";
import type { AuthUser, Plan } from "../../lib/auth";
import { isSupabaseConfigured } from "../../lib/supabase";
import { BurrowDiggingAnimation } from "./BurrowDiggingAnimation";
import { UPGRADE_UPSELL_COPY, UpgradeToProButton } from "./UpgradeUpsell";

export interface AiOrganizeDialogProps {
  open: boolean;
  onClose: () => void;
  /** The collection AI organize is run FROM — every group member's "before" label in the preview. */
  collectionId: string;
  collectionName: string;
  /** That collection's live links — the exact set sent to the AI. */
  links: Link[];
  /** ALL live collections, for `planApplication`'s existing-name matching in the preview. */
  collections: Collection[];
  onError: (message: string) => void;
  /** Called once, right before `onClose`, with a toast-ready success message — the caller renders it via its own Toast stack (App.tsx). */
  onOrganized: (message: string) => void;
}

/** This dialog's own local state machine — the parts that DON'T depend on auth/plan (those are folded in by `resolveView` below, since they can change out from under an open dialog and must never be "stuck"). */
type View =
  | { kind: "confirm" }
  | { kind: "quota"; used: number; limit: number }
  | { kind: "loading" }
  | { kind: "preview"; plan: AiPlan; included: boolean[] }
  | { kind: "applying" }
  /** Some writes committed, some did not (see `summarizeApply`) — an honest report; NEVER the stale preview again. */
  | { kind: "partial"; message: string }
  | { kind: "error"; message: string };

type ResolvedView =
  | { kind: "not-configured" }
  | { kind: "signed-out" }
  | View;

/**
 * Pure: folds auth/plan/quota state into the local `View` FSM to produce
 * the ONE state that's actually rendered. "not-configured"/"signed-out"
 * always win regardless of what `view` was mid-flow (a sign-out while the
 * dialog happens to be open must never leave a stale "preview" on screen).
 * A FREE user already known (via the local display counter) to be at the
 * limit is routed straight to "quota" from "confirm" — the brief's
 * "free-with-zero-quota: same dialog quota state" — without needing to
 * actually fire the request and get a 402 back first.
 */
function resolveView(
  configured: boolean,
  user: AuthUser | null,
  plan: Plan | null,
  usesThisMonth: number,
  view: View,
): ResolvedView {
  if (!configured) return { kind: "not-configured" };
  if (!user) return { kind: "signed-out" };
  if (view.kind === "confirm" && plan === "free" && usesThisMonth >= AI_FREE_LIMIT) {
    return { kind: "quota", used: usesThisMonth, limit: AI_FREE_LIMIT };
  }
  return view;
}

/**
 * The preview-diff/apply flow for T20's AI organize. Fully controlled
 * (`open`/`onClose` from the parent) so both entry points — the collection
 * header's "Organize with AI" button and the popup's "Save all + organize"
 * deep link (`?organize=1`, consumed by useRoute) — can drive the same
 * instance. Owns its own auth/plan/quota state (same "leaf components
 * subscribe to onAuthChange themselves" precedent AccountPane/popup's App
 * already set) and resets to the entry view every time it's (re)opened.
 *
 * The one hard rule every state below serves: `applyPlan` is called from
 * EXACTLY ONE place (`handleApply`, wired to the preview screen's "Apply"
 * button) — nothing here ever writes local data on its own.
 */
export function AiOrganizeDialog({
  open,
  onClose,
  collectionId,
  collectionName,
  links,
  collections,
  onError,
  onOrganized,
}: AiOrganizeDialogProps) {
  const db = getDB();
  const configured = isSupabaseConfigured();

  const [user, setUser] = useState<AuthUser | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [usesThisMonth, setUsesThisMonth] = useState(0);
  const [view, setView] = useState<View>({ kind: "confirm" });

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

  // Re-read the local display counter every time the dialog opens (not just
  // when `user` changes) — a run through this SAME dialog instance earlier
  // in the session must be reflected the next time it's opened, not just on
  // the next sign-in.
  useEffect(() => {
    if (!open || !user) {
      setUsesThisMonth(0);
      return;
    }
    let cancelled = false;
    void getAiUsesThisMonth(user.id, db).then((n) => {
      if (!cancelled) setUsesThisMonth(n);
    });
    return () => {
      cancelled = true;
    };
  }, [open, user, db]);

  // A dialog left in "preview"/"error" from a PRIOR open must never
  // reappear stale — every fresh open starts back at "confirm".
  useEffect(() => {
    if (open) setView({ kind: "confirm" });
  }, [open]);

  const linksById = useMemo(() => new Map(links.map((l) => [l.id, l])), [links]);

  async function handleOrganize() {
    setView({ kind: "loading" });
    try {
      const nextPlan = await organizeLinks(links, db);
      setView({ kind: "preview", plan: nextPlan, included: nextPlan.groups.map(() => true) });
    } catch (err) {
      if (err instanceof AiOrganizeError) {
        if (err.kind === "quota") {
          setView({ kind: "quota", used: err.used ?? usesThisMonth, limit: err.limit ?? AI_FREE_LIMIT });
          return;
        }
        if (err.kind === "auth") {
          // A session that looked valid a moment ago just expired/signed
          // out mid-flow — onAuthChange flips `user` to null on its own,
          // which routes resolveView straight to "signed-out" already.
          return;
        }
      }
      setView({
        kind: "error",
        message: err instanceof Error ? err.message : "AI organize is temporarily unavailable. Try again in a moment.",
      });
    }
  }

  function toggleGroup(index: number) {
    if (view.kind !== "preview") return;
    const included = view.included.slice();
    included[index] = !included[index];
    setView({ ...view, included });
  }

  async function handleApply() {
    if (view.kind !== "preview") return;
    const { plan: acceptedPlan, included } = view;
    const acceptedGroups = acceptedPlan.groups.filter((_, i) => included[i]);
    if (acceptedGroups.length === 0) return; // Apply is disabled at 0 selected — defensive no-op.
    setView({ kind: "applying" });
    let result: AiApplyResult;
    try {
      result = await applyPlan({ groups: acceptedGroups, tags: acceptedPlan.tags }, collectionId, db);
    } catch (err) {
      // applyPlan only throws when NOTHING was attempted (its initial db
      // read failed — see its resilience contract); every per-item failure
      // is contained into the returned counts instead. So the preview is
      // still an accurate picture of local state here, and ONLY here, which
      // is what makes returning to it honest.
      onError(err instanceof Error ? err.message : "Could not apply the AI organize plan.");
      setView({ kind: "preview", plan: acceptedPlan, included });
      return;
    }
    const summary = summarizeApply(result);
    if (summary.kind === "full") {
      onOrganized(summary.message);
      onClose();
    } else {
      // At least one write committed but not everything landed — an honest
      // partial report. NEVER back to the preview: it now lies about state.
      setView({ kind: "partial", message: summary.message });
    }
  }

  function handleSignInClick() {
    onClose();
    window.location.hash = "#/settings";
  }

  const resolved = resolveView(configured, user, plan, usesThisMonth, view);

  let body: ReactNode;
  let footer: ReactNode;

  switch (resolved.kind) {
    case "not-configured":
      body = (
        <p className="text-sm text-[var(--text-2)]">
          Cloud features are not configured for this build. AI organize needs a Supabase project, see SELF_HOSTING.md.
        </p>
      );
      footer = (
        // "Dismiss", not "Close": Dialog's own native × close button is
        // ALSO accessibly named "Close" (Dialog.tsx's aria-label) — a
        // second button with the identical name would be ambiguous to
        // both assistive tech and any getByRole("button", {name:"Close"})
        // test locator.
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Dismiss
        </Button>
      );
      break;

    case "signed-out":
      body = (
        <p className="text-sm text-[var(--text)]">
          Sign in to use AI organize: titles and links are sent to the AI service, never page content.
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
      break;

    case "confirm":
      body = (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-[var(--text)]">
            Organize {links.length} link{links.length === 1 ? "" : "s"} with AI: titles and links are sent to the AI
            service, never page content.
          </p>
          {plan === "free" ? (
            <p className="text-xs text-[var(--text-2)]">
              {Math.max(0, AI_FREE_LIMIT - usesThisMonth)} of {AI_FREE_LIMIT} left this month
            </p>
          ) : null}
        </div>
      );
      footer = (
        <>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={() => void handleOrganize()} disabled={links.length === 0}>
            Organize
          </Button>
        </>
      );
      break;

    case "quota":
      body = (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-[var(--text)]">You&apos;ve used all {resolved.limit} free AI organizes this month.</p>
          <p className="text-xs text-[var(--text-2)]">PRO gets unlimited AI organize (fair use). {UPGRADE_UPSELL_COPY}</p>
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
      break;

    case "loading":
      body = (
        <div className="flex flex-col items-center gap-2 py-2">
          <BurrowDiggingAnimation />
          <p className="text-sm text-[var(--text-2)]">Digging through your links...</p>
        </div>
      );
      footer = null;
      break;

    case "preview": {
      const actions = planApplication(resolved.plan.groups, collections);
      const includedCount = resolved.included.filter(Boolean).length;
      body = (
        <div className="flex max-h-[55vh] flex-col gap-3 overflow-y-auto">
          {resolved.plan.groups.map((group, i) => {
            const action = actions[i]!;
            const targetName = action.kind === "create" ? group.name : action.targetCollectionName;
            const tags = Array.from(new Set(group.linkIds.flatMap((id) => resolved.plan.tags[id] ?? [])));
            return (
              <div
                key={i}
                role="group"
                aria-label={group.name}
                className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--line)] p-3"
              >
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={resolved.included[i]}
                    onChange={() => toggleGroup(i)}
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                  <span aria-hidden="true">{group.emoji}</span>
                  <span className="flex-1 truncate text-sm font-medium text-[var(--text)]">{group.name}</span>
                  <Badge variant="muted">{action.kind === "create" ? "new collection" : "merges into existing"}</Badge>
                </label>
                <ul className="flex flex-col gap-1 pl-6 text-xs text-[var(--text-2)]">
                  {group.linkIds.map((id) => (
                    <li key={id} className="truncate">
                      {linksById.get(id)?.title ?? id}
                      <span className="mx-1">·</span>
                      {collectionName} → {targetName}
                    </li>
                  ))}
                </ul>
                {tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1 pl-6">
                    {tags.map((tag) => (
                      <Badge key={tag} variant="muted">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      );
      footer = (
        <>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={() => void handleApply()} disabled={includedCount === 0}>
            Apply ({includedCount} group{includedCount === 1 ? "" : "s"})
          </Button>
        </>
      );
      break;
    }

    case "applying":
      body = <p className="py-2 text-sm text-[var(--text-2)]">Applying...</p>;
      footer = null;
      break;

    case "partial":
      body = <p className="text-sm text-[var(--text)]">{resolved.message}</p>;
      footer = (
        // Dismiss only — deliberately NO retry and NO way back to the
        // preview: after a partial apply the preview would lie about local
        // state, and re-running the same plan would double-create the
        // groups that DID land.
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Dismiss
        </Button>
      );
      break;

    case "error":
      body = <p className="text-sm text-[var(--text)]">{resolved.message}</p>;
      footer = (
        <>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Dismiss
          </Button>
          <Button type="button" size="sm" onClick={() => void handleOrganize()}>
            Retry
          </Button>
        </>
      );
      break;
  }

  return (
    <Dialog open={open} onClose={onClose} title="Organize with AI" footer={footer}>
      {body}
    </Dialog>
  );
}

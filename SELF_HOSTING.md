# Self-hosting TabBurrow

TabBurrow's local features (save, organize, sessions, search, import/export)
need nothing but the extension itself: no account, no backend, no
environment variables. This guide is for the PRO tier: cloud sync, AI
organize, sharing, and billing, running entirely on your own Supabase
project and your own API keys.

**Status note:** cloud sync, AI organize, sharing, and billing are still
being built (stories T17–T23 in [`stories/stories.json`](stories/stories.json)).
The steps below describe the intended self-hosting path and are written
against the schema and functions as designed in
[`docs/specs/2026-07-15-tabburrow-design.md`](docs/specs/2026-07-15-tabburrow-design.md#5-data-model).
The database schema landed in T15: step 2 below is verified against the
actual files in [`supabase/migrations/`](supabase/migrations/). Extension
auth (email code + Google OAuth scaffold) landed in T16: step 5 below is
now real and verified — the extension DOES read `SUPABASE_URL`/
`SUPABASE_ANON_KEY` at build time. The `ai-organize` Edge Function landed
in T19: it exists at `supabase/functions/ai-organize/`, is covered by a
`deno test` suite, and was verified end to end against a real Anthropic
call on the local stack, so step 3's `ai-organize` row and step 4's
`ANTHROPIC_API_KEY` secret are now a tested runbook, not a preview. The
extension itself doesn't call it yet (that UI wiring is T20), so there's
no in-app way to trigger it until then. `checkout-session`,
`stripe-webhook`, and `share-resolve` have **not** landed yet (T21/T22/T23),
so their rows in step 3 stay a preview of the workflow.

## What self-hosting gets you

| You bring | You get |
| --- | --- |
| A free Supabase project | Cloud sync across your own devices, on your own Postgres |
| An Anthropic API key | Unlimited AI organize, billed to you at Anthropic's per-use rate, not ours |
| (Optional) a Stripe account | Only needed if you want to resell PRO yourself; skip entirely for personal use |
| ~15 minutes | The full TabBurrow feature set, with your data never touching our infrastructure |

## 1. Create a Supabase project

1. Sign up at [supabase.com](https://supabase.com) (free tier is enough
   for personal use; see [Costs](#costs) below).
2. Create a new project and note its **Project URL** and **anon public
   key** from Project Settings → API. You'll also need the **service
   role key** for the Edge Functions (never expose this one to the
   extension).
3. Install the [Supabase CLI](https://supabase.com/docs/guides/cli) if you
   don't already have it:
   ```sh
   brew install supabase/tap/supabase
   ```
4. Log in and link the CLI to your project:
   ```sh
   supabase login
   supabase link --project-ref <your-project-ref>
   ```
   (`<your-project-ref>` is the short ID in your Supabase project's URL,
   e.g. `abcdefghijklmnop`.)

## 2. Run the database migrations

Source of truth: [`supabase/migrations/`](supabase/migrations/) in this
repo (`0001_init.sql` for the schema, `0002_share_index.sql` for the
share-page indexing opt-in). Push every migration to your project:

```sh
supabase db push
```

This creates the `profiles`, `collections`, and `links` tables described
in [design spec §5](docs/specs/2026-07-15-tabburrow-design.md#5-data-model),
plus row-level security policies so every user can only read and write
their own rows, and a trigger that creates a `profiles` row on sign-up.
(`sessions` are intentionally absent: session snapshots are local-only in
v1 and never sync, so there is no cloud table for them.) Verify with:

```sh
supabase db lint
```

To try the schema locally before touching a hosted project (requires
Docker), you can instead run the full stack on your machine:

```sh
supabase start     # boots local Postgres/Auth/API containers
supabase db reset  # applies every migration in supabase/migrations/
```

`supabase status` then prints the local URL and keys.

## 3. Deploy the Edge Functions

The backend logic ships as Supabase Edge Functions in
[`supabase/functions/`](supabase/functions/). `ai-organize` landed in T19
and is in the repo today; `checkout-session`, `stripe-webhook`, and
`share-resolve` have not landed yet (T21/T22/T23):

| Function | Does | Status |
| --- | --- | --- |
| `ai-organize` | Calls Claude to group and tag your tabs; meters free-tier usage | In the repo (T19) |
| `checkout-session` | Creates a Stripe Checkout session for PRO upgrades | Not yet built (T23) |
| `stripe-webhook` | Verifies Stripe webhook signatures and flips `profiles.plan` | Not yet built (T23) |
| `share-resolve` | Serves public collection data to share pages without exposing raw table access | Not yet built (T21/T22) |

Deploy each one that exists so far:

```sh
supabase functions deploy ai-organize
supabase functions deploy checkout-session
supabase functions deploy stripe-webhook
supabase functions deploy share-resolve
```

(If you don't need sharing or billing for personal use, you can skip
`checkout-session`, `stripe-webhook`, and `share-resolve`; sync and AI
organize don't depend on them.)

**Auth posture note:** `supabase/config.toml` sets `verify_jwt = false`
for `ai-organize`, and that setting applies to your hosted deploy too;
this is Supabase's recommended pattern for projects using the newer
asymmetric (ES256) signing keys, and it means the gateway does no JWT
check of its own, so authentication rests entirely on the function's
in-code verification (`supabase/functions/_shared/auth.ts`), which every
request goes through before anything else runs.

**Testing `ai-organize` locally before deploying:** run the local stack
(`supabase start`) and `supabase functions serve ai-organize --env-file <path-to-a-file-with-only-ANTHROPIC_API_KEY>`
(never point `--env-file` at the repo's root `.env` directly, since that
file also holds Stripe/Supabase secrets you don't want an Edge Function
process reading). `supabase/functions/ai-organize/test.ts` has a full
`deno test --allow-all` suite that mocks Anthropic and exercises metering
against the real local database, so you don't need a live API key just to
verify the function's own logic.

## 4. Set secrets

Edge Functions read secrets from the Supabase project, never from the
repo. At minimum, for AI organize:

```sh
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

If you're also self-hosting billing:

```sh
supabase secrets set STRIPE_SECRET_KEY=sk_test_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
```

Get your Anthropic key from [console.anthropic.com](https://console.anthropic.com);
Stripe keys from your Stripe dashboard (use test-mode keys until you're
ready to charge real cards).

## 5. Build the extension with your own environment

The full variable reference lives in [`.env.example`](.env.example) —
fill in the root `.env` (repo root, NOT `apps/extension/`) with your
project's values:

```sh
# Supabase (hosted or self-hosted project)
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=   # web app + functions only, never the extension
# AI organize (self-hosters use their own key)
ANTHROPIC_API_KEY=
# Stripe (test mode)
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_MONTHLY=        # $4/mo price id
STRIPE_PRICE_YEARLY=         # $29/yr price id
# Web
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

**As of T16, the extension DOES read two of these** — `SUPABASE_URL` and
`SUPABASE_ANON_KEY`, and nothing else (never the service-role key or any
other secret). The wiring: `apps/extension/scripts/sync-env.mjs` reads the
root `.env` and writes `apps/extension/.env.local` (gitignored, WXT's
`.env.local` convention) containing only:

```sh
WXT_SUPABASE_URL=...
WXT_SUPABASE_ANON_KEY=...
```

which the extension reads at build time via `import.meta.env.WXT_SUPABASE_URL`/
`WXT_SUPABASE_ANON_KEY` (see `apps/extension/lib/supabase.ts`). This script
runs automatically as a `predev`/`prebuild` hook — you never need to run it
by hand — so a plain build picks up whatever is in the root `.env`:

```sh
pnpm install
pnpm --filter extension build
```

**No `.env` at all (or blank Supabase values) is still a fully supported
mode**, not an error: `hasSupabaseEnv()` detects the missing config and every
cloud-touching UI (Settings' Account section, the popup footer) renders a
quiet "Cloud features are not configured" state with zero network calls —
save/organize/sessions/search/import-export all keep working exactly as
before. AI organize/sharing/billing env vars (`ANTHROPIC_API_KEY`,
`STRIPE_*`) still aren't read by the extension yet — that lands with
T19/T20/T22/T23.

Keep the Supabase project and keys from steps 1–4 around; once you've set
them, re-run the extension build (or `pnpm --filter extension dev`) and
Settings → Account will let you sign in with an email code against your own
project. Google sign-in additionally needs a Google OAuth client configured
on your Supabase project — see `docs/SETUP_NOTES.md` for the exact console
steps (written for the maintainer's own project, but the steps are the same
for any Supabase project).

## 6. Load unpacked

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `apps/extension/.output/chrome-mv3`

## Costs

- **Supabase free tier** covers personal use comfortably: 500 MB database,
  50,000 monthly active users, 5 GB egress, and 500,000 Edge Function
  invocations included before usage-based billing kicks in. Free projects
  pause after a week of inactivity and are capped at 2 per account,
  fine for one personal TabBurrow instance. (Verified against
  [supabase.com/pricing](https://supabase.com/pricing), checked
  2026-07-15; re-check before relying on these numbers, they change.)
- **Anthropic API** is pay-per-use, billed directly to your Anthropic
  account. AI organize sends only `{title, url}` pairs (never page
  content) in small batches (capped at 100 links per call), so per-run
  cost is a few cents at most with a fast model. Check
  [anthropic.com/pricing](https://www.anthropic.com/pricing) for current
  rates before relying on this estimate.
- **Stripe** only matters if you're reselling PRO yourself; skip it
  entirely for personal self-hosting.

## Questions or issues

Open an issue: [REPO_URL_PLACEHOLDER/issues](REPO_URL_PLACEHOLDER/issues).

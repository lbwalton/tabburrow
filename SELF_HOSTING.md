# Self-hosting TabBurrow

TabBurrow's local features (save, organize, sessions, search, import/export)
need nothing but the extension itself — no account, no backend, no
environment variables. This guide is for the PRO tier: cloud sync, AI
organize, sharing, and billing, running entirely on your own Supabase
project and your own API keys.

**Status note:** cloud sync, AI organize, sharing, and billing are still
being built (stories T15–T23 in [`stories/stories.json`](stories/stories.json)).
The steps below describe the intended self-hosting path and are written
against the schema and functions as designed in
[`docs/specs/2026-07-15-tabburrow-design.md`](docs/specs/2026-07-15-tabburrow-design.md#5-data-model).
**The "Database schema" section below is verified against the schema in
`supabase/migrations/` — that directory does not exist in the repo yet
(it lands in T15). Once it does, re-verify this section's commands against
the actual migration files before relying on it**; until then, treat this
guide as a preview of the workflow, not a tested runbook.

## What self-hosting gets you

| You bring | You get |
| --- | --- |
| A free Supabase project | Cloud sync across your own devices, on your own Postgres |
| An Anthropic API key | Unlimited AI organize, billed to you at Anthropic's per-use rate, not ours |
| (Optional) a Stripe account | Only needed if you want to resell PRO yourself; skip entirely for personal use |
| ~15 minutes | The full TabBurrow feature set, with your data never touching our infrastructure |

## 1. Create a Supabase project

1. Sign up at [supabase.com](https://supabase.com) (free tier is enough
   for personal use — see [Costs](#costs) below).
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
repo — **not there yet as of this writing; lands in story T15** (see the
status note above). Once it does, push every migration to your project:

```sh
supabase db push
```

This creates the `collections`, `links`, `sessions`, and `profiles` tables
described in [design spec §5](docs/specs/2026-07-15-tabburrow-design.md#5-data-model),
plus row-level security policies so every user can only read and write
their own rows, and a trigger that creates a `profiles` row on sign-up.
Verify with:

```sh
supabase db lint
```

## 3. Deploy the Edge Functions

The backend logic ships as Supabase Edge Functions in
[`supabase/functions/`](supabase/functions/) — also not in the repo yet
(lands alongside T15/T19/T22/T23):

| Function | Does |
| --- | --- |
| `ai-organize` | Calls Claude to group and tag your tabs; meters free-tier usage |
| `checkout-session` | Creates a Stripe Checkout session for PRO upgrades |
| `stripe-webhook` | Verifies Stripe webhook signatures and flips `profiles.plan` |
| `share-resolve` | Serves public collection data to share pages without exposing raw table access |

Deploy each one:

```sh
supabase functions deploy ai-organize
supabase functions deploy checkout-session
supabase functions deploy stripe-webhook
supabase functions deploy share-resolve
```

(If you don't need sharing or billing for personal use, you can skip
`checkout-session`, `stripe-webhook`, and `share-resolve` — sync and AI
organize don't depend on them.)

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

The full variable reference lives in [`.env.example`](.env.example):

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

**Honest status:** as of this writing, none of these variables are read
by `apps/extension` yet — the extension has no build-time env
injection point for `SUPABASE_URL`/`SUPABASE_ANON_KEY` because sync and
auth (stories T15–T18) haven't landed. **A local build needs no env at
all** — `pnpm --filter extension build` works out of the box, entirely
offline. `apps/web` currently reads only `NEXT_PUBLIC_SITE_URL` (used for
canonical URLs and JSON-LD, see `apps/web/lib/site-config.ts`); it does
not yet call Supabase either.

Once sync/auth/AI/sharing land, this section will document exactly which
`.env` file each variable belongs in (extension vs. `apps/web`) and how
each is injected (WXT's `import.meta.env.WXT_*` convention for the
extension, Next's `NEXT_PUBLIC_*` convention for the web app) — check back
here, or watch `stories/stories.json` for T16/T18/T19/T21/T22/T23 landing.

For now, the build itself doesn't need any of it — an `.env` file with
your keys filled in has no effect on the extension yet, since nothing
reads it:

```sh
pnpm install
pnpm --filter extension build
```

Keep the Supabase project and keys from steps 1–4 around; they'll be
what you plug in once T16/T18/T19 land.

## 6. Load unpacked

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `apps/extension/.output/chrome-mv3`

## Costs

- **Supabase free tier** covers personal use comfortably: 500 MB database,
  50,000 monthly active users, 5 GB egress, and 500,000 Edge Function
  invocations included before usage-based billing kicks in. Free projects
  pause after a week of inactivity and are capped at 2 per account —
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

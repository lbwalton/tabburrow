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
`ANTHROPIC_API_KEY` secret are now a tested runbook, not a preview. T20
wired the extension UI to it (the collection header's "Organize with AI"
and the popup's "Save all + organize"), so self-hosters can now actually
trigger it end to end from the built extension, not just via a raw
function call. Public share pages (T21b) landed WITHOUT a `share-resolve`
function at all: `apps/web/lib/share.ts` reads `collections`/`links`
directly with the web app's own service-role client, so that row never
existed and never will — see step 3's table.
`checkout-session` and `stripe-webhook` landed in T23a: both exist at
`supabase/functions/checkout-session/` and `supabase/functions/stripe-webhook/`,
each covered by a `deno test` suite (the former against the real Stripe
test-mode API, the latter fully self-contained with a generated test
signing secret), and were verified end to end on the local stack with
`stripe listen`/`stripe trigger` — see step 3's table and step 4's Stripe
secrets. The `/account` web page (sign-in, plan, upgrade, billing portal)
landed in the same task at `apps/web/app/account/`. **Not** covered by
T23a: the extension's own "Upgrade" UI (opening the Checkout URL from
inside the extension) is a separate task (T23b) and may still be pending.

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
[`supabase/functions/`](supabase/functions/):

| Function | Does | Status |
| --- | --- | --- |
| `ai-organize` | Calls Claude to group and tag your tabs; meters free-tier usage | In the repo (T19) |
| `checkout-session` | Creates a Stripe Checkout session (subscription) or billing-portal session for PRO | In the repo (T23a) |
| `stripe-webhook` | Verifies Stripe webhook signatures and flips `profiles.plan`/`stripe_subscription_id` | In the repo (T23a) |
| ~~`share-resolve`~~ | Superseded — public share pages read `collections`/`links` directly with `apps/web/lib/share.ts`'s service-role client instead (T21b); this function was never built and isn't planned | N/A |

Deploy each one that exists:

```sh
supabase functions deploy ai-organize
supabase functions deploy checkout-session
supabase functions deploy stripe-webhook
```

(If you don't need AI organize or billing for personal use, skip the
corresponding function; sync doesn't depend on either. Sharing needs no
function deploy at all, just the web app's `SUPABASE_SERVICE_ROLE_KEY`.)

**Auth posture note:** `supabase/config.toml` sets `verify_jwt = false`
for `ai-organize` and `checkout-session`, and that setting applies to
your hosted deploy too; this is Supabase's recommended pattern for
projects using the newer asymmetric (ES256) signing keys, and it means
the gateway does no JWT check of its own, so authentication rests
entirely on the function's in-code verification
(`supabase/functions/_shared/auth.ts`'s `requireUser()`), which every
request goes through before anything else runs. `stripe-webhook` also
sets `verify_jwt = false`, but for a DIFFERENT reason: Stripe's webhook
delivery never carries a Supabase user JWT at all, so there's no JWT
check being bypassed there — that function's entire security boundary is
verifying the `Stripe-Signature` header against `STRIPE_WEBHOOK_SECRET`
(see its own file for the full explanation).

**Testing `ai-organize`/`checkout-session`/`stripe-webhook` locally
before deploying:** run the local stack (`supabase start`) and
`supabase functions serve --env-file <path>` with a temp env file holding
only the secrets those functions need (never point `--env-file` at the
repo's root `.env` directly, since that file also holds the Supabase
service-role key and other secrets you don't want an Edge Function
process reading beyond what it's supposed to have):

```sh
# example temp env file for local `supabase functions serve`
ANTHROPIC_API_KEY=sk-ant-...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...       # from `stripe listen --print-secret`, see below
STRIPE_PRICE_MONTHLY=price_...
STRIPE_PRICE_YEARLY=price_...
SITE_URL=http://localhost:3000        # NOT NEXT_PUBLIC_SITE_URL — Edge Functions read Deno.env, not Next's process.env, so this needs setting separately even though it's the same logical value
```

Each function's `test.ts` has a full `deno test --allow-all` suite you
can run without any of this (`ai-organize` mocks Anthropic;
`checkout-session` calls the real Stripe TEST-MODE API, which is free;
`stripe-webhook` is fully self-contained with a generated test signing
secret, no live Stripe account needed at all), so you don't need live
keys just to verify a function's own logic — only to smoke-test it
end to end with `supabase functions serve`.

**Testing `stripe-webhook` end to end locally:** with the local stack and
`supabase functions serve` running (env file above), forward real Stripe
test-mode events to it:

```sh
stripe listen --forward-to http://127.0.0.1:54321/functions/v1/stripe-webhook
# note the printed webhook signing secret and put it in STRIPE_WEBHOOK_SECRET above
stripe trigger checkout.session.completed --override checkout_session:client_reference_id=<a-real-user-id>
```

then check `profiles.plan` flipped to `pro` for that user via the
Supabase REST API or Studio.

## 4. Set secrets

Edge Functions read secrets from the Supabase project, never from the
repo. At minimum, for AI organize:

```sh
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

If you're also self-hosting billing:

1. In your Stripe dashboard (test mode), create a product ("TabBurrow
   PRO" or similar) with two recurring prices: monthly and yearly. Note
   both price ids (`price_...`) — or create them via the API/CLI, e.g.:
   ```sh
   stripe products create --name "TabBurrow PRO"
   stripe prices create --product <prod_id> --unit-amount 400 --currency usd -d "recurring[interval]=month"
   stripe prices create --product <prod_id> --unit-amount 2900 --currency usd -d "recurring[interval]=year"
   ```
2. Create a webhook endpoint pointing at
   `<your-project-url>/functions/v1/stripe-webhook` in the Stripe
   dashboard (Developers → Webhooks) listening for
   `checkout.session.completed`, `customer.subscription.updated`, and
   `customer.subscription.deleted`; copy its signing secret
   (`whsec_...`). For LOCAL testing only, `stripe listen --print-secret`
   gives you a different, session-scoped secret for `stripe listen`'s own
   forwarding — that one is NOT the same secret your production dashboard
   endpoint uses, don't mix them up.
3. Set every Stripe-related secret on your Supabase project:
   ```sh
   supabase secrets set STRIPE_SECRET_KEY=sk_test_...
   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
   supabase secrets set STRIPE_PRICE_MONTHLY=price_...
   supabase secrets set STRIPE_PRICE_YEARLY=price_...
   supabase secrets set SITE_URL=https://your-deployed-web-app-url
   ```
   `SITE_URL` is where `checkout-session` builds `success_url`/`cancel_url`/
   `return_url` from (`${SITE_URL}/upgrade/success`, `${SITE_URL}/account`)
   — point it at wherever you deploy `apps/web`, NOT your Supabase project
   URL.

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
# apps/web only (T23a): browser-side Supabase client for /account. Same
# project as SUPABASE_URL/SUPABASE_ANON_KEY above, just NEXT_PUBLIC_-
# prefixed so Next.js inlines it into the client bundle; set in
# apps/web/.env.local (or your host's env config), anon key only.
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
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
by hand — so a plain build picks up whatever is in the root `.env`. **If
your Supabase project is self-hosted on a custom domain** (not a
`*.supabase.co` hostname), add that origin to `host_permissions` in
`apps/extension/wxt.config.ts` before building, or the extension's cloud
calls will be blocked by MV3:

```sh
pnpm install
pnpm --filter extension build
```

**No `.env` at all (or blank Supabase values) is still a fully supported
mode**, not an error: `hasSupabaseEnv()` detects the missing config and every
cloud-touching UI (Settings' Account section, the popup footer) renders a
quiet "Cloud features are not configured" state with zero network calls —
save/organize/sessions/search/import-export all keep working exactly as
before. AI organize now works end to end (T19/T20) — `ANTHROPIC_API_KEY`
is read server-side, by the `ai-organize` Edge Function, never by the
extension itself. Billing (T23a) works the same way: `STRIPE_*` secrets
are read server-side by `checkout-session`/`stripe-webhook`, never by the
extension or the web app's client bundle (only the anon-key
`NEXT_PUBLIC_SUPABASE_*` pair reaches the browser, same "public by
design" posture as the extension's own `WXT_SUPABASE_*` vars). `apps/web`
also mirrors `isSupabaseConfigured()`'s pattern (`apps/web/lib/supabase-browser.ts`):
without `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` set,
`/account` renders a quiet "not configured" message instead of a crash.

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

## 7. Deploy the web app (marketing site, share pages, account/billing)

`apps/web` is a plain Next.js app (`pnpm --filter web build && pnpm --filter web start`,
or deploy to Vercel/any Node host) — it needs `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `NEXT_PUBLIC_SITE_URL` set wherever
it runs (step 5's block, `apps/web/.env.local` for local dev). `/account`
lets a signed-in user see their plan and, for PRO, open the Stripe
billing portal; for free, start a Checkout session for either price. Both
call `checkout-session` directly (`fetch` with the signed-in user's JWT),
so billing only works once `SITE_URL` is set on the Supabase project
(step 4) AND this app's own `NEXT_PUBLIC_SUPABASE_*` pair is set here —
they're deliberately two separate values in two separate runtimes (see
step 3's testing note on why `SITE_URL` isn't read from
`NEXT_PUBLIC_SITE_URL`). `/upgrade/success` is Stripe Checkout's
`success_url` landing page; nothing to configure there beyond `SITE_URL`
pointing at wherever this app is actually reachable.

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

Open an issue: [https://github.com/lbwalton/tabburrow/issues](https://github.com/lbwalton/tabburrow/issues).

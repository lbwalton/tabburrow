<!-- TODO(T25b): replace with assets/readme-hero.png (burrow-arch hero banner,
     Deep Green brand direction) once captured. Keep this alt text. -->
<!-- ![TabBurrow: a burrow-arch hero banner showing the popup and dashboard on the Deep Green ground](assets/readme-hero.png) -->

# TabBurrow

**Your tabs, saved in one click, yours forever. No account required. AI organizing and cloud sync land with v1.0.**

[![CI](REPO_URL_PLACEHOLDER/actions/workflows/ci.yml/badge.svg)](REPO_URL_PLACEHOLDER/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-B9C3BB)](REPO_URL_PLACEHOLDER/blob/main/LICENSE)
[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-coming%20soon-F97316)](#project-status)

TabBurrow is an open-source, local-first tab and bookmark manager for Chrome.
One click saves a tab, a selection of tabs, or a whole window into a
collection; everything works instantly with zero signup, and nothing leaves
your device unless you choose to sign in. Sign in later for cloud sync, AI
auto-organize, and shareable collection pages.

<!-- TODO(T25b): drop a short save / organize / restore GIF here once the
     extension can be driven live for capture. -->

## Why TabBurrow

- **Local-first, no forced account.** Every save, organize, and restore
  action works instantly on a fresh install. Data lives in your browser's
  IndexedDB; nothing is required to sign up, and nothing syncs anywhere
  unless you opt in.
- **AI auto-organize, with a preview.** One click sends only your tabs'
  titles and URLs (never page content) to Claude, which groups and tags
  them into collections. You approve the exact diff before anything
  changes; nothing is ever applied automatically. *(PRO, launching with
  v1.0; see [Project status](#project-status).)*
- **Open source, AGPL-3.0.** Every line is public: the popup, the
  dashboard, the sync engine, the AI organize function. Audit it, fork
  it, or [self-host](SELF_HOSTING.md) the whole stack on your own
  infrastructure.
- **Distinctive editorial design.** The tab-manager category is uniformly
  white/gray SaaS. TabBurrow isn't: Deep Green ground, warm orange
  accent, editorial type, a burrow motif throughout.

## Free vs PRO vs Self-host

| Feature | Free | PRO | Self-host |
| --- | --- | --- | --- |
| Local saving & collections | Unlimited, forever | Unlimited | Unlimited |
| Drag-and-drop organizing | Yes | Yes | Yes |
| Sessions & crash restore | Yes | Yes | Yes |
| Search, import & export | Yes | Yes | Yes |
| Cloud sync across devices | No | Yes | Yes (your Supabase) |
| Shareable collection pages | No | Yes | Yes (your Supabase) |
| AI organize | 30 runs/month | Unlimited (fair use) | Your Anthropic key |
| Price | $0 | $4/mo or $29/yr | $0 to us |

Local saving, organizing, sessions, search, and import/export are live in
this repo today. Cloud sync, AI organize, sharing, and billing are PRO
features currently in active development and will land before the v1.0
store release; see [Project status](#project-status) for exactly what's
built.

## Quickstart

**Install from the Chrome Web Store**: coming soon.

**Build from source:**

```sh
git clone REPO_URL_PLACEHOLDER.git
cd tabburrow
pnpm install
pnpm --filter extension build
```

Then load it unpacked:

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select `apps/extension/.output/chrome-mv3`

Requires Node 20+ and pnpm 9+. No environment variables are needed for a
local build; see [SELF_HOSTING.md](SELF_HOSTING.md) if you also want
cloud sync, AI organize, and sharing running against your own Supabase
project.

## Architecture

Monorepo (pnpm workspaces):

```
tabburrow/
├── apps/
│   ├── extension/       # WXT + React + TypeScript + Tailwind (Manifest V3)
│   │   ├── entrypoints/
│   │   │   ├── popup/       # quick save + quick access
│   │   │   ├── dashboard/   # full-page management UI (own tab)
│   │   │   └── background.ts # service worker: sync engine, session snapshots
│   │   └── lib/          # pure logic, unit tested
│   └── web/              # Next.js (App Router) on Vercel: marketing site,
│       ├── (marketing)/  #   share pages (s/[slug]), account/billing entry
│       ├── s/[slug]/
│       └── account/
├── packages/
│   ├── core/              # shared types, storage schema, sync + merge logic
│   └── ui/                # design tokens + shared React components
├── supabase/
│   ├── migrations/        # Postgres schema + RLS policies
│   └── functions/         # Edge Functions: ai-organize, checkout-session,
│                           #   stripe-webhook, share-resolve
├── docs/                   # specs, plans, self-hosting guide
└── stories/                 # implementation stories + fix stories (bug bash)
```

`extension` and `web` both depend on `core` (data model, sync, merge logic)
and `ui` (design tokens + components) as workspace packages; there is one
source of truth for both, not two implementations.

## Self-hosting & contributing

- [SELF_HOSTING.md](SELF_HOSTING.md): run your own Supabase project, deploy
  the Edge Functions, and build the extension against your own keys.
- [CONTRIBUTING.md](CONTRIBUTING.md): dev setup, test commands, commit
  conventions, and PR expectations.

## Project status

TabBurrow is built in the open, one story at a time; every commit maps to
a story in [`stories/stories.json`](stories/stories.json), each with its
own acceptance criteria.

**Built and tested today:** the local extension: popup save flows,
dashboard with drag-and-drop, sessions and crash restore, fuzzy search,
import/export, keyboard shortcuts, and the sync engine's merge logic
(unit-tested, not yet wired to a backend).

**In active development:** Supabase schema and auth, wiring the sync
engine into the extension, the AI organize Edge Function and UI, share
pages, and Stripe billing. These are the PRO features described above and
in the [design spec](docs/specs/2026-07-15-tabburrow-design.md); they
ship together as v1.0, not yet in this build.

No fake stars, no fake user counts, no testimonials here. Watch the repo
or check `stories/stories.json` for real, current progress.

## License

[AGPL-3.0](LICENSE). Forks that host TabBurrow as a service must publish
their changes; that's the deal that keeps this genuinely open source
while protecting the hosted TabBurrow business.

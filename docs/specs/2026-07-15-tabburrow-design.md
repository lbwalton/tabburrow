# TabBurrow — Design Spec

**Date:** 2026-07-15
**Status:** Approved pending LB's final read
**Owner:** LB Walton (EZE Media) · Built with Claude Code (Fable 5)

---

## 1. What TabBurrow is

TabBurrow is an open-source, local-first tab and bookmark manager for Chrome.
One click saves a tab, a selection of tabs, or a whole window into collections.
Everything works instantly with zero signup. Signing in unlocks cloud sync,
AI auto-organize, and public share pages via a PRO subscription.

**Positioning:** "Your tabs, saved in one click, organized by AI, yours
forever. No account required."

**Business model (open-core):** The full source is public on GitHub under
AGPL-3.0. The repo is the marketing engine (stars, community, self-hosters).
Revenue comes from the hosted PRO subscription sold inside the extension via
Stripe. The Chrome Web Store has no native payments, so "paid version in the
store" means: one free listing + in-extension Stripe checkout for PRO.

**Category context:** Competes with Toast, Toby, Partizion, Tablerone. We are
a clean-room recreation of the category's job-to-be-done. No code, name,
logo, or copy is taken from any competitor.

**Differentiators (the four edges):**
1. Local-first, no forced account (Toast requires signup before first save).
2. AI auto-organize (no incumbent does this well).
3. Open source (none of the incumbents are).
4. Distinctive editorial design (the category is uniformly white/gray SaaS).

---

## 2. Success criteria

- Fresh Chrome profile: install unpacked extension, save and restore tabs
  with zero signup, data survives browser restart.
- Sign-in (Google OAuth + magic link), cloud sync between two browser
  profiles, AI organize, share pages, and a Stripe **test-mode** subscription
  all work end to end.
- Repo is public-ready: README, LICENSE (AGPL-3.0), self-hosting guide,
  CONTRIBUTING, issue templates.
- Chrome Web Store listing assets drafted (name, descriptions, screenshots,
  promo tile).
- Marketing site live on Vercel and passing the seo-geo-aeo checklist.
- Every story's acceptance criteria verified, UI stories verified live in
  Chrome via the Claude in Chrome extension.

---

## 3. Architecture

Monorepo (pnpm workspaces):

```
tabburrow/
├── apps/
│   ├── extension/            # WXT + React + TypeScript + Tailwind (Manifest V3)
│   │   ├── entrypoints/
│   │   │   ├── popup/         # quick save + quick access
│   │   │   ├── dashboard/     # full-page management UI (own tab)
│   │   │   └── background.ts  # service worker: sync engine, session snapshots
│   │   └── ...
│   └── web/                   # Next.js (App Router) on Vercel
│       ├── (marketing)/       # landing, pricing, open-source page
│       ├── s/[slug]/          # public share pages
│       └── account/           # billing portal entry, plan status
├── packages/
│   ├── core/                  # shared types, storage schema, sync + merge logic
│   └── ui/                    # design tokens + shared React components
├── supabase/
│   ├── migrations/            # Postgres schema + RLS policies
│   └── functions/             # Edge Functions: ai-organize, stripe-webhook,
│                              #   checkout-session, share-resolve
├── docs/                      # specs, plans, self-hosting guide
└── stories/                   # implementation stories + fix stories (bug bash)
```

**Stack:** WXT (extension framework), React 18, TypeScript, Tailwind,
dnd-kit (drag and drop), Dexie (IndexedDB wrapper), Supabase (Postgres +
Auth + Edge Functions), Stripe, Next.js on Vercel. Node 20+, pnpm.

WXT is chosen because it gives Vite-style DX for MV3 extensions and can emit
Firefox/Edge builds later with minimal change (v2 concern, not v1).

---

## 4. Extension surfaces

### 4.1 Popup (toolbar)
- Primary actions: **Save this tab**, **Save all tabs**, **Save selected
  tabs** (highlighted in the tab strip).
- Save flow: pick existing collection, create new, or accept the
  **Last Used** default (remembers the last save target). One click for the
  default path.
- Quick list of recent collections and a search box (fuzzy, over collection
  names and link titles/URLs).
- Footer: open dashboard, sign-in state, AI-quota indicator when signed in.
- After "Save all tabs": offer to close the saved tabs (explicit button,
  never automatic).

### 4.2 Dashboard (full page, own tab)
- Left rail: collections list (drag to reorder), sessions section, search.
- Main area: selected collection's links as cards (favicon, title, domain,
  note, tags), drag-and-drop between collections and to reorder within one.
- Sort: manual (default), by name, by date added.
- Bulk actions: multi-select links → open all, move, delete.
- Collection actions: rename inline, emoji/color accent, restore all
  (opens every link; >15 links asks for confirmation), share (PRO),
  AI organize, delete (soft delete with undo toast).
- Sessions: list of snapshots (manual + rolling auto-snapshot), each
  restorable into a new window; manual snapshots can be named.
- Settings: theme, sign-in, plan/billing, import (Chrome bookmarks HTML +
  Toby JSON), export (JSON), keyboard shortcuts.

### 4.3 Background service worker
- Owns the sync engine loop (section 6).
- Rolling auto-snapshot: every 5 minutes, snapshot all open windows/tabs to
  IndexedDB (keep last 10; prune older). On startup after a crash the
  dashboard offers "Restore last session".
- Handles keyboard shortcuts: save current tab (Alt+Shift+S), save all tabs
  (Alt+Shift+A), open dashboard (Alt+Shift+B).

---

## 5. Data model

Local (IndexedDB via Dexie) and cloud (Postgres) share one logical schema,
defined once in `packages/core`.

- **collections**: `id (uuid)`, `name`, `accent` (emoji or token color),
  `position` (fractional index for drag-ordering), `is_shared`,
  `share_slug`, `created_at`, `updated_at`, `deleted_at (tombstone)`.
- **links**: `id`, `collection_id`, `url`, `title`, `favicon_url`, `note`,
  `tags (text[])`, `position`, `created_at`, `updated_at`, `deleted_at`.
- **sessions**: `id`, `name`, `kind ('manual'|'auto')`, `snapshot (json:
  windows → tabs {url,title,pinned})`, `created_at`. Sessions are
  local-only in v1 (not synced): snapshots are device-specific by nature.
- **profiles** (cloud only): `user_id`, `plan ('free'|'pro')`,
  `stripe_customer_id`, `stripe_subscription_id`, `ai_uses_period_start`,
  `ai_uses_count`.
- All user rows carry `user_id` with row-level security: owners read/write
  their own rows; share pages read via `share-resolve` Edge Function only
  (no anonymous direct table access).

Favicons come from Chrome's favicon API locally with a
`https://www.google.com/s2/favicons?domain=` fallback on share pages.

---

## 6. Sync engine (PRO)

- Local writes are always instant; sync is a background concern. The
  extension is fully functional offline forever.
- Every row has `updated_at` (ms) + `device_id`. A `pending_ops` queue in
  IndexedDB records dirty row ids.
- Push: flush pending rows to Supabase (upsert). Pull: fetch rows with
  `updated_at > last_sync_cursor`. Merge: **last-write-wins per row**;
  tombstones (`deleted_at`) win over concurrent edits so deletions never
  resurrect. Cursor stored per device.
- Trigger points: on change (debounced 3s), on extension startup, every
  5 minutes, and on sign-in (initial full pull + dedupe by id).
- First sign-in with existing local data: local data is uploaded as-is
  (ids are uuids generated client-side, so no collision handling needed).
- Conflicts are rare (single user, multiple devices); LWW is acceptable and
  documented in the self-hosting guide.

---

## 7. AI auto-organize

- Entry points: "Organize with AI" on a collection, and "Save all + AI
  organize" in the popup's save-all flow.
- Client sends only `{title, url}` pairs (never page content) to the
  `ai-organize` Edge Function.
- The function calls Claude (model: `claude-haiku-4-5-20251001`, temperature
  low, JSON-schema output) and returns:
  `{groups: [{name, emoji, link_ids}], tags: {link_id: [tags]}}`.
- Client shows a **preview diff** (what moves where) and applies only on
  user confirmation. Never auto-applies.
- Metering: `profiles.ai_uses_count` incremented server-side per call;
  free = 30/calendar month, PRO = unlimited (fair-use soft cap 1000/mo).
  Signed-out users see the feature with a "sign in to use" state.
- Self-hosters set `ANTHROPIC_API_KEY` in their own Supabase project; the
  function is part of the open-source repo.

---

## 8. Sharing (PRO)

- "Share collection" generates `share_slug` (10-char nanoid), sets
  `is_shared = true`, copies `https://tabburrow.com/s/{slug}`.
- Share page (Next.js, server-rendered): collection name, link cards with
  favicons, "Open all", per-link outbound clicks, and a persistent
  "Made with TabBurrow — get the extension" banner (the growth loop).
- Unshare kills the slug immediately (page 404s). Reshare generates a new
  slug. Share pages are `noindex` by default with an owner toggle to allow
  indexing.
- OG image generated per collection (Vercel OG) so shares look good in
  Slack/X/LinkedIn.

---

## 9. Auth, billing, entitlements

- **Auth:** Supabase Auth. Google OAuth via
  `chrome.identity.launchWebAuthFlow`, plus email magic link. Session
  tokens stored in `chrome.storage.local`; refresh handled in the service
  worker.
- **Billing:** Stripe Checkout (hosted page) opened in a new tab from the
  extension or account page. Prices: **$4/month or $29/year** (tunable
  before launch). `stripe-webhook` Edge Function (signature-verified)
  updates `profiles.plan` on subscription created/updated/canceled.
  Stripe customer portal for cancel/card changes.
- **Entitlements in the extension:** on sign-in and every 12h, fetch
  `profiles.plan`. PRO gates: sync engine on, sharing on, AI unlimited.
  Free: local everything unlimited, AI 30/mo, no sync, no sharing.
  Graceful downgrade: cloud data stays readable, local stays untouched;
  sync pauses with a clear banner.
- v1 launches with Stripe **test mode** end-to-end verified; flipping to
  live keys is a config change LB does at launch.

---

## 10. Open source

- **License:** AGPL-3.0 (genuinely open source; forks that host it must
  publish their changes, which protects the hosted business).
- Repo contents: full monorepo, README with hero GIF and clear
  free-vs-hosted-PRO table, `SELF_HOSTING.md` (own Supabase + own
  Anthropic key, env var reference), `CONTRIBUTING.md`, issue/PR templates,
  GitHub Actions CI (typecheck, lint, unit tests, extension build).
- Secrets never in repo: `.env.example` documents every variable.
- Public repo under LB's GitHub, EZE Media credited as publisher.

---

## 11. Design system

Deep Green brand direction (LB's global default), imported from
`~/brand/tokens.css` into `packages/ui`, not hardcoded:

- Ground `#16241E`, wells `#0E1813`, cards `#1E3128` (hover `#24382E`).
- Primary accent orange `#F97316`; secondary yellow `#D9A441`. No teal.
- Text cream `#EEE8D9` / secondary `#B9C3BB`; cream-tinted hairlines.
- Kraft-paper surfaces (`#F1EAD9`, ink `#211D14`) for share pages' link
  lists and marketing long-form sections.
- Type: Syne Bold (headings), Inter (UI), Geist Mono (URLs, domains,
  counts — monospace makes URLs feel native).
- Motif: the burrow. Rounded "entrance" arches on cards, a subtle
  underground cross-section illustration on the marketing hero, squirrel/
  chipmunk mascot optional (only if it can be done tastefully; no clip art).
- Both popup and dashboard are dark-first with a light (kraft) theme toggle.
- Microinteractions: save action plays a satisfying "tucked away" animation;
  drag-and-drop has spring physics; empty states are illustrated, not blank.
- Implementation uses the frontend-design skill + Magic MCP for component
  quality; brand tokens are non-negotiable.

---

## 12. Marketing site (apps/web)

- Pages: home (hero, before/after tab clutter, four edges, a "built in the
  open" section showing live GitHub stars in place of testimonials until
  real user quotes exist, FAQ), pricing (free vs PRO vs self-host),
  open-source page
  (GitHub CTA, stars badge, self-host pitch), privacy, terms.
- Full seo-geo-aeo checklist before done: robots.txt with AI crawlers,
  sitemap, llms.txt, JSON-LD (SoftwareApplication + FAQ), per-page
  metadata, semantic HTML, Ask-AI block.
- Copy voice: confident, warm, a little playful ("Your tabs deserve a
  home"), never corporate.

---

## 13. Build & verification methodology

- The implementation plan (next step, via writing-plans) becomes a story
  list in `stories/`, each story with explicit **acceptance criteria**.
- Build order inside the everything-at-once scope: core storage → popup →
  dashboard → sessions → auth → sync → AI → sharing → billing → web →
  repo polish → store assets. Each story lands as a git commit.
- **Verification per story:** unit tests for `packages/core` (merge logic,
  fractional indexing, metering math); for UI stories, live verification
  via Claude in Chrome against the story's acceptance criteria (load
  unpacked extension, click through the real flow, screenshot evidence).
- **End-of-build bug bash:** full pass through every flow in a fresh
  Chrome profile; every defect becomes a fix story in `stories/fixes/`;
  the fix list is burned down with the same verify loop until empty.
- Known Claude-in-Chrome gotchas from the fable-showcase project apply
  (memory: `project_fable_showcase`).

---

## 14. Out of scope for v1 (v2 backlog)

- Firefox/Safari/Edge store builds and listings (WXT keeps the door open).
- iOS/mobile app.
- Team workspaces / collaboration.
- Real-time open-tab sync across devices (we sync saved data, not live tabs).
- Duplicate-tab detection, tab suspension/memory saver.
- Import from Toast (no public export format documented).
- Syncing session snapshots.

## 15. Risks & mitigations

- **Store review delays/rejection:** minimal permissions (`tabs`, `storage`,
  `favicon`, `identity`, host permission only for our API); clear privacy
  policy; no remote code. Draft listing copy avoids competitor names.
- **Name/trademark:** "TabBurrow" verified original in-category; LB confirms
  tabburrow.com is available and will register it.
- **AI cost abuse:** metering server-side, per-user caps, payload size limit
  (max 100 links/call).
- **Sync data loss:** tombstones + LWW tested in unit tests; export-to-JSON
  gives users their own escape hatch from day one.
- **A few-days timeline with one builder:** stories are strictly ordered so
  a timeout still leaves a shippable extension core; billing and web can
  trail by a day without blocking store submission prep.

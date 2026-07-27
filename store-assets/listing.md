# Chrome Web Store listing draft

Status: draft, not yet submitted. Screenshots, the promo tile, and the store
icon were captured/rendered in T25b (see [Screenshots](#screenshots-t25b) and
[Promo tile](#promo-tile) below for the real files and how each was staged).
Character counts below were verified with a script; see
[Verification](#verification).

## Title

```
TabBurrow: Tab & Bookmark Manager
```

33 characters (limit: 45). This is also the extension's manifest name
(`apps/extension/wxt.config.ts`); keep the two identical.

## Summary

```
Save any tab in one click. Local-first, no account needed. AI organize and sync when you want them.
```

99 characters (limit: 132).

## Category

**Workflow & Planning**

## Full description

```
TabBurrow saves your open tabs into tidy folders in one click and keeps
everything on your device. It's local-first, needs no account, and fully
open source (AGPL-3.0). Save a single tab, a selection, or a whole
window; no signup, no account wall. Everything lives in your browser
from the first save.

WHY TABBURROW

• Local-first, no forced account. Every save, organize, and restore action
  works instantly on install. Your collections live in your browser; you
  choose if and when to sign in.

• AI auto-organize, with a preview. One click groups and tags your tabs by
  intent, and you see exactly what moves where before anything changes;
  nothing is ever applied automatically. On a capable desktop Chrome it
  runs on-device with Chrome's built-in Gemini Nano: free, and nothing
  leaves your browser. Cloud AI (Claude) covers any device with a signed-in
  account.

• Open source, AGPL-3.0. Every part of TabBurrow (the popup, the
  dashboard, the sync engine, the AI organize function) is public on
  GitHub. Audit it, fork it, or self-host it on your own infrastructure.

• Distinctive, editorial design. Built to feel like a place your tabs
  actually belong, not another gray dashboard.

WHAT YOU CAN DO TODAY

- Save the current tab, all open tabs, or a highlighted selection into a
  collection, one click.
- Organize collections in a full-page dashboard: drag and drop, rename,
  recolor, bulk move and delete.
- Search instantly across every collection and link, fuzzy-matched.
- Snapshot your open windows automatically every five minutes, plus named
  manual snapshots, so a Chrome crash or an accidental window close never
  costs you your tabs.
- Import your existing Chrome bookmarks, and export everything to JSON at
  any time; your data is never locked in.
- Keyboard shortcuts for saving and opening the dashboard without touching
  the mouse.
- Switch between a dark "burrow" theme and a light "paper" theme.

FREE VS PRO

Local saving, organizing, sessions, search, and import/export are free,
unlimited, forever: no trial, no nag screens. On-device AI organize
(Chrome's built-in Gemini Nano, on a capable desktop Chrome) is free too.
PRO ($3.99/month or $29/year) adds cloud sync across devices, shareable
collection pages, and cloud AI organize with a generous fair-use cap of
about 1,000 runs a month (free accounts get 30 cloud runs a month). Prefer to run your own backend? Self-host the entire
stack, including cloud AI organize with your own API key, for $0; see the
self-hosting guide on GitHub.

PRIVACY

TabBurrow works fully offline by default; nothing leaves your device
unless you sign in. On-device AI organize runs entirely in your browser
and sends nothing anywhere. The cloud AI path sends only link titles and
URLs, never page content. TabBurrow runs no ads, uses no ad trackers, and
does not sell your data. Full privacy policy and source code are linked
from the GitHub repository.

Built in the open: every commit is public, every acceptance criterion is
checked before it ships.
```

## Screenshots (T25b)

All five captured at exactly **1280×800** (verified with `sips`) from the
real running extension, driven by `apps/extension/e2e/capture-assets.ts` —
a standalone script (not a Playwright test) that reuses the e2e harness's own
fixtures/seed helpers, so every pixel is a real render of the actual product,
not a mockup. Staged with realistic collection names and real-looking public
URLs (referenced by title/URL only, never fetched). Re-run with
`npx tsx e2e/capture-assets.ts [main|share|tile|hero|gif]` from
`apps/extension` (requires a fresh extension build and the local Supabase
stack running — see the script's own header comment for the full
requirements).

1. **`screenshots/01-popup-save.png`** — The popup's folders home (the
   redesigned hub): the "1-click Save goes to Kitchen reno research" control
   with a pinned default, the full folder list with live link counts, one row
   hovered so its quick actions (add current tab, open all) are visible, and
   the dismissible Pro strip, composited over a real captured tab titled
   "Sourdough Starter Guide - King Arthur Baking" so the shot reads as a real
   session. (Playwright cannot drive the real toolbar popup overlay — see
   `apps/extension/e2e/MANUAL.md` — so this is a real screenshot of the
   popup's own DOM composited onto a real background-tab screenshot, not an
   invented browser chrome.)
2. **`screenshots/02-dashboard-grid.png`** — Dashboard grid: the rail
   showing 5 collections ("Kitchen reno research", "Q3 competitor
   teardown", "Weekend in Portland", "Dev docs I keep rereading", "Recipes
   worth repeating") and the main grid showing "Kitchen reno research" (10
   link cards, real-looking URLs, two cards with notes/tags visible).
3. **`screenshots/03-ai-organize-preview.png`** — AI organize preview: a
   live call to the real `ai-organize` Edge Function (real Anthropic key)
   against a 16-link "This week's tabs" collection, captured right after
   the suggested groups render, before Apply.
4. **`screenshots/04-sessions-pane.png`** — Sessions pane: 3 seeded auto
   snapshots (6m/11m/16m ago, varying window/tab counts) plus one REAL
   manual snapshot named "Before demo" triggered live via "Snapshot now"
   against two open tabs.
5. **`screenshots/05-share-page.png`** — Share page: the public `/s/<slug>`
   page for a PRO-shared "Weekend in Portland" collection, viewed signed
   out, showing the link cards (real favicons resolved live via Google's
   s2 service) and the "Made with TabBurrow" banner. Captured via the same
   `WXT_SITE_URL` rebuild + local `next dev` dance t22-share.spec.ts uses,
   with the extension build restored to normal afterward.

## Promo tile

**Small promo tile: 440×280 px, PNG, no alpha transparency** (Chrome Web
Store requirement).

Deliverables (both captured in T25b):
- `store-assets/promo-tile-440x280.png`, rendered from
  `store-assets/promo-tile.html` (a self-contained compositor page the
  capture script generates and screenshots at the exact 440×280 — literal
  hex brand values are sanctioned there, and only there, for this one
  standalone asset generator; product source keeps using
  `packages/ui/src/tokens.css`'s `var(--bg-ground)` etc.). Deep Green
  ground, the real burrow-arch mark embedded byte-for-byte from
  `apps/extension/assets/icon.svg` (never redrawn), the TabBurrow wordmark
  in Syne Bold cream, and the tagline "Your tabs deserve a burrow." — no
  screenshot content, orange stays a sparse accent (the arch's own
  outline/base bar).
- `store-assets/icon-128.png` — copied straight from the extension's own
  build output (`apps/extension/.output/chrome-mv3/icons/128.png`), i.e.
  `icon.svg` rasterized at 128×128 through the extension's real build
  pipeline, not a separate rasterization.

## Verification

Character counts verified with:

```sh
python3 - <<'EOF'
title = "TabBurrow: Tab & Bookmark Manager"
summary = "Save any tab in one click. Local-first, no account needed. AI organize and sync when you want them."
print("title:", len(title), "/ 45")
print("summary:", len(summary), "/ 132")
EOF
```

Output: `title: 33 / 45`, `summary: 99 / 132`. Both under limit.

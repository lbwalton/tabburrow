# Chrome Web Store listing draft

Status: draft, not yet submitted. Screenshots and the promo tile image are
deferred to T25b (the extension needs to be driven live for capture); this
file specifies what to shoot and the exact spec for each asset. Character
counts below were verified with a script — see [Verification](#verification).

## Title

```
TabBurrow — Tab & Bookmark Manager
```

34 characters (limit: 45).

## Summary

```
Save any tab in one click. Local-first, no account needed. AI organize and sync when you want them.
```

99 characters (limit: 132).

## Category

**Workflow & Planning**

## Full description

```
TabBurrow is an open-source, local-first tab and bookmark manager. Save a
tab, a selection of tabs, or a whole window in one click — no signup, no
account wall. Everything lives in your browser from the first save.

WHY TABBURROW

• Local-first, no forced account. Every save, organize, and restore action
  works instantly on install. Your collections live in your browser; you
  choose if and when to sign in.

• AI auto-organize, with a preview. One click groups and tags your tabs by
  intent. You see exactly what moves where before anything changes —
  nothing is ever applied automatically. (PRO, launching with v1.0.)

• Open source, AGPL-3.0. Every part of TabBurrow — the popup, the
  dashboard, the sync engine, the AI organize function — is public on
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
  any time — your data is never locked in.
- Keyboard shortcuts for saving and opening the dashboard without touching
  the mouse.
- Switch between a dark "burrow" theme and a light "paper" theme.

FREE VS PRO

Local saving, organizing, sessions, search, and import/export are free,
unlimited, forever — no trial, no nag screens. PRO ($4/month or
$29/year) adds cloud sync across devices, shareable collection pages, and
unlimited AI organize (free accounts get 30 AI organize runs a month).
Prefer to run your own backend? Self-host the entire stack, including AI
organize with your own API key, for $0 — see the self-hosting guide on
GitHub.

PRIVACY

TabBurrow works fully offline by default; nothing leaves your device
unless you sign in. AI organize sends only link titles and URLs, never
page content. TabBurrow runs no ads, uses no ad trackers, and does not
sell your data. Full privacy policy and source code are linked from the
GitHub repository.

Built in the open — every commit is public, every acceptance criterion is
checked before it ships.
```

## Screenshot shot list (T25b)

All captures at **1280×800**, taken from the real running extension via
Claude in Chrome once it can be driven live. Use a clean profile with a
handful of realistic collections (dev docs, recipes, shopping, one
video/reading collection) so the screens don't look empty or staged with
lorem-ipsum data.

1. **Popup save** — the toolbar popup open over a real tab, mid-save
   flow (collection picker visible, "Last Used" default highlighted).
   Staging: pick a page with a recognizable favicon/title so the shot
   reads at a glance; use the dark "burrow" theme.
2. **Dashboard grid** — the full-page dashboard with the rail showing
   4–6 collections and the main grid showing one populated collection
   (8–12 link cards with favicons, titles, a couple of notes/tags
   visible). Staging: pick a collection name and cover image that reads
   well at thumbnail size in the store listing.
3. **AI organize preview** — the "Organize with AI" preview diff showing
   suggested groups before confirmation. Staging: **blocked until T19
   (ai-organize Edge Function) and T20 (AI organize UI) land** — this
   flow doesn't exist in the running extension yet. Once it does, run it
   against a deliberately messy 15–20 tab mix so the "before" clutter
   and "after" grouping read clearly in one frame.
4. **Sessions pane** — the sessions section of the left rail, showing a
   mix of auto and manual snapshots with timestamps/names, plus the
   restore action visible. Staging: trigger at least one manual named
   snapshot ("Before demo") alongside the auto ones so both types are
   visible in frame.
5. **Share page** — a public collection share page as seen by a visitor
   (not signed in), showing the link cards and the "Made with TabBurrow"
   banner. Staging: **blocked until T21 (share pages) and T22 (share
   controls) land** — no share page exists yet. Once it does, shoot it
   at the same 1280×800 crop as the others for visual consistency across
   the listing, even though the page itself is responsive.

Shots 1, 2, and 4 can be captured as soon as T25b starts (all three flows
exist today). Shots 3 and 5 need to wait for their respective stories.

## Promo tile

**Small promo tile: 440×280 px, PNG, no alpha transparency** (Chrome Web
Store requirement).

Spec:
- Deep Green ground (`#16241E`) background, matching the extension and
  marketing site.
- TabBurrow wordmark in Syne Bold, cream (`#EEE8D9`), left- or
  center-aligned.
- The burrow-arch motif (rounded "entrance" arch, same shape language as
  the card corners and the marketing hero) as the dominant graphic
  element — no stock art, no clip-art squirrel unless it can be done in
  the brand's own illustration style.
- Orange accent (`#F97316`) used sparingly as a highlight (e.g. one
  "tucked in" tab icon or the arch outline), not as a large fill — keep
  it a warm accent, not the dominant color.
- No screenshot content crammed into the tile; it should read at
  thumbnail size in a search results grid, not as a mini-dashboard.
- Deliverable: `store-assets/promo-tile-440x280.png`, plus
  `store-assets/icon-128.png` (reuse `apps/extension/assets/icon.svg`
  rasterized at 128×128, already the extension's own icon source).

Both image deliverables are deferred to T25b along with the screenshots
above.

## Verification

Character counts verified with:

```sh
python3 - <<'EOF'
title = "TabBurrow — Tab & Bookmark Manager"
summary = "Save any tab in one click. Local-first, no account needed. AI organize and sync when you want them."
print("title:", len(title), "/ 45")
print("summary:", len(summary), "/ 132")
EOF
```

Output: `title: 34 / 45`, `summary: 99 / 132`. Both under limit.

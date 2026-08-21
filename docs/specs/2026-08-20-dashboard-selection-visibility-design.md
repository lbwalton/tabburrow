# Dashboard selection visibility: teach multi-select the way the popup does

Date: 2026-08-20
Status: **specified, ready to implement.** Design approved 2026-08-20.

## Problem

The popup teaches multi-select at a glance: every `LinkRow` carries a permanent
checkbox, and the inline `SelectionBar` shows a "⇧ click another to select a range" hint
at exactly one selection. The dashboard's `LinkGrid` has none of that. Its selection is
real and already shared (`lib/selection.ts`), but it is driven only by ⌘/Ctrl-click
(toggle) and Shift-click (range) on a card whose *plain* click opens the link — with
nothing on screen saying any of that is possible. Selection shows only as an accent ring
+ wash on already-selected cards, so a user who has never stumbled onto the modifier-
clicks has no way in and no reason to think one exists.

This was scoped out when the popup multi-select was built (see
`2026-08-08-popup-multi-select-design.md`, "Scope") as an accepted cost. It is worth
doing now precisely because the popup proved the pattern and the logic is already shared:
this is a presentation change, not a behavioral one.

## Decision: hover-reveal + persist, not always-on

The popup uses always-visible checkboxes because its rows are a compact list. The
dashboard is a spacious card grid, and its card *already* reveals its other controls —
the drag grip and the edit pencil — only on hover/focus (`opacity-0
group-hover:opacity-100`). An always-visible checkbox would be the single always-on
control on an otherwise hover-reveal card, and would add persistent weight to a board
meant to be scanned.

So the checkbox **reveals on hover/focus of a card, and once anything is selected every
card's checkbox stays visible** (so the set is legible and extendable). This matches the
card's own established language and keeps the resting board clean, while the hover reveal
plus the bottom-bar hint still carry discoverability. It is a deliberate divergence from
the popup's always-on rows, justified by grid ≠ list. (Chosen over always-visible parity
in the design review on 2026-08-20.)

## Design

### 1. The checkbox on `LinkCard`

**Placement.** The card's top-left 16px slot — where the favicon already sits. Primary
approach is a **favicon ⇄ checkbox swap** (the Gmail pattern): the favicon shows at rest;
the checkbox occupies the same slot when the card is hovered, focus-within, or while a
selection is active. This avoids both a layout reflow and a permanent empty gutter.

- **Fallback, decided by eye during the build:** if the per-card swap shimmers as the
  pointer sweeps the grid (favicon → checkbox → favicon under the cursor), fall back to a
  reserved left checkbox slot (~24px) that the content always leaves room for, with the
  favicon staying put. The dashboard is a real tab, so this is settled with a screenshot,
  not guessed — unlike the popup work. Record which one shipped.

**Visibility** = `group-hover` OR `group-focus-within` OR selection-is-active. The first
two are pure CSS on the card (exactly how the grip/edit controls already work); the third
needs a new `selectionActive` boolean prop on `LinkCard` (`LinkGrid` passes
`selectedLinks.length > 0`), which forces the checkbox visible on every card while a
selection exists.

**Style.** Mirrors the popup box: a square (`rounded-[4px]`), `--line-hi` border when
unchecked, **filled with `var(--accent)`** when checked, with the same white check SVG.
It uses the global accent — not a per-collection accent like the popup's `checkColor` —
because that is what the card's *existing* selected ring + wash already use (the
`boxShadow` / `backgroundColor` in `LinkCard`), so the dashboard stays internally
consistent. The minor cross-surface divergence (popup checkbox = folder accent) is
accepted; each surface is internally consistent.

**Wiring — no selection-logic change.** The checkbox is a real `<input type="checkbox">`
rendered inside the card. The card root is itself the click target here (a
`<div role="option">`, unlike the popup where the click target is an inner `<button>`), so
nesting is valid HTML — the input-in-button trap `LinkRow` sidesteps by keeping its box a
*sibling* simply does not apply here — and the box only has to keep its own clicks off the
card. Its handlers:

- `onPointerDown` → `stopPropagation()` so a press on the box never arms the card's
  pointer-drag sensor — the exact guard the edit button already uses.
- `onClick` → `stopPropagation()` (so it never reaches the card body's open handler),
  then call the *existing* `onCardIntent(link.id, e.shiftKey ? "range" : "toggle")`.
  `LinkGrid.handleCardIntent` already routes `toggle`/`range` into `nextSelection`, so the
  checkbox is just a new, discoverable entry point into selection code that is already
  there. `lib/selection.ts` and `lib/click-intent.ts` are untouched.

**Keyboard / a11y.** A native checkbox is focusable and toggles on Space, so it needs no
extra key handling; focusing it reveals it through the card's existing
`group-focus-within`. It carries `aria-label="Select {title}"` (popup parity). The card
keeps `role="option"` + `aria-selected` as the selection source of truth; the checkbox is
a redundant-but-conventional control, consistent with the card already housing the grip
and edit buttons inside the option.

### 2. The Shift-range hint in `BulkBar`

At exactly one selection (`selectedLinks.length === 1`), `BulkBar` shows the same hint the
popup's `SelectionBar` does, with the same copy and `Kbd` key-cap:

> ⇧ click another to select a range

Identical wording across both surfaces is deliberate — one product, one vocabulary. The
hint is self-limiting exactly as in the popup: nothing to teach at zero (a range needs an
anchor), and by two the user has evidently worked it out — so it needs no "don't show
again" preference to store. `BulkBar` is a single `fixed` row today; the hint is added as
a second line (the bar becomes a short column at one selection) or inline, kept subtle
(`text-[var(--text-2)]`) and decided by eye.

### 3. Motion

The checkbox fade is opacity-only and short, in step with the grip/edit reveals. No
transform, so `prefers-reduced-motion` has nothing to suppress; if the swap crossfades the
favicon, that is opacity-only too.

## What does not change

`lib/selection.ts`, `lib/click-intent.ts`, plain-click-opens, ⌘/Ctrl-click and Shift-click
on the card body, every `BulkBar` action, drag-and-drop, and Escape-to-clear (`LinkGrid`'s
shared `escape-guard` listener) all stay exactly as they are. This is purely additive
presentation.

## Verification

Unlike the popup work, the dashboard is a normal tab, so `e2e/specs/t09-grid-dnd.spec.ts`
genuinely exercises all of this in the built extension. Add assertions:

1. At rest (nothing hovered, nothing selected) a card's checkbox is not visible.
2. Hovering — or keyboard-focusing — a card reveals *its* checkbox.
3. Clicking a card's checkbox selects that card (the `BulkBar` appears with "1 selected")
   without opening a tab.
4. Once 1+ is selected, every card's checkbox is visible (the persist rule).
5. Shift-clicking a second card's checkbox selects the contiguous range.
6. The "⇧ click another…" hint shows at exactly one selection, and is gone at zero and at
   two.

Standing constraints (`docs/ROADMAP.md`): run `pnpm --filter extension build` before the
e2e run, and for at least one new assertion, revert the affordance and confirm that
assertion — ideally only it — goes red, then restore. No new unit tests: there is no new
pure logic (the selection math is already covered by `lib/selection.test.ts`); this is UI,
which this repo verifies by Playwright, not vitest. Capture a screenshot to settle the
favicon-swap-vs-reserved-slot call in §1.

## Out of scope

- Any change to *what* selection does or how the math works (`lib/selection.ts`).
- Changing plain-click-opens, or removing the modifier-click paths (the checkbox is
  additive, not a replacement).
- Reworking `BulkBar`'s actions or layout beyond adding the one hint line.
- A per-collection accent for the dashboard checkbox (it deliberately uses the global
  accent).

## Files

- `apps/extension/entrypoints/dashboard/LinkCard.tsx` — the checkbox + swap/visibility.
- `apps/extension/entrypoints/dashboard/LinkGrid.tsx` — pass `selectionActive`; no logic
  change.
- `apps/extension/entrypoints/dashboard/BulkBar.tsx` — the one-selection hint.
- `apps/extension/e2e/specs/t09-grid-dnd.spec.ts` — the assertions above.

Related: `2026-08-08-popup-multi-select-design.md` (the pattern being mirrored) and
`apps/extension/entrypoints/popup/{LinkRow,SelectionBar}.tsx` (the reference
implementation).

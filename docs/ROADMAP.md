# Roadmap

Engineering work that is known, scoped, and deliberately not done yet. Ordered by
priority. Each item says what it is, why it was deferred, and where the detail lives, so
a session can pick up the top item without reconstructing context.

Product and launch planning is not here; it lives in the gitignored `docs/launch/`.

Last reviewed: 2026-08-09.

---

## 1. Escape dismisses the whole popup instead of the open layer

**Status:** specified, ready to implement.
**Detail:** [`docs/specs/2026-08-09-popup-close-request-design.md`](specs/2026-08-09-popup-close-request-design.md)

In the real browser-action popup, Escape closes the entire popup, so a user trying to
dismiss the colour picker, cancel a rename, or clear a selection loses the popup instead.
Confirmed by hand across four cases.

`preventDefault()` cannot fix it — Chromium dismisses the popup via a *close request*,
which is a different mechanism. The fix is `CloseWatcher` (Chromium 120+; Firefox
[declined](https://bugzilla.mozilla.org/show_bug.cgi?id=1443758) and cannot be fixed).

Deferred because a first attempt failed on a teardown race, and because **the e2e harness
cannot verify it**: it loads `popup.html` in a tab, which has no close request, so the
tests pass identically whether it works or not. Needs a human in a real popup between
iterations. The spec records the race, the design, and the acceptance criteria.

## 2. Dashboard selection is invisible

**Status:** deferred by design decision, not yet specced.
**Context:** [`docs/specs/2026-08-08-popup-multi-select-design.md`](specs/2026-08-08-popup-multi-select-design.md), "Scope"

The popup teaches multi-select visibly: permanent checkboxes, plus a hint at exactly one
selection showing that shift-click extends a range. The dashboard still has none of that
— its selection is cmd/ctrl-click and shift-click only, with nothing on screen saying so.

This was scoped out when the popup work was designed, and named there as an accepted
cost. Worth revisiting now that the popup has a proven pattern to copy: `lib/selection.ts`
is already shared, so this is a presentation change rather than a behavioral one.

---

## Standing constraints

Not tasks, but things that shape how work here gets verified. Getting these wrong has
already cost real debugging time.

**Extension UI is only truly verifiable by hand or by Playwright, never by unit tests.**
`apps/extension/vitest.config.ts` unit-tests pure `lib/` functions only. A popup or
dashboard change can pass typecheck and the entire unit suite while being completely
broken. Run `pnpm --filter extension build` before any e2e run — the suite drives the
built extension from `.output/chrome-mv3`, so a stale build tests stale code.

**A tab is not a popup.** `e2e/fixtures.ts` loads `popup.html` as an ordinary tab. That
faithfully exercises the UI and its logic, but differs from a real popup in at least two
ways that have bitten: a tab never closes on Escape, and a tab's viewport is the test's
1400x900 rather than a popup's ~360x500. The second one hid a clipped popover for an
entire release. When probing popup layout, set a popup-sized viewport.

**Verify that a new regression test can actually fail.** Revert the fix, confirm that
test — ideally only that test — goes red, then restore. Two tests in this repo passed for
the wrong reason and were caught only by doing this.

**Non-Chrome DOM repros are not evidence about Chrome.** A `happy-dom` repro once
"proved" a bubble-phase Escape guard was safe. It was not, in Chrome, and the resulting
bug survived three fix rounds and three code reviews before Playwright found it.

# Roadmap

Engineering work that is known, scoped, and deliberately not done yet. Ordered by
priority. Each item says what it is, why it was deferred, and where the detail lives, so
a session can pick up the top item without reconstructing context.

Product and launch planning is not here; it lives in the gitignored `docs/launch/`.

Last reviewed: 2026-08-22.

---

## Open items

### 1. Cross-folder search → select → open-all ("show me Meta across every client")

**Status:** captured, not yet specced. Tracked in [#17](https://github.com/lbwalton/tabburrow/issues/17).

Folders are per-client, but sometimes the axis is the topic, not the client: the goal is to
open every "Meta Business Manager" link across all clients at once. The cross-folder search
already exists (`lib/search.ts`'s `searchAll` ranks links from every folder by title, url,
and tags, and both the popup and dashboard call it), but activating a result only opens one
tab. The work is to make the search results a **selectable set** using the shared
`lib/selection.ts` pattern, plus an **open-all** action via `lib/restore.ts`'s `openLinks`,
so search + select + one click opens the whole topic. No AI is needed for v1; an optional
semantic layer (so "meta" also surfaces a link titled "Facebook Ads Manager") is a possible
v2. Issue [#17](https://github.com/lbwalton/tabburrow/issues/17) has the building blocks, the
`MAX_SEARCH_RESULTS` cap question, and the popup-vs-dashboard surface decision.

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

---

## Closed / not achievable

Kept here so the finding isn't lost and the item isn't re-opened.

**Escape dismissing the open popup layer instead of the whole popup — CANNOT be done in
the popup.** Built and hand-tested 2026-08-12 in a real Chromium 120+ toolbar popup: a
browser-action popup is closed on Escape by Chrome at the widget level, *before* the page
can intercept it. An armed `CloseWatcher` never receives the request, and even a native
modal `<dialog>` can't hold the popup open (its Escape closes the whole popup, not just the
dialog). `preventDefault()` was already a dead end. Same class as Firefox's
[WONTFIX](https://bugzilla.mozilla.org/show_bug.cgi?id=1443758), now confirmed for Chromium.
Full evidence, and the corollary that the old "native dialogs handle themselves" assumption
was also false, live in the Verdict of
[`docs/specs/2026-08-09-popup-close-request-design.md`](specs/2026-08-09-popup-close-request-design.md).
Getting layer-dismissal-on-Escape would require a different surface (dashboard tab or side
panel) — a product decision, not an in-popup fix.

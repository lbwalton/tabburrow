# Popup close requests: Escape should dismiss the open layer, not the whole popup

Date: 2026-08-09
Status: **specified, not implemented.** A first attempt was written and backed out; see
"Failed first attempt" before starting.

## Problem

In the real browser-action popup, pressing Escape closes the entire popup. It does this
regardless of what is open, so a user who means to dismiss the colour picker, cancel a
rename, or clear a multi-select loses the whole popup instead.

Confirmed by hand on 2026-08-08 across four cases: clearing a selection, cancelling a
folder rename, dismissing the accent picker, and pressing Escape while typing in the
Add-link URL field. All four close the popup.

This is invisible to the automated suite. See "Why this cannot be e2e tested".

## Why `preventDefault` cannot fix it

The obvious fix does not work, and it is worth writing down so nobody spends a day on it.

Modern Chromium dismisses an extension popup via a **close request** — the same
high-level signal as an Android back gesture — which is a *separate mechanism* from a
keydown's default action. `event.preventDefault()` on the Escape keydown does not cancel
it. Older Chromium behaved differently, which is why stale advice suggesting
`preventDefault` exists.

The purpose-built API is
[`CloseWatcher`](https://developer.mozilla.org/en-US/docs/Web/API/CloseWatcher). While a
watcher is active it receives the close request, so the popup survives and the page
decides what to close.

## Browser support

| Surface | Behavior after this change |
| --- | --- |
| Chromium 120+ toolbar popup | Escape dismisses the top layer, popup stays open |
| Chromium < 120 | `window.CloseWatcher` undefined, feature-detected no-op, unchanged |
| Firefox | **Cannot be fixed.** Mozilla declined to let extensions intercept the popup-dismissing Escape ([bugzilla 1443758](https://bugzilla.mozilla.org/show_bug.cgi?id=1443758), WONTFIX) |
| Dashboard (a normal tab) | Unaffected. A tab has no popup close request |

Firefox degrading to today's behavior is acceptable and must not block the Chromium fix.

## Failed first attempt, and the race that killed it

The intuitive design is to layer `CloseWatcher` **on top of** the existing keydown
handling: register one watcher per open layer, gated on that layer's own state, and let
Chromium's watcher stack deliver the request to the topmost one.

It does not work, because the layers already dismiss themselves on keydown.

Concrete failure, reproduced against `r10-folder-actions.spec.ts`:

1. A link is selected, so a watcher `S` exists for the selection.
2. The user starts a rename, so a watcher `R` is created on top of `S`.
3. Escape fires. The rename `<Input>`'s own `onKeyDown` sets `renaming = false`
   **synchronously**.
4. React flushes, the `renaming` effect cleans up, and **`R` is destroyed** — all before
   the close request is processed.
5. The close request arrives and finds `S` on top, so it **clears the selection** instead
   of doing nothing.

The general shape: any layer that closes itself on keydown tears down its own watcher
mid-keypress, and the request falls through to the wrong handler.

## Recommended design

**Make `CloseWatcher` the single dismissal path in the popup when it is available**,
rather than layering it over the keydown handlers.

```
if (supportsCloseRequests())  ->  close requests drive all dismissal
else                          ->  today's keydown path, unchanged
```

Concretely:

- One module owning the decision, alongside `lib/escape-guard.ts` (which stays as the
  fallback path and as the dashboard's mechanism).
- While the popup has any dismissible layer open, a watcher is active. Its `onclose`
  decides which layer to close, using the same precedence the keydown guard already
  encodes: a focused text-entry field first, then any open menu or dialog, then the
  selection.
- The per-layer keydown Escape handlers in the popup must **stand down** when close
  requests are driving, or the race above returns. They must keep working on the
  dashboard and on browsers without `CloseWatcher`. `AccentPicker` is shared between
  both surfaces, so this is the fiddly part.
- Watcher creation must be wrapped in `try/catch`: beyond the first, Chromium requires
  user activation and construction can throw `NotAllowedError`. Losing interception is a
  cosmetic degradation; taking the popup down with an unhandled throw is not.
- The handler must be held in a ref rather than keyed into the effect's dependencies, or
  the watcher is destroyed and rebuilt on every render — which both wastes the activation
  budget and reintroduces a teardown window.

## Why this cannot be e2e tested

`e2e/fixtures.ts`'s `popupPage` loads `popup.html` in an **ordinary tab**. A tab has no
popup close request, so:

- the bug cannot occur there, and
- the fix cannot be observed there.

The popup Escape tests in `r10-folder-actions.spec.ts` pass identically whether this is
broken or fixed. **A green suite is not evidence about this behavior.** This is the same
limitation `e2e/MANUAL.md` §1 already records for toolbar-click popup opening.

Verification is the manual checklist in `e2e/MANUAL.md` §10. Run it in a real Chrome
window with the extension loaded unpacked, not in a `chrome-extension://` tab.

## Acceptance criteria

In a **real toolbar popup** on Chromium 120+:

1. Select two links, press Escape once. Selection clears, **popup stays open**. Press
   Escape again. Popup closes.
2. Select two links, start a rename, press Escape. Rename cancels, **selection survives,
   popup stays open**.
3. Select two links, open ⋯ → Change color, press Escape. Picker closes, **selection
   survives, popup stays open**.
4. Open ⋯, press Escape. Menu closes, popup stays open.
5. Open a confirm dialog (Overwrite / Delete folder / bulk Delete), press Escape. Dialog
   closes, popup stays open.
6. With nothing open, press Escape. **Popup closes** — the platform behavior users expect
   must be preserved.
7. Repeat 1 and 6 on the dashboard: unchanged from today.

Regression guard: the full e2e suite must stay green, which proves the fallback path and
the dashboard were not disturbed, even though it says nothing about the popup behavior
itself.

## Out of scope

- Firefox. Not fixable.
- Changing what Escape does on the dashboard.
- Reworking `lib/escape-guard.ts`'s rules. The guard's *decisions* are correct and unit
  tested; only the popup's *delivery mechanism* is wrong.

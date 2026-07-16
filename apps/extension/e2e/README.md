# TabBurrow extension e2e (Playwright)

This is the project's permanent live-verification vehicle for the extension:
a from-scratch Playwright suite that drives the REAL built extension
(`.output/chrome-mv3`) in a real Chromium instance via
`chromium.launchPersistentContext`. It exists because the Claude-in-Chrome
MCP tools cannot navigate `chrome-extension://` pages, so nothing else in
this repo actually exercises popup.html/dashboard.html/the background
service worker end to end. Built for Task 14 (extension-core QA pass) and
meant to keep being the harness for every future extension task.

## Setup

```sh
pnpm --filter extension build:e2e       # produces .output/chrome-mv3 — REQUIRED, fresh, before every run
npx playwright install chromium         # one-time (or after a Playwright version bump)
```

`build:e2e` (not plain `build`) matters: this suite always drives the
extension against the local Supabase stack (`http://127.0.0.1:54321`, see
`supabase start`), and a real production build (`wxt build`'s default
`mode: "production"`) omits that loopback origin from `host_permissions` —
see `wxt.config.ts` — since no installed user's browser could ever reach it.
`build:e2e` sets `WXT_INCLUDE_LOCAL_HOSTS=1` to opt back in. Building with
plain `pnpm --filter extension build` will fail every networked spec
(t16/t18/t20/t22/t23) with MV3 blocking the extension's fetches to the local
stack.

## Running

```sh
pnpm --filter extension e2e             # from apps/extension
# or, from the repo root:
pnpm e2e
```

Runs headless (Chromium's "new" headless mode — verified locally to register
the MV3 service worker and render both entrypoints correctly; see
`fixtures.ts`'s `HEADLESS_MODE` docstring). To watch it run in a real window:

```sh
E2E_HEADLESS=false pnpm --filter extension e2e
```

Run a single file or a single test:

```sh
npx playwright test -c e2e/playwright.config.ts e2e/specs/t07-popup-save.spec.ts
npx playwright test -c e2e/playwright.config.ts -g "fuzzy match"
```

Reports: `list` to stdout + an HTML report at `apps/extension/e2e/report/`
(`npx playwright show-report e2e/report`). Screenshots for visual review live
in `e2e/screenshots/<spec-name>.png` — one representative final-state shot
per spec file. Failure artifacts (extra screenshots, traces) land in
`e2e/test-results/` (gitignored; inspect a trace with `npx playwright
show-trace e2e/test-results/<dir>/trace.zip`).

## How the harness works (`fixtures.ts`)

- **One persistent, extension-loaded Chromium context per worker** (not per
  test): a real extension load is too expensive to redo per test, and this
  suite runs `workers: 1` / `fullyParallel: false` anyway (a second
  concurrent instance of the same extension profile isn't a scenario worth
  supporting here). Playwright's built-in `context`/`page` fixture NAMES are
  reused (see the `TestFixtures` docstring in `fixtures.ts`) so spec files
  read like ordinary Playwright tests.
- **`cleanDashboard` fixture**: every test that needs a blank slate uses
  this — it navigates to `dashboard.html`, wipes the `"tabburrow"`
  IndexedDB, reloads, and afterward closes any extra tabs the test opened.
  Tests that need multiple pages open them via `context.newPage()`/the
  `dashboardPage()`/`popupPage()` helpers directly.
- **`testServer` fixture**: a tiny Node `http` server (NOT `data:` URLs —
  the extension's `isHttpUrl` filter excludes those exactly like any other
  non-http(s) page) on an OS-assigned free port, serving pages with a
  `?title=` query param. Used everywhere a test needs a real http(s) tab.
- **`seed.ts`**: direct IndexedDB writes (bypassing Dexie/`@tabburrow/core`,
  which a `page.evaluate()` can't reach into) for scenarios where driving
  the real UI would be too slow (200 links) or isn't the thing under test
  (crash-restore flag simulation). Shapes are kept hand-in-sync with
  `packages/core/src/types.ts`/`db.ts`.

## The "current tab" gotcha

Playwright can't open the real toolbar popup (see `MANUAL.md`) — a page
navigated to `popup.html` is itself an ordinary tab, and creating/navigating
it makes IT the `chrome.tabs` "active" tab, which breaks `chrome.tabs.query({
active: true })`-based flows ("save current tab"). The fix used throughout
`t07-popup-save.spec.ts`: call `httpPage.bringToFront()` on the intended
"current" tab immediately before triggering the save — this changes which
tab Chrome considers active without disturbing Playwright's ability to keep
driving the (now background) popup tab's DOM directly afterward.

A related quirk: `chrome.tabs.highlight()` (used to simulate a real
multi-tab-strip select for the "Save selected" flow, since there's no
Playwright-level "select multiple tabs" primitive) always makes its first
target tab active — and creating/navigating a brand-new tab always collapses
any existing highlighted set down to just that new tab. So the popup tab has
to already exist (via `context.newPage()`, left unnavigated) BEFORE the
highlight call, then get `goto()`'d into `popup.html` afterward.

## Drag-and-drop strategy

BOTH dnd-kit input paths are covered in `t08-rail.spec.ts` and
`t09-grid-dnd.spec.ts`:

- **Keyboard drags** (`keyboardDragUntil` in `test-utils.ts`): focus a
  row/card's grip handle, `Space` to pick up, `Arrow*` to move, `Space` to
  drop. dnd-kit's keyboard sensor is a first-class interaction, and this
  path is the deterministic baseline for within-list reorders (rail
  collections, grid links).
- **Pointer drags** (`mouseDragUntil`): the path actual users take, via
  dnd-kit's `PointerSensor` — press on the source's center, a small first
  move to clear the sensor's 4px activation-distance threshold, a stepped
  `mouse.move` glide to the target with a hover settle (so collision
  detection updates), then release. Covers the rail-collection reorder, the
  grid-link reorder, AND the one gesture keyboard-drag structurally cannot
  reach: dropping a link card onto a rail `CollectionRow` (a different
  `SortableContext`) to move it between collections — the direct exercise
  of `lib/dnd.ts`'s `move-link` operation. The bulk "Move to…" menu test
  covers the same underlying `moveLinkToEnd` repo call through the menu
  path.

Both helpers retry the FULL gesture (max 3 attempts, rethrow on exhaustion)
if the verify step doesn't pass: dnd-kit's drag-start is async (React state
+ RAF-driven measurement) and can lose a race against synthetic input
timing under machine load — observed directly across repeated full-suite
runs. A pickup that never registered is a no-op (keyboard) or degrades to a
plain click (pointer — on a link card that opens a background tab; the
`cleanDashboard` fixture closes stray tabs), so re-running from scratch
starts from a known state. This absorbs input-timing noise the way a human
retrying a missed drag would; it does not loosen any assertion.

## Perf checks

- **200-link collection scroll**: seeded directly via `seed.ts` (driving the
  UI to create 200 links would itself dominate the test's runtime), then
  scrolls the collection panel to the bottom and asserts the last card
  renders within a generous 2s budget.
- **Popup open speed**: measures a full Playwright round-trip —
  `context.newPage()` (a new tab over CDP) plus `page.goto()` navigation
  machinery — to `popup.html`'s `domcontentloaded`, budgeted at 800ms. The
  acceptance criterion's "under 300ms" describes a REAL toolbar popup open,
  which has none of that harness overhead (observed locally the round-trip
  runs ~170-450ms total), so 300ms flat would fail on harness cost alone;
  800ms still fails on any ~3x regression in the popup's actual load cost.
  Treat a harness pass here as "not obviously regressed," not as the real
  number.

## What's NOT covered here

See `MANUAL.md` for the full list and why each one is out of reach for a
page-level Playwright script (toolbar popup click, global keyboard commands,
the action badge, a real Chrome force-quit, and the real 5-minute
auto-snapshot alarm cadence).

## CI

**Not wired into `.github/workflows/ci.yml` in this task.** Running a real
(even headless-mode) Chromium extension load in GitHub Actions' `ubuntu-latest`
runners needs either Chromium's "new" headless mode (already verified working
locally — see `fixtures.ts`) or an Xvfb virtual display as a fallback if it
turns out CI's sandboxed environment behaves differently than local macOS.
**TODO (future task):** add a `pnpm --filter extension build && npx
playwright install chromium --with-deps && pnpm --filter extension e2e` step,
gated appropriately (this suite is slow — several minutes — so it likely
wants its own job, not blocking the fast typecheck/test/build job).

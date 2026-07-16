# Manual QA checklist (not automatable in this harness)

Task 14 built a real Playwright e2e harness (`apps/extension/e2e/`) that drives
the actual built extension in a real Chromium instance — see `README.md` in
this directory for how to run it. A handful of behaviors genuinely can't be
driven from there, for reasons specific to each one. Verify these by hand
before a release; none of them are faked or skipped silently in the specs.

## 1. Toolbar popup opening via a real toolbar click

Playwright (and the Claude-in-Chrome MCP tools) can navigate to
`chrome-extension://<id>/popup.html` as an ordinary tab, which exercises the
popup's UI and logic faithfully — but a REAL extension popup is a distinct
top-level browsing context Chrome creates only in response to an actual
toolbar-icon click (or `chrome.action.openPopup()`, which itself requires a
user gesture in the general case). There is no Chrome DevTools Protocol
command to simulate "click the toolbar icon."

**Check:** click the TabBurrow toolbar icon in a real Chrome window. Popup
opens instantly, styled correctly, at the expected size/position under the
icon.

## 2. Global keyboard commands (Alt+Shift+S / Alt+Shift+A / Alt+Shift+B)

`wxt.config.ts`'s `commands` block registers these at the OS/browser level
(`chrome://extensions/shortcuts`). They fire whether or not any Chrome window
has focus, and are dispatched by the browser process itself before any page
or extension script sees them — there's no page-level Playwright API that
triggers them the way a real key-chord at the OS level does.

**Check (per shortcut):**
- **Alt+Shift+S** (save current tab): with a last-used collection already
  set, press the shortcut on an http(s) tab. Badge flashes a checkmark, no
  popup opens, and the tab is saved (verify in the dashboard).
- **Alt+Shift+A** (save all tabs): press it. Popup opens and replays the
  "Save all" flow (picker if cold, confirm view if warm) — see
  `commandPlan`/`popup/App.tsx`'s pending-command replay.
- **Alt+Shift+B** (open dashboard): press it from any tab. A dashboard tab
  opens (or focuses, if `chrome.tabs.create` semantics mean a duplicate —
  confirm actual behavior matches expectations).

## 3. Action badge flash

`lib/commands.ts`'s `flashSavedBadge()` calls
`chrome.action.setBadgeBackgroundColor`/`setBadgeText` — this paints the
actual toolbar icon badge, which isn't part of any page's DOM and isn't
observable through `page.screenshot()` or any CDP page-level command.

**Check:** trigger Alt+Shift+S (see #2) and watch the toolbar icon directly —
a "✓" badge appears in the brand orange and clears after ~1.5s.

## 4. Crash-restore via a real force-quit

`background.ts`'s crash detection compares a `sessionState` meta flag across
`chrome.runtime.onStartup` boundaries — i.e. it only means anything across a
REAL full browser process restart. The e2e suite (`t12-sessions.spec.ts`)
simulates the END STATE this produces — writing `crashDetected: "1"` and an
auto snapshot directly via IndexedDB, then verifying the banner/restore/
dismiss UI that state drives — which is a faithful test of the READ side, but
it is not a test of the WRITE side (i.e. that `onStartup` actually sets the
flag correctly after a genuine crash).

**Check:** open Chrome with TabBurrow installed and a few tabs open, then
force-quit Chrome (not a normal Quit — `killall "Google Chrome"` or your OS's
force-quit, so `chrome.windows.onRemoved`'s clean-shutdown write never runs).
Reopen Chrome. The dashboard (or next popup open, if it auto-opens the
dashboard) offers "Restore your last session?" and accepting it reopens the
pre-crash tabs.

## 5. Chrome sync of `chrome.storage`

Not currently used by the app for the local-first phase-1 feature set this
task covers (all durable state is Dexie/IndexedDB, keyed to one Chrome
profile) — flagged here only because the manifest's `permissions` array
grants `"storage"`. If/when a future task starts using
`chrome.storage.sync`, add real multi-profile verification here; there is
nothing to check today.

## 6. Google OAuth sign-in

`lib/auth.ts`'s `signInWithGoogle` drives `chrome.identity.launchWebAuthFlow`,
which opens Chrome's own purpose-built auth popup and waits for either a
redirect back to the extension's `chromiumapp.org` URL or the user closing
the window — there is no CDP/Playwright API to simulate that popup's
lifecycle, and no way to drive a real Google account through a consent
screen from an automated harness without a live Google account and 2FA in
the loop. **Also currently untestable even manually**: the local Supabase
stack has no Google OAuth client configured yet (`supabase/config.toml`'s
`[auth.external.google]` is `enabled = false`) — see `docs/SETUP_NOTES.md`
for the exact Google Cloud Console + Supabase config steps once one exists.

What IS covered without a live Google client: `sendEmailCode`/`verifyEmailCode`
end to end against the real local Mailpit mail catcher
(`e2e/specs/t16-auth.spec.ts`), and the "isn't set up yet" error path as a
pure-function unit test (`lib/auth.test.ts`'s `parseAuthRedirect`/
`describeWebAuthFlowError` fixtures) rather than a live click — clicking
"Sign in with Google" against an unconfigured provider opens a real Chrome
popup showing GoTrue's raw JSON error response that a human then has to
close by hand (Chrome's identity API doesn't auto-close it), which would
hang a headless harness with nothing there to click it shut.

**Check (once a Google OAuth client exists — see docs/SETUP_NOTES.md):**
click "Sign in with Google" in Settings (or the popup footer's "Sign in"
link → dashboard → Settings). A real Google consent screen appears in a
Chrome-owned popup (not a new browsable tab). Approving it closes the popup
and the extension shows the signed-in state (email + Free/PRO badge) with no
extra tab left dangling. Close and reopen the browser entirely — the session
should still be signed in (this is what `autoRefreshToken: true` +
`persistSession: true` over the `chrome.storage.local` adapter are for; see
`lib/supabase.ts`).

## 7. Auto snapshots at real 5-minute marks; never more than 10 kept

`background.ts` schedules `chrome.alarms.create(AUTO_SNAPSHOT_ALARM, {
periodInMinutes: 5 })`. There's no supported way to fast-forward a real
`chrome.alarms` timer from outside the extension, and firing the alarm
listener directly isn't possible either (it's a private closure inside the
service worker, not exposed on any object the harness can reach). The pruning
LOGIC (`pruneAutoSnapshots`: keeps exactly N newest autos, never touches
manual) is unit-tested in `packages/core/test/repo.test.ts` (T4's acceptance)
— what's NOT covered anywhere is the real alarm cadence.

**Check:** leave Chrome open with TabBurrow installed for 50+ minutes (or
change `AUTO_SNAPSHOT_INTERVAL_MINUTES` temporarily for a faster manual
check, then revert). Confirm a new "Auto" snapshot appears roughly every 5
minutes in `#/sessions`, and the Auto group never exceeds 10 rows.

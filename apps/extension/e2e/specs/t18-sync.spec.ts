import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect, closeExtensionContext, launchExtensionContext, popupPage, signInWithEmailOtp } from "../fixtures";
import { loadRootEnv } from "../env";
import {
  deleteAdminUser,
  deleteCloudDataForUser,
  fetchCollectionsForUser,
  fetchLinksForUser,
  findAdminUserByEmail,
  insertCloudCollection,
  setUserPlan,
} from "../admin";
import { seedCollectionsAndLinks, seedPosition } from "../seed";
import { finalScreenshot, readCollectionIdByName, readMetaValue } from "../test-utils";

/**
 * T18 — background sync wiring, PRO-gated (lib/sync-controller.ts,
 * lib/sync-transport.ts, background.ts, AccountPane's "Sync" section).
 *
 * All three tests here launch their OWN ad-hoc extension context(s) via
 * `launchExtensionContext` (see fixtures.ts) rather than the suite's shared
 * worker-scoped context: this file needs genuinely isolated Chrome profiles
 * (separate `chrome.storage.local` -> separate Supabase sessions, separate
 * IndexedDB) to simulate two independent "devices" for the round-trip test,
 * and the other two tests follow the same pattern for consistency and to
 * guarantee zero session bleed across this file's tests or into any other
 * spec file sharing the suite's single worker context.
 *
 * Requires the local stack running (`supabase start`) with
 * SUPABASE_SERVICE_ROLE_KEY set in the root .env — every test below skips
 * itself with a clear reason if that key is absent, same guard t16-auth.spec.ts
 * uses.
 */

const env = loadRootEnv();
const SUPABASE_URL = env.SUPABASE_URL || "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

/** Clicks "Sync now" and waits for it to re-enable — the busy guard (`disabled={syncing}`) flips true immediately on click and false once `requestSync` resolves, so waiting for "enabled again" is a reliable proxy for "the sync cycle finished" without depending on the status text's exact wording. */
async function syncNow(page: Page): Promise<void> {
  const button = page.getByRole("button", { name: "Sync now" });
  await button.click();
  await expect(button).toBeEnabled({ timeout: 20_000 });
}

/**
 * Syncs `page` (navigating to Settings first, wherever it currently is) and
 * only trusts the result once `assertion` actually holds — retrying the
 * whole cycle (a fresh "Sync now" click, not just re-polling the first
 * click's aftermath) up to `attempts` times with a short backoff, instead
 * of syncing exactly once and treating the button's re-enabled state alone
 * as proof the round-trip landed.
 *
 * Why (F2 fix — see stories/fixes.json / task-26-burndown-report.md): the
 * button re-enabling only proves `requestSync()` RESOLVED, not that it ran
 * a real push+pull — it resolves identically on a silent `{ skipped: ... }`
 * gate outcome (lib/sync-controller.ts's `SyncGateDecision`), which
 * `AccountPane.handleSyncNow` doesn't distinguish in its UI state. The
 * background service worker runs its OWN periodic sync-interval alarm
 * through a SEPARATE `sync-controller`/`SyncEngine` module instance on the
 * same device (module state there is explicitly per-JS-context, per that
 * file's own docstrings), so under heavy load it can race a manual click's
 * cycle and settle first on a cursor that predates a row the other device
 * just pushed. Reproduced locally by running this spec with
 * `--repeat-each 3` while a parallel `pnpm -r test` loop plus busy-loop
 * workers churned CPU (`load averages: 17.8` on an 8-core machine): the
 * "device B pulls the newly-created link" assertion intermittently saw 0
 * elements for the full default 8s expect-timeout even though device A's
 * push had already resolved before device B's sync started. Retrying the
 * whole click (not just re-polling the DOM) gives the next cycle's pull a
 * fresh chance to observe whatever's committed by then. Bounded at 3
 * attempts so a genuine regression still fails instead of retrying forever.
 */
async function syncUntil(
  page: Page,
  extensionId: string,
  targetHash: string,
  assertion: () => Promise<void>,
): Promise<void> {
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await page.goto(`chrome-extension://${extensionId}/dashboard.html#/settings`);
    await syncNow(page);
    await page.goto(`chrome-extension://${extensionId}/dashboard.html${targetHash}`);
    try {
      await assertion();
      return;
    } catch (err) {
      if (attempt === attempts) throw err;
      await page.waitForTimeout(500 * attempt);
    }
  }
}

/** Idempotent per-test cleanup: deletes any stray user (and its cloud rows) left behind by a prior crashed run, by email. */
async function cleanupStrayUser(email: string): Promise<void> {
  const existing = await findAdminUserByEmail(SUPABASE_URL, SERVICE_ROLE_KEY!, email);
  if (existing) {
    await deleteCloudDataForUser(SUPABASE_URL, SERVICE_ROLE_KEY!, existing.id);
    await deleteAdminUser(SUPABASE_URL, SERVICE_ROLE_KEY!, existing.id);
  }
}

test("PRO round-trip: an edit on device A appears on device B via Sync now; a delete never resurrects", async ({
  testServer,
}) => {
  test.skip(!SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY not set in root .env — see SELF_HOSTING.md");
  // 180s (was 120s): this test now retries a sync+verify cycle up to 3x on
  // any of its 4 checkpoints (syncUntil, F2 fix above) rather than trusting
  // a single "Sync now" click's re-enabled state as proof the round-trip
  // landed — a real fix under load needs the wall-clock room to actually
  // retry instead of just hitting a bigger single timeout.
  test.setTimeout(180_000);

  const email = "e2e-sync-pro@tabburrow.test";
  await cleanupStrayUser(email);

  const a = await launchExtensionContext();
  const b = await launchExtensionContext();
  try {
    // --- Sign the SAME account into both devices, then flip it to PRO. ---
    const dashA = await a.context.newPage();
    await dashA.goto(`chrome-extension://${a.extensionId}/dashboard.html#/settings`);
    await signInWithEmailOtp(dashA, email);

    const authUser = await findAdminUserByEmail(SUPABASE_URL, SERVICE_ROLE_KEY!, email);
    expect(authUser, "expected an auth.users row after device A signed in").toBeTruthy();

    const dashB = await b.context.newPage();
    await dashB.goto(`chrome-extension://${b.extensionId}/dashboard.html#/settings`);
    await signInWithEmailOtp(dashB, email);

    await setUserPlan(SUPABASE_URL, SERVICE_ROLE_KEY!, authUser!.id, "pro");

    await dashA.getByRole("button", { name: "Refresh status" }).click();
    await expect(dashA.getByText("PRO", { exact: true })).toBeVisible();
    await dashB.getByRole("button", { name: "Refresh status" }).click();
    await expect(dashB.getByText("PRO", { exact: true })).toBeVisible();

    // --- Device A creates a collection + link (via the popup save flow —
    // same cold-start create-and-save path t07-popup-save.spec.ts drives). ---
    const httpPage = await a.context.newPage();
    await httpPage.goto(testServer.pageUrl("Sync Test Page"));
    await httpPage.bringToFront();
    const popupA = await popupPage(a.context, a.extensionId);
    await httpPage.bringToFront();
    await popupA.getByRole("button", { name: "Save this tab" }).click();
    await popupA.getByPlaceholder("Collection name").fill("Sync Test Collection");
    await popupA.getByRole("button", { name: "Create" }).click();
    await expect(popupA.getByText(/Saved 1 tab to Sync Test Collection/)).toBeVisible();
    await popupA.close();

    // --- A syncs (its first-ever PRO sync -> initialUpload, pushing the
    // collection + link just created), then B syncs (its own first-ever PRO
    // sync -> initialUpload of B's own — empty — local rows, then a full
    // pull that picks up what A just pushed). ---
    await dashA.bringToFront();
    await syncNow(dashA);

    const collectionId = await readCollectionIdByName(dashA, "Sync Test Collection");
    expect(collectionId, "expected the created collection to exist locally on device A").toBeTruthy();

    await dashB.bringToFront();
    await syncUntil(dashB, b.extensionId, `#/c/${collectionId}`, () =>
      expect(dashB.getByRole("listbox", { name: "Links" }).getByRole("option")).toHaveCount(1),
    );
    const gridB = dashB.getByRole("listbox", { name: "Links" });
    await finalScreenshot(dashB, "t18-pro-round-trip-device-b-pulled");

    // --- Device B deletes the link, syncs, then device A syncs — the link
    // must NOT come back on A (delete-never-resurrects). ---
    await gridB
      .getByRole("option")
      .first()
      .click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
    const bulkBar = dashB.getByRole("toolbar", { name: "Bulk actions" });
    await expect(bulkBar).toBeVisible();
    await bulkBar.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(gridB.getByRole("option")).toHaveCount(0);

    // "Sync now" lives on AccountPane (the Settings route) — navigate back
    // there on each device before the next syncNow() call.
    await dashB.goto(`chrome-extension://${b.extensionId}/dashboard.html#/settings`);
    await syncNow(dashB);
    await syncUntil(dashA, a.extensionId, `#/c/${collectionId}`, () =>
      expect(dashA.getByRole("listbox", { name: "Links" }).getByRole("option")).toHaveCount(0),
    );
    await finalScreenshot(dashA, "t18-pro-round-trip-delete-not-resurrected");

    // --- Opposite direction (fix pass 1): create on A, sync to B, DELETE on
    // A, sync both — the delete must not resurrect on B either. Same
    // tombstone+LWW mechanics, but exercised with the deleting device being
    // the one that ALSO created the row (the B->A phase above deleted on the
    // device that had only pulled it). ---
    const httpPage2 = await a.context.newPage();
    await httpPage2.goto(testServer.pageUrl("Sync Test Page 2"));
    await httpPage2.bringToFront();
    const popupA2 = await popupPage(a.context, a.extensionId);
    await httpPage2.bringToFront();
    // Warm save: "Sync Test Collection" is the remembered target from the
    // cold save above, so one click saves straight into it.
    await popupA2.getByRole("button", { name: "Save this tab" }).click();
    await expect(popupA2.getByText(/Saved 1 tab to Sync Test Collection/)).toBeVisible();
    await popupA2.close();

    await dashA.goto(`chrome-extension://${a.extensionId}/dashboard.html#/settings`);
    await syncNow(dashA);
    await syncUntil(dashB, b.extensionId, `#/c/${collectionId}`, () =>
      expect(dashB.getByRole("listbox", { name: "Links" }).getByRole("option")).toHaveCount(1),
    );

    // Delete on A this time.
    await dashA.goto(`chrome-extension://${a.extensionId}/dashboard.html#/c/${collectionId}`);
    const gridA = dashA.getByRole("listbox", { name: "Links" });
    await gridA
      .getByRole("option")
      .first()
      .click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
    const bulkBarA = dashA.getByRole("toolbar", { name: "Bulk actions" });
    await expect(bulkBarA).toBeVisible();
    await bulkBarA.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(gridA.getByRole("option")).toHaveCount(0);

    await dashA.goto(`chrome-extension://${a.extensionId}/dashboard.html#/settings`);
    await syncNow(dashA);
    await syncUntil(dashB, b.extensionId, `#/c/${collectionId}`, () =>
      expect(dashB.getByRole("listbox", { name: "Links" }).getByRole("option")).toHaveCount(0),
    );

    await deleteCloudDataForUser(SUPABASE_URL, SERVICE_ROLE_KEY!, authUser!.id);
    await deleteAdminUser(SUPABASE_URL, SERVICE_ROLE_KEY!, authUser!.id);
  } finally {
    await closeExtensionContext(a.context, a.userDataDir);
    await closeExtensionContext(b.context, b.userDataDir);
  }
});

test("initialUpload: local rows created before sign-in are pushed to the cloud on the first PRO sync", async () => {
  test.skip(!SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY not set in root .env — see SELF_HOSTING.md");
  test.setTimeout(90_000);

  const email = "e2e-sync-initial-upload@tabburrow.test";
  await cleanupStrayUser(email);

  const { context, extensionId, userDataDir } = await launchExtensionContext();
  try {
    const collectionId = randomUUID();
    const linkId = randomUUID();

    const dash = await context.newPage();
    await dash.goto(`chrome-extension://${extensionId}/dashboard.html`);

    // Seed BEFORE sign-in: these rows have no pendingOps entries (seed.ts
    // writes straight to IndexedDB, bypassing the repos — see its
    // docstring) — exactly the condition initialUpload() exists for: it
    // pushes every local row regardless of pendingOps state.
    await seedCollectionsAndLinks(
      dash,
      [{ id: collectionId, name: "Pre-existing Collection", position: seedPosition(0) }],
      [{ id: linkId, collectionId, url: "https://example.com/pre-existing", title: "Pre-existing Link", position: seedPosition(0) }],
    );
    await dash.reload();

    await dash.goto(`chrome-extension://${extensionId}/dashboard.html#/settings`);
    await signInWithEmailOtp(dash, email);

    const authUser = await findAdminUserByEmail(SUPABASE_URL, SERVICE_ROLE_KEY!, email);
    expect(authUser).toBeTruthy();
    await setUserPlan(SUPABASE_URL, SERVICE_ROLE_KEY!, authUser!.id, "pro");

    await dash.getByRole("button", { name: "Refresh status" }).click();
    await expect(dash.getByText("PRO", { exact: true })).toBeVisible();

    // This device's first-ever PRO sync -> initialUpload().
    await syncNow(dash);
    await expect(dash.getByText(/Synced/)).toBeVisible();
    await finalScreenshot(dash, "t18-initial-upload-synced");

    // Verify via admin REST — does not trust the extension's own read of
    // what it thinks it pushed.
    const cloudCollections = await fetchCollectionsForUser(SUPABASE_URL, SERVICE_ROLE_KEY!, authUser!.id);
    expect(cloudCollections).toContainEqual(
      expect.objectContaining({ id: collectionId, name: "Pre-existing Collection", deleted_at: null }),
    );
    const cloudLinks = await fetchLinksForUser(SUPABASE_URL, SERVICE_ROLE_KEY!, authUser!.id);
    expect(cloudLinks).toContainEqual(
      expect.objectContaining({ id: linkId, collection_id: collectionId, url: "https://example.com/pre-existing", deleted_at: null }),
    );

    await deleteCloudDataForUser(SUPABASE_URL, SERVICE_ROLE_KEY!, authUser!.id);
    await deleteAdminUser(SUPABASE_URL, SERVICE_ROLE_KEY!, authUser!.id);
  } finally {
    await closeExtensionContext(context, userDataDir);
  }
});

test("FREE gate: a signed-in free user's sync attempts never touch collections/links, and the UI shows the PRO upsell instead of a Sync button", async () => {
  test.skip(!SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY not set in root .env — see SELF_HOSTING.md");
  test.setTimeout(60_000);

  const email = "e2e-sync-free@tabburrow.test";
  await cleanupStrayUser(email);

  const { context, extensionId, userDataDir } = await launchExtensionContext();
  try {
    const dash = await context.newPage();
    await dash.goto(`chrome-extension://${extensionId}/dashboard.html#/settings`);

    // Best-effort network check: Playwright's context.route()/context.on
    // ("request") only reliably captures requests made BY A PAGE. This
    // extension's sync calls run in the BACKGROUND SERVICE WORKER (background.ts),
    // and Playwright's coverage of a service worker's OWN outgoing fetches
    // is still gated behind an experimental flag as of this Playwright
    // version (verified: https://github.com/microsoft/playwright/issues/37675,
    // "(Experimental) Service Worker Network Events", still open) — not
    // enabled here, so this array may simply stay empty regardless of
    // whether the gate is working. It's kept as a cheap, harmless
    // best-effort signal; the assertion that actually proves the gate held
    // is the meta-based one below (readMetaValue: lastSyncAt/lastSyncError
    // were never written), which doesn't depend on Playwright's SW network
    // visibility at all.
    const restCalls: string[] = [];
    await context.route("**/rest/v1/**", async (route) => {
      restCalls.push(route.request().url());
      await route.continue();
    });

    // T23b fix pass 1: while the plan is UNRESOLVED (`plan === null` — a
    // fresh mount before getPlan returns, or a genuinely failed profiles
    // lookup), AccountPane's availability gate (lib/billing.ts's
    // upgradeAvailability, "hidden") must render NEITHER the Sync section
    // NOR live checkout buttons — a PRO user whose plan fetch transiently
    // failed must never be offered a second real subscription. The natural
    // "still resolving" window against the local stack is a few
    // milliseconds — not reliably assertable directly — so this makes the
    // equivalent (and strictly more dangerous) state DETERMINISTIC instead:
    // fail the page's profiles select outright with a 500 (page-level
    // route — getPlan runs in the dashboard page, same interception
    // mechanics t20's mocked error-path tests rely on), sign in, and
    // assert the settled failure state hides both sections.
    await dash.route("**/rest/v1/profiles**", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
    );

    await signInWithEmailOtp(dash, email);
    // No setUserPlan call — this account stays on the default "free" plan.

    // Let the (failing) plan fetch actually settle, so the zero-count
    // assertions below cover the settled failure state rather than only the
    // initial pending render (both must hide the buttons; the settled state
    // is the one that would otherwise persist indefinitely).
    await dash.waitForTimeout(1_500);
    await expect(dash.getByRole("heading", { name: "Upgrade to PRO", exact: true })).toHaveCount(0);
    await expect(dash.getByRole("button", { name: /Monthly \$4\/month/ })).toHaveCount(0);
    await expect(dash.getByRole("button", { name: "Sync now" })).toHaveCount(0);
    await expect(dash.getByRole("button", { name: "Manage billing" })).toHaveCount(0);

    // Un-break profiles and resolve the plan for real (Refresh status ->
    // getPlan(true)) — from here on the test exercises the ordinary
    // resolved-FREE state it always covered.
    await dash.unroute("**/rest/v1/profiles**");
    await dash.getByRole("button", { name: "Refresh status" }).click();

    // T23b: the FREE-plan branch's paragraph became a full "Upgrade to PRO"
    // section (AccountPane.tsx) — still the same PRO upsell this test's
    // title promises, just with real checkout buttons now that billing
    // exists, instead of a plain sentence.
    await expect(dash.getByRole("heading", { name: "Upgrade to PRO", exact: true })).toBeVisible();
    await expect(dash.getByRole("button", { name: "Sync now" })).toHaveCount(0);

    // Explicitly simulate the sync ATTEMPT a "Sync now" click would make —
    // through the same message channel a real click's debounce would use
    // (see lib/sync-nudge.ts / background.ts) — even though the free UI
    // renders no button to click. This also exercises the debounce+message
    // listener wiring itself under the free gate, not just the sign-in-time
    // "startup" trigger that already ran above.
    await dash.evaluate(() => chrome.runtime.sendMessage({ type: "sync-nudge" }));
    await dash.waitForTimeout(4_000); // past the 3s debounce window

    const collectionsOrLinksCalls = restCalls.filter((url) => /\/rest\/v1\/(collections|links)(\?|$)/.test(url));
    expect(collectionsOrLinksCalls).toEqual([]);

    // The authoritative check: no sync (from sign-in's automatic "startup"
    // trigger, the alarm, or this nudge) ever actually ran — syncGateDecision
    // gated every one of them out before requestSync touched the network.
    expect(await readMetaValue(dash, "lastSyncAt")).toBeNull();
    expect(await readMetaValue(dash, "lastSyncError")).toBeNull();
    await finalScreenshot(dash, "t18-free-gate");

    const authUser = await findAdminUserByEmail(SUPABASE_URL, SERVICE_ROLE_KEY!, email);
    if (authUser) await deleteAdminUser(SUPABASE_URL, SERVICE_ROLE_KEY!, authUser.id);
  } finally {
    await closeExtensionContext(context, userDataDir);
  }
});

test("account switch: after A synced on this device, B is blocked from syncing; Replace local data wipes A's rows and pulls B's cloud", async () => {
  test.skip(!SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY not set in root .env — see SELF_HOSTING.md");
  test.setTimeout(120_000);

  const emailA = "e2e-switch-a@tabburrow.test";
  const emailB = "e2e-switch-b@tabburrow.test";
  await cleanupStrayUser(emailA);
  await cleanupStrayUser(emailB);

  const { context, extensionId, userDataDir } = await launchExtensionContext();
  try {
    const dash = await context.newPage();
    await dash.goto(`chrome-extension://${extensionId}/dashboard.html`);

    // Local data that will be "A's" once A syncs (initialUpload adopts it).
    const aCollectionId = randomUUID();
    await seedCollectionsAndLinks(
      dash,
      [{ id: aCollectionId, name: "Switch A Collection", position: seedPosition(0) }],
      [
        {
          id: randomUUID(),
          collectionId: aCollectionId,
          url: "https://example.com/switch-a",
          title: "Switch A Link",
          position: seedPosition(0),
        },
      ],
    );
    await dash.reload();

    // --- A signs in, goes PRO, syncs — arming lastSyncUserId with A. ---
    await dash.goto(`chrome-extension://${extensionId}/dashboard.html#/settings`);
    await signInWithEmailOtp(dash, emailA);
    const userA = await findAdminUserByEmail(SUPABASE_URL, SERVICE_ROLE_KEY!, emailA);
    expect(userA).toBeTruthy();
    await setUserPlan(SUPABASE_URL, SERVICE_ROLE_KEY!, userA!.id, "pro");
    await dash.getByRole("button", { name: "Refresh status" }).click();
    await expect(dash.getByText("PRO", { exact: true })).toBeVisible();
    await syncNow(dash);
    const aCloud = await fetchCollectionsForUser(SUPABASE_URL, SERVICE_ROLE_KEY!, userA!.id);
    expect(aCloud).toContainEqual(expect.objectContaining({ id: aCollectionId, name: "Switch A Collection" }));

    // --- A signs out (local data stays, by design), B signs in + PRO. ---
    await dash.getByRole("button", { name: "Sign out" }).click();
    await expect(dash.getByRole("button", { name: "Send code" })).toBeVisible();
    await signInWithEmailOtp(dash, emailB);
    const userB = await findAdminUserByEmail(SUPABASE_URL, SERVICE_ROLE_KEY!, emailB);
    expect(userB).toBeTruthy();
    await setUserPlan(SUPABASE_URL, SERVICE_ROLE_KEY!, userB!.id, "pro");
    await dash.getByRole("button", { name: "Refresh status" }).click();
    await expect(dash.getByText("PRO", { exact: true })).toBeVisible();

    // --- Blocked state renders instead of a Sync button. ---
    await expect(dash.getByText(/previously synced with a different account/)).toBeVisible();
    await expect(dash.getByRole("button", { name: "Sync now" })).toHaveCount(0);
    await expect(dash.getByRole("button", { name: "Replace local data" })).toBeVisible();
    await finalScreenshot(dash, "t18-account-switch-blocked");

    // --- The leak check: NONE of A's rows may have been uploaded as B. ---
    const bCloudBefore = await fetchCollectionsForUser(SUPABASE_URL, SERVICE_ROLE_KEY!, userB!.id);
    expect(bCloudBefore).toEqual([]);

    // Seed a collection that exists ONLY in B's cloud, BACKDATED one hour so
    // its updated_at is strictly OLDER than the cursor A's sync advanced to
    // moments ago. That makes this row the genuine proof of the cursor
    // reset: if "Replace local data" failed to reset the cursor to 0, the
    // post-replace pull's .gt("updated_at", staleCursor) would skip this row
    // and the rail assertion below would fail. (A row stamped Date.now()
    // would be NEWER than the stale cursor and would pull either way,
    // proving nothing about the reset.)
    const bCollectionId = randomUUID();
    const backdated = Date.now() - 3_600_000;
    await insertCloudCollection(SUPABASE_URL, SERVICE_ROLE_KEY!, {
      id: bCollectionId,
      user_id: userB!.id,
      name: "Switch B Cloud Collection",
      position: seedPosition(0),
      created_at: backdated,
      updated_at: backdated,
    });

    // --- Resolve: Replace local data. ---
    await dash.getByRole("button", { name: "Replace local data" }).click();

    const rail = dash.getByRole("navigation", { name: "Collections" });
    await expect(rail.getByText("Switch B Cloud Collection")).toBeVisible();
    await expect(rail.getByText("Switch A Collection")).toHaveCount(0);
    // Blocked banner resolved; the normal Sync row is back.
    await expect(dash.getByRole("button", { name: "Sync now" })).toBeVisible();
    await expect(dash.getByText(/previously synced with a different account/)).toHaveCount(0);
    await finalScreenshot(dash, "t18-account-switch-replaced");

    // B's cloud still contains only B's own row — the wipe ran BEFORE any
    // sync for B, so A's rows never went up under B's user_id.
    const bCloudAfter = await fetchCollectionsForUser(SUPABASE_URL, SERVICE_ROLE_KEY!, userB!.id);
    expect(bCloudAfter).toEqual([
      expect.objectContaining({ id: bCollectionId, name: "Switch B Cloud Collection" }),
    ]);

    await deleteCloudDataForUser(SUPABASE_URL, SERVICE_ROLE_KEY!, userA!.id);
    await deleteAdminUser(SUPABASE_URL, SERVICE_ROLE_KEY!, userA!.id);
    await deleteCloudDataForUser(SUPABASE_URL, SERVICE_ROLE_KEY!, userB!.id);
    await deleteAdminUser(SUPABASE_URL, SERVICE_ROLE_KEY!, userB!.id);
  } finally {
    await closeExtensionContext(context, userDataDir);
  }
});

test("offline: mutations queue silently while offline and drain to the cloud once back online", async () => {
  test.skip(!SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY not set in root .env — see SELF_HOSTING.md");
  test.setTimeout(90_000);

  const email = "e2e-sync-offline@tabburrow.test";
  await cleanupStrayUser(email);

  const { context, extensionId, userDataDir } = await launchExtensionContext();
  try {
    const dash = await context.newPage();
    await dash.goto(`chrome-extension://${extensionId}/dashboard.html#/settings`);
    await signInWithEmailOtp(dash, email);
    const authUser = await findAdminUserByEmail(SUPABASE_URL, SERVICE_ROLE_KEY!, email);
    expect(authUser).toBeTruthy();
    await setUserPlan(SUPABASE_URL, SERVICE_ROLE_KEY!, authUser!.id, "pro");
    await dash.getByRole("button", { name: "Refresh status" }).click();
    await expect(dash.getByText("PRO", { exact: true })).toBeVisible();

    // Baseline sync while online (bootstraps the device).
    await syncNow(dash);
    await expect(dash.getByText(/Synced/)).toBeVisible();

    // --- Go offline. A manual sync now FAILS visibly (error + Retry)... ---
    await context.setOffline(true);
    await syncNow(dash);
    await expect(dash.getByText("Sync error")).toBeVisible();
    await expect(dash.getByRole("button", { name: "Retry" })).toBeVisible();

    // --- ...but a local mutation queues SILENTLY: creating a collection
    // works instantly with no error UI of its own (local-first: the write is
    // IndexedDB-only; only its pendingOp waits for the network). ---
    await dash.getByRole("button", { name: "+ New collection" }).click();
    await dash.getByPlaceholder("Collection name").fill("Offline Collection");
    await dash.getByRole("button", { name: "Create", exact: true }).click();
    const rail = dash.getByRole("navigation", { name: "Collections" });
    await expect(rail.getByText("Offline Collection")).toBeVisible();
    // No mutation-failure toast (the dashboard's error toasts all start
    // "Could(n't) ..." — absence = the create didn't surface any error).
    await expect(dash.getByText(/Could(n't| not)/)).toHaveCount(0);

    // Not in the cloud yet: the op is queued, nothing more. (Best-effort
    // assert — see the FREE-gate test's note on service-worker fetches; the
    // SW's own background sync isn't subject to setOffline, but no nudge
    // fires from a rail create until its debounce alarm, and this check runs
    // immediately.)
    const cloudWhileOffline = await fetchCollectionsForUser(SUPABASE_URL, SERVICE_ROLE_KEY!, authUser!.id);
    expect(cloudWhileOffline.find((c) => c.name === "Offline Collection")).toBeUndefined();

    // --- Back online: Sync now drains the queue. (Creating a collection
    // navigated the dashboard to the new collection's route — go back to
    // Settings, where the Sync section lives.) ---
    await context.setOffline(false);
    await dash.goto(`chrome-extension://${extensionId}/dashboard.html#/settings`);
    await syncNow(dash);
    await expect(dash.getByText(/Synced/)).toBeVisible();
    await expect(dash.getByText("Sync error")).toHaveCount(0);

    const cloudAfter = await fetchCollectionsForUser(SUPABASE_URL, SERVICE_ROLE_KEY!, authUser!.id);
    expect(cloudAfter).toContainEqual(expect.objectContaining({ name: "Offline Collection", deleted_at: null }));
    await finalScreenshot(dash, "t18-offline-drain");

    await deleteCloudDataForUser(SUPABASE_URL, SERVICE_ROLE_KEY!, authUser!.id);
    await deleteAdminUser(SUPABASE_URL, SERVICE_ROLE_KEY!, authUser!.id);
  } finally {
    await closeExtensionContext(context, userDataDir);
  }
});

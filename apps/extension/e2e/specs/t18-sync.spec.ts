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
  test.setTimeout(120_000);

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
    await dashB.bringToFront();
    await syncNow(dashB);

    const collectionId = await readCollectionIdByName(dashA, "Sync Test Collection");
    expect(collectionId, "expected the created collection to exist locally on device A").toBeTruthy();

    await dashB.goto(`chrome-extension://${b.extensionId}/dashboard.html#/c/${collectionId}`);
    const gridB = dashB.getByRole("listbox", { name: "Links" });
    await expect(gridB.getByRole("option")).toHaveCount(1);
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
    await dashA.goto(`chrome-extension://${a.extensionId}/dashboard.html#/settings`);
    await syncNow(dashA);

    await dashA.goto(`chrome-extension://${a.extensionId}/dashboard.html#/c/${collectionId}`);
    await expect(dashA.getByRole("listbox", { name: "Links" }).getByRole("option")).toHaveCount(0);
    await finalScreenshot(dashA, "t18-pro-round-trip-delete-not-resurrected");

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

    await signInWithEmailOtp(dash, email);
    // No setUserPlan call — this account stays on the default "free" plan.

    await expect(dash.getByText("Cloud sync is a PRO feature.")).toBeVisible();
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

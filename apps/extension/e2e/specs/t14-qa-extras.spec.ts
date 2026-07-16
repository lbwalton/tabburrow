import { test, expect, popupPage } from "../fixtures";
import { seedCollectionsAndLinks, seedMeta, seedPosition } from "../seed";
import { finalScreenshot } from "../test-utils";

/**
 * T14 extras — QA-pass-specific acceptance items not tied to a single
 * earlier task (stories/stories.json T14):
 *   - 200-link collection scroll perf acceptable
 *   - non-http tabs excluded gracefully (ALSO covered directly in
 *     t07-popup-save.spec.ts's "Save all tabs" test, which seeds an
 *     about:blank tab alongside two http(s) ones and asserts it's excluded
 *     from both the count badge and the saved set — not duplicated here)
 *   - popup opens under 300ms (popup DOMContentLoaded, harness-generous
 *     budget — see below)
 *   - zoom 80-125% works
 *   - window resize handled
 *   - double-click spam on save handled
 */

test("200-link collection: scrolling to the bottom is fast and the last card renders", async ({
  cleanDashboard,
  extensionId,
}) => {
  const dashboard = cleanDashboard;
  const collectionId = "perf-collection";
  const links = Array.from({ length: 200 }, (_, i) => ({
    id: `perf-link-${i}`,
    collectionId,
    url: `https://example.com/perf/${i}`,
    title: `Perf Link ${i}`,
    position: seedPosition(i),
  }));
  await seedCollectionsAndLinks(dashboard, [{ id: collectionId, name: "Perf Collection", position: seedPosition(0) }], links);
  
  // Seeding writes straight to IndexedDB via a raw connection, bypassing
  // Dexie's change tracking — an already-mounted page's useLiveQuery never
  // sees it without a reload (fresh Dexie connection = fresh read). See
  // e2e/README.md.
  await dashboard.reload();
  await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html#/c/${collectionId}`);

  const grid = dashboard.getByRole("listbox", { name: "Links" });
  await expect(grid.getByRole("option")).toHaveCount(200);

  const start = Date.now();
  await dashboard.locator("main").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(dashboard.getByRole("option", { name: /Perf Link 199/ })).toBeVisible({ timeout: 2000 });
  const elapsed = Date.now() - start;
  // Generous harness budget (brief: "loosely... < 2s"); real Chrome is faster.
  expect(elapsed).toBeLessThan(2000);
  await finalScreenshot(dashboard, "t14-200-link-scroll");
});

test("popup DOMContentLoaded is fast in the harness (generous budget; real popup is faster)", async ({
  context,
  extensionId,
}) => {
  const start = Date.now();
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "domcontentloaded" });
  const elapsed = Date.now() - start;
  // Acceptance says "under 300ms" for the real toolbar popup. This harness
  // measures a full Playwright round-trip instead — context.newPage() (a
  // whole new tab over CDP) + page.goto() navigation machinery — overhead a
  // native popup open doesn't have, so a straight 300ms budget would fail
  // on harness cost alone (observed locally: ~170-450ms total). 800ms keeps
  // headroom for that overhead while still failing on any ~3x regression in
  // the popup's actual load cost. See e2e/README.md's perf-check notes.
  expect(elapsed).toBeLessThan(800);
  await popup.close();
});

test("zoom 80-125% keeps the dashboard usable (no broken layout)", async ({ cleanDashboard, extensionId }) => {
  const dashboard = cleanDashboard;
  await seedCollectionsAndLinks(
    dashboard,
    [{ id: "zoom-col", name: "Zoom Collection", position: seedPosition(0) }],
    [{ id: "zoom-link", collectionId: "zoom-col", url: "https://example.com/zoom", title: "Zoom Link", position: seedPosition(0) }],
  );
  
  // Seeding writes straight to IndexedDB via a raw connection, bypassing
  // Dexie's change tracking — an already-mounted page's useLiveQuery never
  // sees it without a reload (fresh Dexie connection = fresh read). See
  // e2e/README.md.
  await dashboard.reload();
  await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html#/c/zoom-col`);

  for (const factor of [0.8, 1.25]) {
    await dashboard.evaluate(async (f) => {
      const tab = await chrome.tabs.getCurrent();
      if (tab?.id !== undefined) await chrome.tabs.setZoom(tab.id, f);
    }, factor);
    await dashboard.waitForTimeout(200); // zoom reflow settle
    await expect(dashboard.getByRole("navigation", { name: "Collections" })).toBeVisible();
    await expect(dashboard.getByRole("heading", { name: "Zoom Collection" })).toBeVisible();
    await expect(dashboard.getByText("Zoom Link")).toBeVisible();
  }
  await finalScreenshot(dashboard, "t14-zoom-125");

  await dashboard.evaluate(async () => {
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id !== undefined) await chrome.tabs.setZoom(tab.id, 1);
  });
});

test("window resize is handled without breaking the layout", async ({ cleanDashboard, extensionId }) => {
  const dashboard = cleanDashboard;
  await seedCollectionsAndLinks(
    dashboard,
    [{ id: "resize-col", name: "Resize Collection", position: seedPosition(0) }],
    [{ id: "resize-link", collectionId: "resize-col", url: "https://example.com/resize", title: "Resize Link", position: seedPosition(0) }],
  );
  
  // Seeding writes straight to IndexedDB via a raw connection, bypassing
  // Dexie's change tracking — an already-mounted page's useLiveQuery never
  // sees it without a reload (fresh Dexie connection = fresh read). See
  // e2e/README.md.
  await dashboard.reload();
  await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html#/c/resize-col`);

  for (const size of [
    { width: 1920, height: 1080 },
    { width: 1024, height: 768 },
    { width: 800, height: 600 },
  ]) {
    await dashboard.setViewportSize(size);
    await expect(dashboard.getByRole("navigation", { name: "Collections" })).toBeVisible();
    await expect(dashboard.getByRole("heading", { name: "Resize Collection" })).toBeVisible();
  }
  await dashboard.setViewportSize({ width: 1400, height: 900 });
});

test("double-click spam on 'Save this tab' (warm target) saves exactly once", async ({
  context,
  extensionId,
  testServer,
  cleanDashboard,
}) => {
  const dashboard = cleanDashboard;
  await seedCollectionsAndLinks(dashboard, [{ id: "spam-col", name: "Spam Collection", position: seedPosition(0) }], []);
  await seedMeta(dashboard, { lastUsedCollectionId: "spam-col" });

  const httpPage = await context.newPage();
  await httpPage.goto(testServer.pageUrl("Spam Save Page"));
  await httpPage.bringToFront();
  const popup = await popupPage(context, extensionId);
  await httpPage.bringToFront();

  await expect(popup.getByText(/Saving to:\s*Spam Collection/)).toBeVisible();
  const saveBtn = popup.getByRole("button", { name: "Save this tab" });
  // Fire two clicks back-to-back without awaiting the first's effects —
  // this is the "double-click spam" scenario: does the busy/disabled guard
  // win the race, or does a second save slip through before React commits
  // the disabled state?
  await Promise.all([saveBtn.click(), saveBtn.click()]);
  await expect(popup.getByText(/Saved \d+ tabs? to Spam Collection/)).toBeVisible();

  // "spam-col" itself was raw-seeded before dashboard's first mount — reload
  // so its live query actually sees it (see e2e/README.md); the LINK the
  // popup just saved went through a real Dexie write (cross-tab reactive on
  // its own), but the collection row needs this same fresh-read treatment.
  await dashboard.reload();
  await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html#/c/spam-col`);
  const count = await dashboard.getByRole("listbox", { name: "Links" }).getByRole("option").count();
  expect(count).toBe(1);
  await popup.close();
});

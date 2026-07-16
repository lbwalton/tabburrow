import { test, expect } from "../fixtures";
import { collectConsoleErrors, computedBackground, finalScreenshot, tokenColor } from "../test-utils";

/**
 * T6 — WXT scaffold + manifest. Acceptance (stories/stories.json):
 *   - Extension loads in Chrome with no manifest errors
 *   - Popup opens showing a styled TabBurrow placeholder on ground #16241E
 *   - Dashboard opens as a full tab via chrome.runtime.getURL("dashboard.html")
 */

test("extension loads with no manifest errors and a resolvable service worker", async ({ extensionId }) => {
  // context/extensionId fixtures already prove the manifest parsed and the
  // background service worker registered (see fixtures.ts's extensionId
  // fixture: it waits on context.serviceWorkers()/the "serviceworker"
  // event) — a manifest.json syntax or permissions error would have made
  // that wait time out before this test body ever runs.
  expect(extensionId).toMatch(/^[a-p]{32}$/);
});

test("popup opens showing a styled TabBurrow placeholder on the ground background", async ({
  context,
  extensionId,
}) => {
  const popup = await context.newPage();
  const errors = await collectConsoleErrors(popup, async () => {
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.getByRole("heading", { name: "TabBurrow" }).waitFor();
  });

  const rootBg = await computedBackground(popup, "#root > div");
  const groundToken = await tokenColor(popup, "--bg-ground");
  expect(rootBg).toBe(groundToken);

  expect(errors).toEqual([]);
  await finalScreenshot(popup, "t06-popup-shell");
  await popup.close();
});

test("dashboard opens as a full tab via chrome.runtime.getURL(dashboard.html)", async ({
  extensionId,
  cleanDashboard,
}) => {
  const dashboard = cleanDashboard;
  expect(dashboard.url()).toBe(`chrome-extension://${extensionId}/dashboard.html`);
  // Empty DB (this test's own fresh slate, via cleanDashboard) -> the
  // illustrated empty state, not a blank pane.
  await expect(dashboard.getByText("Nothing here yet")).toBeVisible();
  await expect(dashboard.getByRole("navigation", { name: "Collections" })).toBeVisible();
  await finalScreenshot(dashboard, "t06-dashboard-shell");
});

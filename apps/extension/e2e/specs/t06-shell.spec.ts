import { test, expect } from "../fixtures";
import { collectConsoleErrors, computedBackground, finalScreenshot } from "../test-utils";

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
  // Intentionally pins the AC's literal expected value ("ground #16241E" ->
  // rgb(22, 36, 30)) rather than resolving var(--bg-ground) and comparing to
  // itself — that would be tautological (the token could drift to any color
  // and still pass). The repo's no-hardcoded-hex rule governs UI code, not
  // test EXPECTATIONS; this test's whole job is to fail loudly if the brand
  // token's value drifts from what T6's acceptance criterion specifies.
  expect(rootBg).toBe("rgb(22, 36, 30)");

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
  // No screenshot here: this exact view (fresh empty dashboard) is already
  // captured as t08-empty-state.png — a shot here was byte-identical to it.
  // t06-popup-shell.png is this spec's representative screenshot.
});

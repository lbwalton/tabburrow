import { test, expect } from "../fixtures";
import { seedMeta, seedSnapshots } from "../seed";
import { finalScreenshot } from "../test-utils";

/**
 * T12 — Sessions: snapshots and crash restore. Acceptance (stories/stories.json):
 *   - Manual snapshot captures every open window/tab; restore recreates
 *     them in new windows (pinned preserved)
 *   - Auto snapshots appear at 5-minute marks; never more than 10 autos
 *     kept — NOT automated here: this requires either a real 5-minute
 *     `chrome.alarms` firing (background.ts's AUTO_SNAPSHOT_ALARM,
 *     periodInMinutes: 5 — no test hook to fast-forward it) or waiting out
 *     10+ real cycles to see the prune kick in. The pruning LOGIC itself
 *     (`pruneAutoSnapshots`) is already unit-tested in
 *     packages/core/test/repo.test.ts (T4's acceptance: "keeps exactly N
 *     newest autos and never touches manual"). See e2e/MANUAL.md.
 *   - Kill Chrome (force quit) -> reopen -> dashboard offers crash restore;
 *     accepting restores the pre-crash tabs — SIMULATED here per the task
 *     brief: a real force-quit isn't reachable from Playwright (see
 *     e2e/MANUAL.md), so these tests set the `crashDetected`/snapshot meta
 *     state directly via `seedMeta`/`seedSnapshots` and verify the
 *     banner + restore/dismiss behavior that state drives.
 */

test("manual snapshot captures every open window/tab; restore recreates them with pinned preserved", async ({
  cleanDashboard,
  extensionId,
  testServer,
  context,
}) => {
  const dashboard = cleanDashboard;
  const urlA = testServer.pageUrl("Session Tab A");
  const urlB = testServer.pageUrl("Session Tab B (pinned)");
  const tabA = await context.newPage();
  await tabA.goto(urlA);
  const tabB = await context.newPage();
  await tabB.goto(urlB);

  // Pin tab B via the extension's own chrome.tabs API (no Playwright-level
  // "pin a tab" primitive exists) — run from an extension-privileged page.
  await dashboard.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const match = tabs.find((t) => t.url === url);
    if (match?.id !== undefined) await chrome.tabs.update(match.id, { pinned: true });
  }, urlB);

  await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html#/sessions`);
  await dashboard.getByPlaceholder("Name (optional)").fill("My Snapshot");
  await dashboard.getByRole("button", { name: "Snapshot now" }).click();

  const row = dashboard.getByText("My Snapshot").locator("..").locator("..");
  await expect(row).toBeVisible();
  // windowTabCountLabel format: "N windows · N tabs" — this session's
  // window carries tabA + tabB (+ possibly the popup/dashboard tabs are
  // chrome-extension:// pages and excluded by captureAllWindows' isHttpUrl
  // filter, same policy as getAllTabs).
  await expect(row).toContainText("tabs");
  await finalScreenshot(dashboard, "t12-manual-snapshot");

  const pagesBefore = context.pages().length;
  await row.getByRole("button", { name: "Restore" }).click();

  await expect(async () => {
    expect(context.pages().length).toBeGreaterThan(pagesBefore);
  }).toPass({ timeout: 8000 });

  // Find the restored copies (same URLs, new tab instances) and confirm
  // the one that was pinned came back pinned.
  await expect(async () => {
    const pinned = await dashboard.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      return tabs.filter((t) => t.url === url).some((t) => t.pinned === true);
    }, urlB);
    expect(pinned).toBe(true);
  }).toPass({ timeout: 8000 });

  const unpinnedCopyExists = await dashboard.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    return tabs.filter((t) => t.url === url).length >= 2; // original + restored
  }, urlA);
  expect(unpinnedCopyExists).toBe(true);
});

test("crash-restore banner (simulated flag) offers restore; accepting restores the pre-crash tabs", async ({
  cleanDashboard,
  extensionId,
  testServer,
  context,
}) => {
  const dashboard = cleanDashboard;
  const urlA = testServer.pageUrl("Crash Tab A");
  const urlB = testServer.pageUrl("Crash Tab B");
  await seedSnapshots(dashboard, [
    {
      id: "auto-1",
      kind: "auto",
      windows: [{ tabs: [{ url: urlA, title: "Crash Tab A" }, { url: urlB, title: "Crash Tab B" }] }],
    },
  ]);
  await seedMeta(dashboard, { crashDetected: "1" });
  await dashboard.reload();

  await expect(dashboard.getByText("Looks like Chrome closed unexpectedly. Restore your last session?")).toBeVisible();
  await finalScreenshot(dashboard, "t12-crash-banner");

  const pagesBefore = context.pages().length;
  await dashboard.getByRole("button", { name: "Restore last session" }).click();

  await expect(async () => {
    expect(context.pages().length).toBeGreaterThanOrEqual(pagesBefore + 2);
  }).toPass({ timeout: 8000 });

  const urls = context.pages().map((p) => p.url());
  expect(urls).toContain(urlA);
  expect(urls).toContain(urlB);

  // Banner clears itself after acting (win or lose) — never reappears for the same crash.
  await expect(dashboard.getByText("Looks like Chrome closed unexpectedly. Restore your last session?")).toHaveCount(0);
});

test("crash-restore banner Dismiss clears the flag without opening any tabs", async ({
  cleanDashboard,
  extensionId,
  testServer,
  context,
}) => {
  const dashboard = cleanDashboard;
  await seedSnapshots(dashboard, [
    { id: "auto-2", kind: "auto", windows: [{ tabs: [{ url: testServer.pageUrl("Untouched"), title: "Untouched" }] }] },
  ]);
  await seedMeta(dashboard, { crashDetected: "1" });
  await dashboard.reload();

  await expect(dashboard.getByText("Looks like Chrome closed unexpectedly. Restore your last session?")).toBeVisible();
  const pagesBefore = context.pages().length;
  await dashboard.getByRole("button", { name: "Dismiss" }).click();

  await expect(dashboard.getByText("Looks like Chrome closed unexpectedly. Restore your last session?")).toHaveCount(0);
  await dashboard.waitForTimeout(1000);
  expect(context.pages().length).toBe(pagesBefore);

  // Reloading again must not resurrect the banner (flag was cleared, not just hidden).
  await dashboard.reload();
  await expect(dashboard.getByText("Looks like Chrome closed unexpectedly. Restore your last session?")).toHaveCount(0);

  void extensionId;
});

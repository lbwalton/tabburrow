import { test, expect } from "../fixtures";
import { seedCollectionsAndLinks, seedPosition } from "../seed";
import { finalScreenshot } from "../test-utils";

/**
 * T10 — Restore + undo polish. Acceptance (stories/stories.json):
 *   - Restore-all on a 20-link collection asks first, then opens all 20
 *   - Restore-all <=15 opens immediately
 *   - Card click opens correct URL in new tab
 *   - Delete links -> Undo restores them with positions intact
 */

function linksFor(collectionId: string, count: number, testServer: { pageUrl(title: string): string }) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${collectionId}-link-${i}`,
    collectionId,
    url: testServer.pageUrl(`Restore Link ${i}`),
    title: `Restore Link ${i}`,
    position: seedPosition(i),
  }));
}

test("restore-all on a 20-link collection asks first, then opens all 20", async ({
  cleanDashboard,
  extensionId,
  testServer,
  context,
}) => {
  const dashboard = cleanDashboard;
  const collectionId = "big-collection";
  await seedCollectionsAndLinks(
    dashboard,
    [{ id: collectionId, name: "Big Collection", position: seedPosition(0) }],
    linksFor(collectionId, 20, testServer),
  );
  // Seeding writes straight to IndexedDB via a raw connection, bypassing
  // Dexie's change tracking — an already-mounted page's useLiveQuery never
  // sees it without a reload (fresh Dexie connection = fresh read). See
  // e2e/README.md.
  await dashboard.reload();
  await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html#/c/${collectionId}`);

  await dashboard.getByRole("button", { name: "Restore all" }).click();
  const dialog = dashboard.getByRole("dialog", { name: "Open 20 tabs?" });
  await expect(dialog).toBeVisible();

  const opened: string[] = [];
  context.on("page", (p) => opened.push(p.url()));
  await dialog.getByRole("button", { name: "Open 20 tabs" }).click();

  await expect(async () => {
    expect(opened.length).toBeGreaterThanOrEqual(20);
  }).toPass({ timeout: 10_000 });

  for (const p of context.pages()) {
    if (p.url().includes("Restore%20Link")) await p.close().catch(() => {});
  }
});

test("restore-all with 10 links (<=15) opens immediately, no confirm dialog", async ({
  cleanDashboard,
  extensionId,
  testServer,
  context,
}) => {
  const dashboard = cleanDashboard;
  const collectionId = "small-collection";
  await seedCollectionsAndLinks(
    dashboard,
    [{ id: collectionId, name: "Small Collection", position: seedPosition(0) }],
    linksFor(collectionId, 10, testServer),
  );
  // Seeding writes straight to IndexedDB via a raw connection, bypassing
  // Dexie's change tracking — an already-mounted page's useLiveQuery never
  // sees it without a reload (fresh Dexie connection = fresh read). See
  // e2e/README.md.
  await dashboard.reload();
  await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html#/c/${collectionId}`);

  const opened: string[] = [];
  context.on("page", (p) => opened.push(p.url()));
  await dashboard.getByRole("button", { name: "Restore all" }).click();
  await expect(dashboard.getByRole("dialog")).toHaveCount(0);

  await expect(async () => {
    expect(opened.length).toBeGreaterThanOrEqual(10);
  }).toPass({ timeout: 8_000 });

  for (const p of context.pages()) {
    if (p.url().includes("Restore%20Link")) await p.close().catch(() => {});
  }
});

test("clicking a card opens its exact URL in a new (background) tab", async ({
  cleanDashboard,
  extensionId,
  testServer,
}) => {
  const dashboard = cleanDashboard;
  const collectionId = "click-collection";
  const targetUrl = testServer.pageUrl("Click Target");
  await seedCollectionsAndLinks(
    dashboard,
    [{ id: collectionId, name: "Click Collection", position: seedPosition(0) }],
    [{ id: "click-link", collectionId, url: targetUrl, title: "Click Target", position: seedPosition(0) }],
  );
  // Seeding writes straight to IndexedDB via a raw connection, bypassing
  // Dexie's change tracking — an already-mounted page's useLiveQuery never
  // sees it without a reload (fresh Dexie connection = fresh read). See
  // e2e/README.md.
  await dashboard.reload();
  await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html#/c/${collectionId}`);

  const [newPage] = await Promise.all([
    dashboard.context().waitForEvent("page"),
    dashboard.getByRole("option", { name: /Click Target/ }).click(),
  ]);
  await newPage.waitForLoadState();
  expect(newPage.url()).toBe(targetUrl);
  // Dashboard tab keeps focus — the opened tab is a BACKGROUND tab (open
  // links never steal focus in this app); we can't assert OS-level focus
  // headlessly, but the dashboard itself must still be interactive.
  await expect(dashboard.getByRole("heading", { name: "Click Collection" })).toBeVisible();
  await newPage.close();
  await finalScreenshot(dashboard, "t10-card-click-open");
});

test("deleting links then Undo restores them with positions intact", async ({
  cleanDashboard,
  extensionId,
  testServer,
}) => {
  const dashboard = cleanDashboard;
  const collectionId = "undo-collection";
  await seedCollectionsAndLinks(
    dashboard,
    [{ id: collectionId, name: "Undo Collection", position: seedPosition(0) }],
    linksFor(collectionId, 4, testServer),
  );
  // Seeding writes straight to IndexedDB via a raw connection, bypassing
  // Dexie's change tracking — an already-mounted page's useLiveQuery never
  // sees it without a reload (fresh Dexie connection = fresh read). See
  // e2e/README.md.
  await dashboard.reload();
  await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html#/c/${collectionId}`);

  const grid = dashboard.getByRole("listbox", { name: "Links" });
  await expect(grid.getByRole("option")).toHaveCount(4);
  const before = await grid.getByRole("option").allTextContents();

  // Select the middle two links (index 1, 2) and bulk-delete them. A plain
  // click OPENS a card (clickIntent's default) — toggle-click (cmd/ctrl)
  // sets the anchor, then shift-click ranges from it.
  await grid.getByRole("option").nth(1).click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
  await grid.getByRole("option").nth(2).click({ modifiers: ["Shift"] });
  await dashboard.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(grid.getByRole("option")).toHaveCount(2);
  await expect(dashboard.getByText("Deleted 2 links")).toBeVisible();

  await dashboard.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(grid.getByRole("option")).toHaveCount(4);
  const after = await grid.getByRole("option").allTextContents();
  expect(after).toEqual(before); // positions intact -> identical order restored
});

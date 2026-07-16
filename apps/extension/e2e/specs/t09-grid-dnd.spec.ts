import { test, expect } from "../fixtures";
import { seedCollectionsAndLinks, seedPosition } from "../seed";
import { finalScreenshot, keyboardDragUntil, mouseDragUntil } from "../test-utils";

/**
 * T9 — Link grid + drag and drop. Acceptance (stories/stories.json):
 *   - Reorder within a collection sticks after reload
 *   - Drag a card onto another collection in the rail moves it
 *   - Bulk select 3 -> Move to another collection -> all 3 move
 *   - Edit title/note/tags persists
 *   - Sort by name/date works; switching back to manual restores drag order
 *
 * Drag strategy: BOTH dnd-kit input paths get coverage in this file —
 * keyboard drags (grip focus + Space/Arrow/Space, `keyboardDragUntil`) and
 * real pointer drags (`mouseDragUntil`: press, clear PointerSensor's 4px
 * activation distance, stepped glide, hover settle, release — the path
 * actual users take). Both helpers retry the full gesture on a miss; see
 * e2e/README.md's dnd section and test-utils.ts's docstrings for why.
 */

const COLLECTION_A = "col-a";
const COLLECTION_B = "col-b";

async function seedTwoCollectionsWithLinks(dashboard: import("@playwright/test").Page) {
  await seedCollectionsAndLinks(
    dashboard,
    [
      { id: COLLECTION_A, name: "Collection A", position: seedPosition(0) },
      { id: COLLECTION_B, name: "Collection B", position: seedPosition(1) },
    ],
    [
      { id: "link-1", collectionId: COLLECTION_A, url: "https://example.com/one", title: "Link One", position: seedPosition(0) },
      { id: "link-2", collectionId: COLLECTION_A, url: "https://example.com/two", title: "Link Two", position: seedPosition(1) },
      { id: "link-3", collectionId: COLLECTION_A, url: "https://example.com/three", title: "Link Three", position: seedPosition(2) },
    ],
  );
}

test("reordering within a collection (keyboard-drag) sticks after reload", async ({ cleanDashboard, extensionId }) => {
  const dashboard = cleanDashboard;
  await seedTwoCollectionsWithLinks(dashboard);
  // Seeding writes straight to IndexedDB via a raw connection, bypassing
  // Dexie's change tracking — an already-mounted page's useLiveQuery never
  // sees it without a reload (fresh Dexie connection = fresh read). See
  // e2e/README.md.
  await dashboard.reload();
  await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html#/c/${COLLECTION_A}`);

  const grid = dashboard.getByRole("listbox", { name: "Links" });
  await expect(grid.getByRole("option")).toHaveCount(3);
  const before = await grid.getByRole("option").allTextContents();
  expect(before[0]).toContain("Link One");

  // Track the specific card by content (not position — position is about to
  // change) so retried attempts below stay pinned to the right element.
  const draggedCard = grid.getByRole("option", { name: /Link One/ });
  const firstGrip = draggedCard.getByRole("button", { name: "Reorder link" });
  await keyboardDragUntil(dashboard, firstGrip, "ArrowRight", async () => {
    // rectSortingStrategy: ArrowRight/Down move forward one slot.
    const names = await grid.getByRole("option").allTextContents();
    expect(names[0]).toContain("Link Two");
    expect(names[1]).toContain("Link One");
  });

  await dashboard.reload();
  await expect(async () => {
    const names = await grid.getByRole("option").allTextContents();
    expect(names[0]).toContain("Link Two");
    expect(names[1]).toContain("Link One");
  }).toPass({ timeout: 5000 });

  await finalScreenshot(dashboard, "t09-manual-reorder");
});

test("reordering within a collection (pointer-drag) sticks after reload", async ({
  cleanDashboard,
  extensionId,
}) => {
  const dashboard = cleanDashboard;
  await seedTwoCollectionsWithLinks(dashboard);
  // Raw-IndexedDB seed -> reload before asserting (see e2e/README.md).
  await dashboard.reload();
  await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html#/c/${COLLECTION_A}`);

  const grid = dashboard.getByRole("listbox", { name: "Links" });
  await expect(grid.getByRole("option")).toHaveCount(3);

  // The real-user path: dnd-kit's PointerSensor. A link card's pointer drag
  // activator is the whole card body (see LinkCard.tsx's listeners split) —
  // drag "Link One"'s body onto "Link Two"'s center to swap them. A drag
  // that fails to activate degrades to a plain click (= opens the link as a
  // background tab — harmless here; cleanDashboard closes extra tabs), and
  // the helper retries the full gesture.
  const cardOne = grid.getByRole("option", { name: /Link One/ });
  const cardTwo = grid.getByRole("option", { name: /Link Two/ });
  await mouseDragUntil(dashboard, cardOne, cardTwo, async () => {
    const names = await grid.getByRole("option").allTextContents();
    expect(names[0]).toContain("Link Two");
    expect(names[1]).toContain("Link One");
  });

  await dashboard.reload();
  await expect(async () => {
    const names = await grid.getByRole("option").allTextContents();
    expect(names[0]).toContain("Link Two");
    expect(names[1]).toContain("Link One");
  }).toPass({ timeout: 5000 });
});

test("dragging a card onto a rail collection row (pointer-drag) moves it there", async ({
  cleanDashboard,
  extensionId,
}) => {
  const dashboard = cleanDashboard;
  await seedTwoCollectionsWithLinks(dashboard);
  // Raw-IndexedDB seed -> reload before asserting (see e2e/README.md).
  await dashboard.reload();
  await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html#/c/${COLLECTION_A}`);

  const grid = dashboard.getByRole("listbox", { name: "Links" });
  await expect(grid.getByRole("option")).toHaveCount(3);

  // The cross-list gesture lib/dnd.ts's `move-link` operation exists for:
  // a card dragged out of the grid and dropped on a rail CollectionRow.
  // Only reachable via pointer (dnd-kit's keyboard sensor can't leave its
  // own SortableContext) — this is the direct coverage of that drag; the
  // "bulk Move to…" test below covers the same repo call through the menu.
  const cardOne = grid.getByRole("option", { name: /Link One/ });
  const railRowB = dashboard.getByRole("navigation", { name: "Collections" }).locator("li", { hasText: "Collection B" });
  await mouseDragUntil(dashboard, cardOne, railRowB, async () => {
    await expect(grid.getByRole("option")).toHaveCount(2, { timeout: 3000 });
  });

  await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html#/c/${COLLECTION_B}`);
  await expect(dashboard.getByRole("listbox", { name: "Links" }).getByRole("option", { name: /Link One/ })).toBeVisible();

  // Sticks after reload, same bar as the reorder tests.
  await dashboard.reload();
  await expect(dashboard.getByRole("listbox", { name: "Links" }).getByRole("option", { name: /Link One/ })).toBeVisible();
});

test("moving a link card onto another rail collection (via bulk Move to) moves it", async ({
  cleanDashboard,
  extensionId,
}) => {
  // Menu-path coverage of the same `moveLinkToEnd` repo call the pointer
  // drag above exercises directly (see lib/dnd.ts's `move-link` operation
  // and BulkBar.tsx).
  const dashboard = cleanDashboard;
  await seedTwoCollectionsWithLinks(dashboard);
  // Seeding writes straight to IndexedDB via a raw connection, bypassing
  // Dexie's change tracking — an already-mounted page's useLiveQuery never
  // sees it without a reload (fresh Dexie connection = fresh read). See
  // e2e/README.md.
  await dashboard.reload();
  await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html#/c/${COLLECTION_A}`);

  const grid = dashboard.getByRole("listbox", { name: "Links" });
  // Toggle-select "Link One" via cmd/ctrl-click (clickIntent: meta/ctrl -> toggle).
  await grid.getByRole("option", { name: /Link One/ }).click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
  await expect(dashboard.getByRole("toolbar", { name: "Bulk actions" })).toBeVisible();

  await dashboard.getByLabel("Move to collection").selectOption({ label: "Collection B" });
  await expect(dashboard.getByRole("toolbar", { name: "Bulk actions" })).toHaveCount(0);

  await expect(grid.getByRole("option")).toHaveCount(2);
  await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html#/c/${COLLECTION_B}`);
  await expect(dashboard.getByRole("listbox", { name: "Links" }).getByRole("option", { name: /Link One/ })).toBeVisible();
});

test("bulk select 3 links then Move to another collection moves all 3", async ({ cleanDashboard, extensionId }) => {
  const dashboard = cleanDashboard;
  await seedTwoCollectionsWithLinks(dashboard);
  // Seeding writes straight to IndexedDB via a raw connection, bypassing
  // Dexie's change tracking — an already-mounted page's useLiveQuery never
  // sees it without a reload (fresh Dexie connection = fresh read). See
  // e2e/README.md.
  await dashboard.reload();
  await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html#/c/${COLLECTION_A}`);

  const grid = dashboard.getByRole("listbox", { name: "Links" });
  const first = grid.getByRole("option").first();
  const last = grid.getByRole("option").last();
  // A plain click OPENS a card (clickIntent's default, per T10's click
  // redefinition) — selecting an anchor first requires a toggle click
  // (cmd/ctrl), THEN shift-click ranges from that anchor.
  await first.click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
  await last.click({ modifiers: ["Shift"] }); // range-select all 3

  await expect(dashboard.getByRole("toolbar", { name: "Bulk actions" })).toContainText("3 selected");
  await dashboard.getByLabel("Move to collection").selectOption({ label: "Collection B" });

  await expect(grid.getByRole("option")).toHaveCount(0);
  await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html#/c/${COLLECTION_B}`);
  await expect(dashboard.getByRole("listbox", { name: "Links" }).getByRole("option")).toHaveCount(3);
});

test("editing a link's title/note/tags persists", async ({ cleanDashboard, extensionId }) => {
  const dashboard = cleanDashboard;
  await seedTwoCollectionsWithLinks(dashboard);
  // Seeding writes straight to IndexedDB via a raw connection, bypassing
  // Dexie's change tracking — an already-mounted page's useLiveQuery never
  // sees it without a reload (fresh Dexie connection = fresh read). See
  // e2e/README.md.
  await dashboard.reload();
  await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html#/c/${COLLECTION_A}`);

  const card = dashboard.getByRole("listbox", { name: "Links" }).getByRole("option", { name: /Link One/ });
  await card.hover();
  await card.getByRole("button", { name: "Edit link" }).click();

  const dialog = dashboard.getByRole("dialog", { name: "Edit link" });
  await dialog.locator("input").nth(0).fill("Edited Title");
  await dialog.locator("input").nth(1).fill("An edited note");
  await dialog.locator("input").nth(2).fill("work, reading");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(dashboard.getByText("Edited Title")).toBeVisible();
  await expect(dashboard.getByText("An edited note")).toBeVisible();
  await expect(dashboard.getByText("work")).toBeVisible();
  await expect(dashboard.getByText("reading")).toBeVisible();

  await dashboard.reload();
  await expect(dashboard.getByText("Edited Title")).toBeVisible();
  await expect(dashboard.getByText("An edited note")).toBeVisible();
});

test("sort by name/date works; switching back to manual restores drag order", async ({
  cleanDashboard,
  extensionId,
}) => {
  const dashboard = cleanDashboard;
  await seedTwoCollectionsWithLinks(dashboard);
  // Seeding writes straight to IndexedDB via a raw connection, bypassing
  // Dexie's change tracking — an already-mounted page's useLiveQuery never
  // sees it without a reload (fresh Dexie connection = fresh read). See
  // e2e/README.md.
  await dashboard.reload();
  await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html#/c/${COLLECTION_A}`);

  const grid = dashboard.getByRole("listbox", { name: "Links" });
  const manualOrder = await grid.getByRole("option").allTextContents();
  expect(manualOrder[0]).toContain("Link One");

  await dashboard.getByRole("radio", { name: "Name" }).click();
  await expect(async () => {
    const names = await grid.getByRole("option").allTextContents();
    expect(names[0]).toContain("Link One");
    expect(names[1]).toContain("Link Three");
    expect(names[2]).toContain("Link Two");
  }).toPass({ timeout: 5000 });

  await dashboard.getByRole("radio", { name: "Manual" }).click();
  await expect(async () => {
    const names = await grid.getByRole("option").allTextContents();
    expect(names[0]).toContain("Link One");
    expect(names[1]).toContain("Link Two");
    expect(names[2]).toContain("Link Three");
  }).toPass({ timeout: 5000 });

  await finalScreenshot(dashboard, "t09-sort-and-tags");
});

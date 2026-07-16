import { test, expect } from "../fixtures";
import { finalScreenshot, keyboardDragUntil, mouseDragUntil } from "../test-utils";

/**
 * T8 — Dashboard shell: rail + collections. Acceptance (stories/stories.json):
 *   - Create, rename (inline), recolor, delete-with-undo all work and
 *     persist across browser restart
 *   - Drag a collection to a new rail position; order survives reload
 *   - Empty dashboard shows illustrated empty state (burrow arch motif,
 *     token colors), not a blank pane
 */

async function createCollection(dashboard: import("@playwright/test").Page, name: string) {
  await dashboard.getByRole("button", { name: "+ New collection" }).click();
  await dashboard.getByPlaceholder("Collection name").fill(name);
  await dashboard.getByRole("button", { name: "Create" }).click();
}

test("empty dashboard shows the illustrated empty state, not a blank pane", async ({ cleanDashboard }) => {
  await expect(cleanDashboard.getByText("Nothing here yet")).toBeVisible();
  await expect(cleanDashboard.getByText("Create a collection to start saving tabs from the popup.")).toBeVisible();
  // BurrowIllustration is built from styled divs (aria-hidden, no text) —
  // assert it's actually present, not just the empty-state copy.
  await expect(cleanDashboard.locator('main [aria-hidden="true"]').first()).toBeVisible();
  await finalScreenshot(cleanDashboard, "t08-empty-state");
});

test("create, inline rename, recolor, and delete-with-undo all work and persist across a reload", async ({
  cleanDashboard,
  extensionId,
  context,
}) => {
  const dashboard = cleanDashboard;

  // --- Create ---
  await createCollection(dashboard, "Groceries");
  const row = dashboard.getByRole("navigation", { name: "Collections" }).getByText("Groceries", { exact: true });
  await expect(row).toBeVisible();

  // --- Inline rename (double-click the rail row name) ---
  await row.dblclick();
  const renameInput = dashboard.getByRole("navigation", { name: "Collections" }).locator("input");
  await renameInput.fill("Weekly Groceries");
  await renameInput.press("Enter");
  await expect(
    dashboard.getByRole("navigation", { name: "Collections" }).getByText("Weekly Groceries", { exact: true }),
  ).toBeVisible();

  // --- Recolor --- (the picker closes itself the instant a swatch is
  // chosen — onChoose immediately calls setAccentOpen(false) — so the only
  // thing left to assert afterward is the row's own accent dot changing,
  // not the picker's now-unmounted "pressed" swatch state)
  const dot = dashboard.getByRole("navigation", { name: "Collections" }).locator(".rounded-full").first();
  const dotColorBefore = await dot.evaluate((el) => getComputedStyle(el).backgroundColor);
  await dashboard.getByRole("button", { name: "Choose accent" }).click();
  const swatch = dashboard.locator('[aria-label^="Accent:"]').first();
  await swatch.click();
  await expect(async () => {
    const dotColorAfter = await dot.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(dotColorAfter).not.toBe(dotColorBefore);
  }).toPass({ timeout: 5000 });

  // --- Persist across reload (simulates "survives browser restart": same
  // profile/IndexedDB, fresh document load) ---
  await dashboard.reload();
  await expect(
    dashboard.getByRole("navigation", { name: "Collections" }).getByText("Weekly Groceries", { exact: true }),
  ).toBeVisible();

  // Representative screenshot captured HERE — created + renamed + recolored
  // collection visible, post-reload — not after the delete below (which
  // would just duplicate t08-empty-state).
  await finalScreenshot(dashboard, "t08-rail-crud");

  // --- Delete with undo ---
  await dashboard.getByRole("button", { name: "Delete collection" }).click();
  await expect(dashboard.getByText('"Weekly Groceries" deleted')).toBeVisible();
  await dashboard.getByRole("button", { name: "Undo" }).click();
  await expect(
    dashboard.getByRole("navigation", { name: "Collections" }).getByText("Weekly Groceries", { exact: true }),
  ).toBeVisible();

  // Delete for real (no undo) and confirm it survives a reload too.
  await dashboard.getByRole("button", { name: "Delete collection" }).click();
  await expect(dashboard.getByText('"Weekly Groceries" deleted')).toBeVisible();
  await dashboard.reload();
  await expect(dashboard.getByText("Nothing here yet")).toBeVisible();

  void extensionId;
  void context;
});

test("dragging a collection to a new rail position persists after reload (keyboard-drag path)", async ({
  cleanDashboard,
}) => {
  const dashboard = cleanDashboard;
  await createCollection(dashboard, "Alpha");
  await createCollection(dashboard, "Beta");
  await createCollection(dashboard, "Gamma");

  const rail = dashboard.getByRole("navigation", { name: "Collections" });
  await expect(rail.locator("li")).toHaveCount(3);
  const namesBefore = await rail.locator("li").allTextContents();
  expect(namesBefore.some((t) => t.includes("Alpha"))).toBe(true);

  // dnd-kit's keyboard-drag path (per e2e/README.md's dnd strategy): focus
  // the first row's grip, Space to pick up, ArrowDown to move it past the
  // next row, Space to drop. This moves "Alpha" (row 0) to row 1 (after "Beta").
  // Track the row by content (not position — position is about to change).
  const draggedRow = rail.locator("li", { hasText: "Alpha" });
  const firstGrip = draggedRow.getByRole("button", { name: "Reorder collection" });
  await keyboardDragUntil(dashboard, firstGrip, "ArrowDown", async () => {
    const names = await rail.locator("li").allTextContents();
    expect(names[0]).toContain("Beta");
    expect(names[1]).toContain("Alpha");
  });

  await dashboard.reload();
  await expect(async () => {
    const names = await rail.locator("li").allTextContents();
    expect(names[0]).toContain("Beta");
    expect(names[1]).toContain("Alpha");
  }).toPass({ timeout: 5000 });
});

test("dragging a collection to a new rail position persists after reload (pointer-drag path)", async ({
  cleanDashboard,
}) => {
  const dashboard = cleanDashboard;
  await createCollection(dashboard, "Alpha");
  await createCollection(dashboard, "Beta");
  await createCollection(dashboard, "Gamma");

  const rail = dashboard.getByRole("navigation", { name: "Collections" });
  await expect(rail.locator("li")).toHaveCount(3);

  // The real-user path: dnd-kit's PointerSensor (4px activation distance).
  // A collection row's pointer drag activator is its grip button (⠿) —
  // hover-revealed, but present in layout, so its bounding box is valid.
  // Track rows by content, not index (positions are about to change).
  const alphaRow = rail.locator("li", { hasText: "Alpha" });
  const betaRow = rail.locator("li", { hasText: "Beta" });
  const alphaGrip = alphaRow.getByRole("button", { name: "Reorder collection" });
  await mouseDragUntil(dashboard, alphaGrip, betaRow, async () => {
    const names = await rail.locator("li").allTextContents();
    expect(names[0]).toContain("Beta");
    expect(names[1]).toContain("Alpha");
  });

  await dashboard.reload();
  await expect(async () => {
    const names = await rail.locator("li").allTextContents();
    expect(names[0]).toContain("Beta");
    expect(names[1]).toContain("Alpha");
  }).toPass({ timeout: 5000 });
});

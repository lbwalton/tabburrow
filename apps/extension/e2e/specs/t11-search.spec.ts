import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import { seedCollectionsAndLinks, seedPosition } from "../seed";
import { finalScreenshot } from "../test-utils";

/**
 * T11 — Search. Acceptance (stories/stories.json):
 *   - Fuzzy match: gthb finds github links
 *   - Result click (link -> opens URL; collection -> routes to it)
 *   - Keyboard-only flow works end to end in overlay
 */

const MOD = process.platform === "darwin" ? "Meta" : "Control";

/**
 * Opens the dashboard's global search overlay via Cmd/Ctrl+K. A plain
 * `page.keyboard.press` immediately after a reload/dialog-close was
 * observed intermittently NOT reaching the page's global keydown listener
 * across repeated full-suite runs (a real-page-focus race, not a product
 * bug) — a body click first, plus a couple of retries, makes this reliable
 * without weakening what's being tested (the actual open path is unchanged).
 */
async function openSearchOverlay(page: Page) {
  await expect(async () => {
    await page.locator("body").click();
    await page.keyboard.press(`${MOD}+k`);
    await expect(page.getByRole("dialog", { name: "Search" })).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 8000 });
}

async function seedSearchFixtures(dashboard: Page) {
  await seedCollectionsAndLinks(
    dashboard,
    [
      { id: "dev-stuff", name: "Dev Stuff", position: seedPosition(0) },
      { id: "recipes", name: "Recipes", position: seedPosition(1) },
    ],
    [
      { id: "gh-link", collectionId: "dev-stuff", url: "https://github.com/tabburrow/tabburrow", title: "GitHub - tabburrow/tabburrow", position: seedPosition(0) },
      { id: "docs-link", collectionId: "dev-stuff", url: "https://developer.mozilla.org/docs", title: "MDN Web Docs", position: seedPosition(1) },
      { id: "recipe-link", collectionId: "recipes", url: "https://example.com/pancakes", title: "Fluffy Pancakes", position: seedPosition(0) },
    ],
  );
}

test("fuzzy match 'gthb' finds the GitHub link", async ({ cleanDashboard, extensionId }) => {
  const dashboard = cleanDashboard;
  await seedSearchFixtures(dashboard);
  // Seeding writes straight to IndexedDB via a raw connection, bypassing
  // Dexie's change tracking — reload so the already-mounted page's
  // useLiveQuery picks it up (fresh Dexie connection = fresh read). See
  // e2e/README.md.
  await dashboard.reload();

  await openSearchOverlay(dashboard);
  await dashboard.getByRole("combobox", { name: "Search collections and links" }).fill("gthb");

  const results = dashboard.getByRole("listbox", { name: "Search results" });
  await expect(results.getByRole("option", { name: /GitHub/ })).toBeVisible();
  await expect(results.getByRole("option", { name: /Fluffy Pancakes/ })).toHaveCount(0);
  await finalScreenshot(dashboard, "t11-fuzzy-search");
});

test("clicking a link result opens its URL; clicking a collection result routes to it", async ({
  cleanDashboard,
  extensionId,
}) => {
  const dashboard = cleanDashboard;
  await seedSearchFixtures(dashboard);
  // Seeding writes straight to IndexedDB via a raw connection, bypassing
  // Dexie's change tracking — reload so the already-mounted page's
  // useLiveQuery picks it up (fresh Dexie connection = fresh read). See
  // e2e/README.md.
  await dashboard.reload();

  // --- Link result -> opens the URL as a background tab ---
  await openSearchOverlay(dashboard);
  await dashboard.getByRole("combobox", { name: "Search collections and links" }).fill("pancakes");
  const results = dashboard.getByRole("listbox", { name: "Search results" });
  const [newPage] = await Promise.all([
    dashboard.context().waitForEvent("page"),
    results.getByRole("option", { name: /Fluffy Pancakes/ }).click(),
  ]);
  await newPage.waitForLoadState();
  expect(newPage.url()).toBe("https://example.com/pancakes");
  await newPage.close();
  await expect(dashboard.getByRole("dialog", { name: "Search" })).toHaveCount(0);

  // --- Collection result -> routes the dashboard to it ---
  await openSearchOverlay(dashboard);
  await dashboard.getByRole("combobox", { name: "Search collections and links" }).fill("Recipes");
  await dashboard.getByRole("listbox", { name: "Search results" }).getByRole("option", { name: "Recipes" }).click();
  await expect(dashboard).toHaveURL(/#\/c\/recipes$/);
  await expect(dashboard.getByRole("heading", { name: "Recipes" })).toBeVisible();
});

test("keyboard-only flow works end to end in the overlay (open, navigate, activate)", async ({
  cleanDashboard,
  extensionId,
}) => {
  const dashboard = cleanDashboard;
  await seedSearchFixtures(dashboard);
  // Seeding writes straight to IndexedDB via a raw connection, bypassing
  // Dexie's change tracking — reload so the already-mounted page's
  // useLiveQuery picks it up (fresh Dexie connection = fresh read). See
  // e2e/README.md.
  await dashboard.reload();

  await openSearchOverlay(dashboard);
  await expect(dashboard.getByRole("combobox", { name: "Search collections and links" })).toBeFocused();

  await dashboard.keyboard.type("e"); // matches multiple: "Dev Stuff"'s links + "Recipes" collection etc.
  await expect(dashboard.getByRole("listbox", { name: "Search results" }).getByRole("option").first()).toBeVisible();

  await dashboard.keyboard.press("ArrowDown");
  await dashboard.keyboard.press("ArrowDown");
  await dashboard.keyboard.press("Escape");
  await expect(dashboard.getByRole("dialog", { name: "Search" })).toHaveCount(0);

  // Re-open, type an unambiguous query, Enter activates the sole result.
  await openSearchOverlay(dashboard);
  await dashboard.keyboard.type("Fluffy Pancakes");
  await expect(dashboard.getByRole("listbox", { name: "Search results" }).getByRole("option")).toHaveCount(1);
  const [newPage] = await Promise.all([dashboard.context().waitForEvent("page"), dashboard.keyboard.press("Enter")]);
  await newPage.waitForLoadState();
  expect(newPage.url()).toBe("https://example.com/pancakes");
  await newPage.close();
});

import type { BrowserContext, Page } from "@playwright/test";
import { test, expect, popupPage } from "../fixtures";
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

/* ------------------------------------------------------------------------ *
 * #17 — cross-folder search -> select -> open-all.
 *
 * The driving case: folders are one-per-client, but the axis that matters
 * today is the TOPIC. Search "meta business", see every client's copy, and
 * open the ones you want in a single click.
 * ------------------------------------------------------------------------ */

/** Three client folders that each hold the same topic link, plus a decoy that must never match. */
async function seedClientFolders(dashboard: Page) {
  await seedCollectionsAndLinks(
    dashboard,
    [
      { id: "client-acme", name: "Acme", position: seedPosition(0) },
      { id: "client-globex", name: "Globex", position: seedPosition(1) },
      { id: "client-initech", name: "Initech", position: seedPosition(2) },
    ],
    [
      { id: "acme-meta", collectionId: "client-acme", url: "https://example.com/acme-meta", title: "Meta Business Manager", position: seedPosition(0) },
      { id: "globex-meta", collectionId: "client-globex", url: "https://example.com/globex-meta", title: "Meta Business Manager", position: seedPosition(0) },
      { id: "initech-meta", collectionId: "client-initech", url: "https://example.com/initech-meta", title: "Meta Business Manager", position: seedPosition(0) },
      { id: "acme-decoy", collectionId: "client-acme", url: "https://example.com/acme-invoices", title: "Invoices", position: seedPosition(1) },
    ],
  );
  await dashboard.reload();
}

test("dashboard: each cross-folder result names its client, and ticking opens only those", async ({
  cleanDashboard,
  extensionId,
}) => {
  const dashboard = cleanDashboard;
  await seedClientFolders(dashboard);

  await openSearchOverlay(dashboard);
  await dashboard.getByRole("combobox", { name: "Search collections and links" }).fill("meta business");

  const results = dashboard.getByRole("listbox", { name: "Search results" });
  await expect(results.getByRole("option", { name: /Meta Business Manager/ })).toHaveCount(3);
  await expect(results.getByRole("option", { name: /Invoices/ })).toHaveCount(0);

  // Three identically-titled links are only tellable apart by their folder —
  // the whole point of showing collectionName inline.
  await expect(results.getByRole("option", { name: /Acme/ })).toHaveCount(1);
  await expect(results.getByRole("option", { name: /Globex/ })).toHaveCount(1);
  await expect(results.getByRole("option", { name: /Initech/ })).toHaveCount(1);

  // With nothing ticked the button offers every match...
  await expect(dashboard.getByRole("button", { name: "Open all 3" })).toBeVisible();

  // ...and ticking narrows it to exactly the ticked rows.
  const checkboxes = dashboard.getByRole("checkbox", { name: "Select Meta Business Manager" });
  await checkboxes.nth(0).click();
  await checkboxes.nth(2).click();
  await expect(dashboard.getByText("2 selected")).toBeVisible();
  // Exactly the first and third, with the middle row untouched — the count
  // alone can't tell "the two I clicked" from "some two".
  await expect(checkboxes.nth(0)).toHaveAttribute("aria-checked", "true");
  await expect(checkboxes.nth(1)).toHaveAttribute("aria-checked", "false");
  await expect(checkboxes.nth(2)).toHaveAttribute("aria-checked", "true");
  await finalScreenshot(dashboard, "t11-cross-folder-select");

  const before = dashboard.context().pages().length;
  await dashboard.getByRole("button", { name: "Open 2" }).click();
  await expect.poll(() => dashboard.context().pages().length, { timeout: 10_000 }).toBe(before + 2);

  const opened = dashboard
    .context()
    .pages()
    .map((p) => p.url())
    .filter((u) => u.includes("-meta"));
  // The first and third rows, not the second — proves the tick drove it.
  expect(opened.sort()).toEqual(["https://example.com/acme-meta", "https://example.com/initech-meta"]);
});

test("dashboard: a big open-all confirms before opening, and can be cancelled", async ({
  cleanDashboard,
  extensionId,
}) => {
  const dashboard = cleanDashboard;
  // 16 matches — one past RESTORE_CONFIRM_THRESHOLD (15), the same boundary
  // the collection header's "Restore all" already confirms at.
  await seedCollectionsAndLinks(
    dashboard,
    [{ id: "many", name: "Many", position: seedPosition(0) }],
    Array.from({ length: 16 }, (_, i) => ({
      id: `many-${i}`,
      collectionId: "many",
      url: `https://example.com/zqxtopic-${i}`,
      title: `Zqxtopic ${i}`,
      position: seedPosition(i),
    })),
  );
  await dashboard.reload();

  await openSearchOverlay(dashboard);
  await dashboard.getByRole("combobox", { name: "Search collections and links" }).fill("zqxtopic");

  // Scoped to the search dialog throughout: RestoreAllButton's own confirm
  // dialog is mounted unconditionally on the dashboard and, for a 16-link
  // collection, carries the very same "Open 16 tabs?" title (the shared
  // threshold copy this feature deliberately reuses). Unscoped locators would
  // match that hidden dialog too.
  const overlay = dashboard.getByRole("dialog", { name: "Search" });
  const before = dashboard.context().pages().length;
  await overlay.getByRole("button", { name: "Open all 16" }).click();

  // First click confirms rather than opening.
  await expect(overlay.getByText("Open 16 tabs?", { exact: true })).toBeVisible();
  await expect(overlay.getByRole("button", { name: "Open 16 tabs" })).toBeVisible();
  expect(dashboard.context().pages().length).toBe(before);

  // Cancel backs out with nothing opened.
  await overlay.getByRole("button", { name: "Cancel" }).click();
  await expect(overlay.getByRole("button", { name: "Open all 16" })).toBeVisible();
  expect(dashboard.context().pages().length).toBe(before);
});

test("popup: search results name their client folder and open together", async ({
  context,
  extensionId,
  cleanDashboard,
}) => {
  await seedClientFolders(cleanDashboard);

  const popup = await openPopupSearch(context, extensionId, "meta business");

  // The folder label the popup previously did NOT show — without it, three
  // identically-titled rows are indistinguishable here.
  await expect(popup.getByRole("option", { name: /Acme/ })).toHaveCount(1);
  await expect(popup.getByRole("option", { name: /Globex/ })).toHaveCount(1);
  await finalScreenshot(popup, "t11-popup-cross-folder-search");

  const before = context.pages().length;
  await popup.getByRole("button", { name: "Open all 3" }).click();
  await expect.poll(() => context.pages().length, { timeout: 10_000 }).toBe(before + 3);
});

/** Opens the popup, reveals the search box, and runs `query`. */
async function openPopupSearch(context: BrowserContext, extensionId: string, query: string): Promise<Page> {
  const popup = await popupPage(context, extensionId);
  await expect(popup.getByRole("heading", { name: "TabBurrow" })).toBeVisible();
  await popup.getByRole("button", { name: "Search collections and links" }).click();
  await popup.getByRole("combobox", { name: "Search collections and links" }).fill(query);
  await expect(popup.getByRole("listbox", { name: "Search results" })).toBeVisible();
  return popup;
}

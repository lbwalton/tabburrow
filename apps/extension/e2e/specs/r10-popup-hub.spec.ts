import { randomUUID } from "node:crypto";
import { test, expect, popupPage } from "../fixtures";
import { seedCollectionsAndLinks, seedPosition } from "../seed";
import type { SeedCollection, SeedLink } from "../seed";
import { finalScreenshot } from "../test-utils";

/**
 * R10 — Popup hub: the folders-home screen. All local-only (Dexie): no
 * sign-in and no Supabase stack required. Covers the redesigned home list
 * (every folder + its live count, hover-revealed row actions, drill-in /
 * back), inline "+ New folder" creation (blur-to-confirm, stays home, lands
 * at the bottom), and the row's inline delete trash (confirms, removes only
 * the targeted folder, and sits last in the action group away from open-all).
 *
 * Lifted from the throwaway acceptance scripts e2e/capture-hub.ts and
 * e2e/verify-fixes.ts. Like every popup spec, "current tab" quirks don't
 * matter here — these flows read seeded Dexie data, not chrome.tabs — so no
 * bringToFront dance is needed (see t07-popup-save.spec.ts for that pattern).
 */

/** Seeds folders (name → count of links) and returns each folder's id by name. */
async function seedFolders(
  page: import("@playwright/test").Page,
  folders: Array<{ name: string; accent?: string | null; linkTitles?: string[] }>,
): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  const collections: SeedCollection[] = [];
  const links: SeedLink[] = [];
  folders.forEach((f, i) => {
    const id = randomUUID();
    ids[f.name] = id;
    collections.push({ id, name: f.name, accent: f.accent ?? null, position: seedPosition(i) });
    (f.linkTitles ?? []).forEach((title, j) =>
      links.push({
        id: randomUUID(),
        collectionId: id,
        url: `https://example.com/${encodeURIComponent(f.name)}/${j}`,
        title,
        position: seedPosition(j),
        note: null,
        tags: [],
      }),
    );
  });
  await seedCollectionsAndLinks(page, collections, links);
  return ids;
}

test("home lists every folder with its live count; hover reveals the row actions; a row drills in and back returns home", async ({
  context,
  extensionId,
  cleanDashboard,
}) => {
  await seedFolders(cleanDashboard, [
    { name: "Coding", accent: "var(--accent)", linkTitles: ["useEffect – React", "Dexie React Tutorial"] },
    { name: "Streaming", accent: "var(--accent-2)", linkTitles: ["OBS Docs", "Twitch Camp", "StreamElements"] },
    { name: "Read later" },
  ]);
  await cleanDashboard.reload();

  const popup = await popupPage(context, extensionId);
  await expect(popup.getByRole("heading", { name: "TabBurrow" })).toBeVisible();

  // Every seeded folder is listed with its live link count baked into the
  // row-body button's accessible name ("{name} {count}").
  await expect(popup.getByRole("button", { name: "Coding 2", exact: true })).toBeVisible();
  await expect(popup.getByRole("button", { name: "Streaming 3", exact: true })).toBeVisible();
  await expect(popup.getByRole("button", { name: "Read later 0", exact: true })).toBeVisible();

  // The "+" (add current tab) and open-all controls live in a wrapper that is
  // opacity-0 at rest and opacity-100 on row hover — assert the reveal, not
  // just presence (Playwright treats opacity-0 elements as "visible").
  const codingRow = popup.locator("div.group", { hasText: "Coding" }).first();
  const rowActions = codingRow.getByRole("button", { name: "Add current tab to Coding" }).locator("..");
  await popup.getByRole("heading", { name: "TabBurrow" }).hover(); // park the pointer off the list
  await expect(rowActions).toHaveCSS("opacity", "0");
  await codingRow.hover();
  await expect(rowActions).toHaveCSS("opacity", "1");
  await expect(codingRow.getByRole("button", { name: /Open all \d+ tabs in Coding/ })).toBeVisible();

  // Row body drills into the folder (detail screen shows the Append action +
  // the click-to-rename title).
  await popup.getByRole("button", { name: "Coding 2", exact: true }).click();
  await expect(popup.getByRole("button", { name: "Append tabs" })).toBeVisible();
  await expect(popup.getByRole("button", { name: /^Rename folder Coding/ })).toBeVisible();

  // Back returns to home (only FoldersHome renders the TabBurrow wordmark +
  // the "Folders" section heading).
  await popup.getByRole("button", { name: "Back to folders" }).click();
  await expect(popup.getByRole("heading", { name: "TabBurrow" })).toBeVisible();
  await expect(popup.getByRole("heading", { name: "Folders" })).toBeVisible();
  await finalScreenshot(popup, "r10-home");
});

test('"+ New folder" confirms on blur (not Enter), stays on home, and lands at the bottom of the list', async ({
  context,
  extensionId,
  cleanDashboard,
}) => {
  await seedFolders(cleanDashboard, [{ name: "Coding" }, { name: "Streaming" }, { name: "Read later" }]);
  await cleanDashboard.reload();

  const popup = await popupPage(context, extensionId);
  await expect(popup.getByRole("heading", { name: "TabBurrow" })).toBeVisible();

  await popup.getByRole("button", { name: "+ New folder" }).click();
  await popup.getByLabel("New folder name").fill("Zebra folder");
  // Blur by clicking a neutral, non-focusable element (the "Folders" heading),
  // NOT by pressing Enter — this is the click-away confirm path.
  await popup.getByRole("heading", { name: "Folders" }).click();

  await expect(popup.getByRole("button", { name: /^Zebra folder/ })).toBeVisible();
  // Still on home: the "+ New folder" affordance only exists on the home list,
  // and we did NOT drill into the freshly-made folder.
  await expect(popup.getByRole("button", { name: "+ New folder" })).toBeVisible();

  // It appears at the BOTTOM (manual/creation order — createCollection appends).
  const rowNames = await popup.locator("div.group > button").allInnerTexts();
  const lastName = rowNames
    .map((t) => t.split("\n")[0]?.trim())
    .filter(Boolean)
    .pop();
  expect(lastName?.startsWith("Zebra folder")).toBe(true);
  await finalScreenshot(popup, "r10-new-folder");
});

test("the inline trash on a folder row confirms, then deletes the folder", async ({
  context,
  extensionId,
  cleanDashboard,
}) => {
  // Two folders so we can prove only the targeted one goes.
  await seedFolders(cleanDashboard, [
    { name: "Coding", linkTitles: ["React Docs", "Dexie Tutorial"] },
    { name: "Recipes", linkTitles: ["Sourdough"] },
  ]);
  await cleanDashboard.reload();

  const popup = await popupPage(context, extensionId);
  const row = popup.locator("div.group", { hasText: "Coding" }).first();
  await row.hover();
  await row.getByRole("button", { name: "Delete Coding" }).click();

  // Cancel leaves everything intact — a folder is not a one-click delete.
  // Note: the row's accessible name ("Coding 2"), not a bare text match — every
  // row also carries OpenAllButton's own hidden confirm `<dialog>` (native
  // <dialog> content stays in the DOM, just closed) whose copy repeats the
  // folder name and count, so `getByText("Coding")` alone is ambiguous.
  const dialog = popup.getByRole("dialog", { name: 'Delete "Coding"?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("2 links")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(popup.getByRole("button", { name: "Coding 2", exact: true })).toBeVisible();

  // Confirming removes only that folder.
  await row.hover();
  await row.getByRole("button", { name: "Delete Coding" }).click();
  await popup.getByRole("dialog", { name: 'Delete "Coding"?' }).getByRole("button", { name: "Delete" }).click();

  // Coding's row (and its own hidden dialogs) unmount entirely on delete, so
  // a bare text match is safe here — there's nothing left for it to collide
  // with.
  await expect(popup.getByText("Coding")).toHaveCount(0, { timeout: 5000 });
  await expect(popup.getByRole("button", { name: "Recipes 1", exact: true })).toBeVisible();
});

test("the folder row's trash sits last, away from open-all", async ({
  context,
  extensionId,
  cleanDashboard,
}) => {
  await seedFolders(cleanDashboard, [{ name: "Coding", linkTitles: ["React Docs"] }]);
  await cleanDashboard.reload();

  const popup = await popupPage(context, extensionId);
  const row = popup.locator("div.group", { hasText: "Coding" }).first();
  await row.hover();

  // Order is load-bearing: `↗` opens every tab in the folder and is the most-used
  // control here, so the destructive action is kept at the far end. A refactor that
  // reorders these should fail loudly rather than quietly re-create the hazard.
  const labels = await row.getByRole("button").evaluateAll((els) =>
    els.map((el) => el.getAttribute("aria-label") ?? "").filter(Boolean),
  );
  const addIndex = labels.findIndex((l) => l.startsWith("Add current tab"));
  const openIndex = labels.findIndex((l) => l.startsWith("Open all"));
  const trashIndex = labels.findIndex((l) => l.startsWith("Delete "));

  expect(addIndex).toBeGreaterThanOrEqual(0);
  expect(openIndex).toBeGreaterThan(addIndex);
  expect(trashIndex).toBeGreaterThan(openIndex);
});

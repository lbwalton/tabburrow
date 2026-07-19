import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, popupPage } from "../fixtures";
import { seedCollectionsAndLinks, seedPosition } from "../seed";
import type { SeedCollection, SeedLink } from "../seed";
import { finalScreenshot } from "../test-utils";

/**
 * R10 — Folder-detail actions, all local-only (Dexie; no sign-in, no Supabase
 * stack): Append / Overwrite, manual Add link, the inline (menu-less) delete,
 * the header "+" quick-add, and click-to-rename. Plus the file:// regression
 * guard (item 3) — a local .html file must be saveable, the bug that shipped.
 *
 * Lifted from e2e/verify-fixes.ts. "Current tab" operations (header "+") re-
 * activate the intended page via bringToFront right before the click, exactly
 * as t07-popup-save.spec.ts documents; Append/Overwrite read the whole window
 * via getAllTabs so they don't care which tab is active.
 */

async function seedFolder(page: Page, name: string, linkTitles: string[]): Promise<string> {
  const id = randomUUID();
  const collections: SeedCollection[] = [{ id, name, accent: "var(--accent)", position: seedPosition(0) }];
  const links: SeedLink[] = linkTitles.map((title, j) => ({
    id: randomUUID(),
    collectionId: id,
    url: `https://example.com/${j}`,
    title,
    position: seedPosition(j),
    note: null,
    tags: [],
  }));
  await seedCollectionsAndLinks(page, collections, links);
  return id;
}

/** Opens the popup and drills into `name` (which has `count` links); returns the popup page on the detail screen. */
async function openFolderDetail(
  context: import("@playwright/test").BrowserContext,
  extensionId: string,
  name: string,
  count: number,
): Promise<Page> {
  const popup = await popupPage(context, extensionId);
  await expect(popup.getByRole("heading", { name: "TabBurrow" })).toBeVisible();
  await popup.getByRole("button", { name: `${name} ${count}`, exact: true }).click();
  await expect(popup.getByRole("button", { name: "Append tabs" })).toBeVisible();
  return popup;
}

test('"Append tabs" adds the window\'s http tabs to the folder', async ({
  context,
  extensionId,
  testServer,
  cleanDashboard,
}) => {
  await seedFolder(cleanDashboard, "Coding", ["React Docs"]);
  await cleanDashboard.reload();

  const httpTab = await context.newPage();
  await httpTab.goto(testServer.pageUrl("Sourdough Guide"));

  const popup = await openFolderDetail(context, extensionId, "Coding", 1);
  await popup.getByRole("button", { name: "Append tabs" }).click();
  await expect(popup.getByText("Sourdough Guide")).toBeVisible({ timeout: 5000 });
  // The pre-existing link is kept (append, not replace).
  await expect(popup.getByText("React Docs")).toBeVisible();
});

test('"Overwrite" shows the confirm dialog, then replaces the folder\'s links', async ({
  context,
  extensionId,
  testServer,
  cleanDashboard,
}) => {
  await seedFolder(cleanDashboard, "Coding", ["React Docs", "Dexie Tutorial"]);
  await cleanDashboard.reload();

  const httpTab = await context.newPage();
  await httpTab.goto(testServer.pageUrl("Sourdough Guide"));

  const popup = await openFolderDetail(context, extensionId, "Coding", 2);
  await popup.getByRole("button", { name: "Overwrite" }).click();

  const dialog = popup.getByRole("dialog", { name: "Overwrite folder?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Overwrite" }).click();

  // The window's http tab replaces the seeded links.
  await expect(popup.getByText("Sourdough Guide")).toBeVisible({ timeout: 5000 });
  await expect(popup.getByText("React Docs")).toHaveCount(0);
  await expect(popup.getByText("Dexie Tutorial")).toHaveCount(0);
});

test('"+ Add link" adds a manual URL to the folder', async ({ context, extensionId, cleanDashboard }) => {
  await seedFolder(cleanDashboard, "Coding", ["React Docs"]);
  await cleanDashboard.reload();

  const popup = await openFolderDetail(context, extensionId, "Coding", 1);
  await popup.getByRole("button", { name: "+ Add link" }).click();
  await popup.getByLabel("Link URL").fill("https://news.ycombinator.com/item?id=1");
  await popup.getByLabel("Link title (optional)").fill("Manual Entry");
  await popup.getByRole("button", { name: "Add", exact: true }).click();
  await expect(popup.getByText("Manual Entry")).toBeVisible({ timeout: 5000 });
});

test("the inline trash on a link row deletes it in one click, without opening the … menu", async ({
  context,
  extensionId,
  cleanDashboard,
}) => {
  await seedFolder(cleanDashboard, "Coding", ["useEffect – React", "Dexie Tutorial"]);
  await cleanDashboard.reload();

  const popup = await openFolderDetail(context, extensionId, "Coding", 2);
  // The … menu (Open / Edit) is NOT open — proving the delete below never needs it.
  await expect(popup.getByRole("menuitem", { name: "Edit" })).toHaveCount(0);

  const targetRow = popup.locator("div.group", { hasText: "useEffect – React" }).first();
  await targetRow.hover();
  await targetRow.getByRole("button", { name: /^Delete useEffect/ }).click();

  await expect(popup.getByText("useEffect – React")).toHaveCount(0, { timeout: 5000 });
  await expect(popup.getByText("Dexie Tutorial")).toBeVisible();
});

test('the folder-detail header "+" adds the current tab in place', async ({
  context,
  extensionId,
  testServer,
  cleanDashboard,
}) => {
  await seedFolder(cleanDashboard, "Coding", ["React Docs"]);
  await cleanDashboard.reload();

  const httpTab = await context.newPage();
  await httpTab.goto(testServer.pageUrl("Current Tab Page"));
  await httpTab.bringToFront();

  const popup = await openFolderDetail(context, extensionId, "Coding", 1);
  await httpTab.bringToFront(); // getCurrentTab() must resolve the http page, not the popup tab
  await popup.getByRole("button", { name: "Add current tab to this folder" }).click();

  await expect(popup.getByText("Added the current tab.")).toBeVisible({ timeout: 5000 });
  await expect(popup.getByText("Current Tab Page")).toBeVisible();
});

test("clicking the folder title enters rename mode and Enter renames it", async ({
  context,
  extensionId,
  cleanDashboard,
}) => {
  await seedFolder(cleanDashboard, "Coding", ["React Docs"]);
  await cleanDashboard.reload();

  const popup = await openFolderDetail(context, extensionId, "Coding", 1);
  await popup.getByRole("button", { name: /^Rename folder Coding/ }).click();

  const nameInput = popup.getByLabel("Folder name", { exact: true });
  await expect(nameInput).toBeVisible();
  await nameInput.fill("Renamed Coding");
  await nameInput.press("Enter");

  await expect(popup.getByRole("button", { name: /^Rename folder Renamed Coding/ })).toBeVisible();
  await expect(nameInput).toHaveCount(0);
});

test("a file:// tab (local .html) is saveable into a folder via Append — the shipped regression", async ({
  context,
  extensionId,
  cleanDashboard,
}) => {
  // A real local HTML file — exactly the file:// case that was silently filtered
  // out. Its <title> matches the file's base name, so the saved link's title is
  // the filename the user sees.
  const fileDir = fs.mkdtempSync(path.join(os.tmpdir(), "tabburrow-file-"));
  const filePath = path.join(fileDir, "Partnership Proposal.html");
  fs.writeFileSync(filePath, "<!doctype html><title>Partnership Proposal</title><h1>Proposal</h1>");
  try {
    await seedFolder(cleanDashboard, "Coding", ["React Docs"]);
    await cleanDashboard.reload();

    const fileTab = await context.newPage();
    await fileTab.goto(`file://${filePath}`);
    await fileTab.bringToFront();

    const popup = await openFolderDetail(context, extensionId, "Coding", 1);
    await fileTab.bringToFront();
    await popup.getByRole("button", { name: "Append tabs" }).click();

    await expect(popup.getByText("Partnership Proposal")).toBeVisible({ timeout: 5000 });
    await finalScreenshot(popup, "r10-file-save");
  } finally {
    fs.rmSync(fileDir, { recursive: true, force: true });
  }
});

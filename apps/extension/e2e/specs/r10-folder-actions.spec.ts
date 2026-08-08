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

test("ticking two link checkboxes reveals the selection bar with the live count", async ({
  context,
  extensionId,
  cleanDashboard,
}) => {
  await seedFolder(cleanDashboard, "Coding", ["React Docs", "Dexie Tutorial", "WXT Storage"]);
  await cleanDashboard.reload();

  const popup = await openFolderDetail(context, extensionId, "Coding", 3);
  const bar = popup.getByRole("toolbar", { name: "Selection actions" });

  // Nothing selected: no bar at all.
  await expect(bar).toHaveCount(0);

  await popup.getByRole("checkbox", { name: "Select React Docs" }).click();
  await expect(bar).toBeVisible();
  await expect(bar.getByText("1 selected")).toBeVisible();

  await popup.getByRole("checkbox", { name: "Select WXT Storage" }).click();
  await expect(bar.getByText("2 selected")).toBeVisible();
  await expect(popup.getByRole("button", { name: "Open 2" })).toBeVisible();

  // Unticking the first drops the count without clearing the rest.
  await popup.getByRole("checkbox", { name: "Select React Docs" }).click();
  await expect(bar.getByText("1 selected")).toBeVisible();

  // × clears everything and the bar goes away.
  await bar.getByRole("button", { name: "Clear selection" }).click();
  await expect(bar).toHaveCount(0);
});

test("shift-clicking a checkbox selects the contiguous range from a fixed anchor", async ({
  context,
  extensionId,
  cleanDashboard,
}) => {
  await seedFolder(cleanDashboard, "Coding", ["One", "Two", "Three", "Four"]);
  await cleanDashboard.reload();

  const popup = await openFolderDetail(context, extensionId, "Coding", 4);
  const bar = popup.getByRole("toolbar", { name: "Selection actions" });

  await popup.getByRole("checkbox", { name: "Select One" }).click();
  await popup.getByRole("checkbox", { name: "Select Four" }).click({ modifiers: ["Shift"] });

  await expect(bar.getByText("4 selected")).toBeVisible();
  for (const title of ["One", "Two", "Three", "Four"]) {
    await expect(popup.getByRole("checkbox", { name: `Select ${title}` })).toBeChecked();
  }

  // The anchor does NOT move to Four. Shift-clicking Three ranges One..Three,
  // shrinking the selection rather than extending from Four.
  await popup.getByRole("checkbox", { name: "Select Three" }).click({ modifiers: ["Shift"] });
  await expect(bar.getByText("3 selected")).toBeVisible();
  await expect(popup.getByRole("checkbox", { name: "Select Four" })).not.toBeChecked();
  await expect(popup.getByRole("checkbox", { name: "Select One" })).toBeChecked();
});

test("Open N opens one background tab per selected link and leaves the popup open", async ({
  context,
  extensionId,
  cleanDashboard,
}) => {
  await seedFolder(cleanDashboard, "Coding", ["React Docs", "Dexie Tutorial", "WXT Storage"]);
  await cleanDashboard.reload();

  const popup = await openFolderDetail(context, extensionId, "Coding", 3);
  await popup.getByRole("checkbox", { name: "Select React Docs" }).click();
  await popup.getByRole("checkbox", { name: "Select WXT Storage" }).click();

  const before = context.pages().length;
  await popup.getByRole("button", { name: "Open 2" }).click();

  // Two new tabs appear, one per selected link.
  await expect.poll(() => context.pages().length, { timeout: 10_000 }).toBe(before + 2);

  // NOTE ON WHAT THIS TEST CANNOT PROVE. The harness's `popupPage` loads
  // popup.html in an ordinary tab (fixtures.ts), not as a real browser-action
  // popup. A real popup is dismissed when an `active: true` tab opens; a tab
  // never is. So asserting `popup.isClosed() === false` here would pass no
  // matter what `openLinks` did — a vacuous assertion. Deliberately omitted.
  // What IS meaningful, and is asserted below, is that the page stayed
  // interactive and its state advanced correctly. The background-vs-active
  // distinction itself is covered by `lib/restore.ts` using `active: false`,
  // and by the manual check.

  // Selection cleared, bar gone, confirmation flashed.
  await expect(popup.getByRole("toolbar", { name: "Selection actions" })).toHaveCount(0);
  await expect(popup.getByText("Opened 2 tabs.")).toBeVisible();
});

test("bulk Delete confirms first, then removes exactly the selected links", async ({
  context,
  extensionId,
  cleanDashboard,
}) => {
  await seedFolder(cleanDashboard, "Coding", ["React Docs", "Dexie Tutorial", "WXT Storage"]);
  await cleanDashboard.reload();

  const popup = await openFolderDetail(context, extensionId, "Coding", 3);
  await popup.getByRole("checkbox", { name: "Select React Docs" }).click();
  await popup.getByRole("checkbox", { name: "Select Dexie Tutorial" }).click();

  await popup.getByRole("toolbar", { name: "Selection actions" }).getByRole("button", { name: "Delete" }).click();

  // Cancel leaves everything intact — deletion is confirmed, unlike the per-row trash.
  const dialog = popup.getByRole("dialog", { name: "Delete 2 links?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(popup.getByText("React Docs")).toBeVisible();
  await expect(popup.getByRole("toolbar", { name: "Selection actions" })).toBeVisible();

  // Confirming removes exactly the two selected, and keeps the third.
  await popup.getByRole("toolbar", { name: "Selection actions" }).getByRole("button", { name: "Delete" }).click();
  await popup.getByRole("dialog", { name: "Delete 2 links?" }).getByRole("button", { name: "Delete" }).click();

  await expect(popup.getByText("React Docs")).toHaveCount(0, { timeout: 5000 });
  await expect(popup.getByText("Dexie Tutorial")).toHaveCount(0);
  await expect(popup.getByText("WXT Storage")).toBeVisible();
  await expect(popup.getByRole("toolbar", { name: "Selection actions" })).toHaveCount(0);
});

test("Escape clears the selection, but not when a field or picker owns the key", async ({
  context,
  extensionId,
  cleanDashboard,
}) => {
  await seedFolder(cleanDashboard, "Coding", ["React Docs", "Dexie Tutorial", "WXT Storage"]);
  await cleanDashboard.reload();

  const popup = await openFolderDetail(context, extensionId, "Coding", 3);
  const bar = popup.getByRole("toolbar", { name: "Selection actions" });

  // 1. The core flow. Focus is on the checkbox just clicked — a checkbox IS an
  //    HTMLInputElement, so a guard that bails on any focused input breaks this.
  await popup.getByRole("checkbox", { name: "Select React Docs" }).click();
  await popup.getByRole("checkbox", { name: "Select Dexie Tutorial" }).click();
  await expect(bar.getByText("2 selected")).toBeVisible();
  await popup.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);

  // 2. Cancelling a rename must NOT wipe the selection.
  await popup.getByRole("checkbox", { name: "Select React Docs" }).click();
  await popup.getByRole("button", { name: /^Rename folder/ }).click();
  await popup.getByLabel("Folder name").press("Escape");
  await expect(popup.getByLabel("Folder name")).toHaveCount(0); // rename cancelled
  await expect(bar.getByText("1 selected")).toBeVisible(); // selection survived

  // 3. Typing a URL and pressing Escape must NOT wipe the selection.
  await popup.getByRole("button", { name: "+ Add link" }).click();
  await popup.getByLabel("Link URL").fill("https://example.com/typed");
  await popup.getByLabel("Link URL").press("Escape");
  await expect(bar.getByText("1 selected")).toBeVisible();

  // 4. Dismissing the accent picker must NOT wipe the selection. AccentPicker is a
  //    <div role="dialog">, not a native <dialog> — the case the first guard missed.
  await popup.getByRole("button", { name: "More folder actions" }).click();
  await popup.getByRole("menuitem", { name: "Change color" }).click();
  await expect(popup.getByRole("dialog")).toBeVisible();
  await popup.keyboard.press("Escape");
  await expect(popup.getByRole("dialog")).toHaveCount(0); // picker closed
  await expect(bar.getByText("1 selected")).toBeVisible();

  // 5. A per-row ⋯ menu takes the FIRST Escape and the selection takes the second.
  //    LinkRow closes its own menu from a document-level (bubble) listener, so this
  //    is the case that pins the phase ordering: the window listener has to see
  //    [role="menu"] still mounted, which only holds on capture — by bubble time
  //    LinkRow's setState has already flushed the menu out of the DOM.
  await popup.getByRole("button", { name: "More actions for React Docs" }).click();
  const rowMenu = popup.getByRole("menu", { name: "React Docs actions" });
  await expect(rowMenu).toBeVisible();
  await popup.keyboard.press("Escape");
  await expect(rowMenu).toHaveCount(0); // menu closed
  await expect(bar.getByText("1 selected")).toBeVisible(); // selection survived
  await popup.keyboard.press("Escape");
  await expect(bar).toHaveCount(0); // second Escape clears it

  // 6. Backing out of the bulk-delete confirm must NOT wipe the selection — the user
  //    called off a delete, losing what they'd picked would be its own bug. This is
  //    the native <dialog> arm of the guard (`dialog[open]`), unlike case 4's div.
  await popup.getByRole("checkbox", { name: "Select React Docs" }).click();
  await popup.getByRole("checkbox", { name: "Select Dexie Tutorial" }).click();
  await bar.getByRole("button", { name: "Delete" }).click();
  const confirm = popup.getByRole("dialog", { name: "Delete 2 links?" });
  await expect(confirm).toBeVisible();
  await popup.keyboard.press("Escape");
  await expect(confirm).toBeHidden(); // dialog dismissed
  await expect(bar.getByText("2 selected")).toBeVisible(); // selection survived
});

import { randomUUID } from "node:crypto";
import type { BrowserContext, Page } from "@playwright/test";
import { test, expect, popupPage, dashboardPage } from "../fixtures";
import { seedCollectionsAndLinks, seedMeta, seedPosition } from "../seed";
import type { SeedCollection, SeedLink } from "../seed";
import { finalScreenshot } from "../test-utils";

/**
 * R11 — The Save split-button model, all local-only (Dexie; no sign-in, no
 * Supabase stack). Covers the zero-config "pin on first save" default, the
 * caret menu's three divided zones, "New folder (named by AI)" (naming is
 * best-effort — degrades gracefully to the "New folder" placeholder with no
 * engine), and the dashboard Settings "When you click Save" radiogroup.
 *
 * Lifted from e2e/verify-save.ts, reconciled against the current source (the
 * home line now reads "1-click Save goes to {folder}" / "a folder you choose",
 * per FoldersHome.tsx and e2e/capture-design.ts). "Current tab" saves re-
 * activate the http page via bringToFront (see t07-popup-save.spec.ts).
 */

async function seedOneFolder(page: Page, name: string, pinAsDefault: boolean): Promise<string> {
  const id = randomUUID();
  const collections: SeedCollection[] = [{ id, name, accent: "var(--accent)", position: seedPosition(0) }];
  const links: SeedLink[] = [
    { id: randomUUID(), collectionId: id, url: "https://react.dev/", title: "React", position: seedPosition(0), note: null, tags: [] },
  ];
  await seedCollectionsAndLinks(page, collections, links);
  if (pinAsDefault) await seedMeta(page, { defaultCollectionId: id, saveTargetMode: "default" });
  return id;
}

async function openHttpTab(context: BrowserContext, url: string): Promise<Page> {
  const tab = await context.newPage();
  await tab.goto(url);
  return tab;
}

test("with no default set, 1-click Save opens the picker; picking a folder pins it so a second Save skips the picker", async ({
  context,
  extensionId,
  testServer,
  cleanDashboard,
}) => {
  await seedOneFolder(cleanDashboard, "Coding", false); // no default meta
  await cleanDashboard.reload();

  const httpTab = await openHttpTab(context, testServer.pageUrl("Sourdough Guide"));
  await httpTab.bringToFront();
  const popup = await popupPage(context, extensionId);
  await httpTab.bringToFront();
  await expect(popup.getByRole("heading", { name: "TabBurrow" })).toBeVisible();

  // No default → the line prompts to choose, and its button reads "Choose".
  await expect(popup.getByText("1-click Save goes to")).toBeVisible();
  await expect(popup.getByText("a folder you choose")).toBeVisible();
  await expect(popup.getByRole("button", { name: "Choose", exact: true })).toBeVisible();

  // 1-click Save with no default opens the picker; picking pins the default.
  await httpTab.bringToFront();
  await popup.getByRole("button", { name: "Save", exact: true }).click();
  await expect(popup.getByText("Save to…")).toBeVisible();
  await popup.getByText("Coding", { exact: true }).click();
  await expect(popup.getByText(/Saved 1 tab to Coding/)).toBeVisible({ timeout: 5000 });
  await popup.getByRole("button", { name: "Done" }).click();

  // Default now pinned: the line's button flips to "Change".
  await expect(popup.getByRole("button", { name: "Change", exact: true })).toBeVisible();

  // A second 1-click Save saves straight to the pinned default — no picker.
  await httpTab.bringToFront();
  await popup.getByRole("button", { name: "Save", exact: true }).click();
  await expect(popup.getByText(/Saved 1 tab to Coding/)).toBeVisible({ timeout: 5000 });
  await expect(popup.getByText("Save to…")).toHaveCount(0);
  await finalScreenshot(popup, "r11-pinned-default");
});

test('the "More save options" caret menu shows the three divided zones', async ({
  context,
  extensionId,
  testServer,
  cleanDashboard,
}) => {
  await seedOneFolder(cleanDashboard, "Coding", true); // pinned default → "To Coding"
  await cleanDashboard.reload();

  await openHttpTab(context, testServer.pageUrl("A Tab"));
  const popup = await popupPage(context, extensionId);
  await expect(popup.getByRole("heading", { name: "TabBurrow" })).toBeVisible();

  await popup.getByRole("button", { name: "More save options" }).click();

  // Zone 1: save this tab. Zone 2: the "Save all tabs (N)" group. Zone 3:
  // change default — each item present, plus the "Save all tabs" group label.
  for (const label of ["Save this tab", "To Coding", "Choose a folder…", "New folder (named by AI)", "Change default folder…"]) {
    await expect(popup.getByRole("menuitem", { name: label })).toBeVisible();
  }
  await expect(popup.getByText("Save all tabs")).toBeVisible();
  // The three zones are split by two dividers (role="separator").
  await expect(popup.getByRole("separator")).toHaveCount(2);
  await finalScreenshot(popup, "r11-save-menu");
});

test('"New folder (named by AI)" creates a folder and saves the tabs without losing the save', async ({
  context,
  extensionId,
  testServer,
  cleanDashboard,
}) => {
  await seedOneFolder(cleanDashboard, "Coding", true);
  await cleanDashboard.reload();

  const httpTab = await openHttpTab(context, testServer.pageUrl("AI Named Page"));
  await httpTab.bringToFront();
  const popup = await popupPage(context, extensionId);
  await httpTab.bringToFront();
  await expect(popup.getByRole("heading", { name: "TabBurrow" })).toBeVisible();

  await httpTab.bringToFront();
  await popup.getByRole("button", { name: "More save options" }).click();
  await popup.getByRole("menuitem", { name: "New folder (named by AI)" }).click();

  // The save must land (AI naming is best-effort; the "New folder" placeholder
  // is acceptable, so match any destination name).
  await expect(popup.getByText(/Saved \d+ tabs? to /)).toBeVisible({ timeout: 8000 });
  await popup.getByRole("button", { name: "Done" }).click();

  // The folder now exists: home shows the seeded folder plus the new one.
  await expect(popup.locator("div.group > button")).toHaveCount(2);
});

test('dashboard Settings has the "When you click Save" radiogroup with all three modes', async ({
  context,
  extensionId,
  cleanDashboard,
}) => {
  void cleanDashboard; // seeds nothing special; just needs a wiped DB
  const settings = await dashboardPage(context, extensionId, "#/settings");
  await expect(settings.getByRole("radiogroup", { name: "When you click Save" })).toBeVisible();
  for (const label of ["Save to a default folder", "Save to the last folder I used", "Ask me each time"]) {
    await expect(settings.getByRole("radio", { name: label })).toBeVisible();
  }
});

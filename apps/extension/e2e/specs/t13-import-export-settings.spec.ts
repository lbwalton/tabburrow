import { test, expect } from "../fixtures";
import { seedCollectionsAndLinks, seedPosition } from "../seed";
import { finalScreenshot, tokenColor, computedBackground } from "../test-utils";

/**
 * T13 — Import/export + shortcuts + settings. Acceptance (stories/stories.json):
 *   - Export then re-import into a wiped profile reproduces identical
 *     collections/links
 *   - A real Chrome bookmarks HTML file imports with correct folder mapping
 *   - Alt+Shift+S saves current tab with badge feedback and no popup — NOT
 *     automated: this is a global OS/browser-level keyboard shortcut
 *     (chrome://extensions/shortcuts), outside what a page-level Playwright
 *     script can dispatch. See e2e/MANUAL.md.
 *   - Theme toggle flips dashboard+popup to paper theme and persists
 */

const BOOKMARKS_HTML = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3>Work</H3>
    <DL><p>
        <DT><A HREF="https://example.com/work1">Work Link One</A>
        <DT><A HREF="https://example.com/work2">Work Link Two</A>
    </DL><p>
    <DT><A HREF="https://example.com/root-link">Root Link</A>
</DL><p>
`;

test("export then re-import into a wiped profile reproduces identical collections/links", async ({
  cleanDashboard,
  extensionId,
}) => {
  const dashboard = cleanDashboard;
  await seedCollectionsAndLinks(
    dashboard,
    [{ id: "export-col", name: "Export Test", position: seedPosition(0) }],
    [
      {
        id: "export-link-1",
        collectionId: "export-col",
        url: "https://example.com/a",
        title: "Link A",
        position: seedPosition(0),
        note: "an important note",
        tags: ["work", "reading"],
      },
      { id: "export-link-2", collectionId: "export-col", url: "https://example.com/b", title: "Link B", position: seedPosition(1) },
    ],
  );
  // Seeding writes straight to IndexedDB via a raw connection, bypassing
  // Dexie's change tracking — reload so the already-mounted page's
  // useLiveQuery/exportJson reads see it fresh. See e2e/README.md.
  await dashboard.reload();
  await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html#/settings`);

  const [download] = await Promise.all([
    dashboard.waitForEvent("download"),
    dashboard.getByRole("button", { name: "Export", exact: true }).click(),
  ]);
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const fs = await import("node:fs/promises");
  const exportedJson = await fs.readFile(downloadPath!, "utf-8");
  const exported = JSON.parse(exportedJson);
  expect(exported.collections).toHaveLength(1);
  expect(exported.links).toHaveLength(2);

  // Wipe the profile, reload settings, and re-import that exact export.
  await dashboard.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase("tabburrow");
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });
  await dashboard.reload();
  await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html#/settings`);
  await expect(dashboard.getByText("0 collections")).toBeVisible();

  const burrowInput = dashboard.locator('input[type="file"]').nth(2); // IMPORT_SOURCES order: bookmarks, toby, burrow
  await burrowInput.setInputFiles({ name: "tabburrow-export.json", mimeType: "application/json", buffer: Buffer.from(exportedJson) });
  await expect(dashboard.getByText(/Imported 1 collection, 2 links from TabBurrow export\./)).toBeVisible();

  await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html`);
  await expect(dashboard.getByRole("heading", { name: "Export Test" })).toBeVisible();
  await expect(dashboard.getByText("Link A")).toBeVisible();
  await expect(dashboard.getByText("an important note")).toBeVisible();
  await expect(dashboard.getByText("work")).toBeVisible();
  await expect(dashboard.getByText("Link B")).toBeVisible();
});

test("a real Chrome bookmarks HTML file imports with correct folder mapping", async ({
  cleanDashboard,
  extensionId,
}) => {
  const dashboard = cleanDashboard;
  await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html#/settings`);

  const bookmarksInput = dashboard.locator('input[type="file"]').nth(0);
  await bookmarksInput.setInputFiles({ name: "bookmarks.html", mimeType: "text/html", buffer: Buffer.from(BOOKMARKS_HTML) });
  await expect(dashboard.getByText(/Imported 2 collections, 3 links from Chrome bookmarks\./)).toBeVisible();

  await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html`);
  const rail = dashboard.getByRole("navigation", { name: "Collections" });
  await expect(rail.getByText("Work", { exact: true })).toBeVisible();
  await expect(rail.getByText("Imported bookmarks", { exact: true })).toBeVisible();

  await rail.getByText("Work", { exact: true }).click();
  await expect(dashboard.getByText("Work Link One")).toBeVisible();
  await expect(dashboard.getByText("Work Link Two")).toBeVisible();

  await rail.getByText("Imported bookmarks", { exact: true }).click();
  await expect(dashboard.getByText("Root Link")).toBeVisible();
  await finalScreenshot(dashboard, "t13-bookmarks-import");
});

test("theme toggle flips dashboard + popup to paper theme and persists", async ({
  cleanDashboard,
  extensionId,
  context,
}) => {
  const dashboard = cleanDashboard;
  await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html#/settings`);

  await expect(dashboard.getByRole("radio", { name: "dark" })).toHaveAttribute("aria-checked", "true");
  await dashboard.getByRole("radio", { name: "paper" }).click();
  await expect(dashboard.locator("html")).toHaveAttribute("data-theme", "paper");

  // bg-[var(--bg-ground)] paints App's own root div (#root > div), not
  // <html>/<body> directly — see entrypoints/dashboard/App.tsx.
  const paperBg = await computedBackground(dashboard, "#root > div");
  const paperToken = await tokenColor(dashboard, "--bg-ground");
  expect(paperBg).toBe(paperToken);

  // Persists across reload.
  await dashboard.reload();
  await expect(dashboard.locator("html")).toHaveAttribute("data-theme", "paper");
  await finalScreenshot(dashboard, "t13-paper-theme-dashboard");

  // Popup independently reads the same persisted meta on its own mount.
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.locator("html")).toHaveAttribute("data-theme", "paper");
  await finalScreenshot(popup, "t13-paper-theme-popup");
  await popup.close();
});

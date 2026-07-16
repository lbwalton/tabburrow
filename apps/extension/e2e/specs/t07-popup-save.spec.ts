import { test, expect, popupPage } from "../fixtures";
import { finalScreenshot } from "../test-utils";

/**
 * T7 — Popup save flows. Acceptance (stories/stories.json):
 *   - One click saves current tab into Last Used collection (2 clicks cold:
 *     pick target once, remembered after)
 *   - All tabs saves every http(s) tab of the window; confirmation shows
 *     correct count; optional close button works and never fires on its own
 *   - Highlight 3 tabs -> Selected saves exactly those 3
 *   - New-collection inline creation works from the picker
 *   - Recent collections list (5 most recently updated) opens dashboard
 *     focused on that collection
 *   - Popup is fully keyboard navigable; visible focus rings
 *
 * IMPORTANT test-harness note on "current tab": Playwright cannot open the
 * real toolbar popup (see e2e/MANUAL.md) — a page navigated to popup.html is
 * itself a normal tab, and would normally become chrome.tabs' "active" tab
 * the moment it's created/focused, which would make `chrome.tabs.query({
 * active: true })` resolve to the popup tab itself instead of the http page
 * under test. Every "save current tab" test below re-activates the intended
 * http page via `page.bringToFront()` immediately before clicking "Save
 * this tab" — `bringToFront()` changes which tab Chrome considers active,
 * but Playwright can still drive the (now background) popup tab's DOM
 * directly afterward.
 */

test.beforeEach(async ({ cleanDashboard }) => {
  // cleanDashboard fixture already gives every test a wiped DB + a solo tab.
  void cleanDashboard;
});

test("one click saves current tab into Last Used collection; warm path is a single click", async ({
  context,
  extensionId,
  testServer,
  cleanDashboard,
}) => {
  const httpPage = await context.newPage();
  await httpPage.goto(testServer.pageUrl("Cold Save Page"));
  await httpPage.bringToFront();

  const popup = await popupPage(context, extensionId);
  await httpPage.bringToFront();

  // Cold start: no last-used collection yet -> clicking "Save this tab" opens the picker.
  await popup.getByRole("button", { name: "Save this tab" }).click();
  await expect(popup.getByText("Name your first collection")).toBeVisible();
  await popup.getByPlaceholder("Collection name").fill("Reading List");
  await popup.getByRole("button", { name: "Create" }).click();

  await expect(popup.getByText(/Saved 1 tab to Reading List/)).toBeVisible();
  await popup.getByRole("button", { name: "Done" }).click();
  await popup.close();

  // Second http page + a fresh popup: now the target is warm (remembered),
  // so a single click on "Save this tab" should save immediately, no picker.
  const httpPage2 = await context.newPage();
  await httpPage2.goto(testServer.pageUrl("Warm Save Page"));
  await httpPage2.bringToFront();
  const popup2 = await popupPage(context, extensionId);
  await httpPage2.bringToFront();

  await expect(popup2.getByText(/Saving to:\s*Reading List/)).toBeVisible();
  await popup2.getByRole("button", { name: "Save this tab" }).click();
  await expect(popup2.getByText(/Saved 1 tab to Reading List/)).toBeVisible();
  await finalScreenshot(popup2, "t07-warm-save-confirm");
  await popup2.close();

  // Sole collection so far -> auto-selected as the dashboard's default route.
  await cleanDashboard.goto(cleanDashboard.url());
  await expect(cleanDashboard.getByRole("heading", { name: "Reading List" })).toBeVisible();
  await expect(cleanDashboard.getByText("Cold Save Page")).toBeVisible();
  await expect(cleanDashboard.getByText("Warm Save Page")).toBeVisible();
});

test("Save all tabs saves every http(s) tab and excludes non-http tabs", async ({
  context,
  extensionId,
  testServer,
  cleanDashboard,
}) => {
  const a = await context.newPage();
  await a.goto(testServer.pageUrl("All Tabs Page A"));
  const b = await context.newPage();
  await b.goto(testServer.pageUrl("All Tabs Page B"));
  // A non-http tab (about:blank) must be excluded from both the count and
  // the saved set — this also covers T14's "non-http tabs excluded
  // gracefully" acceptance item.
  const blank = await context.newPage();
  await blank.goto("about:blank");

  const popup = await popupPage(context, extensionId);
  await expect(popup.getByText(/Save all tabs/)).toBeVisible();
  // allCount badge should read 2 (a, b) — NOT 3 (blank excluded), and NOT
  // counting the popup tab itself (chrome-extension:// is also non-http).
  await expect(popup.getByRole("button", { name: "Save all tabs" })).toContainText("2");

  await popup.getByRole("button", { name: "Save all tabs" }).click();
  // Cold picker still applies to "all" the same as "current".
  await popup.getByPlaceholder("Collection name").fill("Everything");
  await popup.getByRole("button", { name: "Create" }).click();
  await expect(popup.getByText(/Saved 2 tabs to Everything/)).toBeVisible();

  // The optional "Close saved tabs" button only appears for the "all" action.
  const closeBtn = popup.getByRole("button", { name: "Close saved tabs" });
  await expect(closeBtn).toBeVisible();
  await closeBtn.click();
  // closeTabsByUrl's chrome.tabs.remove() call resolves fast — often before
  // a freshly-attached `waitForEvent("close")` listener would even attach,
  // which raced and timed out here in earlier iterations. Poll isClosed()
  // instead of racing an event that may have already fired.
  await expect(async () => {
    expect(a.isClosed()).toBe(true);
    expect(b.isClosed()).toBe(true);
  }).toPass({ timeout: 5000 });
  expect(blank.isClosed()).toBe(false);
  await blank.close();
  await popup.close();

  await cleanDashboard.goto(cleanDashboard.url());
  await expect(cleanDashboard.getByRole("heading", { name: "Everything" })).toBeVisible();
  await expect(cleanDashboard.getByText("All Tabs Page A")).toBeVisible();
  await expect(cleanDashboard.getByText("All Tabs Page B")).toBeVisible();
});

test('"Close saved tabs" never fires on its own (no auto-close without the click)', async ({
  context,
  extensionId,
  testServer,
}) => {
  const a = await context.newPage();
  await a.goto(testServer.pageUrl("Persist Page"));
  const popup = await popupPage(context, extensionId);
  await popup.getByRole("button", { name: "Save all tabs" }).click();
  await popup.getByPlaceholder("Collection name").fill("Persisted");
  await popup.getByRole("button", { name: "Create" }).click();
  await expect(popup.getByText(/Saved 1 tab to Persisted/)).toBeVisible();
  // Wait well past the 6s auto-reset-to-idle window without ever clicking
  // "Close saved tabs" — the source tab must still be open.
  await popup.waitForTimeout(6500);
  expect(a.isClosed()).toBe(false);
  await popup.close();
});

test("highlighting 3 tabs then Save selected saves exactly those 3", async ({
  context,
  extensionId,
  testServer,
  cleanDashboard,
}) => {
  const pages = [];
  for (const name of ["Sel A", "Sel B", "Sel C", "Sel D"]) {
    const p = await context.newPage();
    await p.goto(testServer.pageUrl(name));
    pages.push(p);
  }
  // chrome.tabs "highlighted" (multi-select) state requires a real
  // multi-select, which isn't reachable from Playwright's page-level API —
  // simulate it via the extension's own chrome.tabs.highlight() call (the
  // API Chrome itself uses for ctrl/cmd-click tab-strip multi-select; a
  // per-tab chrome.tabs.update({highlighted:true}) does NOT reliably
  // produce the same multi-highlight state). Runs from an
  // extension-privileged page (chrome.tabs is undefined on a plain http(s)
  // page, even in the same browser) — cleanDashboard is already one.
  // Opening the popup as a NEW tab (context.newPage() -> goto) always
  // collapses any existing multi-highlight down to just that new tab (real
  // Chrome tab-strip semantics: activating a freshly-created tab clears the
  // window's prior selection) — so the popup tab has to already EXIST
  // before the highlight is set, then get (re)loaded into popup.html
  // afterward, which does not disturb the other tabs' highlighted state.
  const popup = await context.newPage();
  await cleanDashboard.evaluate(async () => {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const indexes = tabs
      .filter((t) => t.url?.includes("Sel%20A") || t.url?.includes("Sel%20B") || t.url?.includes("Sel%20C"))
      .map((t) => t.index);
    await chrome.tabs.highlight({ tabs: indexes });
  });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.getByRole("button", { name: "Save selected" })).toBeVisible();
  await popup.getByRole("button", { name: "Save selected" }).click();
  await popup.getByPlaceholder("Collection name").fill("Chosen Three");
  await popup.getByRole("button", { name: "Create" }).click();
  await expect(popup.getByText(/Saved 3 tabs to Chosen Three/)).toBeVisible();
  await popup.close();
  for (const p of pages) await p.close();

  await cleanDashboard.goto(cleanDashboard.url());
  await expect(cleanDashboard.getByRole("heading", { name: "Chosen Three" })).toBeVisible();
  await expect(cleanDashboard.getByText("Sel A", { exact: true })).toBeVisible();
  await expect(cleanDashboard.getByText("Sel B", { exact: true })).toBeVisible();
  await expect(cleanDashboard.getByText("Sel C", { exact: true })).toBeVisible();
  await expect(cleanDashboard.getByText("Sel D", { exact: true })).toHaveCount(0);
});

test("new-collection inline creation works from the picker (with an existing collection present)", async ({
  context,
  extensionId,
  testServer,
}) => {
  const p = await context.newPage();
  await p.goto(testServer.pageUrl("Picker Page"));
  await p.bringToFront();
  const popup = await popupPage(context, extensionId);
  await p.bringToFront();
  await popup.getByRole("button", { name: "Save this tab" }).click();
  await popup.getByPlaceholder("Collection name").fill("First Collection");
  await popup.getByRole("button", { name: "Create" }).click();
  await expect(popup.getByText(/Saved 1 tab/)).toBeVisible();
  await popup.getByRole("button", { name: "Done" }).click();
  await popup.close();

  // Fresh popup, click Change to reopen the picker with an existing
  // collection present -> "+ New collection…" row -> inline create.
  const p2 = await context.newPage();
  await p2.goto(testServer.pageUrl("Picker Page 2"));
  const popup2 = await popupPage(context, extensionId);
  await p2.bringToFront();
  await popup2.getByRole("button", { name: "Change" }).click();
  await popup2.getByText("+ New collection…").click();
  await popup2.getByPlaceholder("Collection name").fill("Second Collection");
  await popup2.getByRole("button", { name: "Create" }).click();
  await expect(popup2.getByText(/Saving to:\s*Second Collection/)).toBeVisible();
  await finalScreenshot(popup2, "t07-picker-inline-create");
  await popup2.close();
});

test("recent collections list opens the dashboard focused on that collection", async ({
  context,
  extensionId,
  testServer,
  cleanDashboard,
}) => {
  const p = await context.newPage();
  await p.goto(testServer.pageUrl("Recent Page"));
  await p.bringToFront();
  const popup = await popupPage(context, extensionId);
  await p.bringToFront();
  await popup.getByRole("button", { name: "Save this tab" }).click();
  await popup.getByPlaceholder("Collection name").fill("Recent Target");
  await popup.getByRole("button", { name: "Create" }).click();
  await expect(popup.getByText(/Saved 1 tab/)).toBeVisible();
  await popup.getByRole("button", { name: "Done" }).click();

  await expect(popup.getByRole("heading", { name: "Recent" })).toBeVisible();
  const [newTab] = await Promise.all([
    context.waitForEvent("page"),
    popup.getByRole("button", { name: "Recent Target" }).click(),
  ]);
  await newTab.waitForLoadState();
  expect(newTab.url()).toContain("dashboard.html#/c/");
  await expect(newTab.getByRole("heading", { name: "Recent Target" })).toBeVisible();
  await newTab.close();
  await popup.close();
  void cleanDashboard;
});

test("popup is fully keyboard navigable with visible focus rings", async ({ context, extensionId, testServer }) => {
  const p = await context.newPage();
  await p.goto(testServer.pageUrl("Keyboard Page"));
  await p.bringToFront();
  const popup = await popupPage(context, extensionId);
  await p.bringToFront();

  await popup.locator("body").click({ position: { x: 5, y: 5 } }); // ensure the extension page itself has focus
  await popup.keyboard.press("Tab"); // search input
  await popup.keyboard.press("Tab"); // Save this tab
  const saveBtn = popup.getByRole("button", { name: "Save this tab" });
  await expect(saveBtn).toBeFocused();
  const outline = await saveBtn.evaluate((el) => getComputedStyle(el).outlineStyle + getComputedStyle(el).boxShadow);
  // focus-visible:ring-2 renders as a box-shadow (Tailwind's ring utility),
  // not a native outline — just assert SOME visible focus affordance exists
  // (not "none"/"" for both).
  expect(outline).not.toBe("nonenone");

  await popup.keyboard.press("Enter");
  await expect(popup.getByText("Name your first collection")).toBeVisible();
  await popup.getByPlaceholder("Collection name").fill("Kbd Collection");
  await popup.keyboard.press("Enter");
  await expect(popup.getByText(/Saved 1 tab/)).toBeVisible();
  await finalScreenshot(popup, "t07-popup-keyboard");
  await popup.close();
});

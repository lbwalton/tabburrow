import { test, expect, popupPage } from "../fixtures";
import { finalScreenshot } from "../test-utils";

/**
 * T7 — Popup save flows, retargeted to the redesigned popup hub (R10/R11).
 * The old flat SaveBar + RecentList are gone; the current model is:
 *   - An orange "Save" SPLIT button in the home header. Its main click saves
 *     the current tab to the resolved default (opening the picker + pinning
 *     the chosen folder when none is set yet), and a caret button ("More save
 *     options") opens a menu holding "Save all tabs (N)" (with a "To {default}"
 *     item), "Save selected tabs (N)", "Choose a folder…", etc.
 *   - The old "Saving to: {name}" line is now the "1-click Save goes to {name}"
 *     control with a "Change" (target set) / "Choose" (no target) button.
 *   - The confirm view ("Saved N tabs to X", "Close saved tabs", "Done") is
 *     unchanged.
 * The old "recent collections list opens the dashboard" test is obsolete —
 * RecentList was replaced by the folders-home list (covered by
 * r10-popup-hub.spec.ts) — and has been removed.
 *
 * IMPORTANT test-harness note on "current tab": Playwright cannot open the
 * real toolbar popup (see e2e/MANUAL.md) — a page navigated to popup.html is
 * itself a normal tab, and would normally become chrome.tabs' "active" tab
 * the moment it's created/focused, which would make `chrome.tabs.query({
 * active: true })` resolve to the popup tab itself instead of the http page
 * under test. Every "save current tab" test below re-activates the intended
 * http page via `page.bringToFront()` immediately before clicking "Save" —
 * `bringToFront()` changes which tab Chrome considers active, but Playwright
 * can still drive the (now background) popup tab's DOM directly afterward.
 */

test.beforeEach(async ({ cleanDashboard }) => {
  // cleanDashboard fixture already gives every test a wiped DB + a solo tab.
  void cleanDashboard;
});

test("one click saves the current tab to the pinned default; warm path is a single click", async ({
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

  // Cold start: no default folder yet -> the "Save" main button opens the
  // picker (first-run empty state), and the folder it creates is pinned as the
  // default so subsequent Saves are truly one click.
  await popup.getByRole("button", { name: "Save", exact: true }).click();
  await expect(popup.getByText("Name your first collection")).toBeVisible();
  await popup.getByPlaceholder("Collection name").fill("Reading List");
  await popup.getByRole("button", { name: "Create" }).click();

  await expect(popup.getByText(/Saved 1 tab to Reading List/)).toBeVisible();
  await popup.getByRole("button", { name: "Done" }).click();
  await popup.close();

  // Second http page + a fresh popup: the default is now pinned (warm), so the
  // "1-click Save goes to" line shows it and a single "Save" click saves
  // immediately, no picker.
  const httpPage2 = await context.newPage();
  await httpPage2.goto(testServer.pageUrl("Warm Save Page"));
  await httpPage2.bringToFront();
  const popup2 = await popupPage(context, extensionId);
  await httpPage2.bringToFront();

  await expect(popup2.getByText("1-click Save goes to")).toBeVisible();
  await expect(popup2.getByRole("button", { name: "Change", exact: true })).toBeVisible();
  await popup2.getByRole("button", { name: "Save", exact: true }).click();
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
  await expect(popup.getByRole("button", { name: "More save options" })).toBeVisible();
  await popup.getByRole("button", { name: "More save options" }).click();

  // The "Save all tabs (N)" menu group counts only http(s) tabs: 2 (a, b) —
  // NOT the about:blank tab, NOT the popup's own chrome-extension:// page, NOT
  // the dashboard.
  await expect(popup.getByText("Save all tabs (2)")).toBeVisible();

  // Cold (no default) -> the "To the default folder" item opens the picker for
  // the "all" action, same as the main Save does for "current".
  await popup.getByRole("menuitem", { name: "To the default folder" }).click();
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
  await popup.getByRole("button", { name: "More save options" }).click();
  await popup.getByRole("menuitem", { name: "To the default folder" }).click();
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

  // "Save selected tabs (N)" now lives in the caret menu, and only appears
  // when 2+ tabs are highlighted.
  await popup.getByRole("button", { name: "More save options" }).click();
  await popup.getByRole("menuitem", { name: "Save selected tabs (3)" }).click();
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
  // Cold save creates + pins the first folder as the default.
  await popup.getByRole("button", { name: "Save", exact: true }).click();
  await popup.getByPlaceholder("Collection name").fill("First Collection");
  await popup.getByRole("button", { name: "Create" }).click();
  await expect(popup.getByText(/Saved 1 tab/)).toBeVisible();
  await popup.getByRole("button", { name: "Done" }).click();
  await popup.close();

  // Fresh popup: a default is now pinned, so the target-line button reads
  // "Change". Click it to reopen the picker WITH an existing collection present
  // -> "+ New collection…" row -> inline create.
  const p2 = await context.newPage();
  await p2.goto(testServer.pageUrl("Picker Page 2"));
  const popup2 = await popupPage(context, extensionId);
  await p2.bringToFront();
  await popup2.getByRole("button", { name: "Change", exact: true }).click();
  await expect(popup2.getByText("Save to…")).toBeVisible();
  await popup2.getByText("+ New collection…").click();
  await popup2.getByPlaceholder("Collection name").fill("Second Collection");
  await popup2.getByRole("button", { name: "Create" }).click();

  // The picker resolves back home with Second Collection pinned as the target.
  const targetLine = popup2.getByText("1-click Save goes to").locator("..");
  await expect(targetLine).toContainText("Second Collection");
  await finalScreenshot(popup2, "t07-picker-inline-create");
  await popup2.close();
});

test("popup home is keyboard navigable with visible focus rings", async ({ context, extensionId, testServer }) => {
  const p = await context.newPage();
  await p.goto(testServer.pageUrl("Keyboard Page"));
  await p.bringToFront();
  const popup = await popupPage(context, extensionId);
  await p.bringToFront();

  await popup.locator("body").click({ position: { x: 5, y: 5 } }); // ensure the extension page itself has focus
  await popup.keyboard.press("Tab"); // search toggle (first focusable)
  await popup.keyboard.press("Tab"); // "Save" main button
  const saveBtn = popup.getByRole("button", { name: "Save", exact: true });
  await expect(saveBtn).toBeFocused();
  const focusStyle = await saveBtn.evaluate((el) => getComputedStyle(el).outlineStyle + getComputedStyle(el).boxShadow);
  // focus-visible:ring-2 renders as a box-shadow (Tailwind's ring utility),
  // not a native outline — just assert SOME visible focus affordance exists
  // (not "none"/"" for both).
  expect(focusStyle).not.toBe("nonenone");

  // Enter on the focused "Save" opens the picker (cold); its create input is
  // autofocused, so type + Enter saves the current tab.
  await popup.keyboard.press("Enter");
  await expect(popup.getByText("Name your first collection")).toBeVisible();
  await popup.getByPlaceholder("Collection name").fill("Kbd Collection");
  await popup.keyboard.press("Enter");
  await expect(popup.getByText(/Saved 1 tab/)).toBeVisible();
  await finalScreenshot(popup, "t07-popup-keyboard");
  await popup.close();
});

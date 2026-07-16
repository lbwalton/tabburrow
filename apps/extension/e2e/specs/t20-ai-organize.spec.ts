import { randomUUID } from "node:crypto";
import { test, expect, closeExtensionContext, launchExtensionContext, signInWithEmailOtp } from "../fixtures";
import { loadRootEnv } from "../env";
import { deleteAdminUser, findAdminUserByEmail } from "../admin";
import { seedCollectionsAndLinks, seedPosition } from "../seed";
import { finalScreenshot } from "../test-utils";

/**
 * T20 — AI organize UI (AiOrganizeDialog.tsx, lib/ai.ts).
 *
 * Two kinds of coverage:
 *  - ONE live happy-path test, tagged `@live-ai`, that actually calls the
 *    real `ai-organize` Edge Function (which calls real Anthropic) —
 *    everything else about this feature (pure planning helpers, error
 *    branches) is either a vitest unit test (lib/ai.test.ts) or one of the
 *    MOCKED tests below. Skips itself (with a clear reason) unless the
 *    local stack, an ANTHROPIC_API_KEY, AND the function itself are all
 *    actually reachable — `probeAiOrganizeReachable` checks the last of
 *    those with a real (unauthenticated) request, so a stack that's up but
 *    hasn't got the function deployed/served fails the same clean "skip",
 *    not a confusing timeout deep inside the test.
 *  - Error-path tests that mock the ai-organize response via Playwright's
 *    page-level route interception — 402 (quota) and 502 (upstream). This
 *    works because `organizeLinks` (lib/ai.ts) calls `fetch` directly from
 *    the DASHBOARD PAGE (AiOrganizeDialog is a page-level React component),
 *    not from the background service worker — Playwright reliably
 *    intercepts page-originated fetches (unlike the service worker's own
 *    fetches; see t18-sync.spec.ts's FREE-gate test docstring for that
 *    distinction).
 *
 * Requires the local stack running (`supabase start`) with
 * SUPABASE_SERVICE_ROLE_KEY set in the root .env — every test below skips
 * itself with a clear reason if that key is absent, same guard every other
 * "needs live infra" spec in this suite uses.
 */

const env = loadRootEnv();
const SUPABASE_URL = env.SUPABASE_URL || "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;

/**
 * A POST with no Authorization header against the REAL local ai-organize
 * function returns 401 (requireUser() rejecting an absent JWT) if the
 * function process is actually up and serving; a connection failure,
 * timeout, or 404 means it isn't. This is the exact same probe this task's
 * brief describes ("skip-unless-env pattern... probe first").
 */
async function probeAiOrganizeReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-organize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ links: [] }),
      signal: AbortSignal.timeout(5_000),
    });
    return res.status === 401;
  } catch {
    return false;
  }
}

/** Idempotent per-test cleanup, same pattern t18-sync.spec.ts uses: deletes any stray user left behind by a prior crashed run, by email. */
async function cleanupStrayUser(email: string): Promise<void> {
  const existing = await findAdminUserByEmail(SUPABASE_URL, SERVICE_ROLE_KEY!, email);
  if (existing) await deleteAdminUser(SUPABASE_URL, SERVICE_ROLE_KEY!, existing.id);
}

/** 12 links across four topics (dev docs / recipes / video / shopping) — mirrors the acceptance criterion's "dev docs, recipes, YouTube, shopping" mix, small enough to keep the live API call fast and cheap. */
const MIXED_LINKS: Array<{ title: string; url: string }> = [
  { title: "useEffect – React Docs", url: "https://react.dev/reference/react/useEffect" },
  { title: "TypeScript Handbook: Generics", url: "https://www.typescriptlang.org/docs/handbook/2/generics.html" },
  { title: "PostgreSQL: Row Security Policies", url: "https://www.postgresql.org/docs/current/ddl-rowsecurity.html" },
  { title: "Best Chocolate Chip Cookies Recipe", url: "https://www.allrecipes.com/recipe/10813/best-chocolate-chip-cookies/" },
  { title: "Homemade Pizza Dough Recipe", url: "https://sallysbakingaddiction.com/pizza-dough/" },
  { title: "Easy Pasta Carbonara", url: "https://www.bonappetit.com/recipe/carbonara" },
  { title: "Neural Networks Explained - 3Blue1Brown", url: "https://www.youtube.com/watch?v=aircAruvnKk" },
  { title: "The Backrooms, Explained", url: "https://www.youtube.com/watch?v=zzBackrooms01" },
  { title: "Kurzgesagt – The Egg", url: "https://www.youtube.com/watch?v=h6fcK_fRYaI" },
  { title: "Standing Desk - Amazon.com", url: "https://www.amazon.com/dp/B08STANDDESK" },
  { title: "Mechanical Keyboard - Best Buy", url: "https://www.bestbuy.com/site/keyboard/6430123.p" },
  { title: "Running Shoes - Nike.com", url: "https://www.nike.com/t/pegasus-40-running-shoes-example" },
];

test(
  "live: organize 12 mixed links, uncheck a group, apply — rail gains the accepted groups' collections, source count drops, tags visible",
  { tag: "@live-ai" },
  async () => {
    test.skip(!SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY not set in root .env — see SELF_HOSTING.md");
    test.skip(!ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY not set in root .env — this test needs a real key");
    const reachable = await probeAiOrganizeReachable();
    test.skip(!reachable, "ai-organize function not reachable on the local stack — is `supabase start` running?");
    test.setTimeout(120_000);

    const email = "e2e-ai-organize-live@tabburrow.test";
    await cleanupStrayUser(email);

    const { context, extensionId, userDataDir } = await launchExtensionContext();
    try {
      const dash = await context.newPage();
      await dash.goto(`chrome-extension://${extensionId}/dashboard.html`);

      const collectionId = randomUUID();
      await seedCollectionsAndLinks(
        dash,
        [{ id: collectionId, name: "Mixed Links", position: seedPosition(0) }],
        MIXED_LINKS.map((link, i) => ({
          id: randomUUID(),
          collectionId,
          url: link.url,
          title: link.title,
          position: seedPosition(i),
        })),
      );
      await dash.reload();

      await dash.goto(`chrome-extension://${extensionId}/dashboard.html#/settings`);
      await signInWithEmailOtp(dash, email);

      await dash.goto(`chrome-extension://${extensionId}/dashboard.html#/c/${collectionId}`);
      const sourceGrid = dash.getByRole("listbox", { name: "Links" });
      await expect(sourceGrid.getByRole("option")).toHaveCount(12);

      await dash.getByRole("button", { name: "Organize with AI" }).click();
      const dialog = dash.getByRole("dialog", { name: "Organize with AI" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(/of 30 left this month/)).toBeVisible();
      await dialog.getByRole("button", { name: "Organize", exact: true }).click();

      // The live Anthropic call — T19's report observed ~6.5s for 10 links;
      // budget generously for network variance.
      const groupCards = dialog.getByRole("group");
      await expect(groupCards.first()).toBeVisible({ timeout: 45_000 });

      const groupCount = await groupCards.count();
      expect(groupCount).toBeGreaterThanOrEqual(2); // server relaxes to 1 only under 4 input links
      expect(groupCount).toBeLessThanOrEqual(6);

      // Every one of the 12 links is assigned to exactly one group.
      await expect(dialog.getByRole("listitem")).toHaveCount(12);
      await finalScreenshot(dash, "t20-ai-organize-preview");

      // Capture each group's AI-generated name (role="group"'s aria-label —
      // see AiOrganizeDialog.tsx) BEFORE applying, so the assertions below
      // can navigate the rail by name afterward instead of guessing at
      // click-target ordering (CollectionRow renders several buttons per
      // row — grip handle, name, rename, accent, delete — and only the
      // NAME one navigates).
      const groupNames: string[] = [];
      for (let i = 0; i < groupCount; i++) {
        groupNames.push((await groupCards.nth(i).getAttribute("aria-label")) ?? "");
      }

      // Uncheck the first group — its members must stay behind in "Mixed
      // Links" once applied.
      const firstGroup = groupCards.first();
      const excludedMemberCount = await firstGroup.getByRole("listitem").count();
      await firstGroup.getByRole("checkbox").uncheck();

      const acceptedGroupCount = groupCount - 1;
      await dialog
        .getByRole("button", { name: `Apply (${acceptedGroupCount} group${acceptedGroupCount === 1 ? "" : "s"})` })
        .click();

      await expect(dialog).toHaveCount(0, { timeout: 15_000 });
      await expect(dash.getByText(/Organized \d+ links? into \d+ collections?/)).toBeVisible();

      // Rail gained exactly one NEW collection per accepted group — nothing
      // pre-existing shares a name with an AI-generated group, so every
      // accepted group creates rather than merges.
      const rail = dash.getByRole("navigation", { name: "Collections" });
      await expect(rail.getByRole("listitem")).toHaveCount(1 + acceptedGroupCount);
      await expect(rail.getByText("Mixed Links")).toBeVisible();

      // Source collection kept exactly the excluded group's links.
      await expect(sourceGrid.getByRole("option")).toHaveCount(excludedMemberCount);
      await finalScreenshot(dash, "t20-ai-organize-applied");

      // Tags are visible on at least one moved card — navigate to one of the
      // ACCEPTED (non-excluded) groups' target collection BY NAME (index 1,
      // since index 0 was unchecked above and groupCount >= 2 is asserted
      // above).
      const acceptedGroupName = groupNames[1]!;
      await rail.getByRole("button", { name: acceptedGroupName, exact: true }).click();
      const newGrid = dash.getByRole("listbox", { name: "Links" });
      await expect(newGrid.getByRole("option").first()).toBeVisible();
      await expect(newGrid.locator("span.rounded-full").first()).toBeVisible();

      const authUser = await findAdminUserByEmail(SUPABASE_URL, SERVICE_ROLE_KEY!, email);
      if (authUser) await deleteAdminUser(SUPABASE_URL, SERVICE_ROLE_KEY!, authUser.id);
    } finally {
      await closeExtensionContext(context, userDataDir);
    }
  },
);

test("error paths (mocked): a 402 shows the quota state with an upgrade CTA; a 502 shows a retry state", async () => {
  test.skip(!SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY not set in root .env — see SELF_HOSTING.md");
  test.setTimeout(60_000);

  const email = "e2e-ai-organize-errors@tabburrow.test";
  await cleanupStrayUser(email);

  const { context, extensionId, userDataDir } = await launchExtensionContext();
  try {
    const dash = await context.newPage();
    await dash.goto(`chrome-extension://${extensionId}/dashboard.html`);

    const collectionId = randomUUID();
    await seedCollectionsAndLinks(
      dash,
      [{ id: collectionId, name: "Error Path Test", position: seedPosition(0) }],
      [
        { id: randomUUID(), collectionId, url: "https://example.com/1", title: "Example One", position: seedPosition(0) },
        { id: randomUUID(), collectionId, url: "https://example.com/2", title: "Example Two", position: seedPosition(1) },
      ],
    );
    await dash.reload();

    await dash.goto(`chrome-extension://${extensionId}/dashboard.html#/settings`);
    await signInWithEmailOtp(dash, email);
    await dash.goto(`chrome-extension://${extensionId}/dashboard.html#/c/${collectionId}`);

    // --- 402 quota ---
    await dash.route("**/functions/v1/ai-organize", async (route) => {
      await route.fulfill({
        status: 402,
        contentType: "application/json",
        body: JSON.stringify({ error: "quota", used: 30, limit: 30 }),
      });
    });

    await dash.getByRole("button", { name: "Organize with AI" }).click();
    const dialog = dash.getByRole("dialog", { name: "Organize with AI" });
    await dialog.getByRole("button", { name: "Organize", exact: true }).click();

    await expect(dialog.getByText("You've used all 30 free AI organizes this month.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "See PRO pricing" })).toBeVisible();
    // Not an error dump: no raw {"error":"quota"...} JSON, no generic failure copy.
    await expect(dialog.getByText("error", { exact: false })).toHaveCount(0);
    await finalScreenshot(dash, "t20-ai-organize-quota-state");

    await dialog.getByRole("button", { name: "Dismiss" }).click();
    await expect(dialog).toHaveCount(0);
    await dash.unroute("**/functions/v1/ai-organize");

    // --- 502 upstream -> friendly retry ---
    await dash.route("**/functions/v1/ai-organize", async (route) => {
      await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "upstream" }) });
    });

    await dash.getByRole("button", { name: "Organize with AI" }).click();
    const dialog2 = dash.getByRole("dialog", { name: "Organize with AI" });
    await dialog2.getByRole("button", { name: "Organize", exact: true }).click();

    await expect(dialog2.getByText("AI organize is temporarily unavailable. Try again in a moment.")).toBeVisible();
    await expect(dialog2.getByRole("button", { name: "Retry" })).toBeVisible();
    await finalScreenshot(dash, "t20-ai-organize-upstream-retry");
    await dash.unroute("**/functions/v1/ai-organize");

    const authUser = await findAdminUserByEmail(SUPABASE_URL, SERVICE_ROLE_KEY!, email);
    if (authUser) await deleteAdminUser(SUPABASE_URL, SERVICE_ROLE_KEY!, authUser.id);
  } finally {
    await closeExtensionContext(context, userDataDir);
  }
});

test("signed-out state: the menu item shows a lock glyph and the dialog offers Sign in instead of Organize", async ({
  cleanDashboard,
  extensionId,
}) => {
  const dash = cleanDashboard;

  const collectionId = randomUUID();
  await seedCollectionsAndLinks(
    dash,
    [{ id: collectionId, name: "Signed Out Test", position: seedPosition(0) }],
    [{ id: randomUUID(), collectionId, url: "https://example.com/1", title: "Example One", position: seedPosition(0) }],
  );
  await dash.reload();
  await dash.goto(`chrome-extension://${extensionId}/dashboard.html#/c/${collectionId}`);

  const trigger = dash.getByRole("button", { name: "🔒 Organize with AI" });
  await expect(trigger).toBeVisible();
  await trigger.click();

  const dialog = dash.getByRole("dialog", { name: "Organize with AI" });
  await expect(dialog.getByText("Sign in to use AI organize: titles and links are sent to the AI service, never page content.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Organize", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Sign in" })).toBeVisible();
  await finalScreenshot(dash, "t20-ai-organize-signed-out");
});

test("?organize=1 deep link auto-opens the dialog once; the flag is stripped via replaceState so Back never re-triggers it", async ({
  cleanDashboard,
  extensionId,
}) => {
  const dash = cleanDashboard;

  const collectionId = randomUUID();
  await seedCollectionsAndLinks(
    dash,
    [{ id: collectionId, name: "Back Button Test", position: seedPosition(0) }],
    [{ id: randomUUID(), collectionId, url: "https://example.com/1", title: "Example One", position: seedPosition(0) }],
  );
  await dash.reload();

  // Deep-link with the organize flag — the dashboard must auto-open the
  // dialog (in the signed-out state here; WHICH state it opens in is
  // irrelevant to the history mechanics under test).
  await dash.goto(`chrome-extension://${extensionId}/dashboard.html#/c/${collectionId}?organize=1`);
  const dialog = dash.getByRole("dialog", { name: "Organize with AI" });
  await expect(dialog).toBeVisible();

  // The flag is consumed and stripped from the URL...
  await expect.poll(() => dash.evaluate(() => window.location.hash)).not.toContain("organize=1");

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);

  // ...and because the strip REPLACED the flagged history entry (rather
  // than pushing a stripped entry on top of it), Back does not land on the
  // flagged URL and must NOT re-open the dialog.
  await dash.goBack();
  const hashAfterBack = await dash.evaluate(() => window.location.hash);
  expect(hashAfterBack).not.toContain("organize=1");
  // Give a wrongly-retriggered auto-open time to fire before asserting it didn't.
  await dash.waitForTimeout(500);
  await expect(dialog).toHaveCount(0);
});

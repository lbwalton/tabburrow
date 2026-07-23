import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";

import { EXTENSION_PATH, resetData, signInWithEmailOtp } from "./fixtures";
import { seedCollectionsAndLinks, seedMeta, seedPosition, seedSnapshots } from "./seed";
import type { SeedCollection, SeedLink } from "./seed";
import { loadRootEnv } from "./env";
import { deleteAdminUser, findAdminUserByEmail } from "./admin";

/**
 * Launch demo video (assets/demo.mp4) + README GIF (assets/readme-demo.gif)
 * capture — records the REAL built extension end-to-end with Playwright's
 * `recordVideo`, then cuts/speeds the footage with ffmpeg. Sibling of
 * capture-assets.ts (same not-a-Playwright-test pattern: no `test()` blocks,
 * so `pnpm e2e` never picks it up; same fixtures/seed/admin/env harness
 * imports; same "product-truthful capture, not a mockup" rule).
 *
 * Demo beats, all driven live in the real extension:
 *  a. popup folders home (folder list with counts + the "1-click Save goes
 *     to" control) → one-click Save → confirm view
 *  b. caret menu → "Save all tabs (N)" → "Choose a folder…" → create
 *     "Quick Saves" in the picker → "Saved N tabs to Quick Saves"
 *  c. dashboard collection grid → "Organize with AI" run LIVE against the
 *     local Supabase stack's ai-organize function (the wait is compressed to
 *     ~2s in post) → preview groups → Apply → the rail gains new collections
 *  d. Sessions pane (snapshot list), then "Restore all" on a collection
 *
 * Run (from apps/extension):
 *   npx tsx e2e/capture-demo.ts [phase]
 *   phase: all (default) | capture | post
 *
 * "capture" records raw .webm footage + beat-marker timestamps into a work
 * dir (DEMO_RAW_DIR env var, default <tmpdir>/tabburrow-demo-raw) and keeps
 * it, so "post" (the ffmpeg cut) can be re-run/tuned without re-recording —
 * the live AI beat is the expensive part.
 *
 * Requires:
 *  - `pnpm --filter extension build:e2e` already run (see capture-assets.ts's
 *    docstring for why build:e2e, not plain build)
 *  - the local Supabase stack running WITH env (`set -a; source .env; set +a;
 *    supabase start` from the repo root) — sign-in uses Mailpit OTP and the
 *    AI beat calls the real ai-organize edge function (needs
 *    ANTHROPIC_API_KEY in the edge runtime)
 *  - ffmpeg on PATH
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(EXTENSION_DIR, "../..");
const ASSETS_DIR = path.resolve(REPO_ROOT, "assets");
const RAW_DIR = process.env.DEMO_RAW_DIR || path.join(os.tmpdir(), "tabburrow-demo-raw");
const VIDEOS_DIR = path.join(RAW_DIR, "videos");
const SEGS_DIR = path.join(RAW_DIR, "segs");
const MARKERS_PATH = path.join(RAW_DIR, "markers.json");
const BG_PNG_PATH = path.join(RAW_DIR, "bg.png");
const POPUP_WEBM = path.join(RAW_DIR, "popup.webm");
const DASH_WEBM = path.join(RAW_DIR, "dash.webm");
const OUT_MP4 = path.join(ASSETS_DIR, "demo.mp4");
const OUT_GIF = path.join(ASSETS_DIR, "readme-demo.gif");

const CAPTURE_HEADLESS = process.env.CAPTURE_HEADLESS === "false" ? false : true;
const VIEW = { width: 1280, height: 800 };
/** The popup rides in its own tab at its natural 360px width. Playwright's
 * recorder only ever scales pages DOWN to fit the recording canvas — a
 * 360x640 viewport inside the 1280x800 canvas is captured 1:1 at the
 * top-left corner, padded with gray (verified on this footage). The post
 * step crops that native-resolution region back out and overlays it on a
 * screenshot of the active tab, popup-over-page style. */
const POPUP_VIEW = { width: 360, height: 640 };

const DEMO_EMAIL = "capture-demo@tabburrow.test";

// ---------------------------------------------------------------------------
// Seed data — same realistic-browser convention capture-assets.ts set (titles
// + public URLs referenced only, never fetched).
// ---------------------------------------------------------------------------

type SeedItem = { title: string; url: string; note?: string; tags?: string[] };

const KITCHEN_RENO_LINKS: SeedItem[] = [
  { title: "Best Semi-Custom Cabinets, Reviewed - This Old House", url: "https://www.thisoldhouse.com/kitchens/best-semi-custom-cabinets" },
  { title: "Quartz vs. Granite Countertops - Consumer Reports", url: "https://www.consumerreports.org/home-garden/kitchen/quartz-vs-granite-countertops" },
  { title: "SEKTION Kitchen System - IKEA", url: "https://www.ikea.com/us/en/cat/sektion-kitchen-cabinet-system-38869/", note: "Fits an 8ft run", tags: ["cabinets", "budget"] },
  { title: "How to Install a Farmhouse Sink - Family Handyman", url: "https://www.familyhandyman.com/project/how-to-install-a-farmhouse-sink/" },
  { title: "Kitchen Island Size Guide - Houzz", url: "https://www.houzz.com/magazine/kitchen-island-size-guide" },
  { title: "20 Subway Tile Backsplash Ideas - Better Homes & Gardens", url: "https://www.bhg.com/kitchen/backsplash/subway-tile-backsplash-ideas/" },
  { title: "Best Cabinet Hardware for the Money - Wirecutter", url: "https://www.nytimes.com/wirecutter/reviews/best-cabinet-hardware/", tags: ["hardware"] },
  { title: "Undermount vs. Drop-In Sinks - The Spruce", url: "https://www.thespruce.com/undermount-vs-drop-in-sinks-1821244" },
];

const COMPETITOR_LINKS: SeedItem[] = [
  { title: "Notion Pricing - Notion", url: "https://www.notion.so/pricing" },
  { title: "Linear Changelog", url: "https://linear.app/changelog" },
  { title: "How Superhuman Built Its Onboarding - Lenny's Newsletter", url: "https://www.lennysnewsletter.com/p/how-superhuman-built-onboarding" },
  { title: "Raycast vs Alfred: A Comparison - Raycast Blog", url: "https://www.raycast.com/blog/raycast-vs-alfred" },
  { title: "Arc Browser Teardown - Failory", url: "https://www.failory.com/blog/arc-browser" },
];

const PORTLAND_LINKS: SeedItem[] = [
  { title: "Powell's City of Books", url: "https://www.powells.com/" },
  { title: "Pine State Biscuits Menu", url: "https://www.pinestatebiscuits.com/menu" },
  { title: "Forest Park Trail Map - Portland Parks & Rec", url: "https://www.portland.gov/parks/forest-park" },
  { title: "Best Food Carts in Portland 2026 - Eater PDX", url: "https://pdx.eater.com/maps/best-portland-food-carts" },
];

const DEV_DOCS_LINKS: SeedItem[] = [
  { title: "useEffect – React Docs", url: "https://react.dev/reference/react/useEffect" },
  { title: "TypeScript Handbook: Generics", url: "https://www.typescriptlang.org/docs/handbook/2/generics.html" },
  { title: "IndexedDB API - MDN", url: "https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API" },
  { title: "Dexie.js: React Tutorial", url: "https://dexie.org/docs/Tutorial/React" },
  { title: "WXT Documentation", url: "https://wxt.dev/guide/introduction.html" },
];

const RECIPES_LINKS: SeedItem[] = [
  { title: "Best Chocolate Chip Cookies - Sally's Baking Addiction", url: "https://sallysbakingaddiction.com/best-chocolate-chip-cookies/" },
  { title: "Easy Weeknight Carbonara - Bon Appétit", url: "https://www.bonappetit.com/recipe/easy-carbonara" },
  { title: "No-Knead Bread - NYT Cooking", url: "https://cooking.nytimes.com/recipes/no-knead-bread" },
  { title: "Sheet Pan Gnocchi - Half Baked Harvest", url: "https://www.halfbakedharvest.com/sheet-pan-gnocchi/" },
];

/** The deliberately messy mixed-topic collection the LIVE AI-organize beat runs on — same shape as capture-assets.ts's MESSY_TABS_LINKS. */
const MESSY_TABS_LINKS: SeedItem[] = [
  { title: "Array.prototype.flatMap() - MDN", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/flatMap" },
  { title: "Tailwind CSS: Grid Template Columns", url: "https://tailwindcss.com/docs/grid-template-columns" },
  { title: "GitHub Actions: Reusable Workflows", url: "https://docs.github.com/en/actions/using-workflows/reusing-workflows" },
  { title: "Vite Config Reference", url: "https://vitejs.dev/config/" },
  { title: "Homemade Focaccia - Smitten Kitchen", url: "https://smittenkitchen.com/2021/homemade-focaccia/" },
  { title: "Weeknight Pad Thai - Serious Eats", url: "https://www.seriouseats.com/weeknight-pad-thai" },
  { title: "Perfect Roast Chicken - Bon Appétit", url: "https://www.bonappetit.com/recipe/perfect-roast-chicken" },
  { title: "Overnight Oats 5 Ways - Budget Bytes", url: "https://www.budgetbytes.com/overnight-oats-5-ways/" },
  { title: "Powell's City of Books", url: "https://www.powells.com/" },
  { title: "Multnomah Falls Hike Guide - Oregon Hikers", url: "https://www.oregonhikers.org/field-guide/multnomah-falls" },
  { title: "Best Coffee Roasters in Portland - Sprudge", url: "https://sprudge.com/portland-coffee-roasters-guide" },
  { title: "PDX to Downtown: MAX Light Rail Schedule - TriMet", url: "https://trimet.org/max/redline" },
  { title: "Standing Desk Converter - Amazon.com", url: "https://www.amazon.com/dp/B08STANDDESK2" },
  { title: "Mechanical Keyboard, 75% Layout - Best Buy", url: "https://www.bestbuy.com/site/keyboard/6430987.p" },
  { title: "Merino Wool Base Layer - REI Co-op", url: "https://www.rei.com/product/merino-wool-base-layer" },
  { title: "Cast Iron Skillet, 12-inch - Williams Sonoma", url: "https://www.williams-sonoma.com/products/lodge-cast-iron-skillet-12in/" },
];

function toSeedLinks(collectionId: string, items: SeedItem[]): SeedLink[] {
  return items.map((item, i) => ({
    id: randomUUID(),
    collectionId,
    url: item.url,
    title: item.title,
    position: seedPosition(i),
    note: item.note ?? null,
    tags: item.tags ?? [],
  }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

interface LocalServer {
  server: http.Server;
  pageUrl(title: string): string;
}

/** Same tiny titled-page server as fixtures.ts's worker fixture (duplicated for standalone use — see capture-assets.ts's identical note). */
function startLocalServer(): Promise<LocalServer> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const title = url.searchParams.get("title") ?? "Test Page";
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(
        `<!doctype html><html><head><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1></body></html>`,
      );
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const baseUrl = `http://127.0.0.1:${port}`;
      resolve({ server, pageUrl: (title: string) => `${baseUrl}/?title=${encodeURIComponent(title)}` });
    });
  });
}

function log(msg: string): void {
  console.log(`\n=== ${msg} ===`);
}

function ffmpeg(args: string): void {
  execSync(`ffmpeg -hide_banner -loglevel error -y ${args}`, { stdio: "pipe" });
}

function ffprobeDuration(file: string): number {
  const out = execSync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${file}"`,
  ).toString();
  return parseFloat(out.trim());
}

interface Markers {
  /** seconds since the popup page's video started */
  popup: Record<string, number>;
  /** seconds since the dashboard beats page's video started */
  dash: Record<string, number>;
}

/** Beat-marker clock: seconds since the owning page (and so its .webm) was created — the post step cuts on these. */
function makeMarkerClock(store: Record<string, number>) {
  const t0 = Date.now();
  return (name: string) => {
    store[name] = Math.round((Date.now() - t0) / 10) / 100;
  };
}

// ---------------------------------------------------------------------------
// Phase: capture — record the real flows into RAW_DIR
// ---------------------------------------------------------------------------

async function phaseCapture(): Promise<void> {
  log("Phase capture: recording the live demo flows");
  fs.rmSync(VIDEOS_DIR, { recursive: true, force: true });
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });

  const env = loadRootEnv();
  const SUPABASE_URL = env.SUPABASE_URL || "http://127.0.0.1:54321";
  const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY not set in root .env — the demo's sign-in + live AI beat need the local stack.");
  }

  const localServer = await startLocalServer();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tabburrow-demo-"));
  let context: BrowserContext | null = null;
  const markers: Markers = { popup: {}, dash: {} };

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: CAPTURE_HEADLESS,
      viewport: VIEW,
      recordVideo: { dir: VIDEOS_DIR, size: VIEW },
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        "--no-first-run",
        "--no-default-browser-check",
        // Keep background tabs rendering: the popup is recorded while an
        // http tab is the ACTIVE tab (the one-click Save must resolve a real
        // current tab), so its renderer must not be throttled.
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
      ],
    });
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15_000 });
    const extensionId = new URL(sw.url()).host;

    // --- Setup (own page, its .webm is discarded): wipe, seed, sign in ---
    const setup = await context.newPage();
    await setup.goto(`chrome-extension://${extensionId}/dashboard.html`);
    await resetData(setup);

    const kitchenRenoId = randomUUID();
    const recipesId = randomUUID();
    const messyId = randomUUID();
    const collections: SeedCollection[] = [
      { id: kitchenRenoId, name: "Kitchen reno research", accent: "var(--accent)", position: seedPosition(0) },
      { id: randomUUID(), name: "Q3 competitor teardown", accent: "var(--accent-2)", position: seedPosition(1) },
      { id: randomUUID(), name: "Weekend in Portland", accent: "color-mix(in srgb, var(--accent) 50%, var(--accent-2) 50%)", position: seedPosition(2) },
      { id: randomUUID(), name: "Dev docs I keep rereading", accent: "color-mix(in srgb, var(--muted) 60%, var(--text) 40%)", position: seedPosition(3) },
      { id: recipesId, name: "Recipes worth repeating", accent: "color-mix(in srgb, var(--accent) 70%, var(--text) 30%)", position: seedPosition(4) },
      { id: messyId, name: "This week's tabs", position: seedPosition(5) },
    ];
    const links: SeedLink[] = [
      ...toSeedLinks(kitchenRenoId, KITCHEN_RENO_LINKS),
      ...toSeedLinks(collections[1]!.id, COMPETITOR_LINKS),
      ...toSeedLinks(collections[2]!.id, PORTLAND_LINKS),
      ...toSeedLinks(collections[3]!.id, DEV_DOCS_LINKS),
      ...toSeedLinks(recipesId, RECIPES_LINKS),
      ...toSeedLinks(messyId, MESSY_TABS_LINKS),
    ];
    await seedCollectionsAndLinks(setup, collections, links);
    // One-click Save target pinned to "Recipes worth repeating" — the popup
    // beat saves a bread tab there, so the pinned target reads truthfully.
    await seedMeta(setup, {
      lastUsedCollectionId: recipesId,
      defaultCollectionId: recipesId,
      saveTargetMode: "default",
    });
    const now = Date.now();
    await seedSnapshots(setup, [
      {
        id: randomUUID(),
        kind: "manual",
        name: "Monday deep-work setup",
        createdAt: now - 3 * 60 * 60_000,
        windows: [
          {
            tabs: [
              { url: "https://www.notion.so/tabburrow/Roadmap", title: "Roadmap – Notion" },
              { url: "https://calendar.google.com/calendar/u/0/r", title: "Google Calendar - Week of Jul 20" },
              { url: "https://mail.google.com/mail/u/0/#inbox", title: "Inbox (14) - Gmail" },
            ],
          },
        ],
      },
      {
        id: randomUUID(),
        kind: "auto",
        createdAt: now - 6 * 60_000,
        windows: [
          {
            tabs: [
              { url: "https://github.com/tabburrow/tabburrow/pull/142", title: "Add sync retry backoff · Pull Request #142" },
              { url: "https://linear.app/tabburrow/issue/TAB-142", title: "TAB-142 Sync retry backoff · Linear" },
              { url: "https://www.figma.com/file/tabburrow-share-dialog", title: "Share Dialog — TabBurrow · Figma" },
            ],
          },
        ],
      },
      {
        id: randomUUID(),
        kind: "auto",
        createdAt: now - 16 * 60_000,
        windows: [
          {
            tabs: [
              { url: "https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API", title: "IndexedDB API - MDN" },
              { url: "https://dexie.org/docs/Tutorial/React", title: "Dexie.js: React Tutorial" },
            ],
          },
          {
            tabs: [
              { url: "https://vercel.com/tabburrow/tabburrow-web/deployments", title: "Deployments – tabburrow-web – Vercel" },
            ],
          },
        ],
      },
    ]);

    // Sign in BEFORE any collection view mounts — same ordering constraint
    // capture-assets.ts's gif phase documents (a signed-out-then-in remount
    // was observed leaving "Organize with AI" stuck on its locked label).
    const existing = await findAdminUserByEmail(SUPABASE_URL, SERVICE_ROLE_KEY, DEMO_EMAIL);
    if (existing) await deleteAdminUser(SUPABASE_URL, SERVICE_ROLE_KEY, existing.id);
    await setup.goto(`chrome-extension://${extensionId}/dashboard.html#/settings`);
    await signInWithEmailOtp(setup, DEMO_EMAIL);
    await setup.close();

    // --- Real http tabs for the popup beats ---
    const tabA = await context.newPage();
    await tabA.goto(localServer.pageUrl("Sourdough Starter Guide - King Arthur Baking"));
    const tabB = await context.newPage();
    await tabB.goto(localServer.pageUrl("Focaccia Troubleshooting - The Perfect Loaf"));
    const tabC = await context.newPage();
    await tabC.goto(localServer.pageUrl("No-Knead Bread, Revisited - NYT Cooking"));
    await tabC.bringToFront();
    await tabC.screenshot({ path: BG_PNG_PATH }); // the page the popup floats over in post

    // --- Beats a + b: the popup (its own .webm carries both) ---
    const popup = await context.newPage();
    const popupMark = makeMarkerClock(markers.popup);
    await popup.setViewportSize(POPUP_VIEW);
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    // Display-only: the real toolbar popup window hugs its content, but this
    // stand-in tab has a fixed 640px viewport, so the page body would show
    // through white below the popup root (which is shorter on the confirm
    // views). Paint it the same ground token the root uses.
    await popup.addStyleTag({ content: "html,body{background:var(--bg-ground);}" });
    await tabC.bringToFront(); // the active tab must be a real http page for one-click Save

    await expect(popup.getByText("1-click Save goes to")).toBeVisible();
    await expect(popup.getByText("Recipes worth repeating", { exact: true }).first()).toBeVisible();
    await popup.locator("div.group", { hasText: "Weekend in Portland" }).first().hover();
    await popup.waitForTimeout(500); // settle clear of the load-in before the first cut point
    popupMark("home_settled");
    await popup.waitForTimeout(1800);

    // Beat a: one-click Save → confirm view
    popupMark("save_click");
    await popup.getByRole("button", { name: "Save", exact: true }).click();
    await expect(popup.getByText(/Saved 1 tab to Recipes worth repeating/)).toBeVisible();
    popupMark("save_confirm");
    await popup.waitForTimeout(2000);
    await popup.getByRole("button", { name: "Done" }).click();
    await popup.waitForTimeout(800);

    // Beat b: caret → Save all tabs → Choose a folder… → create "Quick Saves"
    popupMark("caret_click");
    await popup.getByRole("button", { name: "More save options" }).click();
    await expect(popup.getByRole("menu", { name: "Save options" })).toBeVisible();
    await expect(popup.getByText("Save all tabs (3)")).toBeVisible();
    await popup.waitForTimeout(1600);
    popupMark("choose_click");
    await popup.getByRole("menuitem", { name: "Choose a folder…" }).click();
    await expect(popup.getByRole("heading", { name: "Save to…" })).toBeVisible();
    popupMark("picker_open");
    await popup.waitForTimeout(900);
    await popup.getByRole("button", { name: "+ New collection…" }).click();
    await popup.getByPlaceholder("Collection name").pressSequentially("Quick Saves", { delay: 80 });
    await popup.waitForTimeout(500);
    popupMark("create_click");
    await popup.getByRole("button", { name: "Create", exact: true }).click();
    await expect(popup.getByText(/Saved 3 tabs to Quick Saves/)).toBeVisible();
    popupMark("saveall_confirm");
    await popup.waitForTimeout(2400);
    popupMark("popup_end");

    const popupVideo = popup.video();
    await popup.close();
    if (!popupVideo) throw new Error("popup page produced no video");
    await popupVideo.saveAs(POPUP_WEBM);

    // --- Beats c + d: the dashboard (a FRESH page so its .webm starts at the beat, not at setup) ---
    const dash = await context.newPage();
    const dashMark = makeMarkerClock(markers.dash);
    await dash.goto(`chrome-extension://${extensionId}/dashboard.html`);
    await expect(dash.getByRole("heading", { name: "Kitchen reno research" })).toBeVisible();
    dashMark("dash_loaded");
    await dash.waitForTimeout(1400);

    const rail = dash.getByRole("navigation", { name: "Collections" });

    // Beat c: the just-saved collection's grid…
    await rail.getByRole("button", { name: "Quick Saves", exact: true }).click();
    await expect(dash.getByRole("heading", { name: "Quick Saves" })).toBeVisible();
    await expect(dash.getByRole("listbox", { name: "Links" }).getByRole("option")).toHaveCount(3);
    dashMark("quick_grid");
    await dash.waitForTimeout(2200);

    // …then the messy mixed collection, organized LIVE.
    await rail.getByRole("button", { name: "This week's tabs", exact: true }).click();
    await expect(dash.getByRole("heading", { name: "This week's tabs" })).toBeVisible();
    await expect(dash.getByRole("listbox", { name: "Links" }).getByRole("option")).toHaveCount(MESSY_TABS_LINKS.length);
    dashMark("messy_grid");
    await dash.waitForTimeout(1800);

    await dash.getByRole("button", { name: "Organize with AI", exact: true }).click();
    const dialog = dash.getByRole("dialog", { name: "Organize with AI" });
    await expect(dialog).toBeVisible();
    dashMark("ai_dialog");
    await dash.waitForTimeout(1500);
    await dialog.getByRole("button", { name: "Organize", exact: true }).click();
    dashMark("organize_clicked");
    // LIVE Anthropic call via the local ai-organize function — measured slow
    // days take up to ~2 minutes for 16 links; post compresses this to ~2s.
    await expect(dialog.getByRole("group").first()).toBeVisible({ timeout: 150_000 });
    dashMark("preview_visible");
    await dash.waitForTimeout(1400);
    // Scroll the preview so more than one group is seen on camera.
    await dialog.getByRole("group").first().hover();
    await dash.mouse.wheel(0, 260);
    await dash.waitForTimeout(900);
    await dash.mouse.wheel(0, 260);
    await dash.waitForTimeout(900);
    await dialog.getByRole("button", { name: /^Apply \(/ }).click();
    dashMark("apply_clicked");
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    dashMark("apply_done");
    await dash.waitForTimeout(3000); // the rail gains the new collections + the success toast

    // Beat d: Sessions pane, then Restore all on the saved collection.
    await rail.getByRole("button", { name: "Sessions", exact: true }).click();
    await expect(dash.getByRole("heading", { name: "Sessions" })).toBeVisible();
    dashMark("sessions_shown");
    await dash.waitForTimeout(2800);
    await rail.getByRole("button", { name: "Quick Saves", exact: true }).click();
    await expect(dash.getByRole("heading", { name: "Quick Saves" })).toBeVisible();
    dashMark("back_quick");
    await dash.waitForTimeout(1200);
    await dash.getByRole("button", { name: "Restore all", exact: true }).click();
    dashMark("restore_clicked");
    await dash.waitForTimeout(2400);
    dashMark("dash_end");

    const dashVideo = dash.video();
    await dash.close();
    if (!dashVideo) throw new Error("dashboard page produced no video");
    await dashVideo.saveAs(DASH_WEBM);

    // Best-effort account cleanup — never fail the capture over it.
    try {
      const authUser = await findAdminUserByEmail(SUPABASE_URL, SERVICE_ROLE_KEY, DEMO_EMAIL);
      if (authUser) await deleteAdminUser(SUPABASE_URL, SERVICE_ROLE_KEY, authUser.id);
    } catch {
      // ignore
    }
  } finally {
    if (context) await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    localServer.server.closeAllConnections();
    await new Promise<void>((resolve) => localServer.server.close(() => resolve()));
  }

  fs.writeFileSync(MARKERS_PATH, JSON.stringify(markers, null, 2));
  console.log(`  raw footage + markers in ${RAW_DIR}`);
}

// ---------------------------------------------------------------------------
// Phase: post — cut the raw footage into assets/demo.mp4 + assets/readme-demo.gif
// ---------------------------------------------------------------------------

/** How long (s) of the raw loading animation to keep at 1x before the compressed fast-forward. */
const LOADING_LEAD_S = 1.2;
/** The compressed on-screen duration (s) of the live AI wait. */
const LOADING_SHOWN_S = 2.0;
/** Start-cut safety margin (s) ahead of a marker. */
const LEAD = 0.3;

function encodeSegment(outPath: string, filterChain: string, inputs: string): void {
  ffmpeg(`${inputs} -filter_complex "${filterChain}" -map "[v]" -an -c:v libx264 -preset medium -crf 20 -r 30 "${outPath}"`);
}

/**
 * One demo beat, cut from raw footage between two marker-derived times and
 * played back so it lasts (at most) `target` seconds on screen. A snappy
 * live run plays near real time; a run where the UI stalled (headless
 * renderers were observed freezing for tens of seconds between beats) gets
 * compressed to the same watchable pacing either way.
 */
interface Cut {
  start: number;
  end: number;
  /** On-screen budget (s) for this stretch of footage. */
  target: number;
}

function cutSpeed(cut: Cut): number {
  return Math.max(1.05, (cut.end - cut.start) / cut.target);
}

async function phasePost(): Promise<void> {
  log("Phase post: cutting demo.mp4 + readme-demo.gif");
  for (const f of [POPUP_WEBM, DASH_WEBM, MARKERS_PATH, BG_PNG_PATH]) {
    if (!fs.existsSync(f)) throw new Error(`${f} missing — run the capture phase first.`);
  }
  fs.rmSync(SEGS_DIR, { recursive: true, force: true });
  fs.mkdirSync(SEGS_DIR, { recursive: true });
  fs.mkdirSync(ASSETS_DIR, { recursive: true });

  const markers = JSON.parse(fs.readFileSync(MARKERS_PATH, "utf8")) as Markers;
  // Marker clocks start at page creation, but each page's video only starts
  // at its first captured frame, a beat later. The final marker on each page
  // is taken immediately before that page closes (= the video's end), so
  // `finalMarker - videoDuration` measures that page's clock-to-video offset.
  const popupOffset = Math.max(0, markers.popup.popup_end! - ffprobeDuration(POPUP_WEBM));
  const dashOffset = Math.max(0, markers.dash.dash_end! - ffprobeDuration(DASH_WEBM));
  const p = (name: string) => Math.max(0, markers.popup[name]! - popupOffset);
  const d = (name: string) => Math.max(0, markers.dash[name]! - dashOffset);
  console.log(`  marker→video offsets: popup ${popupOffset.toFixed(2)}s, dash ${dashOffset.toFixed(2)}s`);

  // Popup beats a+b: crop the native-resolution popup region out of the
  // recording canvas and float it top-right over the active tab's screenshot
  // (popup-over-page, like the real toolbar popup). Beat-per-cut, so any
  // between-beat stall in the raw footage collapses to the beat's budget.
  const popupCuts: Cut[] = [
    { start: Math.max(0, p("home_settled") - LEAD), end: p("save_click"), target: 2.2 }, // folders home + 1-click control
    { start: p("save_click"), end: p("save_confirm") + 1.9, target: 3.2 }, // Save → "Saved 1 tab" confirm
    { start: p("caret_click") - 0.2, end: p("choose_click") + 0.3, target: 2.8 }, // caret menu open (skips the Done-click dead time before it)
    { start: p("choose_click") + 0.3, end: p("create_click"), target: 3.6 }, // picker + typing "Quick Saves"
    { start: p("create_click"), end: p("popup_end"), target: 3.4 }, // Create → "Saved 3 tabs to Quick Saves"
  ];
  const overlayX = VIEW.width - POPUP_VIEW.width - 32;
  const segs: string[] = [];
  popupCuts.forEach((cut, i) => {
    const seg = path.join(SEGS_DIR, `seg-popup-${i}.mp4`);
    encodeSegment(
      seg,
      `[0:v]trim=start=${cut.start.toFixed(2)}:end=${cut.end.toFixed(2)},setpts=(PTS-STARTPTS)/${cutSpeed(cut).toFixed(4)},` +
        `crop=${POPUP_VIEW.width}:${POPUP_VIEW.height}:0:0[pp];` +
        `[1:v]scale=${VIEW.width}:${VIEW.height},setsar=1[bg];` +
        `[bg][pp]overlay=${overlayX}:28:shortest=1,fps=30,format=yuv420p[v]`,
      `-i "${POPUP_WEBM}" -loop 1 -framerate 30 -i "${BG_PNG_PATH}"`,
    );
    segs.push(seg);
  });

  // Dashboard beats c+d — same beat-per-cut treatment; the live AI wait gets
  // a hard LOADING_SHOWN_S budget (a couple of minutes of real call time on a
  // slow day still reads as one beat of the digging animation).
  const loadingStart = d("organize_clicked") + LOADING_LEAD_S;
  const loadingEnd = Math.max(loadingStart + 0.5, d("preview_visible") - 0.2);
  const dashCuts: Cut[] = [
    { start: Math.max(0, d("dash_loaded") - LEAD), end: d("quick_grid") + 2.2, target: 4.6 }, // rail → Quick Saves grid
    { start: d("quick_grid") + 2.2, end: d("messy_grid") + 1.7, target: 3.4 }, // → the messy 16-link collection
    { start: d("messy_grid") + 1.7, end: loadingStart, target: 4.6 }, // "Organize with AI" dialog → Organize click
    { start: loadingStart, end: loadingEnd, target: LOADING_SHOWN_S }, // the LIVE call, compressed
    { start: loadingEnd, end: d("apply_done") + 3.0, target: 9.5 }, // preview groups → Apply → rail gains collections
    { start: d("apply_done") + 3.0, end: d("sessions_shown") + 2.7, target: 4.2 }, // Sessions pane
    { start: d("sessions_shown") + 2.7, end: d("dash_end"), target: 6.0 }, // back to Quick Saves → Restore all
  ];
  dashCuts.forEach((cut, i) => {
    const seg = path.join(SEGS_DIR, `seg-dash-${i}.mp4`);
    encodeSegment(
      seg,
      `[0:v]trim=start=${cut.start.toFixed(2)}:end=${cut.end.toFixed(2)},setpts=(PTS-STARTPTS)/${cutSpeed(cut).toFixed(4)},` +
        `scale=${VIEW.width}:${VIEW.height},setsar=1,fps=30,format=yuv420p[v]`,
      `-i "${DASH_WEBM}"`,
    );
    segs.push(seg);
  });

  // Concat → assets/demo.mp4 (H.264 + yuv420p + faststart: QuickTime/YouTube-safe).
  const inputs = segs.map((s) => `-i "${s}"`).join(" ");
  const pads = segs.map((_, i) => `[${i}:v]`).join("");
  ffmpeg(
    `${inputs} -filter_complex "${pads}concat=n=${segs.length}:v=1:a=0,format=yuv420p[v]" ` +
      `-map "[v]" -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -movflags +faststart "${OUT_MP4}"`,
  );
  const mp4Dur = ffprobeDuration(OUT_MP4);
  const mp4Mb = fs.statSync(OUT_MP4).size / (1024 * 1024);
  console.log(`  wrote assets/demo.mp4 (${mp4Dur.toFixed(1)}s, ${mp4Mb.toFixed(1)}MB)`);

  // README GIF — the whole demo timeline, aggressively sped into ~11s, 800px
  // wide, two-pass palette (same palettegen/paletteuse pipeline as
  // capture-assets.ts's gif phase).
  const gifTargetS = 11.5;
  let fps = 16;
  let width = 800;
  for (let attempt = 0; attempt < 3; attempt++) {
    const factor = Math.max(1, mp4Dur / gifTargetS);
    const palette = path.join(SEGS_DIR, "palette.png");
    const vf = `setpts=PTS/${factor.toFixed(3)},fps=${fps},scale=${width}:-1:flags=lanczos`;
    ffmpeg(`-i "${OUT_MP4}" -vf "${vf},palettegen=stats_mode=diff" "${palette}"`);
    ffmpeg(
      `-i "${OUT_MP4}" -i "${palette}" -filter_complex "[0:v]${vf}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" -t 12 "${OUT_GIF}"`,
    );
    const gifMb = fs.statSync(OUT_GIF).size / (1024 * 1024);
    if (gifMb <= 5) {
      console.log(`  wrote assets/readme-demo.gif (${ffprobeDuration(OUT_GIF).toFixed(1)}s, ${gifMb.toFixed(2)}MB, ${width}px/${fps}fps)`);
      break;
    }
    console.log(`  readme-demo.gif was ${gifMb.toFixed(2)}MB (>5MB) — retrying smaller`);
    fps = Math.max(10, fps - 3);
    width = Math.max(680, width - 60);
    if (attempt === 2) throw new Error("could not get readme-demo.gif under 5MB");
  }
}

// ---------------------------------------------------------------------------
// CLI dispatch
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const phase = process.argv[2] ?? "all";
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
  } catch {
    throw new Error("ffmpeg not found on PATH (`brew install ffmpeg`).");
  }
  if (phase === "capture" || phase === "all") await phaseCapture();
  if (phase === "post" || phase === "all") await phasePost();
  if (!["capture", "post", "all"].includes(phase)) {
    console.error(`Unknown phase "${phase}". Expected one of: all, capture, post`);
    process.exitCode = 1;
    return;
  }
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

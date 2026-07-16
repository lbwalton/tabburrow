import { randomUUID } from "node:crypto";
import { execSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import type { Browser, BrowserContext, Page } from "@playwright/test";

import { EXTENSION_PATH, closeExtensionContext, popupPage, resetData, signInWithEmailOtp } from "./fixtures";
import { seedCollectionsAndLinks, seedMeta, seedPosition, seedSnapshots } from "./seed";
import type { SeedCollection, SeedLink } from "./seed";
import { loadRootEnv } from "./env";
import { deleteAdminUser, deleteCloudDataForUser, findAdminUserByEmail, setUserPlan } from "./admin";

/**
 * T25b — captures the five Chrome Web Store screenshots listing.md specs,
 * renders the promo tile (440x280) and README hero (1600x800) from small
 * HTML compositor pages, and best-effort records+converts the README demo
 * GIF.
 *
 * Deliberately NOT a Playwright test file: no `test()` blocks, so
 * `playwright.config.ts` (which only picks up `e2e/specs/*.spec.ts`) never
 * runs this as part of `pnpm e2e`. It reuses the harness's own fixtures
 * (`fixtures.ts`, `seed.ts`, `admin.ts`, `env.ts`) the same way every
 * `specs/*.spec.ts` file does, driving the REAL built extension — this is
 * product-truthful capture, not a mockup.
 *
 * Run (from apps/extension):
 *   npx tsx e2e/capture-assets.ts [phase]
 *   phase: all (default) | main | share | tile | hero | gif
 *
 * Requires:
 *  - `pnpm --filter extension build` already run (this script does not do
 *    the INITIAL build for you — same "REQUIRED, fresh, before every run"
 *    precedent e2e/README.md sets for the test suite itself). The "share"
 *    phase DOES rebuild the extension (twice — see t22-share.spec.ts's "env
 *    dance", duplicated here) and restores the normal build afterward.
 *  - the local Supabase stack running (`supabase start`) with
 *    SUPABASE_SERVICE_ROLE_KEY and ANTHROPIC_API_KEY set in the root
 *    `.env` — the "main" phase's AI-organize shot and the "share" phase
 *    both need live infra, same as t20/t22's specs.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(EXTENSION_DIR, "../..");
const WEB_DIR = path.resolve(REPO_ROOT, "apps/web");
const STORE_ASSETS_DIR = path.resolve(REPO_ROOT, "store-assets");
const SCREENSHOTS_DIR = path.resolve(STORE_ASSETS_DIR, "screenshots");
const README_ASSETS_DIR = path.resolve(REPO_ROOT, "assets");
const UI_FONTS_DIR = path.resolve(REPO_ROOT, "packages/ui/src/fonts");
const ICON_SVG_PATH = path.resolve(EXTENSION_DIR, "assets/icon.svg");
const EXTENSION_ENV_LOCAL_PATH = path.resolve(EXTENSION_DIR, ".env.local");

const CAPTURE_HEADLESS = process.env.CAPTURE_HEADLESS === "false" ? false : true;
const STORE_VIEWPORT = { width: 1280, height: 800 };

for (const dir of [SCREENSHOTS_DIR, README_ASSETS_DIR]) fs.mkdirSync(dir, { recursive: true });

// ---------------------------------------------------------------------------
// Brand constants — literal hexes are ONLY ever used inside this standalone
// asset generator (compositor HTML this script writes/renders, never product
// source), which is exactly the exception store-assets/listing.md's promo
// tile spec calls out. Product code must keep using packages/ui/src/tokens.css's
// var(--bg-ground) etc.
// ---------------------------------------------------------------------------
const BRAND_GROUND = "#16241E";
const BRAND_SURFACE = "#1E3128";
const BRAND_CREAM = "#EEE8D9";
const BRAND_CREAM_DIM = "#B9C3BB";
const BRAND_ORANGE = "#F97316";

function fontDataUri(filename: string, mime = "font/woff2"): string {
  const buf = fs.readFileSync(path.join(UI_FONTS_DIR, filename));
  return `data:${mime};base64,${buf.toString("base64")}`;
}

function pngDataUri(buf: Buffer): string {
  return `data:image/png;base64,${buf.toString("base64")}`;
}

/** The real burrow-arch mark, embedded byte-for-byte from the extension's own icon source (apps/extension/assets/icon.svg) — never redrawn or approximated. */
const BURROW_ARCH_SVG = fs.readFileSync(ICON_SVG_PATH, "utf8");

function brandFontFaces(): string {
  return `
    @font-face {
      font-family: "Syne";
      font-weight: 700;
      font-style: normal;
      src: url("${fontDataUri("Syne-Bold.woff2")}") format("woff2");
    }
    @font-face {
      font-family: "Inter";
      font-weight: 400 600;
      font-style: normal;
      src: url("${fontDataUri("Inter-Variable.woff2")}") format("woff2");
    }
  `;
}

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

/** A tiny local HTTP server serving `<h1>{title}</h1>` pages by `?title=` — same shape as fixtures.ts's worker-scoped `testServer` fixture, duplicated here (not imported: that one is wired into Playwright's `test.extend` worker lifecycle, not callable standalone from a plain script) so this script can serve real http(s) "current tab" pages without depending on the test runner. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

interface LocalServer {
  server: http.Server;
  pageUrl(title: string): string;
}

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

/**
 * Launches a fresh persistent, extension-loaded Chromium context at an
 * EXACT viewport — same launch args as fixtures.ts's `launchExtensionContext`,
 * duplicated (not imported) because the Chrome Web Store's 1280x800
 * screenshot requirement is stricter than that fixture's 1400x900 (chosen
 * for general test comfort, not store-asset exactness). Same "kept in sync
 * by hand" precedent env.ts/seed.ts already set for this harness.
 */
async function launchExtensionContextAt(
  viewport: { width: number; height: number } = STORE_VIEWPORT,
): Promise<{ context: BrowserContext; extensionId: string; userDataDir: string }> {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tabburrow-capture-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: CAPTURE_HEADLESS,
    viewport,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15_000 });
  const extensionId = new URL(sw.url()).host;
  return { context, extensionId, userDataDir };
}

let sharedCompositorBrowser: Browser | null = null;
async function compositorBrowser(): Promise<Browser> {
  if (!sharedCompositorBrowser) sharedCompositorBrowser = await chromium.launch({ headless: CAPTURE_HEADLESS });
  return sharedCompositorBrowser;
}

/** Renders `html` at an EXACT `width`x`height` viewport and screenshots it to `outPath` — the shared mechanism behind the promo tile, the README hero, and the shot 1 popup/tab composite. Also writes the HTML itself alongside `outPath` when `htmlOutPath` is given, so the composited source stays a real, reproducible, inspectable asset (not just baked into this script). */
async function renderHtmlToPng(
  html: string,
  width: number,
  height: number,
  outPath: string,
  htmlOutPath?: string,
): Promise<void> {
  if (htmlOutPath) fs.writeFileSync(htmlOutPath, html);
  const browser = await compositorBrowser();
  const page = await browser.newPage({ viewport: { width, height } });
  try {
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready);
    await page.screenshot({ path: outPath });
    console.log(`  wrote ${path.relative(REPO_ROOT, outPath)} (${width}x${height})`);
  } finally {
    await page.close();
  }
}

function log(msg: string): void {
  console.log(`\n=== ${msg} ===`);
}

// ---------------------------------------------------------------------------
// Realistic seed data — real-sounding collection names and real-looking
// public URLs (referenced by title+url only, never fetched — see the task
// brief), so the captures read like an actual person's browser, not
// lorem-ipsum placeholder data.
// ---------------------------------------------------------------------------

const KITCHEN_RENO_LINKS: Array<{ title: string; url: string; note?: string; tags?: string[] }> = [
  { title: "Best Semi-Custom Cabinets, Reviewed - This Old House", url: "https://www.thisoldhouse.com/kitchens/best-semi-custom-cabinets" },
  { title: "Quartz vs. Granite Countertops: What's the Difference? - Consumer Reports", url: "https://www.consumerreports.org/home-garden/kitchen/quartz-vs-granite-countertops" },
  {
    title: "SEKTION Kitchen System - IKEA",
    url: "https://www.ikea.com/us/en/cat/sektion-kitchen-cabinet-system-38869/",
    note: "Measured our galley kitchen, fits an 8ft run",
    tags: ["cabinets", "budget"],
  },
  { title: "How to Install a Farmhouse Sink - Family Handyman", url: "https://www.familyhandyman.com/project/how-to-install-a-farmhouse-sink/" },
  { title: "Kitchen Island Size Guide - Houzz", url: "https://www.houzz.com/magazine/kitchen-island-size-guide" },
  { title: "20 Subway Tile Backsplash Ideas - Better Homes & Gardens", url: "https://www.bhg.com/kitchen/backsplash/subway-tile-backsplash-ideas/" },
  {
    title: "Best Cabinet Hardware for the Money - Wirecutter",
    url: "https://www.nytimes.com/wirecutter/reviews/best-cabinet-hardware/",
    note: "Matches the brushed brass we picked out",
    tags: ["hardware"],
  },
  { title: "Undermount vs. Drop-In Sinks - The Spruce", url: "https://www.thespruce.com/undermount-vs-drop-in-sinks-1821244" },
  { title: "Kitchen Remodel Budget Breakdown - r/HomeImprovement", url: "https://www.reddit.com/r/HomeImprovement/comments/kitchen_remodel_budget/", tags: ["budget"] },
  { title: "Butcher Block Countertop Care Guide - Bob Vila", url: "https://www.bobvila.com/articles/butcher-block-countertop-care/" },
];

const COMPETITOR_TEARDOWN_LINKS: Array<{ title: string; url: string }> = [
  { title: "Notion Pricing - Notion", url: "https://www.notion.so/pricing" },
  { title: "Linear Changelog", url: "https://linear.app/changelog" },
  { title: "How Superhuman Built Its Onboarding - Lenny's Newsletter", url: "https://www.lennysnewsletter.com/p/how-superhuman-built-onboarding" },
  { title: "Raycast vs Alfred: A Comparison - Raycast Blog", url: "https://www.raycast.com/blog/raycast-vs-alfred" },
  { title: "Arc Browser Teardown - Failory", url: "https://www.failory.com/blog/arc-browser" },
  { title: "Competitor Feature Matrix - Google Sheets", url: "https://docs.google.com/spreadsheets/d/competitor-feature-matrix" },
];

const PORTLAND_LINKS: Array<{ title: string; url: string }> = [
  { title: "Powell's City of Books", url: "https://www.powells.com/" },
  { title: "Pine State Biscuits Menu", url: "https://www.pinestatebiscuits.com/menu" },
  { title: "Forest Park Trail Map - Portland Parks & Rec", url: "https://www.portland.gov/parks/forest-park" },
  { title: "Best Food Carts in Portland 2026 - Eater PDX", url: "https://pdx.eater.com/maps/best-portland-food-carts" },
  { title: "Powell's to Pearl District Walking Route - Google Maps", url: "https://maps.google.com/portland-walking-route" },
];

const DEV_DOCS_LINKS: Array<{ title: string; url: string }> = [
  { title: "useEffect – React Docs", url: "https://react.dev/reference/react/useEffect" },
  { title: "TypeScript Handbook: Generics", url: "https://www.typescriptlang.org/docs/handbook/2/generics.html" },
  { title: "Postgres: Row Security Policies", url: "https://www.postgresql.org/docs/current/ddl-rowsecurity.html" },
  { title: "IndexedDB API - MDN", url: "https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API" },
  { title: "Dexie.js: React Tutorial", url: "https://dexie.org/docs/Tutorial/React" },
  { title: "dnd-kit Docs: Sortable", url: "https://docs.dndkit.com/presets/sortable" },
  { title: "WXT Documentation", url: "https://wxt.dev/guide/introduction.html" },
];

const RECIPES_LINKS: Array<{ title: string; url: string }> = [
  { title: "Best Chocolate Chip Cookies - Sally's Baking Addiction", url: "https://sallysbakingaddiction.com/best-chocolate-chip-cookies/" },
  { title: "Easy Weeknight Carbonara - Bon Appétit", url: "https://www.bonappetit.com/recipe/easy-carbonara" },
  { title: "No-Knead Bread - NYT Cooking", url: "https://cooking.nytimes.com/recipes/no-knead-bread" },
  { title: "Sheet Pan Gnocchi - Half Baked Harvest", url: "https://www.halfbakedharvest.com/sheet-pan-gnocchi/" },
];

/** A deliberately messy 16-tab mix across four unrelated topics, for the live AI-organize shot — same "mixed links" shape t20-ai-organize.spec.ts's live test uses, expanded and re-themed so this collection's content doesn't just repeat the dashboard-grid shot's data. */
const MESSY_TABS_LINKS: Array<{ title: string; url: string }> = [
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

function toSeedLinks(collectionId: string, items: Array<{ title: string; url: string; note?: string; tags?: string[] }>): SeedLink[] {
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
// Phase: main (shots 1, 2, 4 on the normal build; shot 3 needs sign-in for
// the live AI-organize call)
// ---------------------------------------------------------------------------

async function phaseMain(): Promise<void> {
  log("Phase main: shots 01, 02, 03, 04");
  const localServer = await startLocalServer();
  const { context, extensionId, userDataDir } = await launchExtensionContextAt();

  try {
    const dash = await context.newPage();
    await dash.goto(`chrome-extension://${extensionId}/dashboard.html`);
    await resetData(dash);

    // --- Seed the five rail collections (4-6 per listing.md's shot 2 spec) ---
    const kitchenRenoId = randomUUID();
    const competitorId = randomUUID();
    const portlandId = randomUUID();
    const devDocsId = randomUUID();
    const recipesId = randomUUID();

    const collections: SeedCollection[] = [
      { id: kitchenRenoId, name: "Kitchen reno research", accent: "var(--accent)", position: seedPosition(0) },
      { id: competitorId, name: "Q3 competitor teardown", accent: "var(--accent-2)", position: seedPosition(1) },
      { id: portlandId, name: "Weekend in Portland", accent: "color-mix(in srgb, var(--accent) 50%, var(--accent-2) 50%)", position: seedPosition(2) },
      { id: devDocsId, name: "Dev docs I keep rereading", accent: "color-mix(in srgb, var(--muted) 60%, var(--text) 40%)", position: seedPosition(3) },
      { id: recipesId, name: "Recipes worth repeating", accent: "color-mix(in srgb, var(--accent) 70%, var(--text) 30%)", position: seedPosition(4) },
    ];
    const links: SeedLink[] = [
      ...toSeedLinks(kitchenRenoId, KITCHEN_RENO_LINKS),
      ...toSeedLinks(competitorId, COMPETITOR_TEARDOWN_LINKS),
      ...toSeedLinks(portlandId, PORTLAND_LINKS),
      ...toSeedLinks(devDocsId, DEV_DOCS_LINKS),
      ...toSeedLinks(recipesId, RECIPES_LINKS),
    ];
    await seedCollectionsAndLinks(dash, collections, links);
    await seedMeta(dash, { lastUsedCollectionId: kitchenRenoId }); // duplicated literal — see lib/commands.ts's LAST_USED_COLLECTION_META_KEY
    await dash.reload();

    // --- Shot 02: dashboard grid ---
    await dash.goto(`chrome-extension://${extensionId}/dashboard.html#/c/${kitchenRenoId}`);
    await expect(dash.getByRole("heading", { name: "Kitchen reno research" })).toBeVisible();
    await expect(dash.getByRole("listbox", { name: "Links" }).getByRole("option")).toHaveCount(KITCHEN_RENO_LINKS.length);
    await dash.waitForTimeout(300); // let favicon fallbacks (broken -> globe SVG) settle before the shot
    await dash.screenshot({ path: path.join(SCREENSHOTS_DIR, "02-dashboard-grid.png") });
    console.log("  wrote screenshots/02-dashboard-grid.png (1280x800)");

    // --- Shot 01: popup save (mid-flow, picker open, over a real tab) ---
    const bgPage = await context.newPage();
    await bgPage.setViewportSize(STORE_VIEWPORT);
    await bgPage.goto(localServer.pageUrl("Sourdough Starter Guide - King Arthur Baking"));
    await bgPage.bringToFront();

    const popup = await popupPage(context, extensionId);
    await bgPage.bringToFront();
    await expect(popup.getByText(/Saving to:\s*Kitchen reno research/)).toBeVisible();
    await popup.getByRole("button", { name: "Change" }).click();
    await expect(popup.getByText("Save to…")).toBeVisible();
    await expect(popup.getByText("Kitchen reno research", { exact: true })).toBeVisible();

    const bgShotBuf = await bgPage.screenshot();
    const popupShotBuf = await popup.locator("#root > div").screenshot();
    const popupBox = await popup.locator("#root > div").boundingBox();
    const popupHeight = popupBox?.height ?? 420;
    const composite01 = `<!doctype html><html><head><style>
      html,body{margin:0;padding:0;width:${STORE_VIEWPORT.width}px;height:${STORE_VIEWPORT.height}px;overflow:hidden;background:#fff;}
      .bg{position:absolute;top:0;left:0;width:${STORE_VIEWPORT.width}px;height:${STORE_VIEWPORT.height}px;object-fit:cover;}
      .popup{position:absolute;top:28px;right:36px;width:360px;height:${popupHeight}px;border-radius:12px;box-shadow:0 28px 56px rgba(0,0,0,0.45),0 6px 16px rgba(0,0,0,0.3);}
    </style></head><body>
      <img class="bg" src="${pngDataUri(bgShotBuf)}">
      <img class="popup" src="${pngDataUri(popupShotBuf)}">
    </body></html>`;
    await renderHtmlToPng(composite01, STORE_VIEWPORT.width, STORE_VIEWPORT.height, path.join(SCREENSHOTS_DIR, "01-popup-save.png"));
    await popup.close();
    await bgPage.close();

    // --- Shot 04: sessions pane (auto + manual snapshots) ---
    const now = Date.now();
    await seedSnapshots(dash, [
      {
        id: randomUUID(),
        kind: "auto",
        createdAt: now - 6 * 60_000,
        windows: [
          {
            tabs: [
              { url: "https://github.com/tabburrow/tabburrow/pull/142", title: "Add sync retry backoff by lbwalton · Pull Request #142" },
              { url: "https://linear.app/tabburrow/issue/TAB-142", title: "TAB-142 Sync retry backoff · Linear" },
              { url: "https://www.figma.com/file/tabburrow-share-dialog", title: "Share Dialog — TabBurrow · Figma" },
              { url: "https://vercel.com/tabburrow/tabburrow-web/deployments", title: "Deployments – tabburrow-web – Vercel" },
            ],
          },
        ],
      },
      {
        id: randomUUID(),
        kind: "auto",
        createdAt: now - 11 * 60_000,
        windows: [
          {
            tabs: [
              { url: "https://www.notion.so/tabburrow/Roadmap", title: "Roadmap – Notion" },
              { url: "https://mail.google.com/mail/u/0/#inbox", title: "Inbox (14) - lb@tabburrow.com - Gmail" },
              { url: "https://calendar.google.com/calendar/u/0/r", title: "Google Calendar - Week of Jul 13" },
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
              { url: "https://github.com/tabburrow/tabburrow/pull/142", title: "Add sync retry backoff by lbwalton · Pull Request #142" },
              { url: "https://linear.app/tabburrow/issue/TAB-142", title: "TAB-142 Sync retry backoff · Linear" },
              { url: "https://vercel.com/tabburrow/tabburrow-web/deployments", title: "Deployments – tabburrow-web – Vercel" },
            ],
          },
          {
            tabs: [
              { url: "https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API", title: "IndexedDB API - MDN" },
              { url: "https://dexie.org/docs/Tutorial/React", title: "Dexie.js: React Tutorial" },
              { url: "https://docs.dndkit.com/presets/sortable", title: "dnd-kit Docs: Sortable" },
            ],
          },
        ],
      },
    ]);
    await dash.reload();
    await dash.goto(`chrome-extension://${extensionId}/dashboard.html#/sessions`);
    await expect(dash.getByRole("heading", { name: "Sessions" })).toBeVisible();

    const demoTabA = await context.newPage();
    await demoTabA.goto(localServer.pageUrl("TabBurrow Launch Checklist"));
    const demoTabB = await context.newPage();
    await demoTabB.goto(localServer.pageUrl("Store Listing Screenshots"));

    await dash.getByPlaceholder("Name (optional)").fill("Before demo");
    await dash.getByRole("button", { name: "Snapshot now" }).click();
    await expect(dash.getByText("Before demo")).toBeVisible({ timeout: 10_000 });
    await dash.waitForTimeout(200);
    await dash.screenshot({ path: path.join(SCREENSHOTS_DIR, "04-sessions-pane.png") });
    console.log("  wrote screenshots/04-sessions-pane.png (1280x800)");
    await demoTabA.close();
    await demoTabB.close();

    // --- Shot 03: AI organize preview (live Anthropic call via ai-organize) ---
    const env = loadRootEnv();
    const SUPABASE_URL = env.SUPABASE_URL || "http://127.0.0.1:54321";
    const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
    const AI_EMAIL = "capture-ai-organize@tabburrow.test";

    if (!SERVICE_ROLE_KEY) {
      console.warn("  SKIPPING shot 03 (AI organize): SUPABASE_SERVICE_ROLE_KEY not set in root .env");
    } else {
      try {
        const existing = await findAdminUserByEmail(SUPABASE_URL, SERVICE_ROLE_KEY, AI_EMAIL);
        if (existing) await deleteAdminUser(SUPABASE_URL, SERVICE_ROLE_KEY, existing.id);

        const messyId = randomUUID();
        await seedCollectionsAndLinks(
          dash,
          [{ id: messyId, name: "This week's tabs", position: seedPosition(5) }],
          toSeedLinks(messyId, MESSY_TABS_LINKS),
        );
        await dash.reload();

        await dash.goto(`chrome-extension://${extensionId}/dashboard.html#/settings`);
        await signInWithEmailOtp(dash, AI_EMAIL);

        await dash.goto(`chrome-extension://${extensionId}/dashboard.html#/c/${messyId}`);
        await expect(dash.getByRole("listbox", { name: "Links" }).getByRole("option")).toHaveCount(MESSY_TABS_LINKS.length);
        await dash.getByRole("button", { name: "Organize with AI" }).click();
        const dialog = dash.getByRole("dialog", { name: "Organize with AI" });
        await expect(dialog).toBeVisible();
        await dialog.getByRole("button", { name: "Organize", exact: true }).click();
        await expect(dialog.getByRole("group").first()).toBeVisible({ timeout: 45_000 });
        await dash.waitForTimeout(300);
        await dash.screenshot({ path: path.join(SCREENSHOTS_DIR, "03-ai-organize-preview.png") });
        console.log("  wrote screenshots/03-ai-organize-preview.png (1280x800)");

        const authUser = await findAdminUserByEmail(SUPABASE_URL, SERVICE_ROLE_KEY, AI_EMAIL);
        if (authUser) await deleteAdminUser(SUPABASE_URL, SERVICE_ROLE_KEY, authUser.id);
      } catch (err) {
        console.warn(`  SKIPPING shot 03 (AI organize) — live call failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    await closeExtensionContext(context, userDataDir);
    localServer.server.closeAllConnections();
    await new Promise<void>((resolve) => localServer.server.close(() => resolve()));
  }
}

// ---------------------------------------------------------------------------
// Phase: share (shot 5) — same "env dance" as t22-share.spec.ts: rebuild the
// extension pointed at a local web dev server, spin that server up, share a
// collection, screenshot the public page, then restore the normal build.
// ---------------------------------------------------------------------------

const WEB_PORT = 3100;
const WEB_SITE_URL = `http://localhost:${WEB_PORT}`;

function runCommand(command: string, args: string[], cwd: string, extraEnv: NodeJS.ProcessEnv = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: "pipe" });
    let output = "";
    child.stdout?.on("data", (d) => (output += d.toString()));
    child.stderr?.on("data", (d) => (output += d.toString()));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} (cwd=${cwd}) exited ${code}\n${output}`));
    });
  });
}

async function buildExtensionWithSiteUrl(siteUrl: string, supabaseUrl: string, supabaseAnonKey: string): Promise<void> {
  const content = `WXT_SUPABASE_URL=${supabaseUrl}\nWXT_SUPABASE_ANON_KEY=${supabaseAnonKey}\nWXT_SITE_URL=${siteUrl}\n`;
  fs.writeFileSync(EXTENSION_ENV_LOCAL_PATH, content);
  await runCommand("npx", ["wxt", "build"], EXTENSION_DIR);
}

async function restoreNormalExtensionBuild(): Promise<void> {
  await runCommand("node", ["scripts/sync-env.mjs"], EXTENSION_DIR);
  await runCommand("npx", ["wxt", "build"], EXTENSION_DIR);
}

let webServerProcess: ChildProcess | null = null;

async function waitForWebServerReady(url: string, budgetMs = 90_000): Promise<void> {
  const deadline = Date.now() + budgetMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(5_000) });
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }
  throw new Error(`apps/web dev server on ${url} did not become ready within ${budgetMs}ms: ${String(lastErr)}`);
}

async function startWebDevServer(supabaseUrl: string, serviceRoleKey: string): Promise<void> {
  webServerProcess = spawn("pnpm", ["exec", "next", "dev", "-p", String(WEB_PORT)], {
    cwd: WEB_DIR,
    env: { ...process.env, NEXT_PUBLIC_SITE_URL: WEB_SITE_URL, SUPABASE_URL: supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey },
    detached: process.platform !== "win32",
    stdio: "ignore",
  });
  await waitForWebServerReady(`${WEB_SITE_URL}/`);
}

async function stopWebDevServer(): Promise<void> {
  const proc = webServerProcess;
  webServerProcess = null;
  if (proc?.pid) {
    try {
      if (process.platform === "win32") proc.kill();
      else process.kill(-proc.pid, "SIGTERM");
    } catch {
      // already exited
    }
  }
  await new Promise((r) => setTimeout(r, 500));
  try {
    execSync(`lsof -ti:${WEB_PORT} | xargs -r kill -9`, { stdio: "ignore" });
  } catch {
    // no strays, or lsof/xargs unavailable — best effort.
  }
}

async function phaseShare(): Promise<void> {
  log("Phase share: shot 05 (public share page)");
  const env = loadRootEnv();
  const SUPABASE_URL = env.SUPABASE_URL || "http://127.0.0.1:54321";
  const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY || "";
  const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SERVICE_ROLE_KEY) {
    console.warn("  SKIPPING shot 05 (share page): SUPABASE_SERVICE_ROLE_KEY not set in root .env");
    return;
  }

  const EMAIL = "capture-share@tabburrow.test";
  await buildExtensionWithSiteUrl(WEB_SITE_URL, SUPABASE_URL, SUPABASE_ANON_KEY);
  await startWebDevServer(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { context, extensionId, userDataDir } = await launchExtensionContextAt();
  try {
    const existing = await findAdminUserByEmail(SUPABASE_URL, SERVICE_ROLE_KEY, EMAIL);
    if (existing) {
      await deleteCloudDataForUser(SUPABASE_URL, SERVICE_ROLE_KEY, existing.id);
      await deleteAdminUser(SUPABASE_URL, SERVICE_ROLE_KEY, existing.id);
    }

    const dash = await context.newPage();
    await dash.goto(`chrome-extension://${extensionId}/dashboard.html`);
    await resetData(dash);

    const portlandId = randomUUID();
    await seedCollectionsAndLinks(
      dash,
      [{ id: portlandId, name: "Weekend in Portland", accent: "var(--accent)", position: seedPosition(0) }],
      toSeedLinks(portlandId, PORTLAND_LINKS),
    );
    await dash.reload();

    await dash.goto(`chrome-extension://${extensionId}/dashboard.html#/settings`);
    await signInWithEmailOtp(dash, EMAIL);
    const authUser = await findAdminUserByEmail(SUPABASE_URL, SERVICE_ROLE_KEY, EMAIL);
    if (!authUser) throw new Error("expected an auth.users row after sign-in");
    await setUserPlan(SUPABASE_URL, SERVICE_ROLE_KEY, authUser.id, "pro");
    await dash.getByRole("button", { name: "Refresh status" }).click();
    await expect(dash.getByText("PRO", { exact: true })).toBeVisible();

    await dash.goto(`chrome-extension://${extensionId}/dashboard.html#/c/${portlandId}`);
    await dash.getByRole("button", { name: "Share", exact: true }).click();
    const dialog = dash.getByRole("dialog", { name: "Share collection" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Share this collection" }).click();
    const urlInput = dialog.getByLabel("Share link");
    await expect(urlInput).toBeVisible({ timeout: 30_000 });
    const shareUrl = await urlInput.inputValue();

    const sharePage = await context.newPage();
    await sharePage.setViewportSize(STORE_VIEWPORT);
    await sharePage.goto(shareUrl, { waitUntil: "networkidle" });
    await expect(sharePage.getByRole("heading", { name: "Weekend in Portland" })).toBeVisible();
    await expect(sharePage.getByText("Made with TabBurrow: get the extension.")).toBeVisible();
    await sharePage.waitForTimeout(500); // let favicon fetches (Google's s2 service) settle
    await sharePage.screenshot({ path: path.join(SCREENSHOTS_DIR, "05-share-page.png") });
    console.log("  wrote screenshots/05-share-page.png (1280x800)");
    await sharePage.close();

    await deleteCloudDataForUser(SUPABASE_URL, SERVICE_ROLE_KEY, authUser.id);
    await deleteAdminUser(SUPABASE_URL, SERVICE_ROLE_KEY, authUser.id);
  } finally {
    await closeExtensionContext(context, userDataDir);
    await stopWebDevServer();
    await restoreNormalExtensionBuild();
  }
}

// ---------------------------------------------------------------------------
// Phase: tile (440x280 promo tile + 128x128 store icon)
// ---------------------------------------------------------------------------

async function phaseTile(): Promise<void> {
  log("Phase tile: promo tile (440x280) + store icon (128x128)");

  const builtIcon128 = path.resolve(EXTENSION_DIR, ".output/chrome-mv3/icons/128.png");
  if (fs.existsSync(builtIcon128)) {
    fs.copyFileSync(builtIcon128, path.join(STORE_ASSETS_DIR, "icon-128.png"));
    console.log("  wrote store-assets/icon-128.png (reused apps/extension's own built icon, rasterized from icon.svg)");
  } else {
    console.warn("  SKIPPING icon-128.png: .output/chrome-mv3/icons/128.png missing — run `pnpm --filter extension build` first");
  }

  const html = `<!doctype html><html><head><style>
    ${brandFontFaces()}
    html,body{margin:0;padding:0;width:440px;height:280px;background:${BRAND_GROUND};overflow:hidden;}
    .wrap{display:flex;align-items:center;gap:28px;width:440px;height:280px;padding:0 32px;box-sizing:border-box;}
    .icon{width:132px;height:132px;flex-shrink:0;}
    .text{display:flex;flex-direction:column;gap:10px;}
    .wordmark{font-family:"Syne",sans-serif;font-weight:700;font-size:40px;line-height:1;color:${BRAND_CREAM};margin:0;}
    .tagline{font-family:"Inter",sans-serif;font-weight:400;font-size:16px;line-height:1.3;color:${BRAND_CREAM_DIM};margin:0;max-width:220px;}
  </style></head><body>
    <div class="wrap">
      <div class="icon">${BURROW_ARCH_SVG}</div>
      <div class="text">
        <p class="wordmark">TabBurrow</p>
        <p class="tagline">Your tabs deserve a burrow.</p>
      </div>
    </div>
  </body></html>`;

  await renderHtmlToPng(
    html,
    440,
    280,
    path.join(STORE_ASSETS_DIR, "promo-tile-440x280.png"),
    path.join(STORE_ASSETS_DIR, "promo-tile.html"),
  );
}

// ---------------------------------------------------------------------------
// Phase: hero (README hero banner, ~1600x800)
// ---------------------------------------------------------------------------

async function phaseHero(): Promise<void> {
  log("Phase hero: README hero banner (1600x800)");
  const dashboardShotPath = path.join(SCREENSHOTS_DIR, "02-dashboard-grid.png");
  if (!fs.existsSync(dashboardShotPath)) {
    throw new Error(`${dashboardShotPath} is missing — run the "main" phase first (it produces the dashboard screenshot the hero embeds).`);
  }
  const dashboardShot = fs.readFileSync(dashboardShotPath);

  const CARD_W = 940;
  const CARD_H = Math.round(CARD_W * (STORE_VIEWPORT.height / STORE_VIEWPORT.width)); // preserve the 1280:800 aspect ratio

  const html = `<!doctype html><html><head><style>
    ${brandFontFaces()}
    html,body{margin:0;padding:0;width:1600px;height:800px;background:${BRAND_GROUND};overflow:hidden;}
    .wrap{display:flex;align-items:center;width:1600px;height:800px;box-sizing:border-box;}
    .left{display:flex;flex-direction:column;gap:20px;width:560px;flex-shrink:0;padding-left:64px;box-sizing:border-box;}
    .icon{width:88px;height:88px;}
    .wordmark{font-family:"Syne",sans-serif;font-weight:700;font-size:64px;line-height:1;color:${BRAND_CREAM};margin:0;}
    .tagline{font-family:"Inter",sans-serif;font-weight:400;font-size:22px;line-height:1.4;color:${BRAND_CREAM_DIM};margin:0;max-width:440px;}
    .right{flex:1;display:flex;align-items:center;justify-content:center;position:relative;}
    .glow{position:absolute;width:${CARD_W + 140}px;height:${CARD_H + 140}px;background:radial-gradient(closest-side, rgba(249,115,22,0.14), rgba(249,115,22,0) 70%);}
    .card{position:relative;width:${CARD_W}px;height:${CARD_H}px;border-radius:18px;overflow:hidden;box-shadow:0 40px 90px rgba(0,0,0,0.6),0 10px 28px rgba(0,0,0,0.45);border:1px solid rgba(238,232,217,0.28);}
    .card img{width:100%;height:100%;object-fit:cover;display:block;}
  </style></head><body>
    <div class="wrap">
      <div class="left">
        <div class="icon">${BURROW_ARCH_SVG}</div>
        <p class="wordmark">TabBurrow</p>
        <p class="tagline">Your tabs, saved in one click, yours forever. Local-first, open source.</p>
      </div>
      <div class="right">
        <div class="glow"></div>
        <div class="card"><img src="${pngDataUri(dashboardShot)}"></div>
      </div>
    </div>
  </body></html>`;

  await renderHtmlToPng(
    html,
    1600,
    800,
    path.join(README_ASSETS_DIR, "readme-hero.png"),
    path.join(README_ASSETS_DIR, "readme-hero.html"),
  );
}

// ---------------------------------------------------------------------------
// Phase: gif (best-effort README demo GIF — save -> organize -> restore)
// ---------------------------------------------------------------------------

function ffmpegAvailable(): boolean {
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function phaseGif(): Promise<void> {
  log("Phase gif: README demo GIF (best-effort)");
  if (!ffmpegAvailable()) {
    console.warn("  SKIPPING gif: ffmpeg not found on PATH (`brew install ffmpeg`).");
    return;
  }

  const localServer = await startLocalServer();
  const videoDir = fs.mkdtempSync(path.join(os.tmpdir(), "tabburrow-gif-"));
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tabburrow-capture-gif-"));
  let context: BrowserContext | null = null;
  let dashVideoPath: string | null = null;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: CAPTURE_HEADLESS,
      viewport: STORE_VIEWPORT,
      recordVideo: { dir: videoDir, size: STORE_VIEWPORT },
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        "--no-first-run",
        "--no-default-browser-check",
      ],
    });
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15_000 });
    const extensionId = new URL(sw.url()).host;

    const dash = await context.newPage();
    await dash.goto(`chrome-extension://${extensionId}/dashboard.html`);
    await resetData(dash);

    // Sign in FIRST, before any collection exists — CollectionPanel (the
    // "Organize with AI"/"Share" buttons' home) then only ever mounts
    // AFTER the session is already established, matching the one pattern
    // already proven reliable elsewhere in this script (the "main" and
    // "share" phases both sign in before their first visit to a collection
    // route). Signing in AFTER save+navigate would remount CollectionPanel
    // signed-out-then-in, which was observed locally to leave the "Organize
    // with AI" trigger stuck on its locked label — not worth chasing
    // further for a best-effort asset.
    const GIF_DEMO_EMAIL = "capture-gif-demo@tabburrow.test";
    let signedIn = false;
    try {
      await dash.goto(`chrome-extension://${extensionId}/dashboard.html#/settings`);
      await signInWithEmailOtp(dash, GIF_DEMO_EMAIL);
      signedIn = true;
    } catch (err) {
      console.warn(`  gif: sign-in skipped, continuing signed-out (${err instanceof Error ? err.message : String(err)})`);
    }

    // --- Save ---
    const tabA = await context.newPage();
    await tabA.goto(localServer.pageUrl("Sourdough Starter Guide - King Arthur Baking"));
    const tabB = await context.newPage();
    await tabB.goto(localServer.pageUrl("Focaccia Troubleshooting - The Perfect Loaf"));
    await tabB.bringToFront();
    const popup = await popupPage(context, extensionId);
    await tabB.bringToFront();
    await popup.getByRole("button", { name: /Save all tabs/ }).click();
    await popup.getByPlaceholder("Collection name").fill("Quick Saves");
    await popup.getByRole("button", { name: "Create" }).click();
    await expect(popup.getByText(/Saved 2 tabs to Quick Saves/)).toBeVisible();
    await popup.waitForTimeout(700);
    await popup.getByRole("button", { name: "Done" }).click();
    await popup.close();

    const dashUrl = dash.url().split("#")[0] ?? dash.url();
    await dash.goto(dashUrl);
    await expect(dash.getByRole("heading", { name: "Quick Saves" })).toBeVisible();
    await dash.waitForTimeout(700);

    // --- Organize (live call — best effort; wrapped so a slow/unreachable
    // AI call can't sink the whole recording — the Restore beat below
    // still runs either way). ---
    try {
      if (!signedIn) throw new Error("not signed in");
      await dash.getByRole("button", { name: "Organize with AI", exact: true }).click({ timeout: 5_000 });
      const dialog = dash.getByRole("dialog", { name: "Organize with AI" });
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      await dialog.getByRole("button", { name: "Organize", exact: true }).click();
      await expect(dialog.getByRole("group").first()).toBeVisible({ timeout: 20_000 });
      await dash.waitForTimeout(800);
      // Cancel (not Apply) — keeps "Quick Saves" populated for the Restore beat below.
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click({ timeout: 3_000 });
    } catch (err) {
      console.warn(`  gif: organize beat skipped (${err instanceof Error ? err.message : String(err)})`);
      // Best-effort close of whatever dialog state we were left in, so it
      // doesn't cover the Restore button below.
      await dash.keyboard.press("Escape").catch(() => {});
    }
    await dash.waitForTimeout(400);

    // --- Restore ---
    await dash.getByRole("button", { name: "Restore all" }).click({ timeout: 5_000 }).catch(() => {});
    await dash.waitForTimeout(1_200);

    try {
      const env = loadRootEnv();
      const SUPABASE_URL = env.SUPABASE_URL || "http://127.0.0.1:54321";
      const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
      if (SERVICE_ROLE_KEY) {
        const authUser = await findAdminUserByEmail(SUPABASE_URL, SERVICE_ROLE_KEY, GIF_DEMO_EMAIL);
        if (authUser) await deleteAdminUser(SUPABASE_URL, SERVICE_ROLE_KEY, authUser.id);
      }
    } catch {
      // best-effort cleanup only — never let this fail the capture.
    }

    // Playwright records ONE .webm per page — the dashboard page's own
    // recording is the one that carries the whole flow (the background tab
    // and the popup are secondary chrome, not needed in the GIF), so its
    // path must be captured explicitly rather than guessed from directory
    // listing order. `.video().path()` only resolves once the page (or its
    // context) has closed and the recording is flushed to disk.
    const dashVideo = dash.video();
    await dash.close();
    await tabA.close();
    await tabB.close();
    dashVideoPath = dashVideo ? await dashVideo.path() : null;
  } finally {
    if (context) await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    localServer.server.closeAllConnections();
    await new Promise<void>((resolve) => localServer.server.close(() => resolve()));
  }

  if (!dashVideoPath || !fs.existsSync(dashVideoPath)) {
    console.warn("  SKIPPING gif: the dashboard page's .webm recording was not produced.");
    return;
  }
  const webmPath = dashVideoPath;
  const outGif = path.join(README_ASSETS_DIR, "readme-demo.gif");
  const palettePath = path.join(videoDir, "palette.png");

  try {
    // 1.6x speed-up (setpts) to compress the whole real flow toward the
    // 10-12s target, downscale to 800px wide, cap at 12s and 20fps, and use
    // a two-pass palette (palettegen/paletteuse) — dramatically smaller than
    // a naive single-pass GIF for mostly-flat UI content like this.
    execSync(
      `ffmpeg -y -i "${webmPath}" -vf "setpts=0.625*PTS,fps=20,scale=800:-1:flags=lanczos,palettegen" "${palettePath}"`,
      { stdio: "pipe" },
    );
    execSync(
      `ffmpeg -y -i "${webmPath}" -i "${palettePath}" -t 12 -filter_complex "[0:v]setpts=0.625*PTS,fps=20,scale=800:-1:flags=lanczos[x];[x][1:v]paletteuse" "${outGif}"`,
      { stdio: "pipe" },
    );
    const sizeBytes = fs.statSync(outGif).size;
    const sizeMb = sizeBytes / (1024 * 1024);
    if (sizeMb > 5) {
      fs.rmSync(outGif, { force: true });
      console.warn(`  SKIPPING gif: converted file was ${sizeMb.toFixed(1)}MB (over the 5MB target) — left the README slot as a TODO instead of shipping an oversized GIF.`);
    } else {
      console.log(`  wrote assets/readme-demo.gif (${sizeMb.toFixed(2)}MB)`);
    }
  } catch (err) {
    console.warn(`  SKIPPING gif: ffmpeg conversion failed — ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    fs.rmSync(videoDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// CLI dispatch
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const phase = process.argv[2] ?? "all";
  const run: Record<string, () => Promise<void>> = {
    main: phaseMain,
    share: phaseShare,
    tile: phaseTile,
    hero: phaseHero,
    gif: phaseGif,
  };
  if (phase === "all") {
    for (const key of ["main", "share", "tile", "hero", "gif"]) await run[key]!();
  } else if (run[phase]) {
    await run[phase]!();
  } else {
    console.error(`Unknown phase "${phase}". Expected one of: all, main, share, tile, hero, gif`);
    process.exitCode = 1;
    return;
  }
  if (sharedCompositorBrowser) await sharedCompositorBrowser.close();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

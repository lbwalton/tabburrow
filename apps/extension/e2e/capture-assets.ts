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
 * renders the promo tiles (440x280 small + 1400x560 marquee) and README hero (1600x800) from small
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
 *   phase: all (default) | main | dashboard-grid | share | tile | hero | gif
 *
 * Requires:
 *  - `pnpm --filter extension build:e2e` already run (this script does not
 *    do the INITIAL build for you — same "REQUIRED, fresh, before every
 *    run" precedent e2e/README.md sets for the test suite itself; `build:e2e`
 *    rather than plain `build` because every phase here talks to the local
 *    Supabase stack, and a production build's `host_permissions` no longer
 *    includes that loopback origin — see wxt.config.ts). The "share"
 *    phase DOES rebuild the extension (twice — see t22-share.spec.ts's "env
 *    dance", duplicated here) and restores the normal build afterward.
 *  - the local Supabase stack running (`supabase start`) with
 *    SUPABASE_SERVICE_ROLE_KEY and ANTHROPIC_API_KEY set in the root
 *    `.env` — the "main" phase's dashboard-grid (shot 02, signed-in PRO —
 *    see phaseDashboardGrid) and AI-organize (shot 03) shots, and the
 *    "share" phase, all need live infra, same as t18/t20/t22's specs.
 *    "dashboard-grid" is also its own standalone phase, for re-capturing
 *    just that one shot.
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
const BRAND_YELLOW = "#D9A441";

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

/** Seeds the five rail collections (4-6 per listing.md's shot 2 spec) shared by shots 01, 02, and 04 — one source of truth for phaseMain()'s own `dash` page AND phaseDashboardGrid()'s separate standalone session below, instead of two copies of this data drifting apart. */
async function seedMainCollections(dash: Page) {
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
  // Duplicated literals — see lib/commands.ts's LAST_USED_COLLECTION_META_KEY and
  // lib/saveTarget.ts's meta keys. defaultCollectionId + saveTargetMode make the
  // redesigned popup's "1-click Save goes to Kitchen reno research" control show
  // a real pinned target in shot 01 instead of the unset "a folder you choose".
  await seedMeta(dash, {
    lastUsedCollectionId: kitchenRenoId,
    defaultCollectionId: kitchenRenoId,
    saveTargetMode: "default",
  });
  await dash.reload();

  return { kitchenRenoId, competitorId, portlandId, devDocsId, recipesId };
}

// ---------------------------------------------------------------------------
// Phase: dashboard-grid (shot 02) — its own persistent context/session,
// deliberately NOT sharing phaseMain()'s `dash` page used for shots 01/04, so
// signing in here can never leak into (and change the appearance of) those
// other, intentionally-signed-out shots. Signed-in + plan-flipped PRO (same
// OTP + admin-API plan-flip helpers phaseShare() uses for shot 05): the
// dashboard grid is the store listing's most-viewed screenshot, and
// DashboardMain.tsx's "Organize with AI"/"Share" header buttons render a
// literal "🔒" glyph whenever `signedIn` is false, which made both headline
// features look paywalled in a signed-out capture. PRO is flipped too (not
// just signed in) so the account state is fully truthful, not merely
// unlocked-looking.
//
// Callable standalone (`npx tsx e2e/capture-assets.ts dashboard-grid`) to
// re-capture ONLY this one shot without also re-running shots 01/03/04 (03
// makes a live, costlier Anthropic call). phaseMain() also calls this
// directly so a full "main"/"all" run still produces all four "main" shots.
// ---------------------------------------------------------------------------

const DASHBOARD_GRID_EMAIL = "capture-dashboard-grid@tabburrow.test";

async function phaseDashboardGrid(): Promise<void> {
  log("Phase dashboard-grid: shot 02 (signed-in, PRO)");
  const { context, extensionId, userDataDir } = await launchExtensionContextAt();

  try {
    const dash = await context.newPage();
    await dash.goto(`chrome-extension://${extensionId}/dashboard.html`);
    await resetData(dash);

    const { kitchenRenoId } = await seedMainCollections(dash);

    const env = loadRootEnv();
    const SUPABASE_URL = env.SUPABASE_URL || "http://127.0.0.1:54321";
    const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SERVICE_ROLE_KEY) {
      console.warn("  02-dashboard-grid: capturing SIGNED OUT — SUPABASE_SERVICE_ROLE_KEY not set in root .env, so Organize with AI / Share will show locked.");
    } else {
      const existing = await findAdminUserByEmail(SUPABASE_URL, SERVICE_ROLE_KEY, DASHBOARD_GRID_EMAIL);
      if (existing) await deleteAdminUser(SUPABASE_URL, SERVICE_ROLE_KEY, existing.id);

      await dash.goto(`chrome-extension://${extensionId}/dashboard.html#/settings`);
      await signInWithEmailOtp(dash, DASHBOARD_GRID_EMAIL);
      const authUser = await findAdminUserByEmail(SUPABASE_URL, SERVICE_ROLE_KEY, DASHBOARD_GRID_EMAIL);
      if (!authUser) throw new Error("expected an auth.users row after sign-in");
      await setUserPlan(SUPABASE_URL, SERVICE_ROLE_KEY, authUser.id, "pro");
      await dash.getByRole("button", { name: "Refresh status" }).click();
      await expect(dash.getByText("PRO", { exact: true })).toBeVisible();
    }

    // --- Shot 02: dashboard grid ---
    await dash.goto(`chrome-extension://${extensionId}/dashboard.html#/c/${kitchenRenoId}`);
    await expect(dash.getByRole("heading", { name: "Kitchen reno research" })).toBeVisible();
    await expect(dash.getByRole("listbox", { name: "Links" }).getByRole("option")).toHaveCount(KITCHEN_RENO_LINKS.length);
    if (SERVICE_ROLE_KEY) {
      await expect(dash.getByRole("button", { name: "Organize with AI", exact: true })).toBeVisible();
      await expect(dash.getByRole("button", { name: "Share", exact: true })).toBeVisible();
    }
    // Move the mouse off-canvas before the shot — its last position (from
    // clicking "Refresh status" on the Settings route above) can otherwise
    // still land over the first grid card after navigating here, leaving a
    // stray hover state (drag-grip + rename-pencil icons, underlined title)
    // baked into the screenshot.
    await dash.mouse.move(0, 0);
    await dash.waitForTimeout(300); // let favicon fallbacks (broken -> globe SVG) settle, and any hover state clear, before the shot
    await dash.screenshot({ path: path.join(SCREENSHOTS_DIR, "02-dashboard-grid.png") });
    console.log("  wrote screenshots/02-dashboard-grid.png (1280x800)");

    if (SERVICE_ROLE_KEY) {
      const authUser = await findAdminUserByEmail(SUPABASE_URL, SERVICE_ROLE_KEY, DASHBOARD_GRID_EMAIL);
      if (authUser) await deleteAdminUser(SUPABASE_URL, SERVICE_ROLE_KEY, authUser.id);
    }
  } finally {
    await closeExtensionContext(context, userDataDir);
  }
}

// ---------------------------------------------------------------------------
// Phase: main (shots 1, 4 on the normal build, signed out; shot 2 is
// captured separately by phaseDashboardGrid — signed-in PRO, its own
// session; shot 3 needs sign-in for the live AI-organize call)
// ---------------------------------------------------------------------------

async function phaseMain(): Promise<void> {
  log("Phase main: shots 01, 02 (via phaseDashboardGrid), 03, 04");
  const localServer = await startLocalServer();
  const { context, extensionId, userDataDir } = await launchExtensionContextAt();

  try {
    const dash = await context.newPage();
    await dash.goto(`chrome-extension://${extensionId}/dashboard.html`);
    await resetData(dash);

    // --- Seed the five rail collections (4-6 per listing.md's shot 2 spec) ---
    const { kitchenRenoId } = await seedMainCollections(dash);

    // --- Shot 02: dashboard grid — own separate context/session, signed-in PRO (see phaseDashboardGrid's docstring above) ---
    await phaseDashboardGrid();

    // --- Shot 01: the redesigned popup's folders home over a real website —
    // the "1-click Save goes to" control with a pinned target (seeded above),
    // the full folder list with live counts, and one row hovered so its quick
    // actions (+ / open-all) are visible. The backdrop is a live capture of
    // newsbooklm.com (subtly blurred in the composite, with an orange glow
    // around the popup, so the shot reads as "the extension, highlighted over
    // a real site"); offline, it falls back to the local stub page. ---
    const bgPage = await context.newPage();
    await bgPage.setViewportSize(STORE_VIEWPORT);
    try {
      await bgPage.goto("https://newsbooklm.com", { waitUntil: "networkidle", timeout: 45_000 });
      await bgPage.waitForTimeout(1200);
      // Dismiss the site's cookie banner if it's up (best-effort — the banner
      // copy may change; a stale selector just leaves the banner in shot).
      for (const name of [/essential only/i, /accept all/i]) {
        const btn = bgPage.getByRole("button", { name });
        if (await btn.count().catch(() => 0)) {
          await btn.first().click().catch(() => {});
          await bgPage.waitForTimeout(600);
          break;
        }
      }
    } catch {
      console.warn("  shot 01: newsbooklm.com unreachable — falling back to the local stub background");
      await bgPage.goto(localServer.pageUrl("Sourdough Starter Guide - King Arthur Baking"));
    }
    await bgPage.bringToFront();

    const popup = await popupPage(context, extensionId);
    await bgPage.bringToFront();
    await expect(popup.getByText("1-click Save goes to")).toBeVisible();
    // The pinned target's name appears in BOTH the save-target control and the
    // folder list (that duplication is the point of the shot) — .first() keeps
    // the strict-mode locator happy.
    await expect(popup.getByText("Kitchen reno research", { exact: true }).first()).toBeVisible();
    await popup.locator("div.group", { hasText: "Weekend in Portland" }).first().hover();
    await popup.waitForTimeout(250);

    const bgShotBuf = await bgPage.screenshot();
    const popupShotBuf = await popup.locator("#root > div").screenshot();
    const popupBox = await popup.locator("#root > div").boundingBox();
    const popupHeight = popupBox?.height ?? 420;
    // The backdrop is blurred just enough to stay recognizable while pushing
    // it behind the popup; the slight scale-up hides the blur's soft edge
    // bleed at the canvas border, the scrim dims it a touch, and the two-layer
    // orange glow (wide soft halo + tight bright ring, brand #F97316) makes
    // the popup unmistakably the subject.
    const composite01 = `<!doctype html><html><head><style>
      html,body{margin:0;padding:0;width:${STORE_VIEWPORT.width}px;height:${STORE_VIEWPORT.height}px;overflow:hidden;background:#101613;}
      .bg{position:absolute;top:0;left:0;width:${STORE_VIEWPORT.width}px;height:${STORE_VIEWPORT.height}px;object-fit:cover;filter:blur(4px);transform:scale(1.02);}
      .scrim{position:absolute;top:0;left:0;width:${STORE_VIEWPORT.width}px;height:${STORE_VIEWPORT.height}px;background:rgba(8,12,10,0.12);}
      .popup{position:absolute;top:28px;right:36px;width:360px;height:${popupHeight}px;border-radius:12px;box-shadow:0 0 18px 4px rgba(249,115,22,0.92),0 0 42px 12px rgba(249,115,22,0.80);}
    </style></head><body>
      <img class="bg" src="${pngDataUri(bgShotBuf)}">
      <div class="scrim"></div>
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
        // Generous: the live call was measured at ~20s for 4 links on a slow
        // day (2026-07-19), and this shot sends 16.
        await expect(dialog.getByRole("group").first()).toBeVisible({ timeout: 150_000 });
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
  // WXT_INCLUDE_LOCAL_HOSTS: this phase always targets the local Supabase
  // stack (see the module docstring) — a plain production build's
  // host_permissions would drop the loopback origin, see wxt.config.ts.
  await runCommand("npx", ["wxt", "build"], EXTENSION_DIR, { WXT_INCLUDE_LOCAL_HOSTS: "1" });
}

async function restoreNormalExtensionBuild(): Promise<void> {
  await runCommand("node", ["scripts/sync-env.mjs"], EXTENSION_DIR);
  // Restores the build:e2e baseline this whole script requires as a
  // precondition (see the module docstring), not a plain production build.
  await runCommand("npx", ["wxt", "build"], EXTENSION_DIR, { WXT_INCLUDE_LOCAL_HOSTS: "1" });
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
// Phase: tile (440x280 small promo tile + 1400x560 marquee + 128x128 icon)
// ---------------------------------------------------------------------------

/**
 * A tiny "tab chip" — a rounded card with a favicon dot and a text bar —
 * used by both promo tiles to tell the product story visually (tabs flowing
 * into the burrow) instead of with copy, per the Chrome Web Store's promo
 * guidance ("avoid too much text", "communicate the brand", "don't just use
 * a screenshot"). Chips are painted BEFORE the arch SVG in the DOM, so a
 * chip positioned over the doorway hollow shows through it (the hollow is
 * transparent) while the arch band occludes it — reading as "this tab is
 * entering the burrow".
 */
function tabChip(opts: { x: number; y: number; w: number; h: number; rot: number; opacity: number; dot: string }): string {
  const { x, y, w, h, rot, opacity, dot } = opts;
  const dotSize = Math.round(h * 0.45);
  const barH = Math.max(3, Math.round(h * 0.22));
  return `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;transform:rotate(${rot}deg);opacity:${opacity};background:${BRAND_SURFACE};border:1px solid rgba(238,232,217,0.22);border-radius:${Math.round(h * 0.55)}px;display:flex;align-items:center;gap:${Math.round(h * 0.3)}px;padding:0 ${Math.round(h * 0.45)}px;box-sizing:border-box;">
    <div style="width:${dotSize}px;height:${dotSize}px;border-radius:50%;background:${dot};flex-shrink:0;"></div>
    <div style="flex:1;height:${barH}px;border-radius:${barH}px;background:rgba(238,232,217,0.28);"></div>
  </div>`;
}

async function phaseTile(): Promise<void> {
  log("Phase tile: small promo tile (440x280) + marquee (1400x560) + store icon (128x128)");

  const builtIcon128 = path.resolve(EXTENSION_DIR, ".output/chrome-mv3/icons/128.png");
  if (fs.existsSync(builtIcon128)) {
    fs.copyFileSync(builtIcon128, path.join(STORE_ASSETS_DIR, "icon-128.png"));
    console.log("  wrote store-assets/icon-128.png (reused apps/extension's own built icon, rasterized from icon.svg)");
  } else {
    console.warn("  SKIPPING icon-128.png: .output/chrome-mv3/icons/128.png missing — run `pnpm --filter extension build` first");
  }

  // --- Small promo tile (440x280) ---------------------------------------
  // Layout: the familiar icon+wordmark lockup, with two upgrades over the
  // launch draft: the tagline is now a value proposition ("Save every tab in
  // one click.") instead of the poetic line, and three tab chips arc from
  // the top-right into the arch's doorway so the graphic itself says "tabs
  // go into the burrow". Text column budget: 440 - 32(left pad) - 132(icon)
  // - 28(gap) - 32(right pad) = 216px. At 40px Syne Bold, "TabBurrow"
  // measures ~241.8px — too wide — so the wordmark stays at 36px (~217.6px)
  // with `max-width` + `overflow:hidden` as belt-and-suspenders clipping.
  // Chips live in the icon's 132px box coordinate space (position:relative);
  // the trailing chip may overflow it (overflow stays visible), but never
  // into the text column's y-range.
  const smallChips = [
    tabChip({ x: 134, y: -8, w: 44, h: 14, rot: -14, opacity: 0.7, dot: BRAND_YELLOW }),
    tabChip({ x: 96, y: 30, w: 48, h: 14, rot: -8, opacity: 0.9, dot: BRAND_ORANGE }),
    // Inside the doorway: occluded by the arch band, visible through the
    // hollow, dimmed as if in the dark of the burrow.
    tabChip({ x: 47, y: 86, w: 46, h: 14, rot: 0, opacity: 0.55, dot: BRAND_CREAM }),
  ].join("");
  const smallTileHtml = `<!doctype html><html><head><style>
    ${brandFontFaces()}
    html,body{margin:0;padding:0;width:440px;height:280px;background:${BRAND_GROUND};overflow:hidden;}
    .wrap{display:flex;align-items:center;gap:28px;width:440px;height:280px;padding:0 32px;box-sizing:border-box;}
    .icon{width:132px;height:132px;flex-shrink:0;position:relative;}
    .icon svg{position:relative;}
    .warmth{position:absolute;left:-60px;top:-60px;width:252px;height:252px;background:radial-gradient(closest-side, rgba(249,115,22,0.12), rgba(249,115,22,0) 70%);}
    .text{display:flex;flex-direction:column;gap:10px;max-width:220px;}
    .wordmark{font-family:"Syne",sans-serif;font-weight:700;font-size:36px;line-height:1;color:${BRAND_CREAM};margin:0;white-space:nowrap;overflow:hidden;}
    .tagline{font-family:"Inter",sans-serif;font-weight:400;font-size:17px;line-height:1.35;color:${BRAND_CREAM_DIM};margin:0;max-width:216px;}
  </style></head><body>
    <div class="wrap">
      <div class="icon"><div class="warmth"></div>${smallChips}${BURROW_ARCH_SVG}</div>
      <div class="text">
        <p class="wordmark">TabBurrow</p>
        <p class="tagline">Save every tab<br>in one click.</p>
      </div>
    </div>
  </body></html>`;

  await renderHtmlToPng(
    smallTileHtml,
    440,
    280,
    path.join(STORE_ASSETS_DIR, "promo-tile-440x280.png"),
    path.join(STORE_ASSETS_DIR, "promo-tile.html"),
  );

  // --- Marquee promo tile (1400x560) ------------------------------------
  // Optional in the console but REQUIRED for the extension to be eligible
  // for the store's rotating marquee carousel. Same visual system as the
  // small tile, with room to breathe: brand lockup + value line on the
  // left, and on the right a large arch with a parade of tab chips flowing
  // in from the edge. No screenshots (the store's guidance says promos
  // should communicate the brand, not the UI), minimal text, saturated
  // ground, full bleed. Wordmark: Syne Bold measures ~6.04px width per 1px
  // of font-size for "TabBurrow", so 80px ≈ 484px — inside the 532px left
  // column budget (620 - 88 padding).
  // Chip coordinates are in `.right`'s space. The arch box is at (60,130),
  // 340px (viewBox scale 2.656): doorway hollow ≈ x 166-294, y 279-428.
  // The trail arcs down-left from the top-right; the last chip sits in the
  // hollow with its right edge tucked under the right band leg (chips paint
  // before the SVG), reading as "entering the burrow".
  const marqueeChips = [
    tabChip({ x: 560, y: 52, w: 104, h: 28, rot: -18, opacity: 0.65, dot: BRAND_YELLOW }),
    tabChip({ x: 470, y: 110, w: 118, h: 30, rot: -14, opacity: 0.78, dot: BRAND_ORANGE }),
    tabChip({ x: 395, y: 175, w: 126, h: 30, rot: -10, opacity: 0.9, dot: BRAND_CREAM }),
    tabChip({ x: 350, y: 245, w: 122, h: 30, rot: -5, opacity: 1, dot: BRAND_ORANGE }),
    // Entering the doorway (occluded by the band, visible in the hollow).
    tabChip({ x: 210, y: 330, w: 112, h: 30, rot: 0, opacity: 0.5, dot: BRAND_YELLOW }),
  ].join("");
  const marqueeHtml = `<!doctype html><html><head><style>
    ${brandFontFaces()}
    html,body{margin:0;padding:0;width:1400px;height:560px;background:linear-gradient(180deg, ${BRAND_GROUND} 0%, #101B15 100%);overflow:hidden;}
    .wrap{display:flex;align-items:center;width:1400px;height:560px;box-sizing:border-box;}
    .left{display:flex;flex-direction:column;gap:22px;width:620px;flex-shrink:0;padding-left:88px;box-sizing:border-box;}
    .lockicon{width:84px;height:84px;}
    .wordmark{font-family:"Syne",sans-serif;font-weight:700;font-size:80px;line-height:1;color:${BRAND_CREAM};margin:0;white-space:nowrap;}
    .value{font-family:"Inter",sans-serif;font-weight:600;font-size:27px;line-height:1.35;color:${BRAND_CREAM};margin:0;max-width:460px;}
    .sub{font-family:"Inter",sans-serif;font-weight:400;font-size:22px;line-height:1.35;color:${BRAND_CREAM_DIM};margin:0;max-width:460px;}
    .right{flex:1;position:relative;height:560px;}
    .glow{position:absolute;left:-40px;top:60px;width:560px;height:560px;background:radial-gradient(closest-side, rgba(249,115,22,0.16), rgba(249,115,22,0) 70%);}
    .arch{position:absolute;left:60px;top:130px;width:340px;height:340px;}
  </style></head><body>
    <div class="wrap">
      <div class="left">
        <div class="lockicon">${BURROW_ARCH_SVG}</div>
        <p class="wordmark">TabBurrow</p>
        <p class="value">Save every tab in one click.</p>
        <p class="sub">Local-first. Private. Open source.</p>
      </div>
      <div class="right">
        <div class="glow"></div>
        ${marqueeChips}
        <div class="arch">${BURROW_ARCH_SVG}</div>
      </div>
    </div>
  </body></html>`;

  await renderHtmlToPng(
    marqueeHtml,
    1400,
    560,
    path.join(STORE_ASSETS_DIR, "marquee-promo-tile-1400x560.png"),
    path.join(STORE_ASSETS_DIR, "marquee-promo-tile.html"),
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
    // Redesigned popup: "Save all" lives in the Save split-button's caret menu;
    // "Choose a folder…" opens the picker with the save-all pending.
    await popup.getByRole("button", { name: "More save options" }).click();
    await popup.getByRole("menuitem", { name: "Choose a folder…" }).click();
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
    "dashboard-grid": phaseDashboardGrid,
    share: phaseShare,
    tile: phaseTile,
    hero: phaseHero,
    gif: phaseGif,
  };
  if (phase === "all") {
    // "dashboard-grid" (shot 02) is NOT listed separately here — phaseMain()
    // already calls it directly so shot 02 is still produced exactly once.
    for (const key of ["main", "share", "tile", "hero", "gif"]) await run[key]!();
  } else if (run[phase]) {
    await run[phase]!();
  } else {
    console.error(`Unknown phase "${phase}". Expected one of: all, main, dashboard-grid, share, tile, hero, gif`);
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

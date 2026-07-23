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
 * Backdrop tabs are LB's real sites (tabburrow.com as the active tab behind
 * the popup composite, thedigitallm.com, lbwalton.com: rights are clean and
 * they double as subtle cross-promo), each with a fully designed local fake
 * page as the no-network fallback; see BACKDROP_TABS + FAKE_PAGES.
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
  /** URL for one of the FAKE_PAGES routes, e.g. pageUrl("/recipe"). */
  pageUrl(route: string): string;
}

// ---------------------------------------------------------------------------
// Fake sites served by the local HTTP server: the OFFLINE FALLBACK for the
// real-site backdrops in BACKDROP_TABS below. LB flagged the old bare
// <h1>{title}</h1> pages as a "white void" behind the popup, so every route
// is a fully designed, self-contained page: system font stacks, all CSS
// inline, CSS-only imagery (gradients/patterns, no image requests), realistic
// content density. All brands are INVENTED (The Weekly Loaf, Fieldnote,
// North Bench Goods); no real publications, retailers, or logos.
// ---------------------------------------------------------------------------

interface FakePage {
  title: string;
  html: string;
}

function pageShell(title: string, css: string, body: string): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escapeHtml(title)}</title>` +
    `<style>*{margin:0;padding:0;box-sizing:border-box}a{color:inherit;text-decoration:none}${css}</style>` +
    `</head><body>${body}</body></html>`
  );
}

const RECIPE_TITLE = "No-Knead Bread, Revisited - The Weekly Loaf";
const RECIPE_PAGE: FakePage = {
  title: RECIPE_TITLE,
  html: pageShell(
    RECIPE_TITLE,
    [
      "body{font-family:Georgia,'Iowan Old Style','Times New Roman',serif;background:#faf5ec;color:#261f17}",
      ".topline{background:#3d2c1e;color:#f2e4cd;font:600 11px/1.2 'Helvetica Neue',Arial,sans-serif;letter-spacing:.16em;text-transform:uppercase;text-align:center;padding:9px 16px}",
      "header{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:18px 56px;border-bottom:1px solid #d8c9ab}",
      ".brand{font-size:30px;font-weight:700;letter-spacing:-.01em}",
      "header nav{display:flex;gap:26px;font:500 12px/1 'Helvetica Neue',Arial,sans-serif;letter-spacing:.09em;text-transform:uppercase;color:#5c4a33}",
      ".pill{font:600 12px/1 'Helvetica Neue',Arial,sans-serif;background:#b4562c;color:#fff7ea;padding:10px 18px;border-radius:999px}",
      "main{max-width:1080px;margin:0 auto;padding:30px 48px 80px}",
      ".kicker{font:700 12px/1 'Helvetica Neue',Arial,sans-serif;letter-spacing:.22em;text-transform:uppercase;color:#b4562c}",
      "h1{font-size:52px;line-height:1.05;font-weight:700;margin:12px 0 12px;letter-spacing:-.015em}",
      ".dek{font-size:19px;line-height:1.45;color:#5c4a33;max-width:780px}",
      ".byline{display:flex;align-items:center;gap:12px;margin:20px 0 24px;font:400 13px/1.4 'Helvetica Neue',Arial,sans-serif;color:#5c4a33}",
      ".avatar{width:40px;height:40px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#e9b57f,#a5673a 70%)}",
      ".byline strong{display:block;font-size:14px;color:#261f17}",
      ".byline .date{margin-left:auto}",
      ".hero{height:280px;border-radius:6px;position:relative;background:radial-gradient(120% 90% at 30% 20%,rgba(255,235,200,.55),rgba(255,235,200,0) 55%),radial-gradient(90% 120% at 78% 75%,rgba(74,40,14,.5),rgba(74,40,14,0) 60%),repeating-linear-gradient(115deg,rgba(255,255,255,.05) 0 3px,rgba(0,0,0,.04) 3px 6px),linear-gradient(115deg,#e9b26a 0%,#c97a34 45%,#8f4c1d 100%)}",
      ".hero figcaption{position:absolute;left:2px;bottom:-24px;font:400 12px/1 'Helvetica Neue',Arial,sans-serif;color:#8a765a}",
      ".layout{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:48px;margin-top:52px}",
      "article p{font-size:17px;line-height:1.72;margin:0 0 22px}",
      "article h2{font-size:25px;margin:32px 0 14px}",
      ".dropcap{float:left;font-size:62px;line-height:.85;padding:6px 10px 0 0;color:#b4562c;font-weight:700}",
      ".ingredients-card{align-self:start;background:#fffdf6;border:1px solid #e3d5b4;border-radius:10px;padding:24px 24px 20px;box-shadow:0 10px 24px rgba(61,44,30,.08)}",
      ".ingredients-card h3{font:700 13px/1 'Helvetica Neue',Arial,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:#b4562c}",
      ".yield{font:400 13px/1.4 'Helvetica Neue',Arial,sans-serif;color:#8a765a;margin-top:8px}",
      ".ingredients-card ul{list-style:none;margin:12px 0 16px;font:400 14px/1.5 'Helvetica Neue',Arial,sans-serif}",
      ".ingredients-card li{padding:9px 0;border-bottom:1px dashed #e3d5b4;display:flex;gap:8px}",
      ".note{background:#f6ead2;border-radius:8px;padding:12px 14px;font:400 13px/1.55 'Helvetica Neue',Arial,sans-serif;color:#5c4a33}",
      ".save-btn{margin-top:16px;width:100%;border:0;background:#3d2c1e;color:#f2e4cd;font:600 14px/1 'Helvetica Neue',Arial,sans-serif;padding:13px;border-radius:8px}",
    ].join(""),
    '<div class="topline">Fresh from the oven: our 2026 Bake Sale Guide is here</div>' +
      '<header><div class="brand">The Weekly Loaf</div>' +
      '<nav><a href="#">Recipes</a><a href="#">Techniques</a><a href="#">Pantry</a><a href="#">Starters</a><a href="#">About</a></nav>' +
      '<span class="pill">Subscribe</span></header>' +
      "<main>" +
      '<div class="kicker">Baking School</div>' +
      "<h1>No-Knead Bread, Revisited</h1>" +
      '<p class="dek">Twenty years after the method swept home kitchens, a few small tweaks make the crackliest crust yet, and you still barely have to touch the dough.</p>' +
      '<div class="byline"><span class="avatar"></span><div><strong>By Marta Ellison</strong>Senior Baking Editor</div><span class="date">July 21, 2026 &middot; 9 min read</span></div>' +
      '<figure class="hero"><figcaption>A high-hydration boule, proofed overnight and baked in a lidded pot.</figcaption></figure>' +
      '<div class="layout"><article>' +
      '<p><span class="dropcap">T</span>he original promise still holds: flour, water, salt, and a whisper of yeast, stirred together in five minutes before bed. What has changed in twenty years of home baking is everything around the loaf, and a few of those lessons are worth folding back into the classic.</p>' +
      "<p>Start with hydration. The classic formula sat near 80 percent, which made a slack, sticky dough that terrified first-timers. Pulling back to 76 percent costs you almost nothing in crumb and buys a dough you can actually shape without a bench scraper standing by.</p>" +
      "<p>Second, salt earlier than you think. Mixing it in with the flour, rather than sprinkling it over the shaggy mass, gives a more even crumb and a crust that browns deeper before it dries out.</p>" +
      "<p>Third, the pot matters less than the lid. Any heavy vessel that seals will do the work of a steam oven for the first half of the bake. We tested enameled iron, bare cast iron, and a plain stockpot with foil; the differences were smaller than a degree of oven drift.</p>" +
      "<h2>Why the cold second rise matters</h2>" +
      "<p>An overnight rest in the refrigerator slows fermentation to a crawl, which sounds like a delay but is really a flavor trade. The dough picks up gentle acidity, blisters form on the surface, and scoring becomes almost easy because the cold skin holds its shape under the blade.</p>" +
      "</article>" +
      '<aside class="ingredients-card"><h3>Ingredients</h3><p class="yield">Makes one 9-inch round loaf</p>' +
      "<ul><li><b>430 g</b> bread flour</li><li><b>345 g</b> cool water</li><li><b>9 g</b> fine sea salt</li><li><b>1 g</b> instant yeast, about 1/4 tsp</li><li><b>Rice flour</b> for dusting the basket</li></ul>" +
      '<div class="note"><strong>Baker&#39;s note</strong> A lidded pot traps steam for the first 30 minutes; that steam is the whole secret to the shattering crust.</div>' +
      '<button class="save-btn">Save recipe</button></aside></div></main>',
  ),
};

const DOCS_TITLE = "Quickstart - Fieldnote Docs";
const DOCS_PAGE: FakePage = {
  title: DOCS_TITLE,
  html: pageShell(
    DOCS_TITLE,
    [
      "body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#ffffff;color:#1c2330}",
      ".shell{display:grid;grid-template-columns:256px minmax(0,1fr) 200px;min-height:100vh}",
      ".sidebar{background:#f6f7f9;border-right:1px solid #e5e8ee;padding:20px 16px 40px}",
      ".logo{display:flex;align-items:center;gap:9px;font-weight:700;font-size:17px;padding:4px 8px 16px}",
      ".mark{width:22px;height:22px;border-radius:6px;background:linear-gradient(135deg,#4f63e6,#8a4fe6)}",
      ".ver{margin-left:auto;font:600 10px/1 ui-monospace,Menlo,monospace;color:#5a6478;background:#e9ecf2;border-radius:999px;padding:4px 8px}",
      ".search{display:flex;align-items:center;gap:8px;font-size:13px;color:#7a8398;background:#fff;border:1px solid #dde1e9;border-radius:8px;padding:8px 10px;margin:0 4px 18px}",
      ".kbd{margin-left:auto;font:600 10px/1 ui-monospace,Menlo,monospace;border:1px solid #d4d9e2;border-radius:4px;padding:3px 6px;color:#8a92a5}",
      ".group{font:700 10.5px/1 -apple-system,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#8a92a5;padding:16px 12px 8px}",
      ".item{display:block;font-size:13.5px;color:#3c4457;padding:7px 12px;border-radius:7px}",
      ".item.active{background:#e9edff;color:#3646c4;font-weight:600}",
      "main{padding:36px 56px 80px;max-width:860px}",
      ".crumbs{font-size:12.5px;color:#7a8398;margin-bottom:14px}",
      ".crumbs b{color:#3646c4}",
      "h1{font-size:36px;letter-spacing:-.02em;margin-bottom:12px}",
      ".lead{font-size:16.5px;line-height:1.6;color:#4c5568;margin-bottom:28px}",
      "h2{font-size:21px;letter-spacing:-.01em;margin:30px 0 10px}",
      "main p{font-size:14.5px;line-height:1.65;color:#3c4457;margin-bottom:14px}",
      "pre{background:#14181f;color:#c9d4e3;border-radius:10px;padding:16px 18px;font:400 13px/1.6 ui-monospace,Menlo,'SF Mono',monospace;overflow-x:auto;margin:12px 0 20px;white-space:pre}",
      ".p{color:#6b7690}.kw{color:#6cb2ff}.str{color:#7ee0a3}.fn{color:#e6c07b}.cn{color:#d19af0}",
      ".callout{display:block;background:#eef4ff;border:1px solid #d5e2fb;border-left:4px solid #4f63e6;border-radius:8px;padding:13px 16px;font-size:13.5px;line-height:1.6;color:#31415f;margin:18px 0}",
      ".toc{padding:44px 24px 0 0;font-size:12.5px}",
      ".toc-h{font-weight:700;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#8a92a5;margin-bottom:10px}",
      ".toc a{display:block;color:#5a6478;padding:5px 0 5px 12px;border-left:2px solid #e5e8ee}",
      ".toc a.on{color:#3646c4;border-left-color:#3646c4;font-weight:600}",
    ].join(""),
    '<div class="shell"><aside class="sidebar">' +
      '<div class="logo"><span class="mark"></span>Fieldnote<span class="ver">v3.2</span></div>' +
      '<div class="search">Search docs<span class="kbd">/</span></div>' +
      '<div class="group">Getting started</div>' +
      '<a class="item" href="#">Overview</a><a class="item active" href="#">Quickstart</a><a class="item" href="#">Installation</a><a class="item" href="#">Authentication</a>' +
      '<div class="group">Core concepts</div>' +
      '<a class="item" href="#">Notebooks</a><a class="item" href="#">Entries</a><a class="item" href="#">Sync engine</a><a class="item" href="#">Offline mode</a>' +
      '<div class="group">API reference</div>' +
      '<a class="item" href="#">REST API</a><a class="item" href="#">Webhooks</a><a class="item" href="#">Rate limits</a><a class="item" href="#">Errors</a>' +
      "</aside><main>" +
      '<div class="crumbs">Docs / Getting started / <b>Quickstart</b></div>' +
      "<h1>Quickstart</h1>" +
      '<p class="lead">Capture your first entry in under five minutes. This guide walks through installing the SDK, creating a notebook, and syncing it to the Fieldnote cloud.</p>' +
      "<h2>1. Install the SDK</h2>" +
      "<p>Fieldnote ships a single package for Node 18 and later. Install it with the package manager of your choice:</p>" +
      '<pre class="term"><span class="p">$</span> npm install @fieldnote/sdk</pre>' +
      "<h2>2. Create a notebook</h2>" +
      "<p>Every entry lives in a notebook. Create one with a name and an optional retention policy:</p>" +
      '<pre class="code"><span class="kw">import</span> { Fieldnote } <span class="kw">from</span> <span class="str">&quot;@fieldnote/sdk&quot;</span>;\n\n' +
      '<span class="kw">const</span> client = <span class="kw">new</span> <span class="fn">Fieldnote</span>({ apiKey: process.env.<span class="cn">FIELDNOTE_KEY</span> });\n\n' +
      '<span class="kw">const</span> notebook = <span class="kw">await</span> client.notebooks.<span class="fn">create</span>({\n' +
      '  name: <span class="str">&quot;field-observations&quot;</span>,\n' +
      '  retention: <span class="str">&quot;90d&quot;</span>,\n});</pre>' +
      '<span class="callout"><b>Note</b> Keys created in the dashboard are scoped to a single workspace. Keep them in a server-side environment variable; never ship a key to the browser.</span>' +
      "<h2>3. Write and sync</h2>" +
      "<p>Entries accept markdown plus structured fields, and sync is automatic once a session is open. See Notebooks for batching and conflict rules.</p>" +
      "</main>" +
      '<nav class="toc"><div class="toc-h">On this page</div><a class="on" href="#">Install the SDK</a><a href="#">Create a notebook</a><a href="#">Write and sync</a><a href="#">Next steps</a></nav></div>',
  ),
};

const SHOP_TITLE = "New Arrivals - North Bench Goods";
const SHOP_PAGE: FakePage = {
  title: SHOP_TITLE,
  html: pageShell(
    SHOP_TITLE,
    [
      "body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f4f2ec;color:#20241f}",
      ".announce{background:#20241f;color:#efeadf;font-size:12px;letter-spacing:.06em;text-align:center;padding:9px 16px}",
      "header{display:flex;align-items:center;justify-content:space-between;background:#fbfaf7;border-bottom:1px solid #e2ded2;padding:18px 56px}",
      ".wordmark{font-size:20px;font-weight:800;letter-spacing:.16em;text-transform:uppercase}",
      ".wordmark span{color:#8a6a3a}",
      "header nav{display:flex;gap:28px;font-size:13.5px;font-weight:500;color:#4c5245}",
      ".cart{font-size:13px;font-weight:600;border:1.5px solid #20241f;border-radius:999px;padding:8px 16px}",
      ".intro{padding:40px 56px 8px}",
      ".intro h1{font-size:40px;letter-spacing:-.02em}",
      ".intro p{font-size:15.5px;color:#5c6355;margin-top:8px;max-width:560px}",
      ".chips{display:flex;gap:10px;margin:20px 0 4px}",
      ".chip{font-size:12.5px;font-weight:600;color:#4c5245;background:#fbfaf7;border:1px solid #ddd8c9;border-radius:999px;padding:8px 16px}",
      ".chip.on{background:#20241f;color:#efeadf;border-color:#20241f}",
      ".product-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:22px;padding:22px 56px 72px}",
      ".card{background:#fbfaf7;border:1px solid #e6e2d6;border-radius:12px;padding:10px 10px 14px;position:relative}",
      ".swatch{aspect-ratio:4/3;border-radius:8px;margin-bottom:12px}",
      ".badge{position:absolute;top:18px;left:18px;font:700 10px/1 -apple-system,sans-serif;letter-spacing:.1em;text-transform:uppercase;background:#fbfaf7;border-radius:999px;padding:5px 9px}",
      ".pname{font-size:14px;font-weight:600;padding:0 4px}",
      ".prow{display:flex;justify-content:space-between;align-items:center;padding:5px 4px 0;font-size:13px;color:#5c6355}",
      ".price{font-weight:700;color:#20241f}",
      ".s-tote{background:radial-gradient(90% 70% at 50% 25%,rgba(255,255,255,.35),rgba(255,255,255,0) 60%),linear-gradient(180deg,#c8ab7e 0 62%,#6b5233 62% 78%,#c8ab7e 78%)}",
      ".s-mug{background:radial-gradient(circle at 50% 42%,#f4f1ea 0 34%,#2f5d50 35% 72%,#24483e 73%),#e7e2d5}",
      ".s-board{background:repeating-linear-gradient(94deg,#7a5433 0 9px,#8f6540 9px 21px,#6d4a2c 21px 26px),#7a5433}",
      ".s-throw{background:repeating-linear-gradient(0deg,rgba(32,36,31,.28) 0 12px,rgba(0,0,0,0) 12px 34px),repeating-linear-gradient(90deg,rgba(140,60,44,.5) 0 12px,rgba(0,0,0,0) 12px 34px),#b8a184}",
      ".s-pour{background:linear-gradient(180deg,#d8c6b2 0 30%,#b4795a 30% 85%,#8c5a41 85%),#d8c6b2}",
      ".s-ruler{background:linear-gradient(115deg,#d9c07a 0%,#f0e0a8 35%,#c4a55e 70%,#e6cf8d 100%)}",
      ".s-notes{background:linear-gradient(90deg,#5c4a33 0 14%,rgba(0,0,0,0) 14%),repeating-linear-gradient(0deg,rgba(0,0,0,.05) 0 2px,rgba(0,0,0,0) 2px 16px),linear-gradient(#c9a878,#c9a878)}",
      ".s-candle{background:radial-gradient(70% 60% at 50% 30%,#f0ce8f,#c98d3f 70%,#9c6428)}",
    ].join(""),
    '<div class="announce">Free shipping on orders over $75 &middot; Handmade in small batches</div>' +
      '<header><div class="wordmark">North Bench <span>Goods</span></div>' +
      '<nav><a href="#">Shop</a><a href="#">Workshop</a><a href="#">Journal</a><a href="#">About</a></nav>' +
      '<div class="cart">Cart (2)</div></header>' +
      '<section class="intro"><h1>New Arrivals</h1>' +
      "<p>Sturdy goods for the kitchen, the desk, and the trail, built to be used daily and repaired rarely.</p>" +
      '<div class="chips"><span class="chip on">All</span><span class="chip">Kitchen</span><span class="chip">Desk</span><span class="chip">Outdoor</span><span class="chip">Last call</span></div></section>' +
      '<section class="product-grid">' +
      '<div class="card"><span class="badge">New</span><div class="swatch s-tote"></div><div class="pname">Waxed Canvas Tote</div><div class="prow"><span>Olive / natural</span><span class="price">$88</span></div></div>' +
      '<div class="card"><div class="swatch s-mug"></div><div class="pname">Enamel Camp Mug</div><div class="prow"><span>Spruce green</span><span class="price">$24</span></div></div>' +
      '<div class="card"><div class="swatch s-board"></div><div class="pname">Walnut Serving Board</div><div class="prow"><span>Oiled finish</span><span class="price">$52</span></div></div>' +
      '<div class="card"><span class="badge">New</span><div class="swatch s-throw"></div><div class="pname">Wool Camp Throw</div><div class="prow"><span>Ember plaid</span><span class="price">$124</span></div></div>' +
      '<div class="card"><div class="swatch s-pour"></div><div class="pname">Stoneware Pour-Over</div><div class="prow"><span>Clay / cream</span><span class="price">$46</span></div></div>' +
      '<div class="card"><div class="swatch s-ruler"></div><div class="pname">Brass Pocket Ruler</div><div class="prow"><span>Six inch</span><span class="price">$18</span></div></div>' +
      '<div class="card"><div class="swatch s-notes"></div><div class="pname">Field Notebook, 3-Pack</div><div class="prow"><span>Kraft cover</span><span class="price">$15</span></div></div>' +
      '<div class="card"><div class="swatch s-candle"></div><div class="pname">Cedar &amp; Amber Candle</div><div class="prow"><span>40 hour burn</span><span class="price">$28</span></div></div>' +
      "</section>",
  ),
};

/** Exported so a scratch QA script can screenshot the pages without running the pipeline. */
export const FAKE_PAGES: Record<string, FakePage> = {
  "/recipe": RECIPE_PAGE,
  "/docs": DOCS_PAGE,
  "/shop": SHOP_PAGE,
};

/**
 * Real-site backdrops: LB's own properties, so rights are clean and they
 * double as subtle cross-promo. Evaluated headed at 1280x800 on 2026-07-23:
 *  - tabburrow.com    PASS 1.9s, fully painted, no banners; the active tab
 *                     behind the popup composite (a nice meta touch)
 *  - thedigitallm.com PASS 2.3s, fully painted, no banners
 *  - lbwalton.com     PASS 4.1s, fully painted, no banners
 *  - techishub.com    FAIL 11.4s load + a cookie consent banner on camera
 * Each entry keeps a FAKE_PAGES fallback so the capture still works with no
 * network: gotoBackdrop() below swaps to the local route on navigation
 * failure and never films an unpainted tab either way.
 */
interface TabSource {
  url: string;
  /** Selector that proves the page painted (waited for on top of networkidle). */
  readySelector: string;
  /** FAKE_PAGES route used when the real site cannot be reached. */
  fallbackRoute: string;
}

const BACKDROP_TABS: { docs: TabSource; portfolio: TabSource; active: TabSource } = {
  docs: { url: "https://thedigitallm.com", readySelector: "h1", fallbackRoute: "/docs" },
  portfolio: { url: "https://lbwalton.com", readySelector: "h1", fallbackRoute: "/shop" },
  active: { url: "https://tabburrow.com", readySelector: "h1", fallbackRoute: "/recipe" },
};

/** Navigate a backdrop tab and only return once it is visually settled: real
 * site if reachable (networkidle + painted selector + a settle beat), local
 * fake page otherwise. The popup composite screenshots the active one, so
 * "loaded" is never enough; it must be PAINTED. */
async function gotoBackdrop(page: Page, source: TabSource, localServer: LocalServer): Promise<void> {
  try {
    await page.goto(source.url, { timeout: 20_000, waitUntil: "load" });
  } catch {
    console.warn(`  ${source.url} unreachable; using local fallback ${source.fallbackRoute}`);
    await page.goto(localServer.pageUrl(source.fallbackRoute));
  }
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  await page.locator(source.readySelector).first().waitFor({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(700);
}

/** Serves the FAKE_PAGES routes (standalone sibling of fixtures.ts's worker fixture server, which only needs bare titled pages for tests). */
function startLocalServer(): Promise<LocalServer> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const page = FAKE_PAGES[url.pathname] ?? RECIPE_PAGE;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(page.html);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const baseUrl = `http://127.0.0.1:${port}`;
      resolve({ server, pageUrl: (route: string) => `${baseUrl}${route}` });
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
    const readLaterId = randomUUID();
    const messyId = randomUUID();
    const collections: SeedCollection[] = [
      { id: kitchenRenoId, name: "Kitchen reno research", accent: "var(--accent)", position: seedPosition(0) },
      { id: randomUUID(), name: "Q3 competitor teardown", accent: "var(--accent-2)", position: seedPosition(1) },
      { id: randomUUID(), name: "Weekend in Portland", accent: "color-mix(in srgb, var(--accent) 50%, var(--accent-2) 50%)", position: seedPosition(2) },
      { id: randomUUID(), name: "Dev docs I keep rereading", accent: "color-mix(in srgb, var(--muted) 60%, var(--text) 40%)", position: seedPosition(3) },
      { id: recipesId, name: "Recipes worth repeating", accent: "color-mix(in srgb, var(--accent) 70%, var(--text) 30%)", position: seedPosition(4) },
      { id: readLaterId, name: "Read later", accent: "color-mix(in srgb, var(--accent-2) 70%, var(--text) 30%)", position: seedPosition(5) },
      { id: messyId, name: "This week's tabs", position: seedPosition(6) },
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
    // One-click Save target pinned to "Read later": the popup beat saves the
    // active tab (the tabburrow.com marketing page), and stashing an article
    // or product page to Read later reads truthfully for any site.
    await seedMeta(setup, {
      lastUsedCollectionId: readLaterId,
      defaultCollectionId: readLaterId,
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

    // --- Real http tabs for the popup beats: LB's real sites (local fake
    // pages as offline fallback), so every backdrop on camera is a fully
    // painted page (never a white void). ---
    const tabA = await context.newPage();
    await gotoBackdrop(tabA, BACKDROP_TABS.docs, localServer);
    const tabB = await context.newPage();
    await gotoBackdrop(tabB, BACKDROP_TABS.portfolio, localServer);
    const tabC = await context.newPage();
    await gotoBackdrop(tabC, BACKDROP_TABS.active, localServer);
    await tabC.bringToFront();
    // The popup composite floats over this screenshot; gotoBackdrop already
    // held for networkidle + a painted selector, so this shoots a fully
    // rendered tabburrow.com hero, not a mid-load frame.
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
    await expect(popup.getByText("Read later", { exact: true }).first()).toBeVisible();
    await popup.locator("div.group", { hasText: "Weekend in Portland" }).first().hover();
    await popup.waitForTimeout(500); // settle clear of the load-in before the first cut point
    popupMark("home_settled");
    await popup.waitForTimeout(1800);

    // Beat a: one-click Save → confirm view
    popupMark("save_click");
    await popup.getByRole("button", { name: "Save", exact: true }).click();
    await expect(popup.getByText(/Saved 1 tab to Read later/)).toBeVisible();
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
  // 1px hairline padded around the popup crop (cream-tinted, mixed toward the
  // ground): the popup and the tabburrow.com backdrop share the same deep
  // green, so without an edge the panel melts into the page. Real Chrome
  // popups draw a border too, so this stays product-truthful.
  const HAIRLINE = "0x5E6A60";
  const segs: string[] = [];
  popupCuts.forEach((cut, i) => {
    const seg = path.join(SEGS_DIR, `seg-popup-${i}.mp4`);
    encodeSegment(
      seg,
      `[0:v]trim=start=${cut.start.toFixed(2)}:end=${cut.end.toFixed(2)},setpts=(PTS-STARTPTS)/${cutSpeed(cut).toFixed(4)},` +
        `crop=${POPUP_VIEW.width}:${POPUP_VIEW.height}:0:0,` +
        `pad=${POPUP_VIEW.width + 2}:${POPUP_VIEW.height + 2}:1:1:color=${HAIRLINE}[pp];` +
        `[1:v]scale=${VIEW.width}:${VIEW.height},setsar=1[bg];` +
        `[bg][pp]overlay=${overlayX - 1}:27:shortest=1,fps=30,format=yuv420p[v]`,
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

// Only run when executed directly (npx tsx e2e/capture-demo.ts), not when a
// QA script imports FAKE_PAGES.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

import { randomUUID } from "node:crypto";
import { execSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { APIRequestContext, BrowserContext } from "@playwright/test";
import { test, expect, closeExtensionContext, launchExtensionContext, signInWithEmailOtp } from "../fixtures";
import { loadRootEnv } from "../env";
import {
  deleteAdminUser,
  deleteCloudDataForUser,
  fetchCollectionsForUser,
  findAdminUserByEmail,
  insertCloudCollection,
  setUserPlan,
} from "../admin";
import { seedCollectionsAndLinks, seedPosition } from "../seed";
import { finalScreenshot } from "../test-utils";

/**
 * T22 — collection sharing controls (ShareDialog.tsx, packages/core's
 * `setShare`/`generateShareSlug`, lib/share-url.ts), closing the
 * extension -> cloud -> public-page loop T21b built the read side of.
 *
 * ## The env dance
 *
 * `shareUrlFor` (lib/share-url.ts) reads `WXT_SITE_URL`, which is baked
 * into the built extension bundle at BUILD time (Vite's `import.meta.env`
 * static replacement — there is no way to change it at runtime). The
 * extension's normal build points that at the root `.env`'s
 * `NEXT_PUBLIC_SITE_URL` (or the public `tabburrow.com` fallback — see
 * scripts/sync-env.mjs), neither of which is a live server this test can
 * hit. So THIS FILE, and only this file:
 *
 *  1. Overwrites `apps/extension/.env.local` with `WXT_SITE_URL=http://
 *     localhost:3100` (keeping the real `WXT_SUPABASE_*` values) and runs
 *     `npx wxt build` — a real rebuild of `.output/chrome-mv3` — in
 *     `beforeAll`.
 *  2. Spawns `apps/web`'s real Next dev server on port 3100
 *     (`NEXT_PUBLIC_SITE_URL=http://localhost:3100` + the local Supabase
 *     service-role env `apps/web/lib/share.ts` needs) and waits for it to
 *     answer requests.
 *  3. In `afterAll`, kills the dev server and rebuilds the extension AGAIN
 *     via `node scripts/sync-env.mjs && npx wxt build` — the ordinary build
 *     path — so `.output/chrome-mv3` is left exactly as any other task's
 *     `pnpm --filter extension build` would leave it, not pinned to a
 *     test-only origin.
 *
 * This spec file runs LAST alphabetically among `specs/*.spec.ts` (Playwright's
 * default file order), so every other spec's worker-scoped `sharedContext`
 * fixture (see fixtures.ts) has already launched against the NORMAL build
 * before this file's `beforeAll` ever touches `.output/chrome-mv3` on disk —
 * this file uses its own ad hoc `launchExtensionContext()` calls throughout
 * (same pattern as t18/t20), never the shared worker context, so there's no
 * risk of a mid-run extension swap affecting an already-loaded context
 * either way.
 *
 * Requires the local stack running (`supabase start`) with
 * `SUPABASE_SERVICE_ROLE_KEY` set in the root `.env` — every test below (and
 * the `beforeAll`/`afterAll` setup itself) skips/no-ops with a clear reason
 * if that key is absent, same guard t18/t20's specs use.
 */

const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_DIR = path.resolve(SPEC_DIR, "../..");
const REPO_ROOT = path.resolve(EXTENSION_DIR, "../..");
const WEB_DIR = path.resolve(REPO_ROOT, "apps/web");
const EXTENSION_ENV_LOCAL_PATH = path.resolve(EXTENSION_DIR, ".env.local");

const WEB_PORT = 3100;
const WEB_SITE_URL = `http://localhost:${WEB_PORT}`;

const env = loadRootEnv();
const SUPABASE_URL = env.SUPABASE_URL || "http://127.0.0.1:54321";
const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY || "";
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

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

/** Overwrites `.env.local` with `WXT_SITE_URL=siteUrl` (real Supabase vars preserved) and rebuilds — see the module docstring's "env dance". */
async function buildExtensionWithSiteUrl(siteUrl: string): Promise<void> {
  const content = `WXT_SUPABASE_URL=${SUPABASE_URL}\nWXT_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}\nWXT_SITE_URL=${siteUrl}\n`;
  fs.writeFileSync(EXTENSION_ENV_LOCAL_PATH, content);
  await runCommand("npx", ["wxt", "build"], EXTENSION_DIR);
}

/** Restores the ordinary build path (real root `.env` -> `.env.local` -> build), undoing `buildExtensionWithSiteUrl`. */
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
      // ANY response (even a 404) proves the Next dev server is up and
      // routing, not just that the port is listening — a bare TCP connect
      // can succeed before Next has finished its first on-demand compile.
      await fetch(url, { signal: AbortSignal.timeout(5_000) });
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }
  throw new Error(`apps/web dev server on ${url} did not become ready within ${budgetMs}ms: ${String(lastErr)}`);
}

async function startWebDevServer(): Promise<void> {
  // `next dev -p <port>` directly (not the `pnpm --filter web dev` script):
  // pnpm's own `--` arg-forwarding through a `--filter` selector was
  // observed locally to mis-splice `-p 3100` into the script's literal
  // argv (Next then reads "-p" as a project-directory positional and
  // fails to start) — invoking `next` directly via `pnpm exec` sidesteps
  // that entirely and was verified working locally.
  webServerProcess = spawn("pnpm", ["exec", "next", "dev", "-p", String(WEB_PORT)], {
    cwd: WEB_DIR,
    env: {
      ...process.env,
      NEXT_PUBLIC_SITE_URL: WEB_SITE_URL,
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY ?? "",
    },
    // Own process group (POSIX) so teardown can kill the whole tree —
    // `next dev` can spawn a render-worker child that survives a plain
    // SIGTERM to just the parent PID.
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
  // Backstop: make sure the port is actually free before any later run
  // (including a re-run of this same file) tries to rebind it.
  try {
    execSync(`lsof -ti:${WEB_PORT} | xargs -r kill -9`, { stdio: "ignore" });
  } catch {
    // no strays, or lsof/xargs unavailable on this platform — best effort.
  }
}

test.beforeAll(async () => {
  if (!SERVICE_ROLE_KEY) return; // every test below self-skips; don't pay setup cost for nothing.
  test.setTimeout(180_000);
  await buildExtensionWithSiteUrl(WEB_SITE_URL);
  await startWebDevServer();
});

test.afterAll(async () => {
  if (!SERVICE_ROLE_KEY) return;
  test.setTimeout(120_000);
  await stopWebDevServer();
  await restoreNormalExtensionBuild();
});

/** Idempotent per-test cleanup, same pattern t18/t20's specs use: deletes any stray user (and its cloud rows) left behind by a prior crashed run. */
async function cleanupStrayUser(email: string): Promise<void> {
  const existing = await findAdminUserByEmail(SUPABASE_URL, SERVICE_ROLE_KEY!, email);
  if (existing) {
    await deleteCloudDataForUser(SUPABASE_URL, SERVICE_ROLE_KEY!, existing.id);
    await deleteAdminUser(SUPABASE_URL, SERVICE_ROLE_KEY!, existing.id);
  }
}

const REST_ROUTE_PATTERN = "**/rest/v1/**";

/**
 * Delays every `/rest/v1/**` request on `context` by `delayMs`, so an
 * otherwise sub-second local sync cycle stays observably "busy" long enough
 * to assert against (see ShareDialog's module docstring: "never block the
 * dialog on sync without a visible busy state"). Registered ONCE and
 * unrouted ONCE across a whole multi-step flow (not per-action): calling
 * `context.route`/`unroute` repeatedly in quick succession was observed to
 * race against Playwright's own "no handler left -> auto-continue" fallback
 * for a request whose delay hadn't elapsed yet at unroute time, throwing
 * "Route is already handled!" — so `route.continue()` here tolerates that
 * exact race defensively too (the request already went through either way).
 */
async function delayRestCalls(context: BrowserContext, delayMs: number): Promise<void> {
  await context.route(REST_ROUTE_PATTERN, async (route) => {
    await new Promise((r) => setTimeout(r, delayMs));
    await route.continue().catch(() => {});
  });
}

/** Polls `url` with a cache-busting query param until it 404s or `budgetMs` elapses. */
async function pollUntil404(
  request: APIRequestContext,
  url: string,
  budgetMs = 90_000,
  intervalMs = 3_000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < budgetMs) {
    const response = await request.get(`${url}${url.includes("?") ? "&" : "?"}cb=${Date.now()}`);
    if (response.status() === 404) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

test("PRO round-trip: sharing a 3-link collection serves the live public page; Stop sharing 404s the same URL", async ({
  request,
}) => {
  test.skip(!SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY not set in root .env — see SELF_HOSTING.md");
  test.setTimeout(150_000);

  const email = "e2e-share-pro@tabburrow.test";
  await cleanupStrayUser(email);

  const { context, extensionId, userDataDir } = await launchExtensionContext();
  try {
    const dash = await context.newPage();
    await dash.goto(`chrome-extension://${extensionId}/dashboard.html`);

    const collectionId = randomUUID();
    const linkTitles = ["Share Test Link One", "Share Test Link Two", "Share Test Link Three"];
    await seedCollectionsAndLinks(
      dash,
      [{ id: collectionId, name: "Share Test Collection", position: seedPosition(0) }],
      linkTitles.map((title, i) => ({
        id: randomUUID(),
        collectionId,
        url: `https://example.com/share-${i}`,
        title,
        position: seedPosition(i),
      })),
    );
    await dash.reload();

    await dash.goto(`chrome-extension://${extensionId}/dashboard.html#/settings`);
    await signInWithEmailOtp(dash, email);
    const authUser = await findAdminUserByEmail(SUPABASE_URL, SERVICE_ROLE_KEY!, email);
    expect(authUser, "expected an auth.users row after sign-in").toBeTruthy();
    await setUserPlan(SUPABASE_URL, SERVICE_ROLE_KEY!, authUser!.id, "pro");
    await dash.getByRole("button", { name: "Refresh status" }).click();
    await expect(dash.getByText("PRO", { exact: true })).toBeVisible();

    // ShareDialog mounts fresh here (CollectionPanel only renders for a
    // "collection" route) — its own getPlan() call reads the "pro" value
    // "Refresh status" just wrote to the shared plan cache, not a stale
    // free-plan snapshot from sign-in time.
    await dash.goto(`chrome-extension://${extensionId}/dashboard.html#/c/${collectionId}`);
    await expect(dash.getByRole("listbox", { name: "Links" }).getByRole("option")).toHaveCount(3);

    await dash.getByRole("button", { name: "Share", exact: true }).click();
    const dialog = dash.getByRole("dialog", { name: "Share collection" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText(
        "Anyone with the link can see this collection's names, links, notes, and tags. Nothing else is shared.",
      ),
    ).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Share this collection" })).toBeVisible();

    // Case 1 setup: share, waiting out the visible busy state (delayed REST
    // makes the otherwise sub-second local sync cycle observable) before the
    // URL is revealed. One route registration spans BOTH the share and the
    // stop-sharing actions below (see delayRestCalls's docstring for why).
    await delayRestCalls(context, 700);
    await dialog.getByRole("button", { name: "Share this collection" }).click();
    await expect(dialog.getByText(/Sharing this collection and syncing to the cloud/)).toBeVisible();
    const urlInput = dialog.getByLabel("Share link");
    await expect(urlInput).toBeVisible({ timeout: 30_000 });
    const shareUrl = await urlInput.inputValue();
    expect(shareUrl).toMatch(/^http:\/\/localhost:3100\/s\/[a-z0-9]{10}$/);

    // Don't trust the extension's own UI: the cloud row really carries it.
    const cloudAfterShare = await fetchCollectionsForUser(SUPABASE_URL, SERVICE_ROLE_KEY!, authUser!.id);
    const sharedRow = cloudAfterShare.find((c) => c.id === collectionId);
    expect(sharedRow?.is_shared).toBe(true);
    expect(sharedRow?.share_slug).toBeTruthy();
    expect(shareUrl.endsWith(`/s/${sharedRow!.share_slug}`)).toBe(true);

    // --- Acceptance (1): the URL opens the live page with current links. ---
    const shareResponse = await request.get(shareUrl);
    expect(shareResponse.status()).toBe(200);
    const shareBody = await shareResponse.text();
    expect(shareBody).toContain("Share Test Collection");
    for (const title of linkTitles) expect(shareBody).toContain(title);
    await finalScreenshot(dash, "t22-share-dialog-shared");

    // --- Acceptance (2): Stop sharing -> the SAME url 404s within one sync cycle. ---
    await dialog.getByRole("button", { name: "Stop sharing" }).click();
    await expect(dialog.getByText(/Stopping sharing and syncing to the cloud/)).toBeVisible();
    await context.unroute(REST_ROUTE_PATTERN);
    await expect(dialog.getByRole("button", { name: "Share this collection" })).toBeVisible({ timeout: 30_000 });

    const cloudAfterStop = await fetchCollectionsForUser(SUPABASE_URL, SERVICE_ROLE_KEY!, authUser!.id);
    const stoppedRow = cloudAfterStop.find((c) => c.id === collectionId);
    expect(stoppedRow?.is_shared).toBe(false);
    expect(stoppedRow?.share_slug).toBeNull();

    // `apps/web` here is a DEV server (`next dev`), not a production ISR
    // deploy — Next's dev mode does not apply the full route cache
    // `revalidate = 60` relies on in production (see the T21b report), so
    // this converges immediately rather than needing the full ~60s
    // propagation window a production deploy would have. Poll anyway
    // (budget below) rather than asserting single-shot, so this test would
    // still honestly fail (not hang) if dev-mode caching behavior ever
    // changes; the ~90s budget mirrors the acceptance criterion's "one sync
    // cycle" language and would also cover a real production-cache wait if
    // this ever runs against a built site instead.
    const became404 = await pollUntil404(request, shareUrl);
    expect(became404, "share URL did not 404 within the polling budget after Stop sharing").toBe(true);
    await finalScreenshot(dash, "t22-share-dialog-unshared");

    await deleteCloudDataForUser(SUPABASE_URL, SERVICE_ROLE_KEY!, authUser!.id);
    await deleteAdminUser(SUPABASE_URL, SERVICE_ROLE_KEY!, authUser!.id);
  } finally {
    await closeExtensionContext(context, userDataDir);
  }
});

test("FREE gate: the dialog shows the PRO upsell with no toggle; admin REST confirms is_shared is never flipped", async () => {
  test.skip(!SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY not set in root .env — see SELF_HOSTING.md");
  test.setTimeout(60_000);

  const email = "e2e-share-free@tabburrow.test";
  await cleanupStrayUser(email);

  const { context, extensionId, userDataDir } = await launchExtensionContext();
  try {
    const dash = await context.newPage();
    await dash.goto(`chrome-extension://${extensionId}/dashboard.html`);

    const collectionId = randomUUID();
    await seedCollectionsAndLinks(
      dash,
      [{ id: collectionId, name: "Free Share Test Collection", position: seedPosition(0) }],
      [
        {
          id: randomUUID(),
          collectionId,
          url: "https://example.com/free-share",
          title: "Free Share Link",
          position: seedPosition(0),
        },
      ],
    );
    await dash.reload();

    await dash.goto(`chrome-extension://${extensionId}/dashboard.html#/settings`);
    await signInWithEmailOtp(dash, email);
    const authUser = await findAdminUserByEmail(SUPABASE_URL, SERVICE_ROLE_KEY!, email);
    expect(authUser).toBeTruthy();
    // No setUserPlan call — this account stays on the default "free" plan.

    // FREE users can never sync (T18's PRO gate) — nothing this device does
    // could push a row on its own, so to make "is_shared never flips"
    // actually provable (not just vacuously true), seed a matching cloud
    // row directly as the admin, simulating "this collection reached the
    // cloud once, e.g. before a pro->free downgrade" — backdated so it
    // reads as pre-existing, not something this test run just created.
    const backdated = Date.now() - 3_600_000;
    await insertCloudCollection(SUPABASE_URL, SERVICE_ROLE_KEY!, {
      id: collectionId,
      user_id: authUser!.id,
      name: "Free Share Test Collection",
      position: seedPosition(0),
      created_at: backdated,
      updated_at: backdated,
    });

    const restCalls: string[] = [];
    await context.route("**/rest/v1/collections**", async (route) => {
      restCalls.push(`${route.request().method()} ${route.request().url()}`);
      await route.continue();
    });

    await dash.goto(`chrome-extension://${extensionId}/dashboard.html#/c/${collectionId}`);
    await dash.getByRole("button", { name: "Share", exact: true }).click();
    const dialog = dash.getByRole("dialog", { name: "Share collection" });
    await expect(dialog).toBeVisible();

    await expect(dialog.getByText("Sharing is part of PRO.")).toBeVisible();
    await expect(dialog.getByText(/PRO purchasing is coming soon/)).toBeVisible();
    await expect(dialog.getByRole("button", { name: "See PRO pricing" })).toBeVisible();
    // No toggle of any kind — the FREE state renders no way to turn sharing on.
    await expect(dialog.getByRole("button", { name: "Share this collection" })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Stop sharing" })).toHaveCount(0);
    await expect(dialog.getByLabel("Share link")).toHaveCount(0);
    await finalScreenshot(dash, "t22-share-free-upsell");

    // There was never a button to click that WOULD write — this asserts the
    // negative directly (no PATCH/POST to collections at all) rather than
    // trusting the absent-button UI check alone.
    const writeAttempts = restCalls.filter((c) => c.startsWith("PATCH") || c.startsWith("POST"));
    expect(writeAttempts).toEqual([]);

    const cloudAfter = await fetchCollectionsForUser(SUPABASE_URL, SERVICE_ROLE_KEY!, authUser!.id);
    const row = cloudAfter.find((c) => c.id === collectionId);
    expect(row?.is_shared).toBe(false);
    expect(row?.share_slug).toBeNull();

    await deleteCloudDataForUser(SUPABASE_URL, SERVICE_ROLE_KEY!, authUser!.id);
    await deleteAdminUser(SUPABASE_URL, SERVICE_ROLE_KEY!, authUser!.id);
  } finally {
    await closeExtensionContext(context, userDataDir);
  }
});

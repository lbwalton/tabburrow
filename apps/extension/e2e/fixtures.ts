import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test as base, chromium, expect } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { clearMailbox, waitForOtpCode } from "./mail";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The build `pnpm --filter extension build` produces — see e2e/README.md. */
export const EXTENSION_PATH = path.resolve(__dirname, "../.output/chrome-mv3");

/**
 * Verified locally (Playwright 1.61.1 / channel "chromium"): Chromium's
 * "new" headless mode DOES register the MV3 service worker and render
 * popup.html/dashboard.html correctly, so that's the default here — no
 * on-screen window needed, and it's what a future CI job (see e2e/README.md
 * — deliberately not wired up in this task) would want anyway. Set
 * `E2E_HEADLESS=false` to run headed instead (useful for watching a test
 * run live while debugging).
 */
const HEADLESS_MODE = process.env.E2E_HEADLESS === "false" ? false : true;

export interface TestServer {
  baseUrl: string;
  /** Builds a URL to a tiny generated HTML page titled `title`. */
  pageUrl(title: string): string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * A minimal local HTTP server (Node's `http` module — NOT `data:` URLs,
 * which the extension's `isHttpUrl` filter would exclude same as any other
 * non-http(s) page) serving tiny titled pages, so save/restore flows have
 * real http(s) tabs to operate on. Started once per worker on an
 * OS-assigned free port (`listen(0)`), not a hardcoded one.
 */
function startTestServer(): Promise<{ server: http.Server; testServer: TestServer }> {
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
      resolve({
        server,
        testServer: {
          baseUrl,
          pageUrl: (title: string) => `${baseUrl}/?title=${encodeURIComponent(title)}`,
        },
      });
    });
  });
}

interface WorkerFixtures {
  testServer: TestServer;
  /** The real persistent, extension-loaded browser context — launched ONCE per worker (see the module docstring in README.md for why: a real extension load is expensive, and this suite runs `workers: 1`/`fullyParallel: false` anyway). */
  sharedContext: BrowserContext;
  extensionId: string;
}

interface TestFixtures {
  /** Playwright's built-in `context`/`page` fixtures are normally
   * test-scoped (a fresh browser context per test). This harness overrides
   * `context` to just hand back the one worker-scoped `sharedContext`
   * instead — same fixture NAME so every spec can keep using the ordinary
   * `{ context }` destructure, but no new context is launched (or closed)
   * per test. The built-in `page` fixture is unmodified: since it depends
   * on `context`, it transparently starts creating its pages inside our
   * persistent extension context instead. */
  context: BrowserContext;
  /** A page already navigated to dashboard.html with a freshly-wiped
   * "tabburrow" IndexedDB — the common starting point for every spec.
   * Extra pages/tabs opened during the test are closed automatically
   * afterward so the next test starts from a clean tab set too. */
  cleanDashboard: Page;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  testServer: [
    async ({}, use) => {
      const { server, testServer } = await startTestServer();
      await use(testServer);
      // Chromium keeps http keep-alive sockets open, which would otherwise
      // block server.close()'s callback forever (Node only fires it once
      // every connection has closed) — force them shut so worker teardown
      // doesn't hang.
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
    { scope: "worker" },
  ],

  sharedContext: [
    async ({}, use) => {
      const { context, userDataDir } = await launchExtensionContext();
      await use(context);
      await closeExtensionContext(context, userDataDir);
    },
    { scope: "worker" },
  ],

  extensionId: [
    async ({ sharedContext }, use) => {
      let [sw] = sharedContext.serviceWorkers();
      if (!sw) sw = await sharedContext.waitForEvent("serviceworker", { timeout: 15_000 });
      const id = new URL(sw.url()).host;
      await use(id);
    },
    { scope: "worker" },
  ],

  // Test-scoped override of the built-in `context` fixture: no new launch,
  // no close — see the TestFixtures docstring above.
  context: async ({ sharedContext }, use) => {
    await use(sharedContext);
  },

  cleanDashboard: async ({ context, extensionId, page }, use) => {
    await page.goto(`chrome-extension://${extensionId}/dashboard.html`);
    await resetData(page);
    await use(page);
    for (const p of context.pages()) {
      if (p !== page && !p.isClosed()) await p.close().catch(() => {});
    }
  },
});

export { expect } from "@playwright/test";

/** Opens a fresh tab on dashboard.html, optionally at a hash route (e.g. "#/sessions"). */
export async function dashboardPage(context: BrowserContext, extensionId: string, hash = ""): Promise<Page> {
  const p = await context.newPage();
  await p.goto(`chrome-extension://${extensionId}/dashboard.html${hash}`);
  return p;
}

/** Opens a fresh tab on popup.html — stands in for the real toolbar popup (Playwright cannot open that; see e2e/MANUAL.md). */
export async function popupPage(context: BrowserContext, extensionId: string): Promise<Page> {
  const p = await context.newPage();
  await p.goto(`chrome-extension://${extensionId}/popup.html`);
  return p;
}

/**
 * Wipes the "tabburrow" IndexedDB and reloads `page`. Must be called on a
 * page that is the ONLY open connection to that database (an open second
 * tab on dashboard/popup would block the delete) — `cleanDashboard` closes
 * every other tab before calling this for exactly that reason.
 */
export async function resetData(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase("tabburrow");
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
    try {
      localStorage.clear();
    } catch {
      // ignore
    }
  });
  await page.reload();
}

/** Closes every open tab in `context` except the ones in `keep`. */
export async function closeExtraPages(context: BrowserContext, keep: Page[]): Promise<void> {
  for (const p of context.pages()) {
    if (!keep.includes(p) && !p.isClosed()) await p.close().catch(() => {});
  }
}

/**
 * Launches a fresh persistent, extension-loaded Chromium context — the same
 * launch args the worker-scoped `sharedContext` fixture above uses,
 * extracted so a spec that needs MULTIPLE independent "devices" in one test
 * (t18-sync.spec.ts's cross-profile sync assertions) can create extra ones
 * ad hoc, on top of (not instead of) the shared one. Each gets its own temp
 * `userDataDir`, so its `chrome.storage.local` (and therefore any persisted
 * Supabase session — see lib/supabase.ts's `chromeStorageAdapter`) and
 * IndexedDB are completely isolated from every other context, exactly like
 * two separate real Chrome profiles would be.
 */
export async function launchExtensionContext(): Promise<{ context: BrowserContext; extensionId: string; userDataDir: string }> {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tabburrow-e2e-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: HEADLESS_MODE,
    viewport: { width: 1400, height: 900 },
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

/** Tears down a context returned by `launchExtensionContext` — closes it and removes its temp profile directory. */
export async function closeExtensionContext(context: BrowserContext, userDataDir: string): Promise<void> {
  await context.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}

/**
 * Drives the real email-OTP sign-in flow (Settings' AccountPane — see
 * lib/auth.ts's `sendEmailCode`/`verifyEmailCode`) against the local
 * Supabase stack's Mailpit mail catcher, exactly as t16-auth.spec.ts
 * originally drove it inline — extracted here so t18-sync.spec.ts can reuse
 * the identical flow for TWO separate "devices" signing the same account in.
 * `page` must already be navigated to a Settings route
 * (`dashboard.html#/settings`) with the AccountPane's signed-out form
 * visible. Clears the mailbox immediately before sending, so a stale prior
 * code for the same address (e.g. a previous run's leftover, or the OTHER
 * device's code in a same-account two-device test) can never be matched by
 * accident — the two devices in t18-sync.spec.ts's round-trip test sign in
 * sequentially, one after the other, for exactly this reason.
 *
 * Retries the "Send code" click a few times on GoTrue's per-address send
 * cooldown ("For security purposes, you can only request this after N
 * seconds.") — observed locally when two sign-ins for the SAME email land
 * close together (t18-sync.spec.ts's round-trip test signs one account into
 * two devices back to back), even though the cooldown's own error text
 * claims the wait is already over by the time it's shown. Not a product bug
 * (this is Supabase Auth's own local rate limiter), just something a
 * same-email multi-device test has to absorb the same way a real user
 * retrying a "resend code" button would.
 */
export async function signInWithEmailOtp(page: Page, email: string): Promise<void> {
  await clearMailbox();
  await page.getByLabel("Email").fill(email);

  const codeSentText = page.getByText(`Enter the 6-digit code sent to ${email}.`);
  const sendButton = page.getByRole("button", { name: "Send code" });
  for (let attempt = 0; attempt < 5; attempt++) {
    await sendButton.click();
    try {
      await expect(codeSentText).toBeVisible({ timeout: 5_000 });
      break;
    } catch (err) {
      if (attempt === 4) throw err;
      await page.waitForTimeout(2_000);
    }
  }

  const code = await waitForOtpCode(email);
  await page.getByLabel(/6-digit code/i).fill(code);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText(email)).toBeVisible();
}

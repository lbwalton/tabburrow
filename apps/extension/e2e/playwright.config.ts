import { defineConfig } from "@playwright/test";

/**
 * Task 14 QA harness. This is a from-scratch Playwright suite, not part of
 * the vitest unit-test pipeline: it drives the REAL built extension
 * (`.output/chrome-mv3`) in a real Chromium instance via
 * `chromium.launchPersistentContext` (see `fixtures.ts`) — the
 * Claude-in-Chrome MCP tools cannot navigate `chrome-extension://` pages, so
 * this harness is what actually exercises popup.html/dashboard.html/the
 * background service worker end to end.
 *
 * Requires a fresh production build before every run:
 *   pnpm --filter extension build
 *   pnpm --filter extension e2e
 *
 * Single project, no retries, no sharding: this suite is slow (extension
 * load + a real Chromium window) and small enough that flake should be
 * fixed, not retried away.
 */
export default defineConfig({
  testDir: "./specs",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  retries: 0,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "./report", open: "never" }]],
  outputDir: "./test-results",
  use: {
    screenshot: "on",
    trace: "retain-on-failure",
    video: "off",
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  projects: [{ name: "chromium-extension" }],
});

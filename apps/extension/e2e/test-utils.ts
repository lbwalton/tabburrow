import type { Locator, Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SCREENSHOTS_DIR = path.resolve(__dirname, "screenshots");

/** Full-page screenshot into e2e/screenshots/<name>.png — every spec calls this once at the end (see e2e/README.md). */
export async function finalScreenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `${name}.png`), fullPage: true });
}

/**
 * Resolves a CSS custom property (design token) to its browser-computed
 * color string, by applying it as a background on a throwaway probe element
 * — so tests can assert "this element's color equals this token" without
 * ever hardcoding a hex literal (repo convention; see CLAUDE.md/CONTRIBUTING).
 */
export async function tokenColor(page: Page, tokenName: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement("div");
    probe.style.background = `var(${name})`;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return value;
  }, tokenName);
}

/** The resolved (rgb/rgba) background-color of the first element matching `selector`. */
export async function computedBackground(page: Page, selector: string): Promise<string> {
  return page.locator(selector).first().evaluate((el) => getComputedStyle(el).backgroundColor);
}

/**
 * Runs dnd-kit's keyboard-drag gesture (grip focus -> Space down/up ->
 * `moveKey` -> Space drop) and retries the WHOLE gesture from scratch if
 * `verify` doesn't pass afterward, up to `attempts` times.
 *
 * Why a retry, not just a longer wait: dnd-kit's `KeyboardSensor` drag-start
 * is async (React state + a RAF-driven position measurement), and under
 * real machine load (this harness's Chromium instance sharing the box with
 * whatever else is running) that occasionally loses the race against a
 * fixed timeout — observed directly across repeated full-suite runs, not
 * theoretical. When a pickup fails to register at all, NOTHING moves (the
 * follow-on arrow/drop keys land on a non-dragging element and are
 * harmless no-ops), so retrying the full gesture from a fresh `grip.focus()`
 * starts from the same known-good state each time — this is not
 * papering over a real product bug, it's absorbing synthetic-input timing
 * noise the same way a human retrying a missed drag would.
 */
export async function keyboardDragUntil(
  page: Page,
  grip: Locator,
  moveKey: string,
  verify: () => Promise<void>,
  attempts = 3,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    await grip.focus();
    await page.keyboard.down("Space");
    await page.waitForTimeout(120);
    await page.keyboard.up("Space");
    await page.waitForTimeout(120);
    await page.keyboard.press(moveKey);
    await page.waitForTimeout(120);
    await page.keyboard.press("Space");
    try {
      await verify();
      return;
    } catch (err) {
      lastError = err;
      await page.waitForTimeout(300);
    }
  }
  throw lastError instanceof Error
    ? new Error(`keyboardDragUntil: gesture did not take effect after ${attempts} attempts: ${lastError.message}`)
    : new Error(`keyboardDragUntil: gesture did not take effect after ${attempts} attempts`);
}

/** Collects console "error"-level messages logged while `run` executes. Empty array = clean. */
export async function collectConsoleErrors(page: Page, run: () => Promise<void>): Promise<string[]> {
  const errors: string[] = [];
  const handler = (msg: { type: () => string; text: () => string }) => {
    if (msg.type() === "error") errors.push(msg.text());
  };
  page.on("console", handler);
  try {
    await run();
  } finally {
    page.off("console", handler);
  }
  return errors;
}

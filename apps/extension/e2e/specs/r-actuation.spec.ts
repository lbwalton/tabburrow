import { randomUUID } from "node:crypto";
import { test, expect, popupPage } from "../fixtures";
import { seedCollectionsAndLinks, seedMeta, seedPosition } from "../seed";
import { finalScreenshot } from "../test-utils";

/**
 * R — Actuation glow (lib/actuation.ts): pressing a control plays a brief
 * `.tb-actuate` accent-underglow pulse that clears on animationend. Local-only
 * (Dexie; no sign-in, no stack). Lifted from e2e/verify-glow.ts.
 *
 * Technique: pointerdown fires the glow, but the mouse is moved OFF the control
 * before mouse.up so the press never actuates (a row would drill in, "Change"
 * would open the picker) — keeping us on home for the next assertion. The class
 * is asserted mid-pulse (well inside the 340ms animation) so the first poll
 * lands while it's still present, then re-checked after the animation ends.
 */

test("pressing a control adds .tb-actuate on pointerdown and clears it after the animation", async ({
  context,
  extensionId,
  cleanDashboard,
}) => {
  const defaultId = randomUUID();
  await seedCollectionsAndLinks(
    cleanDashboard,
    [
      { id: defaultId, name: "test", position: seedPosition(0) },
      { id: randomUUID(), name: "test 2", position: seedPosition(1) },
    ],
    [],
  );
  // A pinned default → the target-line button renders as "Change".
  await seedMeta(cleanDashboard, { defaultCollectionId: defaultId, saveTargetMode: "default" });
  await cleanDashboard.reload();

  const popup = await popupPage(context, extensionId);
  await expect(popup.getByRole("heading", { name: "TabBurrow" })).toBeVisible();

  async function pressAndGlow(el: import("@playwright/test").Locator) {
    await el.hover();
    await popup.mouse.down();
    await popup.waitForTimeout(110); // ~mid-pulse of the 340ms animation
    await expect(el).toHaveClass(/tb-actuate/);
    await popup.mouse.move(2, 2); // move off the control before releasing → no click
    await popup.mouse.up();
  }

  // A folder row body (glowing-dot row) and the "Change" ghost button.
  await pressAndGlow(popup.getByRole("button", { name: "test 0", exact: true }));
  const changeBtn = popup.getByRole("button", { name: "Change", exact: true });
  await pressAndGlow(changeBtn);

  // After the animation ends, the class is cleaned up (animationend handler).
  await expect(changeBtn).not.toHaveClass(/tb-actuate/, { timeout: 2000 });
  await finalScreenshot(popup, "r-actuation");
});

import { randomUUID } from "node:crypto";
import { execSync, spawn } from "node:child_process";
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import type { BrowserContext, Page } from "@playwright/test";
import { test, expect, closeExtensionContext, launchExtensionContext, signInWithEmailOtp } from "../fixtures";
import { loadRootEnv } from "../env";
import {
  deleteAdminUser,
  fetchBillingProfile,
  findAdminUserByEmail,
} from "../admin";
import { seedCollectionsAndLinks, seedPosition } from "../seed";
import { finalScreenshot } from "../test-utils";

/**
 * T23b — the extension side of Stripe billing (AccountPane's "Upgrade to
 * PRO" section, lib/billing.ts), closing the loop T23a built the backend
 * half of (`checkout-session`/`stripe-webhook` Edge Functions).
 *
 * ONE live test, tagged `@live-stripe`, covering both acceptance scenarios
 * end to end against REAL Stripe test-mode infrastructure — chained into a
 * single test (not two) because the expensive part (a real hosted-Checkout
 * browser flow) only needs to happen once; the downgrade phase reuses the
 * same signed-in user/customer the checkout phase just created, matching
 * the brief's "for that customer" framing:
 *
 *  (a) sign in a fresh user -> AccountPane shows FREE -> click "Monthly
 *      $4/month" -> a real Stripe-hosted Checkout page opens in a new tab
 *      (captured via `context.waitForEvent("page")`, the same pattern
 *      t07-popup-save.spec.ts uses for extension-initiated
 *      `chrome.tabs.create` tabs) -> filled with Stripe's documented
 *      always-succeeds test card -> Subscribe -> the success redirect ->
 *      back in the extension, PRO Badge + "Manage billing" + "Sync" appear
 *      -> admin REST independently confirms `plan=pro` and both
 *      `stripe_customer_id`/`stripe_subscription_id` are stored.
 *  (b) `stripe trigger customer.subscription.deleted --override
 *      subscription:metadata.user_id=<userId>` (verified locally against a
 *      REAL checkout-created user before writing this spec — see
 *      task-23b-report.md; matches task-23a-report.md's own validated
 *      invocation) forwarded through the same `stripe listen` process ->
 *      Refresh status -> FREE state with the upgrade section back, and a
 *      collection seeded before checkout still renders untouched.
 *
 * ## The `stripe listen` dance
 *
 * `stripe-webhook`'s entire auth boundary is `STRIPE_WEBHOOK_SECRET` (see
 * that function's own docstring) — nothing reaches it without a real,
 * currently-valid Stripe signature. This spec spawns `stripe listen
 * --forward-to <local stripe-webhook URL>` as a child process for the
 * duration of the test (T23a's report's own local-verification loop, now
 * automated) so real Stripe test-mode events actually get delivered.
 * `stripe --api-key` is passed explicitly on every invocation: this
 * machine's default `stripe` CLI login is a DIFFERENT Stripe account than
 * the project's own `STRIPE_SECRET_KEY` (confirmed locally, same
 * discrepancy task-23a-report.md flags), so the CLI's default login must
 * never be relied on. Before spawning the long-running listener, a one-shot
 * `stripe listen --print-secret` fetches the whsec this run's CLI/account
 * pairing would derive and compares it (log-only) against root `.env`'s
 * `STRIPE_WEBHOOK_SECRET` — the ALREADY-RUNNING `stripe-webhook` function
 * was started with whatever `.env` held at that time, and `stripe listen`
 * has no flag to override its own derived secret, so a mismatch isn't
 * fixable from here; it's surfaced as a diagnostic so a maintainer knows
 * where to look if the PRO-flip assertion below times out.
 *
 * Skip-unless-env: SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, and the
 * `stripe` CLI must all be present, AND `checkout-session` must actually
 * answer (same "probe with an unauthenticated request, expect 401" pattern
 * t20-ai-organize.spec.ts's `probeAiOrganizeReachable` uses) — a keyless or
 * stack-down environment skips with a clear reason instead of a confusing
 * timeout, and CI (not currently wired to run `@live-stripe`, same posture
 * as t20's `@live-ai`) stays green.
 *
 * Real Stripe test-mode resources this test creates (a Stripe customer, one
 * $4/month subscription) are cleaned up in a `finally` block regardless of
 * pass/fail, alongside the Supabase test user. Never logs the test card
 * number beyond the `STRIPE_TEST_CARD` constant below (Stripe's own
 * publicly documented always-succeeds test-mode number, not a real card).
 */

const STRIPE_TEST_CARD = "4242424242424242";

const env = loadRootEnv();
const SUPABASE_URL = env.SUPABASE_URL || "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const STRIPE_SECRET_KEY = env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = env.STRIPE_WEBHOOK_SECRET;
const STRIPE_WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/stripe-webhook`;

function stripeCliAvailable(): boolean {
  try {
    execSync("stripe --version", { stdio: "ignore", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/** Same "unauthenticated request -> 401 means the function is actually live" probe t20-ai-organize.spec.ts's `probeAiOrganizeReachable` uses. */
async function probeCheckoutSessionReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/checkout-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ interval: "month" }),
      signal: AbortSignal.timeout(5_000),
    });
    return res.status === 401;
  } catch {
    return false;
  }
}

/** Idempotent per-test cleanup, same pattern t18/t20/t22's specs use. */
async function cleanupStrayUser(email: string): Promise<void> {
  const existing = await findAdminUserByEmail(SUPABASE_URL, SERVICE_ROLE_KEY!, email);
  if (existing) await deleteAdminUser(SUPABASE_URL, SERVICE_ROLE_KEY!, existing.id);
}

function stripeAuthHeader(): HeadersInit {
  return { authorization: `Basic ${Buffer.from(`${STRIPE_SECRET_KEY}:`).toString("base64")}` };
}

/**
 * Best-effort cleanup of every real Stripe test-mode resource this test's
 * live checkout created: cancels any active subscriptions for the customer
 * (queried by customer id, NOT by whatever `profiles.stripe_subscription_id`
 * currently holds — the downgrade phase's trigger fixture overwrites that
 * column with ITS OWN throwaway subscription id, so the original real
 * subscription this checkout created has to be found independently), then
 * deletes the customer itself. Swallows errors: a failed cleanup here must
 * never fail the test or mask a real assertion failure above it.
 */
async function cleanupStripeCustomer(customerId: string): Promise<void> {
  try {
    const subsRes = await fetch(`https://api.stripe.com/v1/subscriptions?customer=${customerId}&status=active`, {
      headers: stripeAuthHeader(),
    });
    const subsJson = (await subsRes.json()) as { data?: Array<{ id: string }> };
    for (const sub of subsJson.data ?? []) {
      await fetch(`https://api.stripe.com/v1/subscriptions/${sub.id}`, { method: "DELETE", headers: stripeAuthHeader() });
    }
  } catch {
    // best-effort
  }
  try {
    await fetch(`https://api.stripe.com/v1/customers/${customerId}`, { method: "DELETE", headers: stripeAuthHeader() });
  } catch {
    // best-effort
  }
}

function spawnStripeListen(): ChildProcessByStdio<null, Readable, Readable> {
  return spawn("stripe", ["listen", "--api-key", STRIPE_SECRET_KEY!, "--forward-to", STRIPE_WEBHOOK_URL], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** `stripe listen` prints its "Ready! ... webhook signing secret is whsec_..." banner to STDERR, not stdout (verified locally) — waits for that line before any event is triggered, so the very first webhook isn't raced against the forwarder still starting up. */
function waitForListenReady(child: ChildProcessByStdio<null, Readable, Readable>, timeoutMs = 20_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("stripe listen did not report Ready within the timeout"));
    }, timeoutMs);
    function onData(chunk: Buffer) {
      if (/Ready!/i.test(chunk.toString())) {
        cleanup();
        resolve();
      }
    }
    function onExit(code: number | null) {
      cleanup();
      reject(new Error(`stripe listen exited early (code ${code}) before reporting Ready`));
    }
    function cleanup() {
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.stderr.off("data", onData);
      child.off("exit", onExit);
    }
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", onExit);
  });
}

/**
 * Clicks "Refresh status" repeatedly until the plan Badge shows `expected`,
 * or the timeout elapses. A SINGLE click would race real Stripe webhook
 * delivery latency: `stripe trigger`/a completed Checkout both return to
 * this process before Stripe has necessarily finished delivering the event
 * to `stripe listen` and it forwarding to the local function — so this
 * polls the actual USER ACTION (click Refresh status, which calls
 * `getPlan(true)`), not just the DOM, giving the webhook real time to land
 * between attempts.
 */
async function refreshUntilBadge(dash: Page, expected: "PRO" | "Free", timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await dash.getByRole("button", { name: "Refresh status" }).click();
    try {
      await expect(dash.getByText(expected, { exact: true })).toBeVisible({ timeout: 4_000 });
      return;
    } catch {
      await dash.waitForTimeout(1_500);
    }
  }
  // One last real assertion outside the loop, so a genuine failure reports
  // Playwright's own clear error instead of this helper silently returning.
  await dash.getByRole("button", { name: "Refresh status" }).click();
  await expect(dash.getByText(expected, { exact: true })).toBeVisible({ timeout: 5_000 });
}

/**
 * Fills and submits Stripe's REAL hosted test-mode Checkout page. Every
 * field selector here (`#cardNumber`/`#cardExpiry`/`#cardCvc`/
 * `#billingName`/`#billingPostalCode`, and the "Card" accordion row's
 * radio id) was verified directly against a live test-mode Checkout
 * Session before writing this spec — see task-23b-report.md. All of them
 * live in Checkout's own top-level frame; none of this needs an iframe
 * locator.
 *
 * MAINTENANCE NOTE (fix pass 1): these selectors belong to Stripe's page,
 * not this repo — Stripe can rename/restructure them in a Checkout
 * redesign at any time. If this test starts timing out stuck ON
 * checkout.stripe.com (a selector wait, or "never redirected away"),
 * check Stripe's current Checkout DOM first (open a real test-mode
 * session and inspect, the way these selectors were originally derived)
 * before assuming a regression in this repo's own code.
 */
async function completeHostedCheckout(page: Page): Promise<void> {
  // "Card" starts collapsed; a covering accordion button intercepts a plain
  // click on the radio itself, so this is forced — verified against a real
  // Checkout session, not a guess. Retried: clicking immediately after
  // `domcontentloaded` can silently no-op (Stripe Elements finishes
  // mounting its own handlers asynchronously, after the DOM event fires) —
  // observed directly on a real run while writing this spec, so this waits
  // for the radio itself first, then retries the click until `#cardNumber`
  // actually appears, same "retry the full gesture, not a fixed sleep"
  // precedent test-utils.ts's `keyboardDragUntil`/`mouseDragUntil` set for
  // this harness's other input-timing-sensitive interactions.
  const cardRadio = page.locator("#payment-method-accordion-item-title-card");
  await cardRadio.waitFor({ state: "visible", timeout: 15_000 });
  const cardNumberField = page.locator("#cardNumber");
  let expanded = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    await cardRadio.click({ force: true }).catch(() => {});
    try {
      await cardNumberField.waitFor({ state: "visible", timeout: 4_000 });
      expanded = true;
      break;
    } catch {
      await page.waitForTimeout(1_000);
    }
  }
  if (!expanded) throw new Error("Card payment method never expanded to reveal #cardNumber");

  await cardNumberField.fill(STRIPE_TEST_CARD);
  await page.locator("#cardExpiry").fill("12/34");
  await page.locator("#cardCvc").fill("123");
  await page.locator("#billingName").fill("TabBurrow E2E");
  const zip = page.locator("#billingPostalCode");
  if (await zip.count()) await zip.fill("94103").catch(() => {});

  // "Save my information for faster checkout" (Stripe Link) is checked by
  // default and would otherwise detour into a phone-verification prompt
  // this harness can't drive — uncheck it, same as any real user who
  // declines a Link account would.
  const linkOptIn = page.locator("#enableStripePass");
  if ((await linkOptIn.count()) && (await linkOptIn.isChecked().catch(() => false))) {
    await linkOptIn.uncheck({ force: true }).catch(() => {});
  }

  // Email is normally pre-filled and non-editable: checkout-session's
  // findOrCreateCustomerId attaches the signed-in user's real email to the
  // Stripe customer before Checkout ever renders. Defensive fallback only,
  // in case a future Checkout configuration ever renders an empty editable
  // field instead.
  const emailInput = page.locator('input[type="email"]');
  if (await emailInput.count()) {
    const current = await emailInput.inputValue().catch(() => "prefilled");
    if (!current) await emailInput.fill("e2e-billing@tabburrow.test").catch(() => {});
  }

  await page.getByRole("button", { name: /Subscribe/i }).click();

  // The success redirect target (`${SITE_URL}/upgrade/success`, apps/web —
  // T23a) is not necessarily running in every environment this test runs
  // in, and doesn't need to be: this test only needs proof the REAL Stripe
  // checkout completed and Stripe's own redirect fired, not that apps/web's
  // success page renders (a separate concern, already covered by T23a's own
  // suite). `waitForURL`'s default "load" wait throws on a refused
  // connection to that page even though the redirect itself succeeded
  // (verified locally: Chromium lands on `chrome-error://chromewebdata/`,
  // which is a real, successful proof the redirect fired) — so this polls
  // `page.url()` directly instead of depending on the destination actually
  // loading.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (!page.url().includes("checkout.stripe.com")) return;
    await page.waitForTimeout(500);
  }
  throw new Error(`Checkout never redirected away from checkout.stripe.com (stuck at ${page.url()})`);
}

test(
  "@live-stripe live checkout flips FREE to PRO; downgrade webhook flips back to FREE with local data untouched",
  { tag: "@live-stripe" },
  async () => {
    test.skip(!SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY not set in root .env — see SELF_HOSTING.md");
    test.skip(!STRIPE_SECRET_KEY, "STRIPE_SECRET_KEY not set in root .env — this test needs real Stripe test-mode credentials");
    test.skip(!stripeCliAvailable(), "the `stripe` CLI is not installed/on PATH — required to forward webhook events locally");
    const reachable = await probeCheckoutSessionReachable();
    test.skip(!reachable, "checkout-session function not reachable on the local stack — is `supabase start` running?");
    test.setTimeout(180_000);

    const email = `e2e-billing-${randomUUID().slice(0, 8)}@tabburrow.test`;
    await cleanupStrayUser(email);

    // Diagnostic-only whsec comparison — see the module docstring's
    // "stripe listen dance" section for why a mismatch can't be fixed here.
    let printedSecret = "";
    try {
      printedSecret = execSync(`stripe listen --api-key "${STRIPE_SECRET_KEY}" --print-secret`, {
        encoding: "utf8",
        timeout: 15_000,
      }).trim();
    } catch {
      // Non-fatal — proceed with the live forward regardless; the assertions below surface any real signing problem.
    }
    if (printedSecret && STRIPE_WEBHOOK_SECRET && printedSecret !== STRIPE_WEBHOOK_SECRET) {
      // eslint-disable-next-line no-console
      console.warn(
        "[t23-billing] stripe listen's derived webhook secret differs from root .env's STRIPE_WEBHOOK_SECRET — " +
          "the already-running stripe-webhook function was started with .env's value at process start and can't " +
          "be reconfigured from here. If the PRO-flip assertion below times out, check this first.",
      );
    }

    const listenChild = spawnStripeListen();
    let context: BrowserContext | undefined;
    let userDataDir: string | undefined;
    let authUserId: string | null = null;
    let stripeCustomerId: string | null = null;

    try {
      await waitForListenReady(listenChild);

      const launched = await launchExtensionContext();
      context = launched.context;
      userDataDir = launched.userDataDir;
      const { extensionId } = launched;

      const dash = await context.newPage();
      await dash.goto(`chrome-extension://${extensionId}/dashboard.html`);

      // Seeded BEFORE checkout so the downgrade phase's "local data
      // untouched" assertion is a real before/after comparison, not
      // vacuously true.
      const collectionId = randomUUID();
      const collectionName = "Billing E2E Collection";
      await seedCollectionsAndLinks(
        dash,
        [{ id: collectionId, name: collectionName, position: seedPosition(0) }],
        [
          {
            id: randomUUID(),
            collectionId,
            url: "https://example.com/billing-e2e",
            title: "Billing E2E Link",
            position: seedPosition(0),
          },
        ],
      );
      await dash.reload();

      await dash.goto(`chrome-extension://${extensionId}/dashboard.html#/settings`);
      await signInWithEmailOtp(dash, email);

      const authUser = await findAdminUserByEmail(SUPABASE_URL, SERVICE_ROLE_KEY!, email);
      expect(authUser, "expected an auth.users row for the test email").toBeTruthy();
      authUserId = authUser!.id;

      // --- (a) live checkout ---
      await expect(dash.getByText("Free", { exact: true })).toBeVisible();
      const monthlyButton = dash.getByRole("button", { name: "Monthly $4/month" });
      await expect(monthlyButton).toBeVisible();

      const [checkoutPage] = await Promise.all([context.waitForEvent("page"), monthlyButton.click()]);
      await checkoutPage.waitForLoadState("domcontentloaded");
      await expect(checkoutPage).toHaveURL(/checkout\.stripe\.com/, { timeout: 20_000 });
      await expect(dash.getByText("Complete checkout in the new tab, then hit Refresh status.")).toBeVisible();

      await completeHostedCheckout(checkoutPage);
      await checkoutPage.close();

      // Switching back to the dashboard tab exercises T23b's visibilitychange
      // pickup (lib/billing.ts's shouldPickupPlanOnVisible) — it may well
      // flip the badge on its own before the explicit click below ever
      // runs. "Refresh status" is still clicked deterministically right
      // after so this assertion never races the pickup's real network
      // round trip or the webhook's own delivery latency.
      await dash.bringToFront();
      await refreshUntilBadge(dash, "PRO");
      await expect(dash.getByRole("button", { name: "Manage billing" })).toBeVisible();
      await expect(dash.getByRole("heading", { name: "Sync", exact: true })).toBeVisible();
      await finalScreenshot(dash, "t23-billing-pro-flip");

      const proProfile = await fetchBillingProfile(SUPABASE_URL, SERVICE_ROLE_KEY!, authUserId);
      expect(proProfile).toMatchObject({ plan: "pro" });
      expect(proProfile?.stripe_customer_id, "expected stripe_customer_id to be stored").toBeTruthy();
      expect(proProfile?.stripe_subscription_id, "expected stripe_subscription_id to be stored").toBeTruthy();
      stripeCustomerId = proProfile!.stripe_customer_id;

      // --- (b) downgrade ---
      // Verified directly against a real checkout-created user before
      // writing this spec (task-23b-report.md) — resolves via
      // applyPlanDecision's userId path (planForEvent's metadataUserId),
      // matching task-23a-report.md's own validated invocation. A
      // `customer:id=...` override was tried and rejected by Stripe
      // ("Customer already exists") — the trigger fixture always CREATES a
      // fresh customer/subscription pair, it can't be pointed at an
      // existing one, so this only overrides the one field the resolution
      // actually needs.
      execSync(
        `stripe trigger customer.subscription.deleted --api-key "${STRIPE_SECRET_KEY}" --override "subscription:metadata.user_id=${authUserId}"`,
        { timeout: 30_000 },
      );

      await refreshUntilBadge(dash, "Free");
      await expect(dash.getByText("Upgrade to PRO", { exact: true })).toBeVisible();
      await expect(dash.getByRole("button", { name: "Monthly $4/month" })).toBeVisible();

      // Local data untouched: the collection seeded before checkout still renders.
      await dash.goto(`chrome-extension://${extensionId}/dashboard.html#/c/${collectionId}`);
      await expect(dash.getByRole("heading", { name: collectionName })).toBeVisible();
      await expect(dash.getByText("Billing E2E Link")).toBeVisible();
      await finalScreenshot(dash, "t23-billing-downgrade");

      const freeProfile = await fetchBillingProfile(SUPABASE_URL, SERVICE_ROLE_KEY!, authUserId);
      expect(freeProfile).toMatchObject({ plan: "free" });
    } finally {
      listenChild.kill();
      if (context && userDataDir) await closeExtensionContext(context, userDataDir);
      // A failure BEFORE the PRO-flip assertions (e.g. the hosted Checkout
      // page itself timing out) never reaches the `stripeCustomerId =`
      // assignment above — but `createCheckoutSession` may still have
      // created and persisted a Stripe customer via `findOrCreateCustomerId`
      // before that point. One best-effort extra lookup so a failed run
      // doesn't leak that customer (observed directly while writing this
      // spec: two failed early attempts each left a stray Stripe test
      // customer behind, cleaned up by hand — see task-23b-report.md).
      if (!stripeCustomerId && authUserId) {
        const leftoverProfile = await fetchBillingProfile(SUPABASE_URL, SERVICE_ROLE_KEY!, authUserId).catch(() => null);
        stripeCustomerId = leftoverProfile?.stripe_customer_id ?? null;
      }
      if (stripeCustomerId) await cleanupStripeCustomer(stripeCustomerId);
      if (authUserId) await deleteAdminUser(SUPABASE_URL, SERVICE_ROLE_KEY!, authUserId);
    }
  },
);

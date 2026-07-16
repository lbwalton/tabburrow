import { test, expect, signInWithEmailOtp } from "../fixtures";
import { loadRootEnv } from "../env";
import { deleteAdminUser, fetchProfile, findAdminUserByEmail } from "../admin";
import { finalScreenshot } from "../test-utils";

/**
 * T16 — extension auth. Acceptance (stories/stories.json):
 *   - "Email code flow works with a real inbox" — driven end to end here
 *     against the LOCAL Supabase stack's real Mailpit mail catcher (see
 *     e2e/mail.ts), not mocked.
 *   - "Sign out clears session; local data untouched" — the sign-out phase
 *     below asserts the UI returns to signed-out; local data is untouched
 *     by construction (signOut only ever touches the auth session, never
 *     Dexie — see lib/auth.ts).
 *   - "Google sign-in completes inside the extension... and survives
 *     browser restart" — NOT covered here. The local stack has no Google
 *     OAuth client configured yet (see docs/SETUP_NOTES.md for the exact
 *     console steps LB still needs to run), so there is nothing live to
 *     drive; see e2e/MANUAL.md for the manual check once a client exists.
 *     The one thing that IS machine-verified without a live client is the
 *     "clear error when unconfigured" guard — covered as a pure-function
 *     unit test instead (lib/auth.test.ts's parseAuthRedirect /
 *     describeWebAuthFlowError fixtures), same as the "cloud not
 *     configured" AccountPane/footer branch (lib/supabase.test.ts's
 *     hasSupabaseEnv fixtures) — launching a second extension build with no
 *     env vars just to exercise one conditional render isn't worth this
 *     harness's weight for either case. This split is deliberate, not a
 *     coverage gap.
 *
 * Requires the local stack running (`supabase start`) with Mailpit
 * reachable at 127.0.0.1:54324 and SUPABASE_SERVICE_ROLE_KEY set in the
 * root .env (see SELF_HOSTING.md) — skips itself with a clear reason if
 * that key is absent, same as every other "needs live infra" guard in this
 * suite would.
 */

const TEST_EMAIL = "e2e-auth@tabburrow.test";

test("email code sign-in creates a profiles row and shows Free; sign-out returns to signed-out", async ({
  cleanDashboard,
  extensionId,
}) => {
  const env = loadRootEnv();
  const supabaseUrl = env.SUPABASE_URL || "http://127.0.0.1:54321";
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  test.skip(!serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY not set in root .env — see SELF_HOSTING.md");

  // Idempotent setup: a prior run that crashed before its own cleanup (see
  // the end of this test) could otherwise leave a stray user behind.
  const preexisting = await findAdminUserByEmail(supabaseUrl, serviceRoleKey!, TEST_EMAIL);
  if (preexisting) await deleteAdminUser(supabaseUrl, serviceRoleKey!, preexisting.id);

  const dashboard = cleanDashboard;
  await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html#/settings`);

  // --- Phases 1-2: send + verify the OTP against the real local mail
  // catcher (see e2e/mail.ts) — shared with t18-sync.spec.ts's two-device
  // sign-in via fixtures.ts's signInWithEmailOtp. ---
  await signInWithEmailOtp(dashboard, TEST_EMAIL);

  await expect(dashboard.getByText("Free", { exact: true })).toBeVisible();
  await finalScreenshot(dashboard, "t16-signed-in");

  // --- Phase 3: profiles row exists (independent, service-role verification —
  // does not trust anything the extension itself reported) ---
  const authUser = await findAdminUserByEmail(supabaseUrl, serviceRoleKey!, TEST_EMAIL);
  expect(authUser, "expected an auth.users row for the test email").toBeTruthy();

  const profile = await fetchProfile(supabaseUrl, serviceRoleKey!, authUser!.id);
  expect(profile).toMatchObject({ user_id: authUser!.id, plan: "free" });

  // --- Phase 4: sign out returns the UI to signed-out ---
  await dashboard.getByRole("button", { name: "Sign out" }).click();
  await expect(dashboard.getByRole("button", { name: "Send code" })).toBeVisible();
  await expect(dashboard.getByText(TEST_EMAIL)).toHaveCount(0);
  await finalScreenshot(dashboard, "t16-signed-out");

  await deleteAdminUser(supabaseUrl, serviceRoleKey!, authUser!.id);
});

import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repo root — where `supabase/` (config + migrations) lives, and therefore where the CLI must run. */
export const REPO_ROOT = path.resolve(__dirname, "../../..");

/** The local stack's REST endpoint. Matches `supabase status`'s API_URL and the `WXT_SUPABASE_URL` build:e2e bakes in. */
export const LOCAL_SUPABASE_REST = "http://127.0.0.1:54321/rest/v1/";

/**
 * Env flag `globalSetup` publishes for the spec files to read.
 *
 * It has to travel as an env var rather than a module-level export: Playwright
 * runs `globalSetup` in the main process and each spec in a separate WORKER
 * process, so a value written to a module's state in setup is simply not there
 * when a spec imports the same module. Workers inherit `process.env` at spawn,
 * which is the documented channel for exactly this.
 */
export const STACK_FLAG = "TABBURROW_E2E_SUPABASE_UP";

/** Set to "1" to skip the auto-start and only probe (for anyone who manages the stack themselves). */
export const NO_AUTOSTART_FLAG = "TABBURROW_E2E_NO_SUPABASE_AUTOSTART";

/** Whether the local Supabase REST endpoint answers. A 401/404 still counts — something is listening and routing, which is all the specs need before they authenticate. */
export async function isSupabaseUp(timeoutMs = 2500): Promise<boolean> {
  try {
    await fetch(LOCAL_SUPABASE_REST, { signal: AbortSignal.timeout(timeoutMs) });
    return true;
  } catch {
    return false;
  }
}

/** Polls `isSupabaseUp` until it answers or `deadlineMs` passes. */
export async function waitForSupabase(deadlineMs: number): Promise<boolean> {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    if (await isSupabaseUp(1500)) return true;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

/**
 * Brings the local stack up if it isn't already, and reports whether the
 * networked specs (t16/t18/t20/t22/t23) can run.
 *
 * Never throws. A missing stack must not fail the whole run — the ~77
 * local-only specs need nothing but a built extension, and making them
 * unrunnable because Docker is asleep would be a worse bug than the one this
 * fixes. The networked specs skip themselves instead, with a reason.
 */
export async function ensureSupabase(): Promise<boolean> {
  if (await isSupabaseUp()) {
    console.log("[e2e] local Supabase stack: already running.");
    return true;
  }

  if (process.env[NO_AUTOSTART_FLAG] === "1") {
    console.warn(`[e2e] local Supabase stack is down and ${NO_AUTOSTART_FLAG}=1 — not starting it.`);
    return false;
  }

  console.log("[e2e] local Supabase stack is down — running `supabase start` (first run pulls images; this can take a minute)…");
  try {
    execSync("supabase start", { cwd: REPO_ROOT, stdio: "inherit", timeout: 300_000 });
  } catch {
    // Almost always "Docker is not running" or the CLI isn't installed. Both
    // are the developer's environment, not something a test run should paper
    // over — so say exactly what to do rather than retrying.
    console.warn(
      [
        "",
        "[e2e] Could not start the local Supabase stack.",
        "[e2e]   • Is Docker running? (`open -a Docker`, then wait for it to finish starting)",
        "[e2e]   • Is the CLI installed? (`brew install supabase/tap/supabase`)",
        "[e2e] The networked specs (t16/t18/t20/t22/t23) will be SKIPPED; every other spec still runs.",
        "",
      ].join("\n"),
    );
    return false;
  }

  const up = await waitForSupabase(60_000);
  console.log(up ? "[e2e] local Supabase stack: started." : "[e2e] `supabase start` returned but the API never answered.");
  return up;
}

/**
 * The reason string a skipped networked spec reports. Written as an
 * instruction, because "skipped" with no cause is how a suite quietly stops
 * covering something.
 */
export const SKIP_REASON =
  "local Supabase stack not running — start Docker, then `supabase start` (see e2e/README.md)";

/** True when the networked specs should skip. Reads the flag `globalSetup` published. */
export function supabaseUnavailable(): boolean {
  return process.env[STACK_FLAG] !== "1";
}

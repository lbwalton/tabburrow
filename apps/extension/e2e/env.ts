import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_ENV_PATH = path.resolve(__dirname, "../../../.env");

/**
 * Reads the monorepo root `.env` — test-only, for `SUPABASE_SERVICE_ROLE_KEY`
 * (t16-auth.spec.ts's admin-level `profiles` row assertion; never bundled
 * into the extension itself — see lib/supabase.ts, which only ever reads
 * the two `WXT_SUPABASE_*` vars scripts/sync-env.mjs copies into
 * apps/extension/.env.local).
 *
 * Same flat KEY=VALUE (+ optional trailing " # comment") parsing as
 * scripts/sync-env.mjs, duplicated rather than imported: that script runs
 * under plain Node ESM, this runs under Playwright's TS loader — not worth
 * a shared module for ~15 lines (same "kept in sync by hand" precedent
 * seed.ts's docstring sets for duplicating shapes across the two runtimes).
 */
export function loadRootEnv(): Record<string, string> {
  if (!fs.existsSync(ROOT_ENV_PATH)) return {};
  const values: Record<string, string> = {};
  for (const rawLine of fs.readFileSync(ROOT_ENV_PATH, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1);
    const commentIdx = value.indexOf(" #");
    if (commentIdx !== -1) value = value.slice(0, commentIdx);
    values[key] = value.trim();
  }
  return values;
}

// Production build for real-Chrome use and store zips: bakes the HOSTED
// backend (not the local dev stack) and copies the result to dist-prod/, a
// stable path that `pnpm dev` / `build:e2e` never overwrite — load THAT dir
// unpacked in Chrome for production testing, and dev/test rebuilds can't
// silently repoint it at the local stack (which is exactly what happened on
// 2026-07-22: a dev rebuild flipped a loaded copy back to localhost, where
// Google sign-in is intentionally disabled).
//
// The values below are PUBLIC by design: the Supabase publishable key ships
// inside every installed copy of the extension, and the URLs are just origins.
// Real secrets stay in the hosted project's secret store, never here.
//
// Run: pnpm --filter extension build:prod
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_LOCAL = path.join(EXT_DIR, ".env.local");
const OUT = path.join(EXT_DIR, ".output", "chrome-mv3");
const DIST = path.join(EXT_DIR, "dist-prod", "chrome-mv3");

const PROD_ENV = [
  "WXT_SUPABASE_URL=https://kaktkbnqkqxfhwrerhjh.supabase.co",
  "WXT_SUPABASE_ANON_KEY=sb_publishable_9iBESkBAAHV5Q8D9owsa8A_Ex6De96R",
  "WXT_SITE_URL=https://tabburrow.com",
  "",
].join("\n");

const run = (cmd) => execSync(cmd, { cwd: EXT_DIR, stdio: "inherit" });

fs.writeFileSync(ENV_LOCAL, PROD_ENV);
try {
  // Plain `wxt zip` (production mode; builds then zips) — NOT the pnpm
  // scripts, whose prebuild hook would regenerate .env.local from the root
  // .env's local-stack values. The zip MUST be produced here, inside the
  // hosted-env window: running `wxt zip` on its own later rebuilds from
  // whatever .env.local then holds (the dev stack, after this script's
  // finally-block restore) and silently bakes 127.0.0.1 into the store
  // artifact — exactly the near-miss caught on 2026-07-27.
  run("npx wxt zip");
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(DIST), { recursive: true });
  fs.cpSync(OUT, DIST, { recursive: true });

  const manifest = JSON.parse(fs.readFileSync(path.join(DIST, "manifest.json"), "utf8"));
  const baked = execSync(`grep -rl "kaktkbnqkqxfhwrerhjh" "${DIST}"`).toString().trim().length > 0;
  const localLeak = (() => {
    try {
      execSync(`grep -rq "127.0.0.1:54321" "${DIST}"`);
      return true;
    } catch {
      return false;
    }
  })();
  const zipPath = path.join(EXT_DIR, ".output", `tabburrowextension-${manifest.version}-chrome.zip`);
  const zipExists = fs.existsSync(zipPath);
  console.log("\n=== build:prod verification ===");
  console.log("version:", manifest.version, "| host_permissions:", JSON.stringify(manifest.host_permissions));
  console.log("hosted URL baked:", baked, "| local URL leaked:", localLeak, "| store zip written:", zipExists);
  if (!baked || localLeak || !zipExists || manifest.host_permissions.some((h) => h.includes("127.0.0.1"))) {
    throw new Error("build:prod verification failed — see flags above");
  }
  console.log(`\nStore upload artifact: ${path.relative(EXT_DIR, zipPath)} (hosted backend baked in)`);
  console.log("Load in Chrome: apps/extension/dist-prod/chrome-mv3 (stable, dev builds never touch it)");
} finally {
  // Leave .env.local pointing back at the dev stack so a later `pnpm dev` /
  // `build:e2e` behaves as every doc in e2e/ assumes.
  run("node scripts/sync-env.mjs");
}

#!/usr/bin/env node
// One-off rasterizer: assets/og-image.svg -> public/og-image.png (1200x630).
// Output PNG is committed (not generated at build/deploy time), mirroring
// apps/extension/scripts/make-icons.mjs. Run with
// `pnpm --filter @tabburrow/web make-og-image` after editing the source SVG.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const svgPath = path.join(root, "assets", "og-image.svg");
const outPath = path.join(root, "public", "og-image.png");

async function main() {
  await mkdir(path.dirname(outPath), { recursive: true });
  await sharp(svgPath, { density: 144 }).resize(1200, 630).png().toFile(outPath);
  console.log(`wrote ${path.relative(root, outPath)} (1200x630)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

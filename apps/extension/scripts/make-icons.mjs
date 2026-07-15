#!/usr/bin/env node
// One-off rasterizer: assets/icon.svg -> public/icons/{16,32,48,128}.png
// Run with `pnpm --filter @tabburrow/extension make-icons`. Output PNGs are
// committed (not generated at build time) so the manifest can reference
// stable paths under public/, which WXT copies to the output as-is.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const svgPath = path.join(root, "assets", "icon.svg");
const outDir = path.join(root, "public", "icons");
const sizes = [16, 32, 48, 128];

async function main() {
  await mkdir(outDir, { recursive: true });

  for (const size of sizes) {
    const outPath = path.join(outDir, `${size}.png`);
    // Render at a higher density than the target pixel size so small icons
    // (16/32) don't come out soft after Sharp's resize.
    await sharp(svgPath, { density: 384 })
      .resize(size, size)
      .png()
      .toFile(outPath);
    console.log(`wrote ${path.relative(root, outPath)} (${size}x${size})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

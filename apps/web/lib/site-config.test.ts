import { afterEach, describe, expect, it, vi } from "vitest";

// site-config reads the environment at import time, so each case stubs the
// env and re-imports a fresh copy of the module.
async function beaconToken(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return (await import("./site-config")).CF_BEACON_TOKEN;
}

describe("CF_BEACON_TOKEN", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is set on the official production deploy", async () => {
    expect(await beaconToken({ VERCEL_ENV: "production", NEXT_PUBLIC_SITE_URL: undefined })).toBeTruthy();
  });

  it("is null on preview builds", async () => {
    expect(await beaconToken({ VERCEL_ENV: "preview", NEXT_PUBLIC_SITE_URL: undefined })).toBeNull();
  });

  it("is null for self-hosted copies, on Vercel or not", async () => {
    expect(await beaconToken({ VERCEL_ENV: undefined, NEXT_PUBLIC_SITE_URL: undefined })).toBeNull();
    expect(
      await beaconToken({ VERCEL_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://tabs.example.com" }),
    ).toBeNull();
  });
});

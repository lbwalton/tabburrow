import { defineConfig } from "vitest/config";

// Mirrors packages/core/vitest.config.ts. Only pure lib/ functions are unit
// tested here (tab filtering, recents ordering, the popup's save-flow state
// machine) — no chrome.* mocking, no DOM/component rendering.
export default defineConfig({
  test: {},
});

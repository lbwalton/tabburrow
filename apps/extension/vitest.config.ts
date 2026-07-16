import { configDefaults, defineConfig } from "vitest/config";

// Mirrors packages/core/vitest.config.ts. Only pure lib/ functions are unit
// tested here (tab filtering, recents ordering, the popup's save-flow state
// machine) — no chrome.* mocking, no DOM/component rendering.
export default defineConfig({
  test: {
    // e2e/ is the Playwright suite (Task 14) — its *.spec.ts files use
    // @playwright/test's own `test()`, which throws when collected outside
    // a Playwright runner. Vitest's default include glob would otherwise
    // pick them up right alongside this package's real unit tests.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});

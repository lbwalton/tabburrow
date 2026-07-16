import { defineConfig } from "vitest/config";

export default defineConfig({
  // The `server-only` package's `exports` map throws from its `default`
  // condition and only resolves to a no-op under the `react-server`
  // condition (which Next's RSC bundler sets, but plain Node/Vitest never
  // does on its own). Setting it here is the standard way to unit-test a
  // `import "server-only"` module without either stripping that import
  // (which would weaken the real guard) or splitting pure helpers into a
  // separate un-guarded file just for testability.
  resolve: {
    conditions: ["react-server"],
  },
  test: {},
});

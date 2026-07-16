import { describe, it, expect } from "vitest";
import { buildShareUrl } from "./share-url";

// `shareUrlFor` (the real one-arg entry point ShareDialog calls) is NOT unit
// tested directly, for the same reason `lib/supabase.ts`'s `getClient`/
// `isSupabaseConfigured` aren't (see lib/supabase.test.ts's docstring): it
// reads `import.meta.env.WXT_SITE_URL`, which this package's vitest config
// deliberately does no mocking of. `buildShareUrl` — the actual trailing-
// slash/join logic `shareUrlFor` defers to — IS test-driven here, mirroring
// `hasSupabaseEnv`'s split (pure decision function, parametrized; thin env-
// reading wrapper, untested in isolation).

describe("buildShareUrl", () => {
  it("joins a bare origin and a slug with exactly one slash", () => {
    expect(buildShareUrl("https://tabburrow.com", "abc123defg")).toBe("https://tabburrow.com/s/abc123defg");
  });

  it("strips a single trailing slash from the site url before joining", () => {
    expect(buildShareUrl("https://tabburrow.com/", "abc123defg")).toBe("https://tabburrow.com/s/abc123defg");
  });

  it("strips multiple trailing slashes from the site url before joining", () => {
    expect(buildShareUrl("https://tabburrow.com///", "abc123defg")).toBe("https://tabburrow.com/s/abc123defg");
  });

  it("works with a localhost origin (e2e's dev-server WXT_SITE_URL)", () => {
    expect(buildShareUrl("http://localhost:3100", "zzzzzzzzzz")).toBe("http://localhost:3100/s/zzzzzzzzzz");
  });

  it("does not alter the slug itself", () => {
    expect(buildShareUrl("https://tabburrow.com", "0a9b8c7d6e")).toBe("https://tabburrow.com/s/0a9b8c7d6e");
  });
});

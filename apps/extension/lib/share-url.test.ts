import { describe, it, expect } from "vitest";
import { buildShareUrl, mailtoShareForCollection } from "./share-url";

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

describe("mailtoShareForCollection", () => {
  const url = "https://tabburrow.com/s/abc123defg";

  it("builds a recipient-less mailto: with subject and body", () => {
    const result = mailtoShareForCollection("Coding", url);
    expect(result.startsWith("mailto:?")).toBe(true);
    // No `to=` recipient — the user picks who to send to.
    expect(result).not.toContain("mailto:someone");
    expect(result).toContain("subject=");
    expect(result).toContain("body=");
  });

  it("includes the share url inside the encoded body", () => {
    const result = mailtoShareForCollection("Coding", url);
    expect(result).toContain(encodeURIComponent(url));
  });

  it("puts the collection name in both subject and body, encoded", () => {
    const result = mailtoShareForCollection("Coding", url);
    expect(result).toContain(encodeURIComponent("Coding: a TabBurrow collection"));
    expect(result).toContain(encodeURIComponent('Here are my "Coding" links:'));
  });

  it("encodes a name containing & and \" so it cannot split the query or inject headers", () => {
    const result = mailtoShareForCollection('R&D "notes"', url);
    // A raw & or " must never appear unescaped in the query string.
    const query = result.slice("mailto:?".length);
    expect(query).not.toContain('"');
    expect(query.split("&").length).toBe(2); // exactly subject=…&body=…, no extra & from the name
    expect(result).toContain(encodeURIComponent('R&D "notes": a TabBurrow collection'));
  });

  it("encodes newlines as CRLF percent-escapes", () => {
    const result = mailtoShareForCollection("Coding", url);
    expect(result).toContain("%0D%0A");
  });
});

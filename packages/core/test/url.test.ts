import { describe, it, expect } from "vitest";
import { isStorableLinkUrl, normalizeUrl } from "../src/url";

describe("normalizeUrl", () => {
  describe("bare input gains a scheme", () => {
    it("prefixes a bare domain with https://", () => {
      // The exact issue #24 repro: typed "nike.com", stored schemeless, and
      // chrome.tabs.create resolved it against the extension's own origin.
      expect(normalizeUrl("nike.com")).toBe("https://nike.com");
    });

    it("prefixes a bare domain carrying a path/query/fragment", () => {
      expect(normalizeUrl("www.nike.com/shoes?a=1#top")).toBe("https://www.nike.com/shoes?a=1#top");
    });

    it("prefixes a protocol-relative reference without doubling its slashes", () => {
      expect(normalizeUrl("//nike.com/x")).toBe("https://nike.com/x");
    });

    it("prefixes a bare IPv4 host", () => {
      expect(normalizeUrl("192.168.1.1")).toBe("https://192.168.1.1");
    });
  });

  describe("host:port is a host, not a scheme", () => {
    // `new URL()` alone parses "localhost:3000" as scheme "localhost:" with
    // path "3000", so a naive "does it parse?" scheme check leaves exactly
    // this shape unnormalized and broken. See `hasScheme`.
    it("prefixes host:port rather than reading the host as a scheme", () => {
      expect(normalizeUrl("localhost:3000")).toBe("https://localhost:3000");
    });

    it("prefixes host:port with a path", () => {
      expect(normalizeUrl("localhost:3000/admin")).toBe("https://localhost:3000/admin");
    });

    it("prefixes a dotted host:port (the scheme-lookalike case)", () => {
      expect(normalizeUrl("nike.com:8080")).toBe("https://nike.com:8080");
    });

    it("prefixes host:port with a query and fragment", () => {
      expect(normalizeUrl("x.com:80/p?q=1#h")).toBe("https://x.com:80/p?q=1#h");
    });
  });

  describe("already-absolute input is returned untouched", () => {
    it("leaves an https URL exactly as-is — no trailing slash, no re-encoding", () => {
      expect(normalizeUrl("https://nike.com")).toBe("https://nike.com");
    });

    it("preserves a URL's case rather than canonicalizing the host", () => {
      expect(normalizeUrl("HTTPS://NIKE.COM/Path")).toBe("HTTPS://NIKE.COM/Path");
    });

    it.each([
      ["http://localhost:3000", "an http URL with a real port"],
      ["mailto:someone@example.com", "a mailto: URL"],
      ["chrome://settings", "a chrome:// URL"],
      ["file:///etc/hosts", "a file:// URL"],
      ["ftp://example.com/f", "an ftp:// URL"],
      ["about:blank", "an about: URL"],
    ])("leaves %s untouched (%s)", (input) => {
      expect(normalizeUrl(input)).toBe(input);
    });
  });

  describe("input that can't become a URL is preserved, not mangled", () => {
    it("returns free text unchanged rather than inventing https://free text", () => {
      // Callers already tolerate an unparseable URL (`hostnameOf` in
      // addLink, `formatHost` in the UI both fall back to the raw string),
      // so preserving it loses nothing and keeps the old behavior.
      expect(normalizeUrl("not a valid url")).toBe("not a valid url");
    });

    it("returns an empty string for empty input", () => {
      expect(normalizeUrl("")).toBe("");
    });

    it("returns an empty string for whitespace-only input", () => {
      expect(normalizeUrl("   ")).toBe("");
    });
  });

  describe("whitespace", () => {
    it("trims surrounding whitespace before deciding (a pasted URL with padding still normalizes)", () => {
      // Without the trim this fails BOTH ways: it doesn't parse as-is, and
      // "https://  nike.com  " doesn't parse either, so it would have been
      // stored — and opened — as raw padded text.
      expect(normalizeUrl("  nike.com  ")).toBe("https://nike.com");
    });

    it("trims an already-absolute URL too", () => {
      expect(normalizeUrl("  https://nike.com  ")).toBe("https://nike.com");
    });
  });

  describe("idempotence", () => {
    // openLinks normalizes on every open, and addLink normalized on the way
    // in, so most strings get normalized more than once. A second pass must
    // never change the result.
    it.each([
      "nike.com",
      "https://nike.com",
      "localhost:3000",
      "//nike.com",
      "not a valid url",
      "  nike.com  ",
      "",
    ])("normalizing %s twice equals normalizing it once", (input) => {
      const once = normalizeUrl(input);
      expect(normalizeUrl(once)).toBe(once);
    });
  });
});

describe("isStorableLinkUrl", () => {
  it.each([
    ["https://nike.com", "an https URL"],
    ["http://example.com", "an http URL"],
    ["nike.com", "a bare domain (normalized to https first)"],
    ["  nike.com  ", "a padded bare domain"],
    ["file:///Users/me/report.html", "a local file, which tab capture already accepts"],
  ])("accepts %s (%s)", (url) => {
    expect(isStorableLinkUrl(url)).toBe(true);
  });

  it.each([
    ["javascript:alert(1)", "the stored-XSS payload"],
    ["java\nscript:alert(1)", "the newline bypass — the URL parser strips it, so a prefix check would miss this"],
    ["JavaScript:alert(1)", "mixed case"],
    ["  javascript:alert(1)  ", "padded"],
    ["data:text/html,<script>alert(1)</script>", "data: executes in the page origin"],
    ["vbscript:msgbox(1)", "the legacy equivalent"],
    ["blob:https://tabburrow.com/abc", "blob: is same-origin scripting"],
    ["chrome://settings", "browser-internal, not a link worth storing"],
    ["mailto:a@b.com", "not a page"],
    ["not a valid url", "free text could never be opened"],
    ["", "empty"],
    ["   ", "whitespace only"],
  ])("rejects %s (%s)", (url) => {
    expect(isStorableLinkUrl(url)).toBe(false);
  });
});

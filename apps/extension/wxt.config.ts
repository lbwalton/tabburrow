import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: (env) => ({
    // This IS the Chrome Web Store listing title, not just the toolbar name,
    // so it doubles as store-search copy: "session" covers a high-volume store
    // query ("session manager", "restore tabs") that the previous name missed.
    // 42/45 chars. Ships with the next release; see store-assets/listing.md.
    name: "TabBurrow: Tab, Session & Bookmark Manager",
    // The on-device AI (Gemini Nano via the Prompt API, `LanguageModel`) needs
    // NO permission here: it's available to extension pages on Chrome 138+ with
    // no manifest entry (developer.chrome.com/docs/ai/prompt-api, checked
    // 2026-07-18). The old `aiLanguageModelOriginTrial` permission is expired
    // and intentionally absent — see e2e/MANUAL.md §9.
    permissions: ["tabs", "storage", "favicon", "identity", "alarms"],
    // Supabase: any hosted/self-hosted *.supabase.co project (T15) always
    // gets host access. The local dev stack's fixed loopback origin
    // (http://127.0.0.1:54321) is dev/e2e-only — a real shippable build
    // (`wxt build`'s default `mode: "production"`, e.g. for the store or a
    // self-hoster's own install) leaves it out, since no installed user's
    // browser could ever need it and an unused host permission is exactly
    // what store reviewers (and privacy-minded users reading the install
    // prompt) flag. `wxt`'s dev server (`env.mode !== "production"`) keeps
    // it automatically. `wxt build` itself can't tell "shippable production
    // build" apart from "build the e2e harness tests against" (both run
    // with mode "production"), so the e2e suite — which always drives the
    // extension against the local stack, see e2e/README.md — opts back in
    // explicitly via WXT_INCLUDE_LOCAL_HOSTS=1 (see package.json's
    // `build:e2e` script).
    host_permissions:
      env.mode !== "production" || process.env.WXT_INCLUDE_LOCAL_HOSTS === "1"
        ? ["http://127.0.0.1:54321/*", "https://*.supabase.co/*"]
        : ["https://*.supabase.co/*"],
    commands: {
      "save-current-tab": { suggested_key: { default: "Alt+Shift+S" }, description: "Save current tab" },
      "save-all-tabs": { suggested_key: { default: "Alt+Shift+A" }, description: "Save all tabs" },
      "open-dashboard": { suggested_key: { default: "Alt+Shift+B" }, description: "Open TabBurrow" },
    },
    // Not part of the brief's verbatim manifest block, but required to wire up
    // the generated icon PNGs (see assets/icon.svg + scripts/make-icons.mjs).
    icons: {
      16: "/icons/16.png",
      32: "/icons/32.png",
      48: "/icons/48.png",
      128: "/icons/128.png",
    },
    action: {
      default_popup: "popup.html",
      default_icon: {
        16: "/icons/16.png",
        32: "/icons/32.png",
        48: "/icons/48.png",
        128: "/icons/128.png",
      },
    },
  }),
});

import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: "TabBurrow — Tab & Bookmark Manager",
    permissions: ["tabs", "storage", "favicon", "identity", "alarms"],
    host_permissions: [], // Supabase URL added in Task 15
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
  },
});

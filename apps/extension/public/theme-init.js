// Pre-paint theme init. Loaded as a classic (non-module, parser-blocking)
// <script> FIRST in the <head> of both popup.html and dashboard.html, so it
// runs before anything paints. An external file rather than inline because
// MV3's extension-page CSP blocks inline scripts.
//
// Reads the localStorage cache that lib/theme.ts's applyTheme mirrors the
// durable meta "theme" value into ("tabburrow-theme" — keep the key and the
// "paper"/"dark" literals in sync with THEME_STORAGE_KEY/parseTheme there;
// a classic pre-paint script can't import from a module). The async meta
// read each entrypoint does on mount remains the reconciliation pass for
// whenever this cache is missing or stale (fresh profile, cleared storage,
// theme changed from another surface that never painted here).
//
// Defaults to dark on ANY error or unrecognized value.
(function () {
  var theme = "dark";
  try {
    if (localStorage.getItem("tabburrow-theme") === "paper") theme = "paper";
  } catch (e) {
    // localStorage unavailable — fall through to dark.
  }
  document.documentElement.setAttribute("data-theme", theme);
})();

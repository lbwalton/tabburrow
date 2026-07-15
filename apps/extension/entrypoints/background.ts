export default defineBackground(() => {
  console.log("[tabburrow] service worker up");

  // Command (keyboard shortcut) wiring lands in T13 — this is just an
  // install/update log so the service worker lifecycle is observable.
  chrome.runtime.onInstalled.addListener((details) => {
    console.log(`[tabburrow] onInstalled reason=${details.reason}`);
  });
});

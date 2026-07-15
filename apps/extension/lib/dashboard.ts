/**
 * dashboard.html hash-route for a collection. Emitting the format now per
 * the Task 7 brief; the route itself is wired up in T8 (dashboard shell).
 */
export function dashboardCollectionPath(id: string): string {
  return `dashboard.html#/c/${id}`;
}

/** Full extension-origin URL, for chrome.tabs.create. */
export function dashboardCollectionUrl(id: string): string {
  return chrome.runtime.getURL(`/${dashboardCollectionPath(id)}`);
}

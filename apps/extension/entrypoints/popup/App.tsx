import { Button } from "@tabburrow/ui";

function openDashboard() {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
}

export function App() {
  return (
    <div className="flex min-h-[420px] w-[360px] flex-col items-center justify-center gap-6 bg-[var(--bg-ground)] px-6 py-8">
      <h1
        className="text-3xl font-bold text-[var(--text)]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        TabBurrow
      </h1>
      <Button variant="primary" onClick={openDashboard}>
        Open dashboard
      </Button>
    </div>
  );
}

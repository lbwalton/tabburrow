import { EmptyState } from "@tabburrow/ui";

export function App() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--bg-ground)] px-6 py-16">
      <h1
        className="text-4xl font-bold text-[var(--text)]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        TabBurrow
      </h1>
      <p
        className="text-base text-[var(--text-2)]"
        style={{ fontFamily: "var(--font-body)" }}
      >
        Your tabs deserve a burrow.
      </p>
      <EmptyState
        title="Nothing saved yet"
        description="Save a tab from the popup to see it appear here."
        className="mt-6"
      />
    </div>
  );
}

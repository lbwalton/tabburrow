import { Badge } from "@tabburrow/ui";

// T25 TODO: replace this stylized illustration with real dashboard
// screenshots once the extension has production UI to capture. Keep the
// same two-panel "before / after" layout so the swap is a drop-in.

const CHAOS_CHIPS = [
  { rotate: -8, size: 34, tone: "var(--muted)" },
  { rotate: 5, size: 26, tone: "var(--line-hi)" },
  { rotate: -14, size: 30, tone: "var(--accent-2)", faint: true },
  { rotate: 11, size: 22, tone: "var(--muted)" },
  { rotate: -3, size: 38, tone: "var(--line-hi)" },
  { rotate: 18, size: 24, tone: "var(--accent)", faint: true },
  { rotate: -20, size: 28, tone: "var(--muted)" },
  { rotate: 7, size: 32, tone: "var(--line-hi)" },
  { rotate: -6, size: 24, tone: "var(--muted)" },
  { rotate: 15, size: 30, tone: "var(--accent-2)", faint: true },
  { rotate: -11, size: 26, tone: "var(--line-hi)" },
  { rotate: 4, size: 36, tone: "var(--muted)" },
  { rotate: -17, size: 22, tone: "var(--line-hi)" },
  { rotate: 9, size: 28, tone: "var(--muted)" },
];

const COLLECTIONS = [
  { name: "Research", count: 12, variant: "accent" as const },
  { name: "Recipes", count: 8, variant: "accent-2" as const },
  { name: "Job hunt", count: 6, variant: "muted" as const },
  { name: "Reading list", count: 15, variant: "muted" as const },
];

export function ClutterStrip() {
  return (
    <div className="grid gap-6 md:grid-cols-[1fr_auto_1fr] md:items-center">
      {/* Before: chaotic tab clutter */}
      <div className="rounded-[var(--radius-arch)] border border-[var(--line)] bg-[var(--bg-well)] p-6">
        <p
          className="mb-4 text-xs font-semibold uppercase tracking-wide text-[var(--text-2)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Before — 47 tabs open
        </p>
        <div className="flex flex-wrap items-center gap-2" aria-hidden="true">
          {CHAOS_CHIPS.map((chip, i) => (
            <span
              key={i}
              className="block shrink-0 rounded-[6px]"
              style={{
                width: chip.size,
                height: chip.size,
                background: chip.tone,
                opacity: chip.faint ? 0.55 : 0.9,
                transform: `rotate(${chip.rotate}deg)`,
              }}
            />
          ))}
        </div>
        <p className="mt-4 text-sm text-[var(--text-2)]">
          Scattered across three windows. Impossible to find anything twice.
        </p>
      </div>

      <div
        aria-hidden="true"
        className="mx-auto hidden text-2xl text-[var(--accent)] md:block"
        style={{ fontFamily: "var(--font-display)" }}
      >
        →
      </div>

      {/* After: tidy collections */}
      <div className="rounded-[var(--radius-arch)] border border-[var(--line)] bg-[var(--surface)] p-6">
        <p
          className="mb-4 text-xs font-semibold uppercase tracking-wide text-[var(--text-2)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          After — one click, sorted
        </p>
        <ul className="flex flex-col gap-2">
          {COLLECTIONS.map((c) => (
            <li
              key={c.name}
              className="flex items-center justify-between rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--bg-ground)] px-3 py-2"
            >
              <span className="text-sm font-medium text-[var(--text)]">{c.name}</span>
              <Badge variant={c.variant}>{c.count}</Badge>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

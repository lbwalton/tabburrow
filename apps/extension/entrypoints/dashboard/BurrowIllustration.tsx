/**
 * The "burrow arch" motif used across the dashboard's empty states: two
 * nested arches (the outer hill, an inner doorway cut into it) plus a small
 * accent glow, built entirely from existing tokens — no new hex values.
 * Reuses `--radius-arch` (the same rounded-top/flat-bottom shape `Card`
 * defaults to) so it reads as the same brand shape, not a one-off icon.
 */
export function BurrowIllustration() {
  return (
    <div aria-hidden="true" className="relative mx-auto mb-1 h-16 w-24">
      <div
        className="absolute inset-0"
        style={{
          borderRadius: "var(--radius-arch)",
          background: "linear-gradient(180deg, var(--surface) 0%, var(--bg-well) 100%)",
          border: "1px solid var(--line-hi)",
        }}
      />
      <div
        className="absolute bottom-0 left-1/2 h-10 w-14 -translate-x-1/2"
        style={{
          borderRadius: "var(--radius-arch)",
          background: "var(--bg-ground)",
          border: "1px solid var(--line)",
        }}
      />
      <div
        className="absolute left-1/2 top-3 h-2 w-2 -translate-x-1/2 rounded-full"
        style={{ background: "var(--accent)", opacity: 0.85 }}
      />
    </div>
  );
}

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { ACCENT_EMOJIS, accentPalette } from "../../lib/accents";

export interface AccentPickerProps {
  anchorRef: RefObject<HTMLButtonElement>;
  value: string | null;
  onChoose: (accent: string) => void;
  onClose: () => void;
}

/**
 * A small, non-modal popover for the 8 token-derived color swatches plus
 * the curated emoji row. Positioned `fixed` off the trigger's bounding
 * rect (computed once on open) rather than `absolute` inside the row, so
 * it isn't clipped by the rail's scrolling container. Closes on an outside
 * pointerdown or Escape — no focus trap; this is a lightweight picker, not
 * a full dialog.
 */
export function AccentPicker({ anchorRef, value, onChoose, onClose }: AccentPickerProps) {
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  /**
   * Flips above the trigger when there isn't room below, and clamps to the
   * viewport on every edge.
   *
   * The naive version — always `rect.bottom + 6` — is fine on the dashboard,
   * where the rail sits in a ~900px-tall window and there is always room. It
   * breaks in the extension popup: that window is only as tall as its content
   * (roughly 500px, and taller content just makes the trigger lower, not the
   * window bigger), and the ⋯ that opens this picker lives near the bottom. The
   * picker rendered past the popup's edge and was simply clipped — no scroll,
   * no visual cue, the emoji row just wasn't there.
   *
   * Measuring works because the popover is already in the DOM when this runs:
   * it renders with `visibility: hidden` until `pos` is set (see the style
   * below), so it has real dimensions but has not painted anywhere wrong yet.
   */
  useLayoutEffect(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const MARGIN = 8;
    const GAP = 6;
    const height = popRef.current?.offsetHeight ?? 0;
    const width = popRef.current?.offsetWidth ?? 208;

    const below = rect.bottom + GAP;
    const above = rect.top - GAP - height;
    // Prefer below (the conventional direction); flip only when it would
    // overflow AND flipping actually helps.
    const fitsBelow = below + height <= window.innerHeight - MARGIN;
    const top = fitsBelow ? below : Math.max(MARGIN, above);

    const left = Math.min(
      Math.max(MARGIN, rect.right - width),
      Math.max(MARGIN, window.innerWidth - width - MARGIN),
    );
    setPos({ top, left });
  }, [anchorRef]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (popRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [anchorRef, onClose]);

  return (
    <div
      ref={popRef}
      role="dialog"
      aria-label="Choose accent"
      style={{ position: "fixed", top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" }}
      className="z-50 flex w-52 flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] p-3 shadow-lg"
    >
      <div className="grid grid-cols-4 gap-2">
        {accentPalette().map((swatch) => (
          <button
            key={swatch.id}
            type="button"
            aria-label={`Accent: ${swatch.id}`}
            aria-pressed={value === swatch.value}
            onClick={() => onChoose(swatch.value)}
            className={`h-6 w-6 rounded-full border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
              value === swatch.value ? "ring-2 ring-[var(--accent)]" : "border-[var(--line)]"
            }`}
            style={{ backgroundColor: swatch.value }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        {ACCENT_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            aria-label={`Accent: ${emoji}`}
            aria-pressed={value === emoji}
            onClick={() => onChoose(emoji)}
            className={`flex h-7 w-7 items-center justify-center rounded-[6px] text-sm hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
              value === emoji ? "bg-[var(--surface-hover)]" : ""
            }`}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}

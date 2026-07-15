import { useEffect, useId, useRef } from "react";
import type { MouseEvent, ReactNode } from "react";
import { cx } from "../lib/cx";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
  /** Optional footer slot, typically action buttons. */
  footer?: ReactNode;
  className?: string;
}

/**
 * Wraps the native <dialog> element so we get free focus-trapping, Escape
 * handling, and a real ::backdrop from the browser instead of reimplementing
 * a modal. `data-tabburrow-dialog` scopes the ::backdrop rule in tokens.css
 * so it never leaks onto a host page's own <dialog> elements.
 */
export function Dialog({ open, onClose, title, children, footer, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // Sync the imperative <dialog> open state with the `open` prop.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // The native "close" event fires for Escape (cancel -> close), the close
  // button below, and backdrop clicks (handled via dialog.close() below) —
  // one listener covers every dismissal path and keeps the parent in sync.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleClose = () => onClose();
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [onClose]);

  const handleBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    // A click lands directly on the <dialog> element (not a descendant) only
    // when it hits the backdrop area outside the content box.
    if (event.target === ref.current) {
      ref.current?.close();
    }
  };

  return (
    <dialog
      ref={ref}
      data-tabburrow-dialog=""
      aria-labelledby={titleId}
      onClick={handleBackdropClick}
      className={cx(
        "w-full max-w-md rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] p-0 text-[var(--text)]",
        "backdrop:bg-transparent",
        className
      )}
      style={{ fontFamily: "var(--font-body)" }}
    >
      <div className="flex items-center justify-between gap-4 border-b border-[var(--line)] px-5 py-4">
        <h2
          id={titleId}
          className="text-base font-semibold"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {title}
        </h2>
        <button
          type="button"
          aria-label="Close"
          onClick={() => ref.current?.close()}
          className={cx(
            "shrink-0 leading-none text-[var(--text-2)] hover:text-[var(--text)]",
            "rounded-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          )}
        >
          ×
        </button>
      </div>
      <div className="px-5 py-4 text-sm">{children}</div>
      {footer ? (
        <div className="flex items-center justify-end gap-2 border-t border-[var(--line)] px-5 py-4">
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}

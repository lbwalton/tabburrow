import { useEffect, useRef } from "react";
import { cx } from "../lib/cx";

export interface ToastProps {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Auto-dismiss delay in ms. Default 6000. */
  durationMs?: number;
  /** Called when the toast should be removed, whether by timeout, action, or manual close. */
  onDismiss?: () => void;
  className?: string;
}

/**
 * A single toast notification (e.g. "Tab restored" with an Undo action).
 * The caller owns mount/unmount; this component just announces itself via
 * role="status" and calls onDismiss when its time is up.
 */
export function Toast({ message, actionLabel, onAction, durationMs = 6000, onDismiss, className }: ToastProps) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!durationMs || durationMs <= 0) return;
    const timer = window.setTimeout(() => {
      onDismissRef.current?.();
    }, durationMs);
    return () => window.clearTimeout(timer);
  }, [durationMs]);

  return (
    <div
      role="status"
      className={cx(
        "flex items-center gap-3 rounded-[var(--radius-card)] border border-[var(--line)]",
        "bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] shadow-lg",
        className
      )}
      style={{ fontFamily: "var(--font-body)" }}
    >
      <span className="flex-1">{message}</span>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className={cx(
            "shrink-0 font-semibold text-[var(--accent)] hover:brightness-110",
            "rounded-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          )}
        >
          {actionLabel}
        </button>
      ) : null}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => onDismiss?.()}
        className={cx(
          "shrink-0 leading-none text-[var(--text-2)] hover:text-[var(--text)]",
          "rounded-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        )}
      >
        ×
      </button>
    </div>
  );
}

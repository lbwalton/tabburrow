"use client";
// Uses hooks (useEffect/useRef), so Next.js App Router Server Component
// consumers need this directive or the whole @tabburrow/ui barrel fails to
// compile when imported anywhere in a server module graph. No-op for the
// Vite-based extension build.

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
  /**
   * When false, every USER-initiated dismissal path is disabled: Escape is
   * swallowed (the native `cancel` event is prevented), backdrop clicks are
   * ignored, and the × close button isn't rendered — the dialog can only
   * close via its owner flipping `open` to false. For flows that must stay
   * visibly present while an uncancelable action runs to completion (e.g.
   * ShareDialog's share-then-wait-for-sync), where letting the dialog
   * disappear would misread as the action having been called off. Default
   * true (fully dismissable, the behavior every pre-existing caller had).
   */
  dismissable?: boolean;
  className?: string;
}

/**
 * Wraps the native <dialog> element so we get free focus-trapping, Escape
 * handling, and a real ::backdrop from the browser instead of reimplementing
 * a modal. `data-tabburrow-dialog` scopes the ::backdrop rule in tokens.css
 * so it never leaks onto a host page's own <dialog> elements.
 */
export function Dialog({ open, onClose, title, children, footer, dismissable = true, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // Ref mirrors so the once-registered listeners below always read CURRENT
  // values without re-registering on every prop change.
  const dismissableRef = useRef(dismissable);
  dismissableRef.current = dismissable;
  const openRef = useRef(open);
  openRef.current = open;

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
  // The `cancel` listener is what makes `dismissable={false}` hold against
  // Escape: preventing the cancel event stops the browser from closing the
  // dialog at all, so no `close` ever fires and the modal stays up. One
  // known browser hole in that guard: some Chromium versions force-close on
  // a rapid SECOND Escape as an anti-abuse measure, skipping straight to
  // `close` — so the close handler ALSO checks: if the dialog is supposed
  // to be non-dismissable and the owner still wants it open, it re-opens
  // itself instead of notifying the owner. An owner-initiated close
  // (flipping `open` to false, which the sync effect above turns into
  // dialog.close()) is distinguished via `openRef` and always goes through.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleClose = () => {
      if (!dismissableRef.current && openRef.current) {
        dialog.showModal();
        return;
      }
      onClose();
    };
    const handleCancel = (event: Event) => {
      if (!dismissableRef.current) event.preventDefault();
    };
    dialog.addEventListener("close", handleClose);
    dialog.addEventListener("cancel", handleCancel);
    return () => {
      dialog.removeEventListener("close", handleClose);
      dialog.removeEventListener("cancel", handleCancel);
    };
  }, [onClose]);

  const handleBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    // A click lands directly on the <dialog> element (not a descendant) only
    // when it hits the backdrop area outside the content box.
    if (event.target === ref.current && dismissableRef.current) {
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
        {dismissable ? (
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
        ) : null}
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

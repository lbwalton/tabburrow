import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent, RefObject } from "react";
import { Button, Input } from "@tabburrow/ui";
import { parseTags } from "../../lib/links";

export interface EditLinkPatch {
  title: string;
  note: string | null;
  tags: string[];
}

export interface EditLinkPopoverProps {
  anchorRef: RefObject<HTMLButtonElement>;
  title: string;
  note: string | null;
  tags: string[];
  onSave: (patch: EditLinkPatch) => void;
  onClose: () => void;
}

/**
 * Per-card edit popover (title/note/tags), anchored off the pencil button
 * like `AccentPicker`, but built on the native `<dialog>` (as `Dialog.tsx`
 * is) rather than a plain positioned `<div>`: `showModal()` gives it a real
 * focus trap and Escape-to-cancel for free, and — since it's opened while
 * the pencil button still has focus — `close()` automatically returns focus
 * there per the `<dialog>` spec, satisfying "returns focus to the pencil"
 * without any manual focus bookkeeping.
 */
export function EditLinkPopover({ anchorRef, title, note, tags, onSave, onClose }: EditLinkPopoverProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftNote, setDraftNote] = useState(note ?? "");
  const [draftTags, setDraftTags] = useState(tags.join(", "));
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Position the popover so it stays fully inside the window, using the same
  // viewport-aware flip/clamp AccentPicker uses. This matters in the extension
  // POPUP, which is only as tall as its content (~500px): the naive "always
  // rect.bottom + 6" opened a lower row's editor straight off the bottom edge,
  // clipped with no scroll and no cue (issue #19). Measuring needs real
  // dimensions, so show the modal FIRST; it stays visibility:hidden until `pos`
  // is set (see the style below), so there is no flash at 0,0.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!dialog || !rect) return;
    if (!dialog.open) dialog.showModal();
    const MARGIN = 8;
    const GAP = 6;
    const height = dialog.offsetHeight;
    const width = dialog.offsetWidth || 288;
    const below = rect.bottom + GAP;
    const above = rect.top - GAP - height;
    // Prefer opening downward; flip up only when down would overflow and up fits better.
    const fitsBelow = below + height <= window.innerHeight - MARGIN;
    const top = fitsBelow ? below : Math.max(MARGIN, above);
    const left = Math.min(
      Math.max(MARGIN, rect.right - width),
      Math.max(MARGIN, window.innerWidth - width - MARGIN),
    );
    setPos({ top, left });
  }, [anchorRef]);

  useEffect(() => {
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, []);

  // The native "close" event fires for Escape (cancel -> close) and the
  // backdrop click below — covers every dismissal path that ISN'T Save.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => onClose();
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [onClose]);

  function handleBackdropClick(event: React.MouseEvent<HTMLDialogElement>) {
    if (event.target === dialogRef.current) dialogRef.current?.close();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = draftTitle.trim();
    onSave({
      title: trimmedTitle || title,
      note: draftNote.trim() || null,
      tags: parseTags(draftTags),
    });
    dialogRef.current?.close();
  }

  return (
    <dialog
      ref={dialogRef}
      data-tabburrow-dialog=""
      aria-label="Edit link"
      onClick={handleBackdropClick}
      style={{ position: "fixed", top: pos?.top ?? 0, left: pos?.left ?? 0, margin: 0, visibility: pos ? "visible" : "hidden" }}
      className="w-72 rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] p-3 text-[var(--text)] backdrop:bg-transparent"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-2" style={{ fontFamily: "var(--font-body)" }}>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-2)]">
          Title
          <Input ref={titleInputRef} value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-2)]">
          Note
          <Input value={draftNote} onChange={(e) => setDraftNote(e.target.value)} placeholder="Optional note" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-2)]">
          Tags
          <Input value={draftTags} onChange={(e) => setDraftTags(e.target.value)} placeholder="comma, separated" />
        </label>
        <div className="mt-1 flex justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => dialogRef.current?.close()}>
            Cancel
          </Button>
          <Button type="submit" size="sm">
            Save
          </Button>
        </div>
      </form>
    </dialog>
  );
}

import { useEffect, useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent } from "react";

export interface UseInlineRenameOptions {
  value: string;
  onCommit: (nextValue: string) => void;
}

/**
 * Shared double-click-to-rename interaction (collection rows + the main
 * header both use it): Enter commits, Escape cancels, blur commits.
 *
 * - An empty (post-trim) draft reverts silently instead of persisting a
 *   blank name.
 * - A draft that trims back to the original value also reverts without
 *   calling `onCommit` — avoids a needless write (renameCollection always
 *   bumps `updatedAt`, even when nothing actually changed).
 * - Enter's commit() also runs `setEditing(false)`, which removes the
 *   input from the DOM and can trigger a native blur on the way out;
 *   `committedRef` guards against that firing `onCommit` a second time.
 */
export function useInlineRename({ value, onCommit }: UseInlineRenameOptions) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const committedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  function start() {
    setDraft(value);
    committedRef.current = false;
    setEditing(true);
  }

  function commit() {
    if (committedRef.current) return;
    committedRef.current = true;
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onCommit(trimmed);
    setEditing(false);
  }

  function cancel() {
    committedRef.current = true;
    setEditing(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  }

  function handleBlur(_event: FocusEvent<HTMLInputElement>) {
    commit();
  }

  return {
    editing,
    draft,
    setDraft,
    start,
    inputRef,
    inputHandlers: { onKeyDown: handleKeyDown, onBlur: handleBlur },
  };
}

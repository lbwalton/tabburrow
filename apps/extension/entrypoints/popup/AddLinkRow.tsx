import { useEffect, useRef, useState } from "react";
import { getDB, isStorableLinkUrl, UNSUPPORTED_LINK_URL_MESSAGE } from "@tabburrow/core";
import { Button, Input } from "@tabburrow/ui";
import { addLinkToFolder } from "../../lib/folderActions";
import { sendSyncNudge } from "../../lib/sync-nudge";

export interface AddLinkRowProps {
  collectionId: string;
  onError?: (message: string) => void;
}

/**
 * Manual "add link" at the bottom of a folder: a "+ Add link" affordance that
 * expands to a URL field plus an optional title, saved via `addLinkToFolder`
 * (core `addLink`, which fills a hostname title when none is given). Stays open
 * after a successful add, clearing the fields so several links can be pasted in
 * a row.
 */
export function AddLinkRow({ collectionId, onError }: AddLinkRowProps) {
  const db = getDB();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  // Set only on a failed submit, never while typing: a URL field is
  // half-invalid on almost every keystroke, so live validation would nag.
  const [urlError, setUrlError] = useState<string | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) urlRef.current?.focus();
  }, [open]);

  async function handleAdd() {
    const trimmedUrl = url.trim();
    if (!trimmedUrl || busy) return;
    // Checked here as well as in `addLink` so the reason lands next to the
    // field being corrected, rather than as a toast over on the side. The
    // core throw is still the real gate — this is just where it's explained.
    if (!isStorableLinkUrl(trimmedUrl)) {
      setUrlError(UNSUPPORTED_LINK_URL_MESSAGE);
      urlRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      await addLinkToFolder(collectionId, { url: trimmedUrl, title: title.trim() || undefined }, db);
      sendSyncNudge();
      setUrl("");
      setTitle("");
      urlRef.current?.focus();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Could not add the link.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-7 flex items-center gap-2 rounded-[var(--radius-card)] px-2 py-1.5 text-left text-sm font-medium text-[var(--accent)] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        + Add link
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-[var(--radius-card)] border border-[var(--line)] p-2">
      <Input
        ref={urlRef}
        type="url"
        placeholder="https://…"
        value={url}
        onChange={(e) => {
          setUrl(e.target.value);
          setUrlError(null); // editing is the retry — clear the last verdict
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void handleAdd();
          }
        }}
        aria-label="Link URL"
        invalid={!!urlError}
        aria-describedby={urlError ? "add-link-url-error" : undefined}
        disabled={busy}
      />
      {urlError ? (
        <p id="add-link-url-error" role="alert" className="px-1 text-xs text-[var(--accent-2)]">
          {urlError}
        </p>
      ) : null}
      <Input
        type="text"
        placeholder="Title (optional)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void handleAdd();
          }
        }}
        aria-label="Link title (optional)"
        disabled={busy}
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void handleAdd()} disabled={busy || !url.trim()}>
          Add
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setUrl("");
            setTitle("");
            setUrlError(null);
          }}
          disabled={busy}
        >
          Done
        </Button>
      </div>
    </div>
  );
}

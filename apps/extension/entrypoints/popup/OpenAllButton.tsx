import { useState } from "react";
import { Button, Dialog } from "@tabburrow/ui";
import { needsRestoreConfirm, openFailureMessage, openLinks } from "../../lib/restore";

export interface OpenAllButtonProps {
  /** URLs to open (the folder's live links, in order). */
  urls: string[];
  /** Collection name, for the confirm dialog copy. */
  collectionName: string;
  onError?: (message: string) => void;
  /** Small square icon variant for the home rows; the header uses the default (labelled) variant. */
  compact?: boolean;
}

/**
 * Opens every link in a folder as background tabs, reusing `openLinks` +
 * `needsRestoreConfirm` from lib/restore (the same helpers the dashboard's
 * RestoreAllButton uses). Folders over the confirm threshold (15) get one
 * confirm Dialog first; at or under it, the click opens immediately. Shared by
 * FolderRow (compact icon) and FolderDetail's header.
 */
export function OpenAllButton({ urls, collectionName, onError, compact }: OpenAllButtonProps) {
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function openAll() {
    if (busy) return;
    setBusy(true);
    setConfirmOpen(false);
    try {
      const result = await openLinks(urls, {});
      if (result.failed > 0) onError?.(openFailureMessage(result.failed));
    } finally {
      setBusy(false);
    }
  }

  function handleClick() {
    if (urls.length === 0) return;
    if (needsRestoreConfirm(urls.length)) {
      setConfirmOpen(true);
    } else {
      void openAll();
    }
  }

  const label = `Open all ${urls.length} tabs in ${collectionName}`;

  return (
    <>
      {compact ? (
        <button
          type="button"
          aria-label={label}
          title="Open all"
          onClick={handleClick}
          disabled={busy || urls.length === 0}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-40"
        >
          {/* open-in-tabs glyph */}
          <span aria-hidden="true">&#8599;</span>
        </button>
      ) : (
        <Button type="button" size="sm" variant="ghost" onClick={handleClick} disabled={busy || urls.length === 0}>
          Open all
        </Button>
      )}

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={`Open ${urls.length} tabs?`}
        footer={
          <>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={() => void openAll()} disabled={busy}>
              Open {urls.length} tabs
            </Button>
          </>
        }
      >
        <p>
          {collectionName} has {urls.length} links. Opening them all will create {urls.length} new tabs.
        </p>
      </Dialog>
    </>
  );
}

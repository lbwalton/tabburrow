import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { SessionSnapshot } from "@tabburrow/core";
import { deleteSnapshot, getDB, listSnapshots, saveSnapshot } from "@tabburrow/core";
import { Button, Card, Dialog, EmptyState, Input } from "@tabburrow/ui";
import { captureAllWindows, relativeTime, restoreFailureMessage, restoreSnapshot, windowTabCountLabel } from "../../lib/sessions";
import { BurrowIllustration } from "./BurrowIllustration";

export interface SessionsPaneProps {
  onError: (message: string) => void;
}

/**
 * #/sessions: manual "Snapshot now" (with an optional inline name), a
 * Manual/Auto grouped list of every stored snapshot (newest first within
 * each group — `listSnapshots` already sorts that way), and per-row
 * Restore/Delete. Auto snapshots themselves are written by
 * `background.ts`'s alarm handler, not here — this pane only reads/manages
 * them plus offers the one manual capture path.
 *
 * Restoring never deletes the snapshot (`restoreSnapshot` in `lib/sessions.ts`
 * is purely additive). Deleting a manual snapshot confirms first (it took a
 * deliberate action to create); deleting an auto snapshot is immediate —
 * there are up to 10 of them and losing one is a non-event by design (the
 * alarm handler keeps making more).
 */
export function SessionsPane({ onError }: SessionsPaneProps) {
  const db = getDB();
  const snapshotsRaw = useLiveQuery(() => listSnapshots(db), [db]);
  const snapshots = snapshotsRaw ?? [];
  const loaded = snapshotsRaw !== undefined;

  const [name, setName] = useState("");
  const [snapshotting, setSnapshotting] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  async function handleSnapshotNow() {
    if (snapshotting) return;
    setSnapshotting(true);
    try {
      const windows = await captureAllWindows();
      await saveSnapshot("manual", windows, name.trim() || undefined, db);
      setName("");
    } catch {
      onError("Couldn't create the snapshot. Try again.");
    } finally {
      setSnapshotting(false);
    }
  }

  async function handleRestore(snapshot: SessionSnapshot) {
    if (restoringId) return;
    setRestoringId(snapshot.id);
    try {
      const result = await restoreSnapshot(snapshot.windows);
      if (result.failed > 0) onError(restoreFailureMessage(result.failed));
    } finally {
      setRestoringId(null);
    }
  }

  function handleDeleteClick(snapshot: SessionSnapshot) {
    if (snapshot.kind === "manual") {
      setPendingDeleteId(snapshot.id);
    } else {
      void deleteSnapshot(snapshot.id, db);
    }
  }

  function confirmDelete() {
    if (!pendingDeleteId) return;
    void deleteSnapshot(pendingDeleteId, db);
    setPendingDeleteId(null);
  }

  const manual = snapshots.filter((s) => s.kind === "manual");
  const auto = snapshots.filter((s) => s.kind === "auto");
  const deletingSnapshot = snapshots.find((s) => s.id === pendingDeleteId) ?? null;

  return (
    <div className="flex h-full flex-col px-8 py-8">
      <header className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-3xl font-bold text-[var(--text)]" style={{ fontFamily: "var(--font-display)" }}>
          Sessions
        </h1>
        <div className="flex items-center gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleSnapshotNow();
              }
            }}
            placeholder="Name (optional)"
            disabled={snapshotting}
            className="w-48"
            aria-label="Snapshot name"
          />
          <Button onClick={() => void handleSnapshotNow()} disabled={snapshotting}>
            Snapshot now
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!loaded ? null : snapshots.length === 0 ? (
          <EmptyState
            title="No snapshots yet"
            description="TabBurrow automatically snapshots your open windows every 5 minutes, so you can always get back to where you were. Snapshot now to capture this moment manually."
            illustration={<BurrowIllustration />}
          />
        ) : (
          <div className="flex flex-col gap-6">
            {manual.length > 0 ? (
              <SnapshotGroup
                label="Manual"
                snapshots={manual}
                restoringId={restoringId}
                onRestore={handleRestore}
                onDelete={handleDeleteClick}
              />
            ) : null}
            {auto.length > 0 ? (
              <SnapshotGroup
                label="Auto"
                snapshots={auto}
                restoringId={restoringId}
                onRestore={handleRestore}
                onDelete={handleDeleteClick}
              />
            ) : null}
          </div>
        )}
      </div>

      <Dialog
        open={pendingDeleteId !== null}
        onClose={() => setPendingDeleteId(null)}
        title="Delete snapshot?"
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={() => setPendingDeleteId(null)}>
              Cancel
            </Button>
            <Button size="sm" variant="danger" onClick={confirmDelete}>
              Delete
            </Button>
          </>
        }
      >
        <p>
          {deletingSnapshot?.name ? `"${deletingSnapshot.name}"` : "This snapshot"} will be permanently deleted. This
          can't be undone.
        </p>
      </Dialog>
    </div>
  );
}

interface SnapshotGroupProps {
  label: string;
  snapshots: SessionSnapshot[];
  restoringId: string | null;
  onRestore: (snapshot: SessionSnapshot) => void;
  onDelete: (snapshot: SessionSnapshot) => void;
}

function SnapshotGroup({ label, snapshots, restoringId, onRestore, onDelete }: SnapshotGroupProps) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-2)]">{label}</h2>
      <ul className="flex flex-col gap-2">
        {snapshots.map((snapshot) => (
          <SnapshotRow
            key={snapshot.id}
            snapshot={snapshot}
            busy={restoringId === snapshot.id}
            onRestore={() => onRestore(snapshot)}
            onDelete={() => onDelete(snapshot)}
          />
        ))}
      </ul>
    </section>
  );
}

interface SnapshotRowProps {
  snapshot: SessionSnapshot;
  busy: boolean;
  onRestore: () => void;
  onDelete: () => void;
}

function SnapshotRow({ snapshot, busy, onRestore, onDelete }: SnapshotRowProps) {
  return (
    <Card variant="surface" arch={false} className="flex items-center justify-between gap-3 p-4">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-[var(--text)]">
          {snapshot.kind === "manual" ? snapshot.name ?? "Untitled snapshot" : "Auto snapshot"}
        </p>
        <p className="mt-0.5 text-xs text-[var(--text-2)]" style={{ fontFamily: "var(--font-mono)" }}>
          {windowTabCountLabel(snapshot.windows)} · {relativeTime(snapshot.createdAt, Date.now())}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onRestore} disabled={busy}>
          Restore
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete} disabled={busy}>
          Delete
        </Button>
      </div>
    </Card>
  );
}

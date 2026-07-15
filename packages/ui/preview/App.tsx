import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Input,
  Kbd,
  Toast,
} from "../src/index";

function ThemeShowcase({ theme, label }: { theme: "dark" | "paper"; label: string }) {
  const [toastOpen, setToastOpen] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div
      data-theme={theme === "paper" ? "paper" : undefined}
      className="flex min-h-full flex-1 flex-col gap-6 p-8"
      style={{ background: "var(--bg-ground)", color: "var(--text)" }}
    >
      <div>
        <p
          className="text-xs uppercase tracking-wide text-[var(--accent-2)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {label}
        </p>
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
          TabBurrow UI
        </h1>
      </div>

      {/* Buttons */}
      <section className="flex flex-wrap items-center gap-3">
        <Button variant="primary">Save all tabs</Button>
        <Button variant="ghost">Cancel</Button>
        <Button variant="danger" size="sm" onClick={() => setDialogOpen(true)}>
          Delete collection
        </Button>
      </section>

      {/* Input + Kbd */}
      <section className="flex max-w-sm items-center gap-2">
        <Input placeholder="Search tabs and collections…" />
        <Kbd>⌘K</Kbd>
      </section>

      {/* Badges */}
      <section className="flex flex-wrap items-center gap-2">
        <Badge variant="accent">12 tabs</Badge>
        <Badge variant="accent-2">New</Badge>
        <Badge variant="muted">Archived</Badge>
      </section>

      {/* Card */}
      <section className="max-w-sm">
        <Card variant={theme === "paper" ? "paper" : "surface"}>
          <div className="flex items-center justify-between">
            <h3 className="font-semibold" style={{ fontFamily: "var(--font-display)" }}>
              Reading list
            </h3>
            <Badge variant="accent">7</Badge>
          </div>
          <p
            className="mt-1 text-sm"
            style={{
              color: theme === "paper" ? "var(--ink-soft, var(--text-2))" : "var(--text-2)",
              fontFamily: "var(--font-mono)",
            }}
          >
            longform.example.com · saved 2h ago
          </p>
        </Card>
      </section>

      {/* EmptyState */}
      <section className="max-w-sm">
        <Card variant={theme === "paper" ? "paper" : "surface"} arch={false}>
          <EmptyState
            title="No tabs saved yet"
            description="Save your open tabs to start a collection you can find later."
            action={<Button variant="primary">Save all tabs</Button>}
          />
        </Card>
      </section>

      {/* Toast */}
      <section className="max-w-sm">
        {toastOpen ? (
          <Toast
            message="5 tabs saved"
            actionLabel="Undo"
            onAction={() => setToastOpen(false)}
            onDismiss={() => setToastOpen(false)}
          />
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setToastOpen(true)}>
            Show toast again
          </Button>
        )}
      </section>

      {/* Dialog */}
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title='Delete "Reading list"?'
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => setDialogOpen(false)}>
              Delete
            </Button>
          </>
        }
      >
        This removes the collection and its 7 saved tabs. You can undo from the toast for a few
        seconds after deleting.
      </Dialog>
    </div>
  );
}

export function App() {
  return (
    <div className="flex min-h-screen w-full flex-col md:flex-row">
      <ThemeShowcase theme="dark" label="Dark shell (default)" />
      <ThemeShowcase theme="paper" label='Paper theme (data-theme="paper")' />
    </div>
  );
}

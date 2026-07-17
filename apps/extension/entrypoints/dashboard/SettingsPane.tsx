import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { BurrowDB } from "@tabburrow/core";
import { getDB, getMeta, listCollections, listSnapshots, setMeta } from "@tabburrow/core";
import { Button, Card, Kbd, Toast } from "@tabburrow/ui";
import { downloadBlob, exportFilename, exportJson, formatDataStats } from "../../lib/exporter";
import {
  formatImportResult,
  importBurrowJson,
  importChromeBookmarksHtml,
  importTobyJson,
} from "../../lib/importers";
import type { ImportCounts } from "../../lib/importers";
import { applyTheme, parseTheme, THEME_META_KEY } from "../../lib/theme";
import type { Theme } from "../../lib/theme";
import {
  DEFAULT_COLLECTION_META_KEY,
  parseSaveTargetMode,
  SAVE_TARGET_MODE_META_KEY,
} from "../../lib/saveTarget";
import type { SaveTargetMode } from "../../lib/saveTarget";
import { AccountPane } from "./AccountPane";

// The manifest's three commands (wxt.config.ts) — chrome.commands.getAll()
// also returns a synthetic "_execute_action" entry when a default_popup is
// declared; filtering to this known set keeps that out of the list.
const SHORTCUT_COMMAND_NAMES = ["save-current-tab", "save-all-tabs", "open-dashboard"];

const THEME_OPTIONS: Theme[] = ["dark", "paper"];

const SAVE_MODE_OPTIONS: Array<{ value: SaveTargetMode; label: string }> = [
  { value: "default", label: "Save to a default folder" },
  { value: "last-used", label: "Save to the last folder I used" },
  { value: "ask", label: "Ask me each time" },
];

interface ImportSource {
  key: string;
  label: string;
  accept: string;
  run: (text: string, db: BurrowDB) => Promise<ImportCounts>;
}

const IMPORT_SOURCES: ImportSource[] = [
  { key: "bookmarks", label: "Chrome bookmarks", accept: ".html,text/html", run: importChromeBookmarksHtml },
  { key: "toby", label: "Toby JSON", accept: ".json,application/json", run: importTobyJson },
  { key: "burrow", label: "TabBurrow export", accept: ".json,application/json", run: importBurrowJson },
];

/**
 * #/settings: Appearance (theme toggle), Shortcuts (read-only, plus a link
 * to Chrome's own shortcuts page), and Data (live stats + export/import).
 *
 * Self-contained rather than threading callbacks through DashboardMain/App:
 * its own toast covers both success ("Imported 3 collections…") and error
 * messages, which App's existing `onLinkError` channel (error-only) isn't
 * shaped for — same "own its local UI state" precedent SessionsPane already
 * set for its delete-confirmation Dialog.
 */
export function SettingsPane() {
  const db = getDB();

  // --- Appearance ---
  const themeRaw = useLiveQuery(() => getMeta(THEME_META_KEY, db), [db]);
  const theme = parseTheme(themeRaw ?? null);

  function handleThemeChange(next: Theme) {
    if (next === theme) return;
    applyTheme(next); // instant for this tab; other open tabs/popups pick it up on their own next mount
    void setMeta(THEME_META_KEY, next, db);
  }

  // --- Save behavior --- (drives the popup's one-click Save; see lib/saveTarget.ts)
  const saveModeRaw = useLiveQuery(() => getMeta(SAVE_TARGET_MODE_META_KEY, db), [db]);
  const saveMode = parseSaveTargetMode(saveModeRaw ?? null);
  const defaultCollectionId = useLiveQuery(() => getMeta(DEFAULT_COLLECTION_META_KEY, db), [db]) ?? null;

  function handleSaveModeChange(next: SaveTargetMode) {
    if (next === saveMode) return;
    void setMeta(SAVE_TARGET_MODE_META_KEY, next, db);
  }

  function handleDefaultCollectionChange(id: string) {
    if (!id) return;
    void setMeta(DEFAULT_COLLECTION_META_KEY, id, db);
  }

  // --- Shortcuts ---
  const [shortcuts, setShortcuts] = useState<chrome.commands.Command[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void chrome.commands.getAll().then((commands) => {
      if (!cancelled) setShortcuts(commands);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const shownShortcuts = (shortcuts ?? []).filter(
    (c): c is chrome.commands.Command & { name: string } => !!c.name && SHORTCUT_COMMAND_NAMES.includes(c.name),
  );

  function openShortcutsPage() {
    chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  }

  // --- Data stats --- (own live queries, same "just scan the whole table"
  // precedent App.tsx's crash-banner comment already sets for a self-
  // contained pane, rather than threading App's already-fetched data down).
  const collectionsRaw = useLiveQuery(() => listCollections(db), [db]);
  const linksRaw = useLiveQuery(() => db.links.toArray(), [db]);
  const sessionsRaw = useLiveQuery(() => listSnapshots(db), [db]);
  const statsLoaded = collectionsRaw !== undefined && linksRaw !== undefined && sessionsRaw !== undefined;
  const liveLinkCount = (linksRaw ?? []).filter((l) => l.deletedAt === null).length;
  const statsLine = statsLoaded ? formatDataStats(collectionsRaw!.length, liveLinkCount, sessionsRaw!.length) : "";

  // --- Export / import ---
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ key: number; message: string } | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  function showToast(message: string) {
    setToast({ key: Date.now(), message });
  }

  async function handleExport() {
    if (busy) return;
    setBusy(true);
    try {
      const blob = await exportJson(db);
      downloadBlob(blob, exportFilename(Date.now()));
    } catch {
      showToast("Couldn't export your data. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleImportFile(source: ImportSource, input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = ""; // allow re-selecting the exact same file next time
    if (!file || busy) return;
    setBusy(true);
    try {
      const text = await file.text();
      const result = await source.run(text, db);
      showToast(formatImportResult(source.label, result));
    } catch (err) {
      showToast(err instanceof Error ? err.message : `Couldn't import ${source.label}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto px-8 py-8">
      <h1 className="text-3xl font-bold text-[var(--text)]" style={{ fontFamily: "var(--font-display)" }}>
        Settings
      </h1>

      <AccountPane />

      <Card variant="surface" arch={false} className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-[var(--text)]">Appearance</h2>
        <div
          role="radiogroup"
          aria-label="Theme"
          className="inline-flex w-fit items-center gap-0.5 rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--bg-ground)] p-0.5"
        >
          {THEME_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={theme === option}
              onClick={() => handleThemeChange(option)}
              className={`rounded-[6px] px-3 py-1.5 text-sm font-medium capitalize transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                theme === option
                  ? "bg-[var(--accent)] text-[var(--btn-fg)]"
                  : "text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </Card>

      <Card variant="surface" arch={false} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold text-[var(--text)]">When you click Save</h2>
          <p className="text-xs text-[var(--text-2)]">
            Choose where a one-click Save in the popup puts the current tab.
          </p>
        </div>
        <div role="radiogroup" aria-label="When you click Save" className="flex flex-col gap-1.5">
          {SAVE_MODE_OPTIONS.map((option) => {
            const checked = saveMode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => handleSaveModeChange(option.value)}
                className={`flex items-center gap-2.5 rounded-[var(--radius-card)] border px-3 py-2 text-left text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                  checked
                    ? "border-[var(--accent)] bg-[var(--surface-hover)] text-[var(--text)]"
                    : "border-[var(--line)] text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    checked ? "border-[var(--accent)]" : "border-[var(--line)]"
                  }`}
                >
                  {checked ? <span className="h-2 w-2 rounded-full bg-[var(--accent)]" /> : null}
                </span>
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
        {saveMode === "default" ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="default-folder-select" className="text-xs font-medium text-[var(--text-2)]">
              Default folder
            </label>
            {collectionsRaw && collectionsRaw.length === 0 ? (
              <p className="text-xs text-[var(--text-2)]">Create a folder first, then pick it here.</p>
            ) : (
              <select
                id="default-folder-select"
                value={defaultCollectionId ?? ""}
                onChange={(e) => handleDefaultCollectionChange(e.target.value)}
                className="w-fit rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--bg-ground)] px-3 py-2 text-sm text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                <option value="" disabled>
                  Choose a folder…
                </option>
                {(collectionsRaw ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            <p className="text-xs text-[var(--text-2)]">
              Leave this unset and the first save will ask you to pick a folder, then pin it as your default.
            </p>
          </div>
        ) : null}
      </Card>

      <Card variant="surface" arch={false} className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-[var(--text)]">Shortcuts</h2>
        <ul className="flex flex-col gap-2">
          {shownShortcuts.map((c) => (
            <li key={c.name} className="flex items-center justify-between gap-3 text-sm text-[var(--text)]">
              <span>{c.description || c.name}</span>
              <Kbd>{c.shortcut || "Not set"}</Kbd>
            </li>
          ))}
        </ul>
        <Button variant="ghost" size="sm" className="w-fit" onClick={openShortcutsPage}>
          Change shortcuts
        </Button>
      </Card>

      <Card variant="surface" arch={false} className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-[var(--text)]">Data</h2>
        <p className="text-xs text-[var(--text-2)]" style={{ fontFamily: "var(--font-mono)" }}>
          {statsLine}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => void handleExport()} disabled={busy}>
            Export
          </Button>
          {IMPORT_SOURCES.map((source) => (
            <Button
              key={source.key}
              variant="ghost"
              size="sm"
              onClick={() => fileInputRefs.current[source.key]?.click()}
              disabled={busy}
            >
              Import {source.label}
            </Button>
          ))}
        </div>
        {IMPORT_SOURCES.map((source) => (
          <input
            key={source.key}
            ref={(el) => {
              fileInputRefs.current[source.key] = el;
            }}
            type="file"
            accept={source.accept}
            className="hidden"
            onChange={(e) => void handleImportFile(source, e.currentTarget)}
          />
        ))}
      </Card>

      {toast ? (
        <div className="fixed bottom-6 right-6 z-50">
          <Toast key={toast.key} message={toast.message} durationMs={5000} onDismiss={() => setToast(null)} />
        </div>
      ) : null}
    </div>
  );
}

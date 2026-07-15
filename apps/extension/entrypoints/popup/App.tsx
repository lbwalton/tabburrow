import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Collection, TabInfo } from "@tabburrow/core";
import { createCollection, getDB, getMeta, listCollections, saveTabs, setMeta } from "@tabburrow/core";
import { Button, Kbd } from "@tabburrow/ui";
import { closeTabsByUrl, faviconFor, getAllTabs, getCurrentTab, getHighlightedTabs } from "../../lib/tabs";
import { initialPopupState, popupReducer } from "../../lib/popupState";
import type { PopupState, SaveAction } from "../../lib/popupState";
import { SaveBar } from "./SaveBar";
import { CollectionPicker } from "./CollectionPicker";
import { RecentList } from "./RecentList";

const LAST_USED_KEY = "lastUsedCollectionId";

function openDashboard() {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
}

function tabsForAction(
  action: SaveAction,
  allTabs: TabInfo[] | null,
  selectedTabs: TabInfo[] | null,
): Promise<TabInfo[]> {
  if (action === "current") return getCurrentTab().then((tab) => [tab]);
  if (action === "all") return allTabs ? Promise.resolve(allTabs) : getAllTabs();
  return selectedTabs ? Promise.resolve(selectedTabs) : getHighlightedTabs();
}

export function App() {
  const db = getDB();
  const collections = useLiveQuery(() => listCollections(db), []);

  const [state, dispatch] = useReducer(popupReducer, undefined, initialPopupState);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [targetLoaded, setTargetLoaded] = useState(false);
  const [allTabs, setAllTabs] = useState<TabInfo[] | null>(null);
  const [selectedTabs, setSelectedTabs] = useState<TabInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Snapshot the current window's tabs + last-used target once, on open. The
  // popup is a fresh document every time it opens, so a one-shot fetch is
  // sufficient (no live tab-change subscription needed).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [all, selected, lastUsed] = await Promise.all([
        getAllTabs(),
        getHighlightedTabs(),
        getMeta(LAST_USED_KEY, db),
      ]);
      if (cancelled) return;
      setAllTabs(all);
      setSelectedTabs(selected);
      setTargetId(lastUsed);
      setTargetLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [db]);

  // Auto-reset the confirmation back to idle after 6s.
  useEffect(() => {
    if (state.view !== "confirm") return;
    const timer = window.setTimeout(() => dispatch({ type: "RESET" }), 6000);
    return () => window.clearTimeout(timer);
  }, [state.view]);

  // Focus restoration: leaving the picker back to idle (Escape or a
  // resolved selection) must put keyboard focus back on the "Change" target
  // button that opened it, so the keyboard-only flow stays continuous
  // (Tab to Change -> Enter -> picker -> Escape -> back on Change).
  const changeTargetRef = useRef<HTMLButtonElement>(null);
  const prevViewRef = useRef<PopupState["view"]>(state.view);
  useEffect(() => {
    const prevView = prevViewRef.current;
    prevViewRef.current = state.view;
    if (prevView === "picker" && state.view === "idle") {
      changeTargetRef.current?.focus();
    }
  }, [state.view]);

  // useLiveQuery resolves asynchronously (starts `undefined`); until its
  // first emission lands, `target` below can't be trusted — without this,
  // a warm popup (valid lastUsedCollectionId) could momentarily look cold
  // if the meta fetch happens to resolve before the live query does, and
  // a click in that window would wrongly send the user to the picker.
  const collectionsLoaded = collections !== undefined;
  const dataLoaded = targetLoaded && collectionsLoaded;
  const target = targetId ? collections?.find((c) => c.id === targetId) ?? null : null;
  const hasTarget = dataLoaded && target !== null;

  const performSave = useCallback(
    async (action: SaveAction, collection: Collection) => {
      setBusy(true);
      setActionError(null);
      try {
        const tabs = await tabsForAction(action, allTabs, selectedTabs);
        if (tabs.length === 0) {
          setActionError("No tabs to save (only http/https pages count).");
          return;
        }
        const withFavicons = tabs.map((t) => ({ ...t, faviconUrl: faviconFor(t.url) }));
        await saveTabs(collection.id, withFavicons, db);
        await setMeta(LAST_USED_KEY, collection.id, db);
        setTargetId(collection.id);
        dispatch({
          type: "SAVE_SUCCESS",
          action,
          count: withFavicons.length,
          collectionName: collection.name,
          savedUrls: withFavicons.map((t) => t.url),
        });
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Could not save tabs.");
      } finally {
        setBusy(false);
      }
    },
    [allTabs, selectedTabs, db],
  );

  function handleSaveClick(action: SaveAction) {
    setActionError(null);
    if (hasTarget && target) {
      dispatch({ type: "SAVE_CLICK", action, hasTarget: true });
      void performSave(action, target);
    } else {
      dispatch({ type: "SAVE_CLICK", action, hasTarget: false });
    }
  }

  /** Shared tail of both picker resolutions: remember the target, close the picker, fire any pending save. */
  async function resolvePickerWith(collection: Collection, pendingAction: SaveAction | null) {
    setTargetId(collection.id);
    await setMeta(LAST_USED_KEY, collection.id, db);
    dispatch({ type: "PICKER_RESOLVED" });
    if (pendingAction) void performSave(pendingAction, collection);
  }

  async function handlePickerSelect(collection: Collection) {
    // Double-select guard: the first click sets `resolving`; App re-renders
    // before the next click is processed (React discrete-event flushing), so
    // a rapid second click on a DIFFERENT row hits this guard and is ignored
    // instead of firing performSave twice into two collections.
    if (state.view !== "picker" || state.resolving !== null) return;
    const pendingAction = state.pendingAction;
    dispatch({ type: "PICKER_SELECT", collectionId: collection.id });
    await resolvePickerWith(collection, pendingAction);
  }

  async function handlePickerCreate(name: string): Promise<Collection> {
    // Same guard for the create path (CollectionPicker also gates on `busy`).
    if (state.view !== "picker" || state.resolving !== null) {
      throw new Error("Another choice is already being saved.");
    }
    const pendingAction = state.pendingAction;
    dispatch({ type: "PICKER_CREATE_START" });
    let created: Collection;
    try {
      created = await createCollection(name, undefined, db);
    } catch (err) {
      // Clear the resolving flag so the user can fix the name and retry.
      dispatch({ type: "PICKER_CREATE_FAILED" });
      throw err;
    }
    await resolvePickerWith(created, pendingAction);
    return created;
  }

  async function handleCloseSavedTabs() {
    if (state.view !== "confirm" || busy) return;
    setBusy(true);
    try {
      await closeTabsByUrl(state.savedUrls);
      dispatch({ type: "RESET" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="flex w-[360px] flex-col gap-4 bg-[var(--bg-ground)] px-4 py-4"
      style={{ minHeight: 420 }}
    >
      <header>
        <h1
          className="text-lg font-bold text-[var(--text)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          TabBurrow
        </h1>
      </header>

      {state.view === "confirm" ? (
        // Toast's visual language (tokens, spacing, role="status"), rendered
        // inline in normal document flow rather than the floating <Toast>
        // component itself — Toast only offers a single action slot and this
        // state needs two (Close saved tabs / Done).
        <div
          role="status"
          className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] px-4 py-3 shadow-lg"
        >
          <p className="text-sm text-[var(--text)]">
            <span className="text-[var(--accent)]">&#10003;</span> Saved {state.count}{" "}
            {state.count === 1 ? "tab" : "tabs"} to {state.collectionName}
          </p>
          <div className="flex gap-2">
            {state.action === "all" ? (
              <Button
                variant="danger"
                size="sm"
                onClick={() => void handleCloseSavedTabs()}
                disabled={busy}
              >
                Close saved tabs
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => dispatch({ type: "RESET" })}
              disabled={busy}
            >
              Done
            </Button>
          </div>
        </div>
      ) : state.view === "picker" ? (
        <CollectionPicker
          collections={collections ?? []}
          onSelect={(c) => void handlePickerSelect(c)}
          onCreate={handlePickerCreate}
          onCancel={() => dispatch({ type: "ESCAPE" })}
          busy={state.resolving !== null}
        />
      ) : (
        <>
          <SaveBar
            onSaveCurrent={() => handleSaveClick("current")}
            onSaveAll={() => handleSaveClick("all")}
            onSaveSelected={() => handleSaveClick("selected")}
            allCount={allTabs?.length ?? 0}
            showSelected={(selectedTabs?.length ?? 0) >= 2}
            disabled={busy || !dataLoaded}
          />

          <div className="flex items-center justify-between gap-2 text-sm text-[var(--text-2)]">
            <span className="truncate">
              Saving to:{" "}
              <span className="text-[var(--text)]">{target ? target.name : "Choose a collection"}</span>
            </span>
            <Button
              ref={changeTargetRef}
              size="sm"
              variant="ghost"
              onClick={() => dispatch({ type: "CHANGE_TARGET_CLICK" })}
              disabled={busy || !collectionsLoaded}
            >
              Change
            </Button>
          </div>

          {actionError ? <p className="text-xs text-[var(--accent-2)]">{actionError}</p> : null}

          <RecentList collections={collections ?? []} />
        </>
      )}

      <footer className="mt-auto flex items-center justify-between border-t border-[var(--line)] pt-3">
        <Button variant="ghost" size="sm" onClick={openDashboard}>
          Open dashboard
        </Button>
        <span className="flex items-center gap-1 text-xs text-[var(--text-2)]">
          <Kbd>Enter</Kbd>
          <span>save</span>
          {/* Esc only does anything while the picker is open — only advertise it then. */}
          {state.view === "picker" ? (
            <>
              <Kbd>Esc</Kbd>
              <span>back</span>
            </>
          ) : null}
        </span>
      </footer>
    </div>
  );
}

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Collection, Link, TabInfo } from "@tabburrow/core";
import { createCollection, getDB, getMeta, listCollections, renameCollection, saveTabs, setMeta } from "@tabburrow/core";
import { Badge, Button } from "@tabburrow/ui";
import { closeTabsByUrl, faviconFor, getAllTabs, getCurrentTab, getHighlightedTabs } from "../../lib/tabs";
import { addTabToFolder } from "../../lib/folderActions";
import { initialPopupState, popupReducer } from "../../lib/popupState";
import type { PopupState, SaveAction } from "../../lib/popupState";
import { dashboardCollectionOrganizeUrl, dashboardSettingsUrl } from "../../lib/dashboard";
import { getPlan, onAuthChange } from "../../lib/auth";
import type { AuthUser, Plan } from "../../lib/auth";
import { proBadgeState } from "../../lib/proBadge";
import { isSupabaseConfigured } from "../../lib/supabase";
import { aiOrganizeCtaAvailable, getAiUsesThisMonth, suggestFolderName } from "../../lib/ai";
import {
  DEFAULT_COLLECTION_META_KEY,
  parseSaveTargetMode,
  resolveSaveTarget,
  SAVE_TARGET_MODE_META_KEY,
} from "../../lib/saveTarget";
import type { SaveTargetMode } from "../../lib/saveTarget";
import { sendSyncNudge } from "../../lib/sync-nudge";
import {
  isPendingCommandFresh,
  LAST_USED_COLLECTION_META_KEY,
  parsePendingCommandFlag,
  PENDING_COMMAND_CLEAR,
  PENDING_COMMAND_META_KEY,
  PENDING_COMMAND_SAVE_ALL,
} from "../../lib/commands";
import { applyTheme, parseTheme, THEME_META_KEY } from "../../lib/theme";
import { CollectionPicker } from "./CollectionPicker";
import { FoldersHome } from "./FoldersHome";
import { FolderDetail } from "./FolderDetail";

const LAST_USED_KEY = LAST_USED_COLLECTION_META_KEY;
/** Placeholder name a "New folder (named by AI)" save creates before the best-effort AI rename lands. */
const AI_FOLDER_PLACEHOLDER = "New folder";

function openDashboard() {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
}

function openDashboardSettings() {
  chrome.tabs.create({ url: dashboardSettingsUrl() });
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

/** home ↔ folderDetail is the only pair that gets the "dig in / climb out" slide. */
function isNavView(view: PopupState["view"]): boolean {
  return view === "home" || view === "folderDetail";
}

export function App() {
  const db = getDB();
  const collections = useLiveQuery(() => listCollections(db), []);

  const [state, dispatch] = useReducer(popupReducer, undefined, initialPopupState);
  // The three inputs to `resolveSaveTarget`: the persisted "how to pick a
  // folder" mode, the pinned default folder id, and the last folder saved
  // into. All loaded once on mount (fresh popup document every open).
  const [saveMode, setSaveMode] = useState<SaveTargetMode>("default");
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [lastUsedId, setLastUsedId] = useState<string | null>(null);
  const [targetLoaded, setTargetLoaded] = useState(false);
  const [allTabs, setAllTabs] = useState<TabInfo[] | null>(null);
  const [selectedTabs, setSelectedTabs] = useState<TabInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Set true just before opening the picker for "Change default folder…" so
  // its resolution pins the default even in last-used/ask mode (where the mode
  // check below wouldn't). Read + cleared in resolvePickerWith.
  const pinDefaultRef = useRef(false);
  // Alt+Shift+A's "save all" shortcut can't reproduce the picker/confirm UX
  // from the background service worker, so it sets this meta flag and opens
  // the popup instead — read once on mount below, replayed once collections
  // are loaded (see the effect after handleSaveClick).
  const [pendingSaveAll, setPendingSaveAll] = useState(false);

  // Applies the persisted theme on mount — same convention the dashboard's
  // App.tsx follows (see lib/theme.ts's docstring); a fresh popup document
  // every open means "on mount" is the only time this needs to run.
  useEffect(() => {
    void getMeta(THEME_META_KEY, db).then((value) => applyTheme(parseTheme(value)));
  }, [db]);

  // Footer account state (T16): "Sign in" link when signed out, a plan Badge
  // when signed in, nothing when cloud isn't configured. All state via
  // onAuthChange, no polling — same precedent as AccountPane.
  const cloudConfigured = isSupabaseConfigured();
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  useEffect(() => {
    if (!cloudConfigured) return;
    const unsubscribe = onAuthChange(setAuthUser);
    return unsubscribe;
  }, [cloudConfigured]);
  useEffect(() => {
    if (!authUser) {
      setPlan(null);
      return;
    }
    let cancelled = false;
    void getPlan().then((p) => {
      if (!cancelled) setPlan(p);
    });
    return () => {
      cancelled = true;
    };
  }, [authUser]);

  // T20 "Save all + organize" gate — see lib/ai.ts's aiOrganizeCtaAvailable.
  const [aiUsesThisMonth, setAiUsesThisMonth] = useState(0);
  useEffect(() => {
    if (!authUser) {
      setAiUsesThisMonth(0);
      return;
    }
    let cancelled = false;
    void getAiUsesThisMonth(authUser.id, db).then((n) => {
      if (!cancelled) setAiUsesThisMonth(n);
    });
    return () => {
      cancelled = true;
    };
  }, [authUser, db]);

  // Snapshot the current window's tabs + last-used target once, on open. The
  // popup is a fresh document every time it opens, so a one-shot fetch is
  // sufficient. Also reads (and immediately clears) the "save-all"
  // pending-command flag background.ts's Alt+Shift+A handler may have left.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [all, selected, lastUsed, modeRaw, defaultRaw, pendingCommandRaw] = await Promise.all([
        getAllTabs(),
        getHighlightedTabs(),
        getMeta(LAST_USED_KEY, db),
        getMeta(SAVE_TARGET_MODE_META_KEY, db),
        getMeta(DEFAULT_COLLECTION_META_KEY, db),
        getMeta(PENDING_COMMAND_META_KEY, db),
      ]);
      if (cancelled) return;
      const pendingFlag = parsePendingCommandFlag(pendingCommandRaw);
      if (pendingFlag) {
        void setMeta(PENDING_COMMAND_META_KEY, PENDING_COMMAND_CLEAR, db);
        if (pendingFlag.command === PENDING_COMMAND_SAVE_ALL && isPendingCommandFresh(pendingFlag.ts, Date.now())) {
          setPendingSaveAll(true);
        }
      }
      setAllTabs(all);
      setSelectedTabs(selected);
      setLastUsedId(lastUsed);
      setSaveMode(parseSaveTargetMode(modeRaw));
      setDefaultId(defaultRaw);
      setTargetLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [db]);

  // Auto-reset the confirmation back to home after 6s.
  useEffect(() => {
    if (state.view !== "confirm") return;
    const timer = window.setTimeout(() => dispatch({ type: "RESET" }), 6000);
    return () => window.clearTimeout(timer);
  }, [state.view]);

  // The horizontal "dig in / climb out" slide between home and folderDetail
  // (transform via WAAPI, no stylesheet needed). prefers-reduced-motion
  // downgrades to a short cross-fade.
  const screenRef = useRef<HTMLDivElement>(null);
  const prevViewRef = useRef<PopupState["view"]>(state.view);
  useEffect(() => {
    const prev = prevViewRef.current;
    prevViewRef.current = state.view;
    // Focus restoration: leaving the picker back to home puts focus somewhere
    // sane inside home (its first focusable) rather than dropping to <body>.
    const el = screenRef.current;
    if (!el) return;
    if (!isNavView(prev) || !isNavView(state.view) || prev === state.view) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (reduce) {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: "ease" });
      return;
    }
    const from = state.view === "folderDetail" ? "24px" : "-24px";
    el.animate(
      [
        { transform: `translateX(${from})`, opacity: 0 },
        { transform: "translateX(0)", opacity: 1 },
      ],
      { duration: 180, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" },
    );
  }, [state.view]);

  const collectionsLoaded = collections !== undefined;
  const dataLoaded = targetLoaded && collectionsLoaded;
  // The one-click Save target, resolved from the persisted preference against
  // the LIVE collections (a pinned id pointing at a deleted folder resolves to
  // needsPicker — see resolveSaveTarget).
  const resolution = resolveSaveTarget(collections ?? [], saveMode, defaultId, lastUsedId);
  const target = resolution.target;
  const hasTarget = dataLoaded && target !== null;
  // Name shown on the "Saving to {folder}" line + the "Save all → to {name}"
  // menu item; null while nothing is resolved yet (the picker is needed).
  const targetName = dataLoaded ? target?.name ?? null : null;

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
        sendSyncNudge();
        await setMeta(LAST_USED_KEY, collection.id, db);
        setLastUsedId(collection.id);
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

  const handleSaveClick = useCallback(
    (action: SaveAction) => {
      setActionError(null);
      if (hasTarget && target) {
        dispatch({ type: "SAVE_CLICK", action, hasTarget: true });
        void performSave(action, target);
      } else {
        dispatch({ type: "SAVE_CLICK", action, hasTarget: false });
      }
    },
    [hasTarget, target, performSave],
  );

  // Replays a pending "save-all" command the instant this popup's own data has
  // settled — through the SAME handleSaveClick("all") path a manual click takes.
  useEffect(() => {
    if (!pendingSaveAll || !dataLoaded) return;
    setPendingSaveAll(false);
    handleSaveClick("all");
  }, [pendingSaveAll, dataLoaded, handleSaveClick]);

  /**
   * Shared tail of both picker resolutions: remember the target, close the
   * picker, fire any pending save. In `"default"` mode (or when the picker was
   * opened via "Change default folder…", `pinDefaultRef`), the chosen folder is
   * also PINNED as the default so subsequent Saves are truly one click — the
   * zero-config path the brief describes.
   */
  async function resolvePickerWith(collection: Collection, pendingAction: SaveAction | null) {
    setLastUsedId(collection.id);
    await setMeta(LAST_USED_KEY, collection.id, db);
    if (saveMode === "default" || pinDefaultRef.current) {
      setDefaultId(collection.id);
      await setMeta(DEFAULT_COLLECTION_META_KEY, collection.id, db);
    }
    pinDefaultRef.current = false;
    dispatch({ type: "PICKER_RESOLVED" });
    if (pendingAction) void performSave(pendingAction, collection);
  }

  /** "Change" (Saving-to line) / "Choose folder…" — open the picker to retarget without a pending save. Pins the default only in `"default"` mode (via resolvePickerWith). */
  function handleChangeTarget() {
    setActionError(null);
    dispatch({ type: "CHANGE_TARGET_CLICK" });
  }

  /** "Change default folder…" — open the picker and pin whatever is chosen as the default, regardless of the current mode. */
  function handleChangeDefault() {
    setActionError(null);
    pinDefaultRef.current = true;
    dispatch({ type: "CHANGE_TARGET_CLICK" });
  }

  /** "Save all → Choose a folder…" — force the picker (with a pending save) even when a target is already resolved. */
  function handleChooseFolderForSave(action: SaveAction) {
    setActionError(null);
    dispatch({ type: "SAVE_CLICK", action, hasTarget: false });
  }

  /**
   * "Save all → New folder (named by AI)": create a placeholder folder, save
   * every current-window tab into it, land on the confirm view, THEN
   * best-effort ask the hybrid engine for a name and rename to it. Naming is
   * strictly non-blocking — any failure (or no engine) leaves the "New folder"
   * placeholder for the user to rename later, and never loses the save.
   */
  async function handleSaveAllToNewAiFolder() {
    if (busy) return;
    setActionError(null);
    setNotice(null);
    setBusy(true);
    try {
      const tabs = await tabsForAction("all", allTabs, selectedTabs);
      if (tabs.length === 0) {
        setActionError("No tabs to save (only http/https pages count).");
        return;
      }
      const withFavicons = tabs.map((t) => ({ ...t, faviconUrl: faviconFor(t.url) }));
      const collection = await createCollection(AI_FOLDER_PLACEHOLDER, undefined, db);
      const savedLinks = await saveTabs(collection.id, withFavicons, db);
      sendSyncNudge();
      await setMeta(LAST_USED_KEY, collection.id, db);
      setLastUsedId(collection.id);
      const savedUrls = withFavicons.map((t) => t.url);
      dispatch({
        type: "SAVE_SUCCESS",
        action: "all",
        count: withFavicons.length,
        collectionName: collection.name,
        savedUrls,
      });
      void nameFolderWithAi(collection.id, savedLinks);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not save tabs.");
    } finally {
      setBusy(false);
    }
  }

  /** Best-effort rename of a just-created folder to an AI suggestion. Surfaces a subtle notice on success; silently keeps the placeholder on any failure. */
  async function nameFolderWithAi(collectionId: string, links: Link[]) {
    try {
      const name = await suggestFolderName(links);
      await renameCollection(collectionId, name, db);
      sendSyncNudge();
      flashNotice(`Named this folder "${name}".`);
    } catch {
      // No engine, or naming failed — leave the "New folder" placeholder; the
      // user can rename it. Never an error, never a lost save.
    }
  }

  function flashNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 3000);
  }

  async function handlePickerSelect(collection: Collection) {
    if (state.view !== "picker" || state.resolving !== null) return;
    const pendingAction = state.pendingAction;
    dispatch({ type: "PICKER_SELECT", collectionId: collection.id });
    await resolvePickerWith(collection, pendingAction);
  }

  async function handlePickerCreate(name: string): Promise<Collection> {
    if (state.view !== "picker" || state.resolving !== null) {
      throw new Error("Another choice is already being saved.");
    }
    const pendingAction = state.pendingAction;
    dispatch({ type: "PICKER_CREATE_START" });
    let created: Collection;
    try {
      created = await createCollection(name, undefined, db);
    } catch (err) {
      dispatch({ type: "PICKER_CREATE_FAILED" });
      throw err;
    }
    await resolvePickerWith(created, pendingAction);
    return created;
  }

  /** T20's "Save all + organize": the tabs are already saved by the time this renders — deep-link into the dashboard, which auto-opens AiOrganizeDialog. */
  function handleSaveAllAndOrganize(collectionId: string) {
    chrome.tabs.create({ url: dashboardCollectionOrganizeUrl(collectionId) });
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

  /**
   * FolderRow's "+" quick-add: save the current tab into that folder in place,
   * no navigation. Resolves the tab fresh (getCurrentTab throws a friendly
   * message the row surfaces if the page genuinely can't be saved) rather than
   * reading a value cached at mount — that cache going stale is what made the
   * "+" silently dead on the first load.
   */
  async function handleAddCurrentToFolder(collectionId: string) {
    const tab = await getCurrentTab();
    await addTabToFolder(collectionId, tab, db);
    sendSyncNudge();
  }

  const detailCollection =
    state.view === "folderDetail" ? collections?.find((c) => c.id === state.collectionId) ?? null : null;

  // A folder deleted out from under the detail view (or an id that never
  // resolves once collections load) falls back home.
  useEffect(() => {
    if (state.view === "folderDetail" && collectionsLoaded && detailCollection === null) {
      dispatch({ type: "BACK_TO_HOME" });
    }
  }, [state.view, collectionsLoaded, detailCollection]);

  let screen: ReactNode;
  if (state.view === "confirm") {
    screen = (
      <div
        role="status"
        className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] px-4 py-3 shadow-lg"
      >
        <p className="text-sm text-[var(--text)]">
          <span className="text-[var(--accent)]">&#10003;</span> Saved {state.count}{" "}
          {state.count === 1 ? "tab" : "tabs"} to {state.collectionName}
        </p>
        <div className="flex flex-wrap gap-2">
          {state.action === "all" ? (
            <Button variant="danger" size="sm" onClick={() => void handleCloseSavedTabs()} disabled={busy}>
              Close saved tabs
            </Button>
          ) : null}
          {state.action === "all" && lastUsedId && authUser && aiOrganizeCtaAvailable(plan, aiUsesThisMonth) ? (
            <Button variant="ghost" size="sm" onClick={() => handleSaveAllAndOrganize(lastUsedId)} disabled={busy}>
              Save all + organize
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => dispatch({ type: "RESET" })} disabled={busy}>
            Done
          </Button>
        </div>
      </div>
    );
  } else if (state.view === "picker") {
    screen = (
      <CollectionPicker
        collections={collections ?? []}
        onSelect={(c) => void handlePickerSelect(c)}
        onCreate={handlePickerCreate}
        onCancel={() => dispatch({ type: "ESCAPE" })}
        busy={state.resolving !== null}
      />
    );
  } else if (state.view === "folderDetail" && detailCollection) {
    screen = <FolderDetail collection={detailCollection} onBack={() => dispatch({ type: "BACK_TO_HOME" })} />;
  } else {
    screen = (
      <FoldersHome
        collections={collections ?? []}
        collectionsLoaded={collectionsLoaded}
        dataLoaded={dataLoaded}
        plan={plan}
        proBadge={proBadgeState(cloudConfigured, authUser, plan)}
        onUpgradeToPro={openDashboardSettings}
        allCount={allTabs?.length ?? 0}
        selectedCount={selectedTabs?.length ?? 0}
        canAddCurrent
        targetName={targetName}
        onSaveCurrent={() => handleSaveClick("current")}
        onSaveAll={() => handleSaveClick("all")}
        onSaveAllChoose={() => handleChooseFolderForSave("all")}
        onSaveAllNewAiFolder={() => void handleSaveAllToNewAiFolder()}
        onSaveSelected={() => handleSaveClick("selected")}
        onChangeTarget={handleChangeTarget}
        onChangeDefault={handleChangeDefault}
        onOpenFolder={(id) => dispatch({ type: "OPEN_FOLDER", collectionId: id })}
        onAddCurrent={handleAddCurrentToFolder}
        onError={setActionError}
      />
    );
  }

  // Width/height in rem, not px: the popup's content is rem-sized, so a
  // user's Chrome font-size setting (e.g. Large = 20px root) scales it.
  // A px-fixed box made the header overflow and overlap at Large fonts;
  // 22.5rem/30rem are identical to the old 360/480px at the default 16px
  // root, and Chrome auto-sizes toolbar popups up to 800x600.
  return (
    <div className="flex w-[22.5rem] flex-col gap-4 bg-[var(--bg-ground)] px-4 py-4" style={{ minHeight: "30rem" }}>
      <div ref={screenRef}>{screen}</div>

      {actionError && state.view !== "folderDetail" ? (
        <p className="text-xs text-[var(--accent)]">{actionError}</p>
      ) : null}

      {notice && !actionError && state.view !== "folderDetail" ? (
        <p className="text-xs text-[var(--text-2)]">{notice}</p>
      ) : null}

      <footer className="mt-auto flex items-center justify-between border-t border-[var(--line)] pt-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={openDashboard}>
            Dashboard
          </Button>
          {cloudConfigured ? (
            authUser ? (
              <Badge variant={plan === "pro" ? "accent" : "muted"}>{plan === "pro" ? "PRO" : "Free"}</Badge>
            ) : (
              <button
                type="button"
                onClick={openDashboardSettings}
                className="text-xs text-[var(--text-2)] underline-offset-2 hover:text-[var(--text)] hover:underline"
              >
                Sign in
              </button>
            )
          ) : null}
        </div>
      </footer>
    </div>
  );
}

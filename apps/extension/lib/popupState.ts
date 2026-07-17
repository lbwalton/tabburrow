export type SaveAction = "current" | "all" | "selected";

/**
 * While the picker is resolving a choice (the row's setMeta write, or a
 * createCollection call, is in flight), all further picker interaction is
 * ignored — this is the guard against a double-click firing performSave
 * twice into two different collections.
 */
export type PickerResolving =
  | { kind: "select"; collectionId: string }
  | { kind: "create" };

export type PopupState =
  // `home` (the folders hub) is the default view — the redesigned popup leads
  // with the folder list + fast actions rather than a flat save panel.
  | { view: "home" }
  // Drill-in: the folder-detail screen for `collectionId` (links + append /
  // overwrite / add-link / send / organize / rename / delete). The collection
  // itself is looked up live from the collections list in App, so a folder
  // deleted out from under this view falls back to `home`.
  | { view: "folderDetail"; collectionId: string }
  | { view: "picker"; pendingAction: SaveAction | null; resolving: PickerResolving | null }
  | {
      view: "confirm";
      action: SaveAction;
      count: number;
      collectionName: string;
      savedUrls: string[];
    };

export type PopupEvent =
  | { type: "SAVE_CLICK"; action: SaveAction; hasTarget: boolean }
  | { type: "CHANGE_TARGET_CLICK" }
  | { type: "OPEN_FOLDER"; collectionId: string }
  | { type: "BACK_TO_HOME" }
  | { type: "PICKER_SELECT"; collectionId: string }
  | { type: "PICKER_CREATE_START" }
  | { type: "PICKER_CREATE_FAILED" }
  | { type: "PICKER_RESOLVED" }
  | { type: "ESCAPE" }
  | {
      type: "SAVE_SUCCESS";
      action: SaveAction;
      count: number;
      collectionName: string;
      savedUrls: string[];
    }
  | { type: "RESET" };

export function initialPopupState(): PopupState {
  return { view: "home" };
}

/**
 * Pure state machine for the popup. Owns which VIEW is showing (home /
 * folderDetail / picker / confirm) plus the picker's resolving flag — the
 * actual tab-fetching, saveTabs() call, and lastUsedCollectionId write happen
 * in App.tsx and are fed back in via SAVE_SUCCESS once they resolve.
 *
 * Navigation: `home` is the default folders hub; OPEN_FOLDER drills into a
 * folder (folderDetail), BACK_TO_HOME climbs back out. The save flow is
 * unchanged from the pre-redesign popup, just landing back on `home` instead
 * of the old `idle` panel:
 *
 * Cold start (no last-used target yet): SAVE_CLICK with hasTarget=false opens
 * the picker and remembers which action to run once a target is chosen. Warm
 * path: SAVE_CLICK with hasTarget=true doesn't touch the view at all — App.tsx
 * fires the save directly, and the view only changes once SAVE_SUCCESS lands
 * (→ confirm).
 *
 * Picker resolution: the first PICKER_SELECT (row click) or
 * PICKER_CREATE_START (create submit) sets `resolving`; while it's set, every
 * further PICKER_SELECT / PICKER_CREATE_START / ESCAPE is ignored, so a rapid
 * second click can't retarget or double-fire the save. PICKER_CREATE_FAILED
 * (e.g. empty-name throw) clears a resolving create so the user can fix the
 * name and retry. PICKER_RESOLVED always lands back on `home`; when a save
 * action was pending, App.tsx fires it at that moment.
 */
export function popupReducer(state: PopupState, event: PopupEvent): PopupState {
  switch (event.type) {
    case "SAVE_CLICK":
      return event.hasTarget ? state : { view: "picker", pendingAction: event.action, resolving: null };

    case "CHANGE_TARGET_CLICK":
      return { view: "picker", pendingAction: null, resolving: null };

    case "OPEN_FOLDER":
      return { view: "folderDetail", collectionId: event.collectionId };

    case "BACK_TO_HOME":
      return { view: "home" };

    case "PICKER_SELECT":
      if (state.view !== "picker" || state.resolving !== null) return state;
      return { ...state, resolving: { kind: "select", collectionId: event.collectionId } };

    case "PICKER_CREATE_START":
      if (state.view !== "picker" || state.resolving !== null) return state;
      return { ...state, resolving: { kind: "create" } };

    case "PICKER_CREATE_FAILED":
      if (state.view !== "picker" || state.resolving?.kind !== "create") return state;
      return { ...state, resolving: null };

    case "PICKER_RESOLVED":
      return { view: "home" };

    case "ESCAPE":
      return state.view === "picker" && state.resolving === null ? { view: "home" } : state;

    case "SAVE_SUCCESS":
      return {
        view: "confirm",
        action: event.action,
        count: event.count,
        collectionName: event.collectionName,
        savedUrls: event.savedUrls,
      };

    case "RESET":
      return { view: "home" };

    default:
      return state;
  }
}

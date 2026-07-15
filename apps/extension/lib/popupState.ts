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
  | { view: "idle" }
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
  return { view: "idle" };
}

/**
 * Pure state machine for the popup's save flow. Owns which VIEW is showing
 * (idle / picker / confirm) plus the picker's resolving flag — the actual
 * tab-fetching, saveTabs() call, and lastUsedCollectionId write happen in
 * App.tsx and are fed back in via SAVE_SUCCESS once they resolve.
 *
 * Cold start (no last-used target yet): SAVE_CLICK with hasTarget=false
 * opens the picker and remembers which action to run once a target is
 * chosen. Warm path: SAVE_CLICK with hasTarget=true doesn't touch the view
 * at all — App.tsx fires the save directly, and the view only changes once
 * SAVE_SUCCESS lands.
 *
 * Picker resolution: the first PICKER_SELECT (row click) or
 * PICKER_CREATE_START (create submit) sets `resolving`; while it's set,
 * every further PICKER_SELECT / PICKER_CREATE_START / ESCAPE is ignored, so
 * a rapid second click can't retarget or double-fire the save.
 * PICKER_CREATE_FAILED (e.g. empty-name throw) clears a resolving create so
 * the user can fix the name and retry. PICKER_RESOLVED always lands back on
 * idle; when a save action was pending, App.tsx fires it at that moment.
 */
export function popupReducer(state: PopupState, event: PopupEvent): PopupState {
  switch (event.type) {
    case "SAVE_CLICK":
      return event.hasTarget ? state : { view: "picker", pendingAction: event.action, resolving: null };

    case "CHANGE_TARGET_CLICK":
      return { view: "picker", pendingAction: null, resolving: null };

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
      return { view: "idle" };

    case "ESCAPE":
      return state.view === "picker" && state.resolving === null ? { view: "idle" } : state;

    case "SAVE_SUCCESS":
      return {
        view: "confirm",
        action: event.action,
        count: event.count,
        collectionName: event.collectionName,
        savedUrls: event.savedUrls,
      };

    case "RESET":
      return { view: "idle" };

    default:
      return state;
  }
}

export type SaveAction = "current" | "all" | "selected";

export type PopupState =
  | { view: "idle" }
  | { view: "picker"; pendingAction: SaveAction | null }
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
 * Pure state machine for the popup's save flow. Owns only which VIEW is
 * showing (idle / picker / confirm) — the actual tab-fetching, saveTabs()
 * call, and lastUsedCollectionId write happen in App.tsx and are fed back in
 * via SAVE_SUCCESS once they resolve.
 *
 * Cold start (no last-used target yet): SAVE_CLICK with hasTarget=false
 * opens the picker and remembers which action to run once a target is
 * chosen (PICKER_RESOLVED just returns to idle; App.tsx reads the
 * `pendingAction` it had before dispatching and fires the save itself).
 * Warm path: SAVE_CLICK with hasTarget=true doesn't touch the view at all —
 * App.tsx fires the save directly, and the view only changes once
 * SAVE_SUCCESS lands.
 */
export function popupReducer(state: PopupState, event: PopupEvent): PopupState {
  switch (event.type) {
    case "SAVE_CLICK":
      return event.hasTarget ? state : { view: "picker", pendingAction: event.action };

    case "CHANGE_TARGET_CLICK":
      return { view: "picker", pendingAction: null };

    case "PICKER_RESOLVED":
      return { view: "idle" };

    case "ESCAPE":
      return state.view === "picker" ? { view: "idle" } : state;

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

import { describe, it, expect } from "vitest";
import { popupReducer, initialPopupState } from "./popupState";
import type { PopupState } from "./popupState";

const freshPicker: PopupState = { view: "picker", pendingAction: null, resolving: null };

describe("popupReducer", () => {
  it("starts idle", () => {
    expect(initialPopupState()).toEqual({ view: "idle" });
  });

  it("cold save (no last-used target) opens the picker first, remembering the pending action", () => {
    const next = popupReducer(initialPopupState(), { type: "SAVE_CLICK", action: "current", hasTarget: false });
    expect(next).toEqual({ view: "picker", pendingAction: "current", resolving: null });
  });

  it("warm save (has a last-used target) does not change the view — App fires the save directly", () => {
    const idle = initialPopupState();
    const next = popupReducer(idle, { type: "SAVE_CLICK", action: "all", hasTarget: true });
    expect(next).toEqual(idle);
  });

  it("the explicit change-target action opens the picker with no pending action and nothing resolving", () => {
    const next = popupReducer(initialPopupState(), { type: "CHANGE_TARGET_CLICK" });
    expect(next).toEqual({ view: "picker", pendingAction: null, resolving: null });
  });

  it("PICKER_SELECT marks the picker as resolving toward the chosen collection", () => {
    const next = popupReducer(freshPicker, { type: "PICKER_SELECT", collectionId: "coll-1" });
    expect(next).toEqual({
      view: "picker",
      pendingAction: null,
      resolving: { kind: "select", collectionId: "coll-1" },
    });
  });

  it("a second PICKER_SELECT with a DIFFERENT target while one is resolving is ignored", () => {
    const first = popupReducer(freshPicker, { type: "PICKER_SELECT", collectionId: "coll-1" });
    const second = popupReducer(first, { type: "PICKER_SELECT", collectionId: "coll-2" });
    // Identical state object back: the second click must not re-target the save.
    expect(second).toBe(first);
    expect(second.view === "picker" && second.resolving).toEqual({ kind: "select", collectionId: "coll-1" });
  });

  it("PICKER_CREATE_START marks the picker as resolving via creation", () => {
    const next = popupReducer(freshPicker, { type: "PICKER_CREATE_START" });
    expect(next).toEqual({ view: "picker", pendingAction: null, resolving: { kind: "create" } });
  });

  it("a row click (PICKER_SELECT) while a create is in flight is ignored", () => {
    const creating = popupReducer(freshPicker, { type: "PICKER_CREATE_START" });
    const rowClick = popupReducer(creating, { type: "PICKER_SELECT", collectionId: "coll-1" });
    expect(rowClick).toBe(creating);
    expect(rowClick.view === "picker" && rowClick.resolving).toEqual({ kind: "create" });
  });

  it("a second PICKER_CREATE_START while anything is resolving is ignored", () => {
    const creating = popupReducer(freshPicker, { type: "PICKER_CREATE_START" });
    expect(popupReducer(creating, { type: "PICKER_CREATE_START" })).toBe(creating);

    const selecting = popupReducer(freshPicker, { type: "PICKER_SELECT", collectionId: "coll-1" });
    expect(popupReducer(selecting, { type: "PICKER_CREATE_START" })).toBe(selecting);
  });

  it("PICKER_CREATE_FAILED clears a resolving create so the user can retry", () => {
    const creating = popupReducer(freshPicker, { type: "PICKER_CREATE_START" });
    const failed = popupReducer(creating, { type: "PICKER_CREATE_FAILED" });
    expect(failed).toEqual(freshPicker);

    // ...and the retry is accepted again.
    const retry = popupReducer(failed, { type: "PICKER_CREATE_START" });
    expect(retry).toEqual({ view: "picker", pendingAction: null, resolving: { kind: "create" } });
  });

  it("PICKER_CREATE_FAILED is a no-op when nothing is being created", () => {
    expect(popupReducer(freshPicker, { type: "PICKER_CREATE_FAILED" })).toBe(freshPicker);

    const selecting = popupReducer(freshPicker, { type: "PICKER_SELECT", collectionId: "coll-1" });
    expect(popupReducer(selecting, { type: "PICKER_CREATE_FAILED" })).toBe(selecting);

    const idle = initialPopupState();
    expect(popupReducer(idle, { type: "PICKER_CREATE_FAILED" })).toBe(idle);
  });

  it("PICKER_SELECT and PICKER_CREATE_START outside the picker view are no-ops", () => {
    const idle = initialPopupState();
    expect(popupReducer(idle, { type: "PICKER_SELECT", collectionId: "coll-1" })).toBe(idle);
    expect(popupReducer(idle, { type: "PICKER_CREATE_START" })).toBe(idle);
  });

  it("PICKER_RESOLVED always returns to idle, whether or not something was pending or resolving", () => {
    const withPending: PopupState = { view: "picker", pendingAction: "all", resolving: null };
    const resolvingSelect = popupReducer(freshPicker, { type: "PICKER_SELECT", collectionId: "c" });
    expect(popupReducer(withPending, { type: "PICKER_RESOLVED" })).toEqual({ view: "idle" });
    expect(popupReducer(resolvingSelect, { type: "PICKER_RESOLVED" })).toEqual({ view: "idle" });
  });

  it("Escape backs out of the picker to idle while nothing is resolving", () => {
    const picker: PopupState = { view: "picker", pendingAction: "selected", resolving: null };
    expect(popupReducer(picker, { type: "ESCAPE" })).toEqual({ view: "idle" });
  });

  it("Escape is ignored while a selection or creation is resolving — the die is cast", () => {
    const selecting = popupReducer(freshPicker, { type: "PICKER_SELECT", collectionId: "coll-1" });
    expect(popupReducer(selecting, { type: "ESCAPE" })).toBe(selecting);

    const creating = popupReducer(freshPicker, { type: "PICKER_CREATE_START" });
    expect(popupReducer(creating, { type: "ESCAPE" })).toBe(creating);
  });

  it("Escape is a no-op outside the picker", () => {
    const idle = initialPopupState();
    expect(popupReducer(idle, { type: "ESCAPE" })).toBe(idle);

    const confirm: PopupState = {
      view: "confirm",
      action: "current",
      count: 1,
      collectionName: "Reading",
      savedUrls: ["https://a.com"],
    };
    expect(popupReducer(confirm, { type: "ESCAPE" })).toBe(confirm);
  });

  it("SAVE_SUCCESS moves to the confirmation view with the save's details", () => {
    const next = popupReducer(initialPopupState(), {
      type: "SAVE_SUCCESS",
      action: "all",
      count: 12,
      collectionName: "Research",
      savedUrls: ["https://a.com", "https://b.com"],
    });
    expect(next).toEqual({
      view: "confirm",
      action: "all",
      count: 12,
      collectionName: "Research",
      savedUrls: ["https://a.com", "https://b.com"],
    });
  });

  it("RESET always returns to idle (Done button, or auto-reset after 6s)", () => {
    const confirm: PopupState = {
      view: "confirm",
      action: "current",
      count: 1,
      collectionName: "Reading",
      savedUrls: ["https://a.com"],
    };
    expect(popupReducer(confirm, { type: "RESET" })).toEqual({ view: "idle" });
  });

  it("full cold-save happy path: idle -> picker -> select-resolving -> idle -> confirm -> idle", () => {
    let state = initialPopupState();
    state = popupReducer(state, { type: "SAVE_CLICK", action: "current", hasTarget: false });
    expect(state).toEqual({ view: "picker", pendingAction: "current", resolving: null });

    state = popupReducer(state, { type: "PICKER_SELECT", collectionId: "coll-1" });
    expect(state.view === "picker" && state.resolving).toEqual({ kind: "select", collectionId: "coll-1" });

    state = popupReducer(state, { type: "PICKER_RESOLVED" });
    expect(state).toEqual({ view: "idle" });

    state = popupReducer(state, {
      type: "SAVE_SUCCESS",
      action: "current",
      count: 1,
      collectionName: "New Collection",
      savedUrls: ["https://a.com"],
    });
    expect(state.view).toBe("confirm");

    state = popupReducer(state, { type: "RESET" });
    expect(state).toEqual({ view: "idle" });
  });

  it("full cold-create path with a failed first attempt: create fails -> retry -> resolved", () => {
    let state = popupReducer(initialPopupState(), { type: "SAVE_CLICK", action: "all", hasTarget: false });
    state = popupReducer(state, { type: "PICKER_CREATE_START" });
    state = popupReducer(state, { type: "PICKER_CREATE_FAILED" }); // e.g. empty name
    expect(state).toEqual({ view: "picker", pendingAction: "all", resolving: null });

    state = popupReducer(state, { type: "PICKER_CREATE_START" });
    state = popupReducer(state, { type: "PICKER_RESOLVED" });
    expect(state).toEqual({ view: "idle" });
  });
});

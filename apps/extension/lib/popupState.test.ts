import { describe, it, expect } from "vitest";
import { popupReducer, initialPopupState } from "./popupState";
import type { PopupState } from "./popupState";

describe("popupReducer", () => {
  it("starts idle", () => {
    expect(initialPopupState()).toEqual({ view: "idle" });
  });

  it("cold save (no last-used target) opens the picker first, remembering the pending action", () => {
    const next = popupReducer(initialPopupState(), { type: "SAVE_CLICK", action: "current", hasTarget: false });
    expect(next).toEqual({ view: "picker", pendingAction: "current" });
  });

  it("warm save (has a last-used target) does not change the view — App fires the save directly", () => {
    const idle = initialPopupState();
    const next = popupReducer(idle, { type: "SAVE_CLICK", action: "all", hasTarget: true });
    expect(next).toEqual(idle);
  });

  it("the explicit change-target action opens the picker with no pending action", () => {
    const next = popupReducer(initialPopupState(), { type: "CHANGE_TARGET_CLICK" });
    expect(next).toEqual({ view: "picker", pendingAction: null });
  });

  it("PICKER_RESOLVED always returns to idle, whether or not something was pending", () => {
    const withPending: PopupState = { view: "picker", pendingAction: "all" };
    const withoutPending: PopupState = { view: "picker", pendingAction: null };
    expect(popupReducer(withPending, { type: "PICKER_RESOLVED" })).toEqual({ view: "idle" });
    expect(popupReducer(withoutPending, { type: "PICKER_RESOLVED" })).toEqual({ view: "idle" });
  });

  it("Escape backs out of the picker to idle", () => {
    const picker: PopupState = { view: "picker", pendingAction: "selected" };
    expect(popupReducer(picker, { type: "ESCAPE" })).toEqual({ view: "idle" });
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

  it("full cold-save happy path: idle -> picker -> idle -> confirm -> idle", () => {
    let state = initialPopupState();
    state = popupReducer(state, { type: "SAVE_CLICK", action: "current", hasTarget: false });
    expect(state.view).toBe("picker");

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
});

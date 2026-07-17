import { describe, it, expect } from "vitest";
import type { Collection } from "@tabburrow/core";
import {
  DEFAULT_SAVE_TARGET_MODE,
  parseSaveTargetMode,
  resolveSaveTarget,
} from "./saveTarget";

function makeCollection(id: string, name = id): Collection {
  return {
    id,
    name,
    accent: null,
    position: "0001",
    isShared: false,
    shareSlug: null,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
  };
}

const COLLECTIONS: Collection[] = [makeCollection("a", "Alpha"), makeCollection("b", "Beta")];

describe("parseSaveTargetMode", () => {
  it("treats an absent value as the default mode", () => {
    expect(parseSaveTargetMode(null)).toBe(DEFAULT_SAVE_TARGET_MODE);
    expect(parseSaveTargetMode(undefined)).toBe(DEFAULT_SAVE_TARGET_MODE);
    expect(DEFAULT_SAVE_TARGET_MODE).toBe("default");
  });

  it("treats an unknown value as the default mode", () => {
    expect(parseSaveTargetMode("nonsense")).toBe("default");
    expect(parseSaveTargetMode("")).toBe("default");
  });

  it("passes through every valid mode", () => {
    expect(parseSaveTargetMode("default")).toBe("default");
    expect(parseSaveTargetMode("last-used")).toBe("last-used");
    expect(parseSaveTargetMode("ask")).toBe("ask");
  });
});

describe("resolveSaveTarget", () => {
  it("ask mode always needs the picker, never a target", () => {
    expect(resolveSaveTarget(COLLECTIONS, "ask", "a", "b")).toEqual({ target: null, needsPicker: true });
  });

  it("last-used mode resolves to the live collection with the last-used id", () => {
    const result = resolveSaveTarget(COLLECTIONS, "last-used", "a", "b");
    expect(result.needsPicker).toBe(false);
    expect(result.target?.id).toBe("b");
  });

  it("last-used mode needs the picker when there is no last-used id", () => {
    expect(resolveSaveTarget(COLLECTIONS, "last-used", "a", null)).toEqual({ target: null, needsPicker: true });
  });

  it("last-used mode needs the picker when the last-used id points at a missing/deleted collection", () => {
    expect(resolveSaveTarget(COLLECTIONS, "last-used", "a", "gone")).toEqual({ target: null, needsPicker: true });
  });

  it("default mode resolves to the live collection with the default id", () => {
    const result = resolveSaveTarget(COLLECTIONS, "default", "a", "b");
    expect(result.needsPicker).toBe(false);
    expect(result.target?.id).toBe("a");
  });

  it("default mode needs the picker when there is no default id (out-of-the-box state)", () => {
    expect(resolveSaveTarget(COLLECTIONS, "default", null, "b")).toEqual({ target: null, needsPicker: true });
  });

  it("default mode needs the picker when the default id points at a missing/deleted collection", () => {
    expect(resolveSaveTarget(COLLECTIONS, "default", "gone", "b")).toEqual({ target: null, needsPicker: true });
  });

  it("an empty collection list always needs the picker", () => {
    expect(resolveSaveTarget([], "default", "a", "b")).toEqual({ target: null, needsPicker: true });
    expect(resolveSaveTarget([], "last-used", "a", "b")).toEqual({ target: null, needsPicker: true });
  });
});

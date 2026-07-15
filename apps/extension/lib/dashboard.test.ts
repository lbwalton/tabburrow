import { describe, it, expect } from "vitest";
import { collectionHash, dashboardCollectionPath } from "./dashboard";

describe("collectionHash", () => {
  it("emits the #/c/<id> hash fragment the dashboard router parses", () => {
    expect(collectionHash("abc-123")).toBe("#/c/abc-123");
  });
});

describe("dashboardCollectionPath", () => {
  it("emits the dashboard.html#/c/<id> hash-route format the T8 dashboard router parses", () => {
    expect(dashboardCollectionPath("abc-123")).toBe("dashboard.html#/c/abc-123");
  });
});

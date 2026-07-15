import { describe, it, expect } from "vitest";
import { dashboardCollectionPath } from "./dashboard";

describe("dashboardCollectionPath", () => {
  it("emits the dashboard.html#/c/<id> hash-route format T8 will wire up", () => {
    expect(dashboardCollectionPath("abc-123")).toBe("dashboard.html#/c/abc-123");
  });
});

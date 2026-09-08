import { describe, it, expect } from "vitest";
import { RESTORE_CONFIRM_THRESHOLD } from "./restore";
import { openConfirmMessage, planSearchOpen, selectLabel } from "./searchSelection";

function link(id: string, url = `https://x.com/${id}`) {
  return { id, url };
}

describe("planSearchOpen", () => {
  describe("with nothing selected it plans an open-all", () => {
    it("takes every shown link, in display order", () => {
      const links = [link("a"), link("b"), link("c")];
      const plan = planSearchOpen(links, new Set());
      expect(plan.urls).toEqual(["https://x.com/a", "https://x.com/b", "https://x.com/c"]);
      expect(plan.count).toBe(3);
      expect(plan.isOpenAll).toBe(true);
    });

    it('labels the button "Open all N"', () => {
      expect(planSearchOpen([link("a"), link("b")], new Set()).label).toBe("Open all 2");
    });

    it("plans nothing for an empty result set (the surface hides the button on count 0)", () => {
      const plan = planSearchOpen([], new Set());
      expect(plan.urls).toEqual([]);
      expect(plan.count).toBe(0);
      expect(plan.needsConfirm).toBe(false);
    });
  });

  describe("with a selection it narrows to exactly the ticked rows", () => {
    it("keeps only selected links", () => {
      const links = [link("a"), link("b"), link("c")];
      const plan = planSearchOpen(links, new Set(["a", "c"]));
      expect(plan.urls).toEqual(["https://x.com/a", "https://x.com/c"]);
      expect(plan.isOpenAll).toBe(false);
    });

    it("preserves DISPLAY order, not selection order", () => {
      // The set is built c-then-a; tabs must still open a-then-c.
      const links = [link("a"), link("b"), link("c")];
      const plan = planSearchOpen(links, new Set(["c", "a"]));
      expect(plan.urls).toEqual(["https://x.com/a", "https://x.com/c"]);
    });

    it('labels the button "Open N" (no "all")', () => {
      expect(planSearchOpen([link("a"), link("b")], new Set(["a"])).label).toBe("Open 1");
    });

    it("ignores selected ids that aren't among the shown links (a stale selection from a previous query)", () => {
      const plan = planSearchOpen([link("a")], new Set(["a", "gone"]));
      expect(plan.urls).toEqual(["https://x.com/a"]);
      expect(plan.count).toBe(1);
    });

    it("selecting every row is still an explicit selection, not an open-all", () => {
      const links = [link("a"), link("b")];
      const plan = planSearchOpen(links, new Set(["a", "b"]));
      expect(plan.isOpenAll).toBe(false);
      expect(plan.label).toBe("Open 2");
    });
  });

  describe("confirm threshold", () => {
    // Reuses the app's existing restore-all threshold rather than a second
    // magic number — these pin that they really are the same boundary.
    function planOf(n: number) {
      return planSearchOpen(
        Array.from({ length: n }, (_, i) => link(`l${i}`)),
        new Set(),
      );
    }

    it("does not confirm at exactly the threshold (it's exclusive)", () => {
      expect(planOf(RESTORE_CONFIRM_THRESHOLD).needsConfirm).toBe(false);
    });

    it("confirms one past the threshold", () => {
      expect(planOf(RESTORE_CONFIRM_THRESHOLD + 1).needsConfirm).toBe(true);
    });

    it("confirms on a big cross-folder batch", () => {
      expect(planOf(40).needsConfirm).toBe(true);
    });

    it("applies to a large SELECTION too, not just open-all", () => {
      const links = Array.from({ length: 30 }, (_, i) => link(`l${i}`));
      const selected = new Set(links.map((l) => l.id));
      expect(planSearchOpen(links, selected).needsConfirm).toBe(true);
    });
  });
});

describe("openConfirmMessage", () => {
  it("asks about the exact tab count", () => {
    expect(openConfirmMessage(23)).toBe("Open 23 tabs?");
  });
});

describe("selectLabel", () => {
  it("names the row so one checkbox is distinguishable from another", () => {
    expect(selectLabel("Meta Business Manager")).toBe("Select Meta Business Manager");
  });
});

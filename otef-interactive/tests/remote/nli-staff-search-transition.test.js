import { describe, expect, test, vi } from "vitest";
import { createNliStaffSearchTransition } from "../../frontend/src/remote/nli-staff-search-transition.js";

describe("NLI staff search transition", () => {
  test("clearAll clears person before place and stops when superseded", async () => {
    let releasePerson;
    const calls = [];
    const transition = createNliStaffSearchTransition({
      clearPersonSelection: () => new Promise((resolve) => {
        calls.push("person");
        releasePerson = resolve;
      }),
      cancelPlaceFocus: async () => { calls.push("place"); return { ok: true }; },
      hasPlaceFocus: () => true,
    });
    const oldToken = transition.begin();
    const oldRun = transition.clearAll(oldToken);
    const newToken = transition.begin();
    releasePerson(true);
    await expect(oldRun).resolves.toBe(false);
    expect(calls).toEqual(["person"]);
    expect(transition.isCurrent(newToken)).toBe(true);
  });

  test("person and place selection clear the competing focus first", async () => {
    const calls = [];
    const transition = createNliStaffSearchTransition({
      clearPersonSelection: async () => { calls.push("person"); return true; },
      cancelPlaceFocus: async () => { calls.push("place"); return { ok: true }; },
      hasPlaceFocus: () => true,
    });
    expect(await transition.beforePerson(transition.begin())).toBe(true);
    expect(await transition.beforePlace(transition.begin())).toBe(true);
    expect(calls).toEqual(["place", "person"]);
  });

  test.each([{ ok: true }, { status: "ok" }])("accepts acknowledged place cancellation %o", async (response) => {
    const transition = createNliStaffSearchTransition({
      clearPersonSelection: async () => true,
      cancelPlaceFocus: async () => response,
      hasPlaceFocus: () => true,
    });
    await expect(transition.beforePerson(transition.begin())).resolves.toBe(true);
  });

  test.each([
    ["false", async () => false],
    ["negative acknowledgment", async () => ({ ok: false })],
    ["missing callback", undefined],
    ["thrown result", async () => { throw new Error("network"); }],
  ])("treats %s place cancellation as failure", async (_label, cancelPlaceFocus) => {
    const transition = createNliStaffSearchTransition({
      clearPersonSelection: async () => true,
      cancelPlaceFocus,
      hasPlaceFocus: () => true,
    });
    await expect(transition.beforePerson(transition.begin())).resolves.toBe(false);
  });

  test("treats failed or unavailable person clear as failure", async () => {
    for (const clearPersonSelection of [async () => false, undefined, async () => { throw new Error("network"); }]) {
      const cancelPlaceFocus = vi.fn(async () => ({ ok: true }));
      const transition = createNliStaffSearchTransition({ clearPersonSelection, cancelPlaceFocus, hasPlaceFocus: () => true });
      await expect(transition.beforePlace(transition.begin())).resolves.toBe(false);
      expect(cancelPlaceFocus).not.toHaveBeenCalled();
    }
  });

  test("skips place cancellation when there is no place focus", async () => {
    const cancelPlaceFocus = vi.fn(async () => ({ ok: false }));
    const transition = createNliStaffSearchTransition({
      clearPersonSelection: async () => true,
      cancelPlaceFocus,
      hasPlaceFocus: () => false,
    });
    await expect(transition.beforePerson(transition.begin())).resolves.toBe(true);
    expect(cancelPlaceFocus).not.toHaveBeenCalled();
  });
});

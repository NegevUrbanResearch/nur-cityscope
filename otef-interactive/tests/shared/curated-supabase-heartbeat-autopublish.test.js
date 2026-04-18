import { describe, it, expect } from "vitest";
import { shouldTriggerCuratedReload } from "../../frontend/src/shared/curated-supabase-reload-trigger.js";

describe("shouldTriggerCuratedReload", () => {
  it("true when only autopublished", () => {
    expect(
      shouldTriggerCuratedReload({ ok: true, updated: 0, autopublished: 1 }),
    ).toBe(true);
  });
  it("false when both zero", () => {
    expect(
      shouldTriggerCuratedReload({ ok: true, updated: 0, autopublished: 0 }),
    ).toBe(false);
  });
});

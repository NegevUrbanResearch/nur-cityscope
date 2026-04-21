import { describe, it, expect } from "vitest";
import { shouldTriggerCuratedReload } from "../../frontend/src/shared/curated-supabase-reload-trigger.js";

describe("shouldTriggerCuratedReload", () => {
  it("true when only autopublished", () => {
    expect(
      shouldTriggerCuratedReload({
        ok: true,
        updated: 0,
        autopublished: 1,
        workshop_auto_publish: false,
      }),
    ).toBe(true);
  });
  it("false when both zero and workshop off", () => {
    expect(
      shouldTriggerCuratedReload({
        ok: true,
        updated: 0,
        autopublished: 0,
        workshop_auto_publish: false,
      }),
    ).toBe(false);
  });
  it("false when ok is not true even if counters are non-zero", () => {
    expect(
      shouldTriggerCuratedReload({
        ok: false,
        updated: 1,
        autopublished: 0,
        workshop_auto_publish: false,
      }),
    ).toBe(false);
    expect(
      shouldTriggerCuratedReload({
        ok: false,
        updated: 0,
        autopublished: 0,
        workshop_auto_publish: true,
      }),
    ).toBe(false);
  });
  it("false when workshop on but counters zero (no Supabase-side changes)", () => {
    expect(
      shouldTriggerCuratedReload({
        ok: true,
        updated: 0,
        autopublished: 0,
        workshop_auto_publish: true,
      }),
    ).toBe(false);
  });
});

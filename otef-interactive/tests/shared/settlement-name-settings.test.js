import { describe, expect, test } from "vitest";
import {
  acceptSettlementNameSnapshot,
  effectiveSettlementPosition,
  normalizeRotationDeg,
  sharedCapturedStyle,
  validateSettlementNameOperation,
  validateSettlementNameSettings,
} from "../../frontend/src/shared/settlement-name-settings.js";

function settingsFixture() {
  return {
    baseline: {
      captureId: "fixture-settlement-name",
      captureDigest: "a".repeat(64),
      sourceDigest: "b".repeat(64),
      catalogDigest: "c".repeat(64),
      predecessor: { revision: 749, configDigest: "d".repeat(64) },
      successor: { revision: 750, configDigest: "e".repeat(64) },
      outputs: {
        left: { "0067": { x: 510, y: 350 }, "0424": { x: -40, y: 1400 } },
        right: { "0067": { x: 1200, y: 350 }, "0424": { x: 3000, y: -20 } },
      },
    },
    style: { fontFamily: "Guttman Hatzvi", fontPx: 14, rotateDeg: 35 },
    outputs: { left: {}, right: {} },
  };
}

describe("settlement name settings", () => {
  test('saves a projection-only break without altering names, positions, or font style', () => {
    const settings = settingsFixture();
    const operation = { action: 'set_settlement_names', operation: 'line_break', citycode: '0067', afterWord: 1,
      baseRevision: 1, sourceId: '11111111-1111-4111-8111-111111111111', timestamp: '2026-10-06T00:00:00Z' };
    const result = validateSettlementNameOperation(operation, settings);
    expect(result.errors).toEqual([]);
    expect(result.settings.lineBreaks).toEqual({ '0067': 1 });
    expect(result.settings.baseline).toEqual(settings.baseline);
    expect(result.settings.style).toEqual(settings.style);
    expect(validateSettlementNameOperation({ ...operation, afterWord: -1 }, settings).errors).toContain('afterWord');
  });
  test('validates connector width and color while preserving font and placement', () => {
    const settings = settingsFixture();
    const leaderStyle = { widthPx: 2, outlineWidthPx: 0.5, color: '#ffffff', outlineColor: '#bfbf99', opacity: 0.8 };
    const operation = { action: 'set_settlement_names', operation: 'leader_style', leaderStyle,
      baseRevision: 1, sourceId: '11111111-1111-4111-8111-111111111111', timestamp: '2026-10-06T00:00:00Z' };
    const result = validateSettlementNameOperation(operation, settings);
    expect(result.errors).toEqual([]);
    expect(result.settings.leaderStyle).toEqual(leaderStyle);
    expect(result.settings.style).toEqual(settings.style);
    expect(validateSettlementNameOperation({ ...operation, leaderStyle: { ...leaderStyle, widthPx: true } }, settings).errors).toContain('leaderStyle.widthPx');
  });
  test("resolves a sparse override, then the baseline, and null when neither exists", () => {
    const settings = settingsFixture();
    settings.outputs.left["0067"] = { x: 12, y: 18 };
    expect(effectiveSettlementPosition(settings, "left", "0067")).toEqual({ x: 12, y: 18 });
    expect(effectiveSettlementPosition(settings, "right", "0067")).toEqual({ x: 1200, y: 350 });
    delete settings.outputs.left["0067"];
    expect(effectiveSettlementPosition(settings, "left", "0067")).toEqual({ x: 510, y: 350 });
    expect(effectiveSettlementPosition(settings, "left", "9999")).toBeNull();
  });

  test("keeps out-of-frame baseline positions and warns instead of clamping", () => {
    const result = validateSettlementNameSettings(settingsFixture());
    expect(result.errors).toEqual([]);
    expect(result.value.baseline.outputs.left["0424"]).toEqual({ x: -40, y: 1400 });
    expect(result.value.baseline.outputs.right["0424"]).toEqual({ x: 3000, y: -20 });
    expect(result.warnings.join(" ")).toMatch(/0424/);
  });

  test("rejects boolean, empty, and out-of-range style values", () => {
    const booleanFont = settingsFixture();
    booleanFont.style.fontPx = true;
    expect(validateSettlementNameSettings(booleanFont).errors).toContain("style.fontPx");

    const emptyFamily = settingsFixture();
    emptyFamily.style.fontFamily = "";
    expect(validateSettlementNameSettings(emptyFamily).errors).toContain("style.fontFamily");

    const unknownFamily = settingsFixture();
    unknownFamily.style.fontFamily = "Comic Sans";
    expect(validateSettlementNameSettings(unknownFamily).errors).toContain("style.fontFamily");

    const huge = settingsFixture();
    huge.style.fontPx = 65;
    huge.style.rotateDeg = 181;
    expect(validateSettlementNameSettings(huge).errors).toEqual(expect.arrayContaining(["style.fontPx", "style.rotateDeg"]));
  });

  test("normalizes rotation into -180..180 and rejects non-numbers", () => {
    expect(normalizeRotationDeg(190)).toBe(-170);
    expect(normalizeRotationDeg(180)).toBe(-180);
    expect(normalizeRotationDeg(-180)).toBe(-180);
    expect(() => normalizeRotationDeg(true)).toThrow(TypeError);
    expect(() => normalizeRotationDeg(Number.NaN)).toThrow(TypeError);
  });

  test("rejects unknown ids and mixed operation fields", () => {
    const settings = settingsFixture();
    const unknown = validateSettlementNameOperation({
      action: "set_settlement_names",
      operation: "position",
      output: "left",
      citycode: "9999",
      position: { x: 10, y: 10 },
      baseRevision: 1,
      sourceId: "11111111-1111-4111-8111-111111111111",
      timestamp: "2026-09-29T00:00:00.000Z",
    }, settings);
    expect(unknown.errors).toContain("citycode");

    const mixed = validateSettlementNameOperation({
      action: "set_settlement_names",
      operation: "position",
      output: "left",
      citycode: "0067",
      position: { x: 10, y: 10 },
      style: { fontFamily: "Arial", fontPx: 14, rotateDeg: 0 },
      baseRevision: 1,
      sourceId: "11111111-1111-4111-8111-111111111111",
      timestamp: "2026-09-29T00:00:00.000Z",
    }, settings);
    expect(mixed.errors).toContain("operation");
  });

  test("reset removes only that override and leaves the other output untouched", () => {
    const settings = settingsFixture();
    settings.outputs.left["0067"] = { x: 1, y: 2 };
    settings.outputs.right["0067"] = { x: 9, y: 8 };
    const reset = validateSettlementNameOperation({
      action: "set_settlement_names",
      operation: "reset_position",
      output: "left",
      citycode: "0067",
      baseRevision: 2,
      sourceId: "11111111-1111-4111-8111-111111111111",
      timestamp: "2026-09-29T00:00:00.000Z",
    }, settings);
    expect(reset.errors).toEqual([]);
    expect(reset.settings.outputs.left["0067"]).toBeUndefined();
    expect(reset.settings.outputs.right["0067"]).toEqual({ x: 9, y: 8 });
    expect(reset.settings.baseline).toEqual(settings.baseline);
    expect(effectiveSettlementPosition(reset.settings, "left", "0067")).toEqual({ x: 510, y: 350 });
  });

  test("accepts a newer snapshot and refuses an older or conflicting equal revision", () => {
    const current = { revision: 2, settings: settingsFixture() };
    const older = acceptSettlementNameSnapshot(current, { revision: 1, settings: settingsFixture() });
    expect(older).toBe(current);
    const changed = settingsFixture();
    changed.style = { ...changed.style, fontPx: 16 };
    const conflict = acceptSettlementNameSnapshot(current, { revision: 2, settings: changed });
    expect(conflict.requiresFreshRead).toBe(true);
    expect(conflict.settings.style.fontPx).toBe(14);
    const next = acceptSettlementNameSnapshot(current, { revision: 3, settings: changed });
    expect(next.revision).toBe(3);
    expect(next.settings.style.fontPx).toBe(16);
  });

  test("shared captured style must match both outputs", () => {
    const layout = { "text-font": ["Guttman Hatzvi", "Noto Sans Regular"], "text-size": 14, "text-rotate": 35 };
    expect(sharedCapturedStyle(layout, layout)).toEqual({ fontFamily: "Guttman Hatzvi", fontPx: 14, rotateDeg: 35 });
    expect(() => sharedCapturedStyle(layout, { ...layout, "text-size": 18 })).toThrow(/conflict/i);
  });
});

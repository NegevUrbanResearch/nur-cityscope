import { describe, expect, it } from "vitest";
import {
  LEGEND_LAYOUT_DEFAULT,
  clampLegendLayout,
  normalizeLegendColumns,
  resolveLegendLayout,
} from "../../frontend/src/projection/legend-layout.js";

describe("passive legend layout resolution", () => {
  it("uses an existing span placement and preserves saved geometry", () => {
    const saved = { ...LEGEND_LAYOUT_DEFAULT, leftPct: 12, widthPct: 30 };
    expect(resolveLegendLayout({ settings: { projection: { left: saved } }, span: "left" }))
      .toEqual(saved);
  });

  it("uses full placement when a split span has no saved record", () => {
    const full = { ...LEGEND_LAYOUT_DEFAULT, topPct: 42 };
    expect(resolveLegendLayout({ settings: { projection: { full } }, span: "right" }))
      .toEqual(full);
  });

  it("uses the established default for a missing slot without writing", () => {
    expect(resolveLegendLayout({ settings: {}, span: "left" })).toEqual(LEGEND_LAYOUT_DEFAULT);
  });

  it("normalizes saved columns without coercion and defaults missing or invalid values to auto", () => {
    expect(LEGEND_LAYOUT_DEFAULT.columns).toBe(0);
    expect(normalizeLegendColumns(undefined)).toBe(0);
    for (const columns of [0, 1, 2, 3]) {
      expect(normalizeLegendColumns(columns)).toBe(columns);
      expect(clampLegendLayout({ columns }).columns).toBe(columns);
    }
    for (const columns of [-1, 4, 1.5, "2", null, true, false]) {
      expect(normalizeLegendColumns(columns)).toBe(0);
      expect(clampLegendLayout({ columns }).columns).toBe(0);
    }
  });

  it("preserves columns in saved full-slot fallback", () => {
    const full = { ...LEGEND_LAYOUT_DEFAULT, columns: 2, topPct: 42 };
    expect(resolveLegendLayout({ settings: { projection: { full } }, span: "right" }))
      .toEqual(full);
  });
});

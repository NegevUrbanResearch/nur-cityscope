import { describe, expect, it } from "vitest";
import {
  LEGEND_LAYOUT_DEFAULT,
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
});

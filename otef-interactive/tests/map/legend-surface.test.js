import { describe, expect, it } from "vitest";
import { shouldIncludeLayerInLegend } from "../../frontend/src/map/legend-model-builder.js";
import { shouldShowLayerOnGisMap } from "../../frontend/src/shared/gis-layer-filter.js";

describe("shouldIncludeLayerInLegend", () => {
  it("strips projector-only layers on gis and keeps them on projection", () => {
    expect(shouldShowLayerOnGisMap("projector_base", "שמות_יישובים")).toBe(false);
    expect(shouldIncludeLayerInLegend("projector_base", "שמות_יישובים", "gis")).toBe(false);
    expect(shouldIncludeLayerInLegend("projector_base", "שמות_יישובים", "projection")).toBe(true);
    expect(shouldIncludeLayerInLegend("nli", "investigation_polygons", "gis")).toBe(true);
    expect(shouldIncludeLayerInLegend("nli", "investigation_polygons", "projection")).toBe(true);
  });
});

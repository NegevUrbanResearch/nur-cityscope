import { describe, expect, it } from "vitest";
import {
  buildLegendModel,
  shouldIncludeLayerInLegend,
} from "../../frontend/src/map/legend-model-builder.js";
import { shouldShowLayerOnGisMap } from "../../frontend/src/shared/gis-layer-filter.js";

describe("shouldIncludeLayerInLegend", () => {
  it("strips projector base layers from both legend surfaces", () => {
    expect(shouldShowLayerOnGisMap("projector_base", "שמות_יישובים")).toBe(false);
    expect(shouldIncludeLayerInLegend("projector_base", "שמות_יישובים", "gis")).toBe(false);
    expect(shouldIncludeLayerInLegend("projector_base", "שמות_יישובים", "projection")).toBe(false);
    expect(shouldIncludeLayerInLegend("nli", "investigation_polygons", "gis")).toBe(true);
    expect(shouldIncludeLayerInLegend("nli", "investigation_polygons", "projection")).toBe(true);
  });

  it("strips Gaza roads from both legend surfaces", () => {
    expect(shouldIncludeLayerInLegend("gaza", "Gaza_Roads", "gis")).toBe(false);
    expect(shouldIncludeLayerInLegend("gaza", "Gaza_Roads", "projection")).toBe(false);
    expect(shouldIncludeLayerInLegend("gaza", "gaza_boundary", "gis")).toBe(true);
    expect(shouldIncludeLayerInLegend("gaza", "gaza_boundary", "projection")).toBe(true);
  });

  it("omits an enabled projector base pack from the built model", async () => {
    const style = {
      renderer: "simple",
      defaultSymbol: {
        symbolLayers: [{ type: "markerPoint", marker: { fillColor: "#123456", size: 12 } }],
      },
    };
    const group = {
      id: "projector_base",
      layers: [{ id: "שמות_יישובים", enabled: true }],
    };
    const model = await buildLegendModel({
      surface: "projection",
      dataContext: { getLayerGroups: () => [group] },
      registry: {
        _initialized: true,
        getGroups: () => [group],
        getLayerConfig: () => ({
          id: "שמות_יישובים",
          name: "שמות_יישובים",
          geometryType: "point",
          style,
        }),
        getPackStyleJsonForLayer: () => style,
      },
    });

    expect(model.packs).toEqual([]);
  });

  it("rejects unknown surfaces instead of silently changing the model", () => {
    expect(() => shouldIncludeLayerInLegend("nli", "people", "other")).toThrow(
      "unknown legend surface: other",
    );
    expect(() => shouldIncludeLayerInLegend("projector_base", "ישובים", "other")).toThrow(
      "unknown legend surface: other",
    );
  });
});

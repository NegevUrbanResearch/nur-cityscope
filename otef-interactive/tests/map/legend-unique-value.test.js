import { describe, expect, it } from "vitest";
import { legendLayerFromConfig } from "../../frontend/src/map/legend-model-builder.js";
import { NLI_VISUAL_TOKENS } from "../../frontend/src/shared/nli-investigation-theme.js";
import { NLI_LEGEND_SHORT_LABELS } from "../../frontend/src/shared/nli-investigation-legend.js";

function uniqueValuePointConfig({ legendLabel } = {}) {
  const config = {
    geometryType: "point",
    name: "fixture_people",
    style: {
      renderer: "uniqueValue",
      uniqueValues: {
        field: "status",
        classes: [
          {
            value: "Murdered",
            label: "Murdered",
            symbol: {
              symbolLayers: [
                {
                  type: "markerPoint",
                  marker: { fillColor: "#b42318", size: 16 },
                },
              ],
            },
          },
          {
            value: "Killed on duty",
            label: "Killed on duty",
            symbol: {
              symbolLayers: [
                {
                  type: "markerPoint",
                  marker: { fillColor: "#175cd3", size: 16 },
                },
              ],
            },
          },
        ],
      },
      defaultSymbol: {
        symbolLayers: [
          { type: "markerPoint", marker: { fillColor: "#808080", size: 16 } },
        ],
      },
    },
  };
  if (legendLabel) {
    config.ui = { legendLabel };
  }
  return config;
}

describe("legendLayerFromConfig uniqueValue", () => {
  it("collapses to one row when ui.legendLabel is set", () => {
    const layer = legendLayerFromConfig(
      uniqueValuePointConfig({ legendLabel: "Roads" }),
      { id: "Gaza_Roads" },
    );
    expect(layer.name).toBe("Roads");
    expect(layer.items).toHaveLength(1);
    expect(layer.items[0].label).toBe("Roads");
    expect(layer.items[0].fill).toBe("#b42318");
  });

  it("lists each class color when ui.legendLabel is absent", () => {
    const layer = legendLayerFromConfig(uniqueValuePointConfig(), {
      id: "fixture_people",
    });
    expect(layer.name).toBe("fixture_people");
    expect(layer.items).toHaveLength(2);
    expect(layer.items.map((item) => item.label)).toEqual([
      "Murdered",
      "Killed on duty",
    ]);
    expect(layer.items.map((item) => item.fill)).toEqual([
      "#b42318",
      "#175cd3",
    ]);
    expect(layer.items.map((item) => item.shape)).toEqual(["point", "point"]);
  });

  it("uses square legend swatches when marker.shape is square", () => {
    const layer = legendLayerFromConfig(
      {
        geometryType: "point",
        name: "fixture_catalog",
        style: {
          renderer: "uniqueValue",
          uniqueValues: {
            field: "categories",
            classes: [
              {
                value: "Victims of terrorism",
                label: "Victims of terrorism",
                symbol: {
                  symbolLayers: [
                    {
                      type: "markerPoint",
                      marker: { shape: "square", fillColor: "#d97706", size: 24 },
                    },
                  ],
                },
              },
            ],
          },
          defaultSymbol: {
            symbolLayers: [
              { type: "markerPoint", marker: { shape: "square", fillColor: "#808080", size: 24 } },
            ],
          },
        },
      },
      { id: "fixture_catalog" },
    );
    expect(layer.items).toHaveLength(1);
    expect(layer.items[0].shape).toBe("square");
  });

  it("expands nli.investigation_polygons to three category rows and ignores ui.legendLabel collapse", () => {
    const config = {
      name: "investigation_polygons",
      geometryType: "polygon",
      ui: { legendLabel: "Investigation polygons" },
      style: {
        renderer: "uniqueValue",
        uniqueValues: {
          field: "Notes",
          classes: [
            { value: "x", label: "host orange", symbol: { symbolLayers: [{ type: "fill", color: "#f79009" }] } },
          ],
        },
      },
    };
    const layer = legendLayerFromConfig(config, { id: "investigation_polygons" }, {
      fullId: "nli.investigation_polygons",
    });
    expect(layer.items).toHaveLength(3);
    expect(layer.items.map((item) => item.label)).toEqual([
      "מוקד קרב/טבח",
      "מוקד שריפה",
      "מוקד חטיפה",
    ]);
    expect(layer.items.map((item) => item.fill)).toEqual([
      NLI_VISUAL_TOKENS.polygonCategories["מרחב לחימה - קרב"].fill,
      NLI_VISUAL_TOKENS.polygonCategories["שריפה"].fill,
      "#ffff73",
    ]);
    expect(layer.items.every((item) => item.shape === "polygon")).toBe(true);
    expect(layer.items.map((item) => item.fill)).not.toContain("#f79009");
    expect(NLI_LEGEND_SHORT_LABELS["מרחב לחימה - קרב"]).toBe("מוקד קרב/טבח");
  });

  it("uses raw processed style classes for gradient swatches", () => {
    const config = {
      name: "investigation_polygons",
      geometryType: "polygon",
      style: {
        renderer: "uniqueValue",
        defaultStyle: { fillColor: "#808080" },
      },
    };
    const rawStyle = {
      renderer: "uniqueValue",
      uniqueValues: {
        field: "Notes",
        classes: [
          {
            value: "מרחב לחימה - קרב",
            displayLabel: "מוקד קרב/טבח",
            symbol: {
              symbolLayers: [
                { type: "stroke", color: "#123456" },
                { type: "fill", fillType: "gradient", resolvedColors: ["#111111", "#222222", "#333333"] },
              ],
            },
          },
          { value: "שריפה", displayLabel: "מוקד שריפה", symbol: { symbolLayers: [{ type: "fill", fillType: "gradient", resolvedColors: ["#444444", "#555555"] }] } },
          { value: "מוקד חטיפה", displayLabel: "מוקד חטיפה", symbol: { symbolLayers: [{ type: "fill", color: "#ffff73" }] } },
        ],
      },
    };
    const layer = legendLayerFromConfig(config, { id: "investigation_polygons" }, {
      fullId: "nli.investigation_polygons",
      rawStyle,
    });
    expect(layer.items[0].fill).toContain("#111111");
    expect(layer.items[0].fill).toContain("#333333");
    expect(layer.items[0].fill).not.toContain("#808080");
    expect(layer.items[0].stroke).toBe("#123456");
  });
});

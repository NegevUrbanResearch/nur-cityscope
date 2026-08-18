import { describe, expect, it } from "vitest";
import { legendLayerFromConfig } from "../../frontend/src/map/legend-model-builder.js";

function uniqueValuePointConfig({ legendLabel } = {}) {
  const config = {
    geometryType: "point",
    name: "oct7_database",
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
      id: "oct7_database",
    });
    expect(layer.name).toBe("oct7_database");
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
        name: "nli_catalog",
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
      { id: "nli_catalog" },
    );
    expect(layer.items).toHaveLength(1);
    expect(layer.items[0].shape).toBe("square");
  });
});

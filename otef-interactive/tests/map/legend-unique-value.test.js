import { describe, expect, it } from "vitest";
import { legendLayerFromConfig } from "../../frontend/src/map/legend-model-builder.js";

function peopleStatusClass(value, fillColor) {
  return {
    value,
    label: value,
    symbol: {
      symbolLayers: [
        {
          type: "markerPoint",
          marker: { fillColor, size: 16 },
        },
      ],
    },
  };
}

function peopleStatusConfig() {
  return {
    geometryType: "point",
    name: "people",
    style: {
      renderer: "uniqueValue",
      uniqueValues: {
        field: "status",
        classes: [
          peopleStatusClass("Murdered", "#b42318"),
          peopleStatusClass("Killed on duty", "#175cd3"),
          peopleStatusClass("Kidnap survivor", "#079455"),
          peopleStatusClass("Murdered in captivity", "#7a2222"),
        ],
      },
    },
  };
}

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
  it("keeps one row per class when ui.legendLabel is set", () => {
    const layer = legendLayerFromConfig(
      uniqueValuePointConfig({ legendLabel: "Roads" }),
      { id: "Gaza_Roads" },
    );
    expect(layer.name).toBe("Roads");
    expect(layer.items).toHaveLength(2);
    expect(layer.items.map((item) => item.label)).toEqual([
      "Murdered",
      "Killed on duty",
    ]);
    expect(layer.items[0].fill).toBe("#b42318");
  });

  it("omits kidnap survivors from the nli.people legend in general view", () => {
    const layer = legendLayerFromConfig(peopleStatusConfig(), { id: "people" }, {
      fullId: "nli.people",
      narrativeId: null,
    });
    expect(layer.items.map((item) => item.label)).toEqual([
      "Murdered",
      "Killed on duty",
      "Murdered in captivity",
    ]);
  });

  it("keeps only kidnap survivors on the nli.people legend during hostages", () => {
    const layer = legendLayerFromConfig(peopleStatusConfig(), { id: "people" }, {
      fullId: "nli.people",
      narrativeId: "hostages",
    });
    expect(layer.items.map((item) => item.label)).toEqual(["Kidnap survivor"]);
  });

  it("keeps every nli.people status class during nova", () => {
    const layer = legendLayerFromConfig(peopleStatusConfig(), { id: "people" }, {
      fullId: "nli.people",
      narrativeId: "nova",
    });
    expect(layer.items.map((item) => item.label)).toEqual([
      "Murdered",
      "Killed on duty",
      "Kidnap survivor",
      "Murdered in captivity",
    ]);
  });

  it("does not filter uniqueValue classes for unrelated layers", () => {
    const layer = legendLayerFromConfig(peopleStatusConfig(), { id: "people" }, {
      fullId: "nli.other_points",
      narrativeId: "hostages",
    });
    expect(layer.items).toHaveLength(4);
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

  it("uses authoritative raw processed classes for investigation polygon swatches", () => {
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

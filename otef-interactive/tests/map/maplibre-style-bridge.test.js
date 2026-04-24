import { describe, expect, it } from "vitest";
import {
  irToMapLibreLayers,
} from "../../frontend/src/shared/maplibre-style-bridge.js";

describe("irToMapLibreLayers", () => {
  it("converts a simple solid-fill polygon layer", () => {
    const layerConfig = {
      geometryType: "polygon",
      style: {
        renderer: "simple",
        defaultSymbol: {
          symbolLayers: [
            { type: "fill", fillType: "solid", color: "#ffdf7f", opacity: 1.0 },
            { type: "stroke", color: "#000000", width: 1.0, opacity: 1.0 },
          ],
        },
      },
    };

    const result = irToMapLibreLayers("land_use.מגורים", "land_use__מגורים", layerConfig);

    expect(result).toHaveLength(2);

    const fill = result.find((layer) => layer.type === "fill");
    expect(fill).toBeDefined();
    expect(fill.paint["fill-color"]).toBe("#ffdf7f");
    expect(fill.paint["fill-opacity"]).toBe(1.0);

    const line = result.find((layer) => layer.type === "line");
    expect(line).toBeDefined();
    expect(line.paint["line-color"]).toBe("#000000");
    expect(line.paint["line-width"]).toBe(1.0);
  });

  it("converts a uniqueValue renderer with match expression", () => {
    const layerConfig = {
      geometryType: "polygon",
      style: {
        renderer: "uniqueValue",
        uniqueValues: {
          field: "mimush",
          classes: [
            {
              value: "0",
              symbol: {
                symbolLayers: [
                  { type: "fill", fillType: "solid", color: "#d76e89", opacity: 1.0 },
                ],
              },
            },
            {
              value: "1",
              symbol: {
                symbolLayers: [
                  { type: "fill", fillType: "solid", color: "#76b5c5", opacity: 1.0 },
                ],
              },
            },
          ],
        },
        defaultSymbol: {
          symbolLayers: [
            { type: "fill", fillType: "solid", color: "#808080", opacity: 1.0 },
          ],
        },
      },
    };

    const result = irToMapLibreLayers("test.layer", "test__layer", layerConfig);
    const fill = result.find((layer) => layer.type === "fill");
    expect(fill.paint["fill-color"]).toEqual([
      "match",
      ["get", "mimush"],
      "0",
      "#d76e89",
      "1",
      "#76b5c5",
      "#808080",
    ]);
  });

  it("converts a circle marker layer", () => {
    const layerConfig = {
      geometryType: "point",
      style: {
        renderer: "simple",
        defaultSymbol: {
          symbolLayers: [
            {
              type: "markerPoint",
              marker: { size: 8, fill: "#a83800", stroke: "#000000", strokeWidth: 1 },
            },
          ],
        },
      },
    };

    const result = irToMapLibreLayers("test.points", "test__points", layerConfig);
    const circle = result.find((layer) => layer.type === "circle");
    expect(circle).toBeDefined();
    expect(circle.paint["circle-radius"]).toBe(4);
    expect(circle.paint["circle-color"]).toBe("#a83800");
  });

  it("converts a line layer with dash array", () => {
    const layerConfig = {
      geometryType: "line",
      style: {
        renderer: "simple",
        defaultSymbol: {
          symbolLayers: [
            {
              type: "stroke",
              color: "#ff0000",
              width: 2,
              opacity: 1.0,
              dash: { array: [4, 4] },
            },
          ],
        },
      },
    };

    const result = irToMapLibreLayers("test.dashed", "test__dashed", layerConfig);
    const line = result.find((layer) => layer.type === "line");
    expect(line.paint["line-dasharray"]).toEqual([4, 4]);
  });

  it("emits default stroke layer when classes only override fill", () => {
    const layerConfig = {
      geometryType: "polygon",
      style: {
        renderer: "uniqueValue",
        uniqueValues: {
          field: "zone",
          classes: [
            {
              value: "a",
              symbol: {
                symbolLayers: [{ type: "fill", color: "#ff0000", opacity: 0.7 }],
              },
            },
          ],
        },
        defaultSymbol: {
          symbolLayers: [
            { type: "fill", color: "#cccccc", opacity: 0.4 },
            { type: "stroke", color: "#111111", width: 2, lineCap: "round", lineJoin: "bevel" },
          ],
        },
      },
    };

    const result = irToMapLibreLayers("test.partial", "test__partial", layerConfig);
    expect(result).toHaveLength(2);

    const fill = result.find((layer) => layer.type === "fill");
    const stroke = result.find((layer) => layer.type === "line");

    expect(fill).toBeDefined();
    expect(stroke).toBeDefined();
    expect(stroke.paint["line-color"]).toBe("#111111");
    expect(stroke.paint["line-width"]).toBe(2);
    expect(stroke.layout["line-cap"]).toBe("round");
    expect(stroke.layout["line-join"]).toBe("bevel");
  });

  it("uses literal arrays in uniqueValue dashed stroke match expression", () => {
    const layerConfig = {
      geometryType: "line",
      style: {
        renderer: "uniqueValue",
        uniqueValues: {
          field: "kind",
          classes: [
            {
              value: "primary",
              symbol: {
                symbolLayers: [
                  { type: "stroke", color: "#f00", width: 2, dash: { array: [2, 1] } },
                ],
              },
            },
            {
              value: "secondary",
              symbol: {
                symbolLayers: [
                  { type: "stroke", color: "#00f", width: 2, dash: { array: [6, 2] } },
                ],
              },
            },
          ],
        },
        defaultSymbol: {
          symbolLayers: [{ type: "stroke", color: "#222", width: 1, dash: { array: [1, 1] } }],
        },
      },
    };

    const result = irToMapLibreLayers("test.matchdash", "test__matchdash", layerConfig);
    const line = result.find((layer) => layer.type === "line");

    expect(line.paint["line-dasharray"]).toEqual([
      "match",
      ["get", "kind"],
      "primary",
      ["literal", [2, 1]],
      "secondary",
      ["literal", [6, 2]],
      ["literal", [1, 1]],
    ]);
  });

  it("ignores classes with missing value while building expressions", () => {
    const layerConfig = {
      geometryType: "polygon",
      style: {
        renderer: "uniqueValue",
        uniqueValues: {
          field: "mimush",
          classes: [
            {
              symbol: {
                symbolLayers: [{ type: "fill", color: "#123456", opacity: 0.8 }],
              },
            },
            {
              value: "1",
              symbol: {
                symbolLayers: [{ type: "fill", color: "#76b5c5", opacity: 1.0 }],
              },
            },
          ],
        },
        defaultSymbol: {
          symbolLayers: [{ type: "fill", color: "#808080", opacity: 1.0 }],
        },
      },
    };

    const result = irToMapLibreLayers("test.missing", "test__missing", layerConfig);
    const fill = result.find((layer) => layer.type === "fill");

    expect(fill.paint["fill-color"]).toEqual([
      "match",
      ["get", "mimush"],
      "1",
      "#76b5c5",
      "#808080",
    ]);
  });
});

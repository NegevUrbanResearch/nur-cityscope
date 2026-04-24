import { describe, expect, it } from "vitest";
import {
  irToMapLibreLayers,
} from "../../frontend/src/shared/maplibre-style-bridge.js";

function assertPaintHasNoNullish(paint) {
  for (const v of Object.values(paint)) {
    expect(v).not.toBeUndefined();
    expect(v).not.toBeNull();
  }
}

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

  it("uses class stroke/fill at each index when default order is fill-then-stroke (חניון-style)", () => {
    const layerConfig = {
      geometryType: "polygon",
      style: {
        renderer: "uniqueValue",
        uniqueValues: {
          field: "code",
          classes: [
            {
              value: "parking",
              symbol: {
                label: "חניון",
                symbolLayers: [
                  { type: "stroke", color: "#1a1a1a", width: 1, opacity: 1 },
                  { type: "fill", color: "#c8c8c8", opacity: 0.4 },
                  { type: "fill", color: "#b0b0b0", opacity: 0.2 },
                  { type: "fill", color: "#989898", opacity: 0.1 },
                ],
              },
            },
            {
              value: "retail",
              symbol: {
                symbolLayers: [
                  { type: "stroke", color: "#0066cc", width: 1.5, opacity: 1 },
                  { type: "fill", color: "#e6f0ff", opacity: 0.5 },
                  { type: "fill", color: "#d0e0f5", opacity: 0.3 },
                  { type: "fill", color: "#bad4eb", opacity: 0.15 },
                ],
              },
            },
          ],
        },
        defaultSymbol: {
          symbolLayers: [
            { type: "fill", color: "#e0e0e0", opacity: 0.3 },
            { type: "stroke", color: "#333333", width: 2, opacity: 1 },
          ],
        },
      },
    };

    const result = irToMapLibreLayers("landuse.layer", "landuse__layer", layerConfig);

    const byId = new Map(result.map((l) => [l.id, l]));
    const line0 = byId.get("landuse__layer__line__0");
    const fill0 = byId.get("landuse__layer__fill__0");
    const fill1 = byId.get("landuse__layer__fill__1");
    const fill2 = byId.get("landuse__layer__fill__2");
    const fill3 = byId.get("landuse__layer__fill__3");

    expect(line0).toBeDefined();
    expect(line0.type).toBe("line");
    expect(fill0).toBeDefined();
    expect(fill0.type).toBe("fill");
    expect(fill1?.type).toBe("fill");
    expect(fill2?.type).toBe("fill");
    expect(fill3?.type).toBe("fill");

    expect(line0.paint["line-color"]).toEqual([
      "match",
      ["get", "code"],
      "parking",
      "#1a1a1a",
      "retail",
      "#0066cc",
      "#1a1a1a",
    ]);
    expect(line0.paint["line-width"]).toEqual([
      "match",
      ["get", "code"],
      "parking",
      1,
      "retail",
      1.5,
      1,
    ]);

    expect(fill1?.paint["fill-color"]).toEqual([
      "match",
      ["get", "code"],
      "parking",
      "#c8c8c8",
      "retail",
      "#e6f0ff",
      "#c8c8c8",
    ]);

    for (const layer of result) {
      assertPaintHasNoNullish(layer.paint);
      for (const v of Object.values(layer.layout)) {
        expect(v).not.toBeUndefined();
        expect(v).not.toBeNull();
      }
    }
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

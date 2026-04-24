import { describe, expect, it, vi } from "vitest";
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

  it("maps marker fillColor to circle-color when fill is absent (OTEF IR parity)", () => {
    const layerConfig = {
      geometryType: "point",
      style: {
        renderer: "simple",
        defaultSymbol: {
          symbolLayers: [
            { type: "markerPoint", marker: { fillColor: "#e84a5f", size: 10 } },
          ],
        },
      },
    };

    const result = irToMapLibreLayers("g.points", "g__points", layerConfig);
    const circle = result.find((layer) => layer.type === "circle");
    expect(circle.paint["circle-color"]).toBe("#e84a5f");
    expect(circle.paint["circle-radius"]).toBe(5);
  });

  it("resolves uniqueValue point color from marker.fillColor in match expressions", () => {
    const layerConfig = {
      geometryType: "point",
      style: {
        renderer: "uniqueValue",
        uniqueValues: {
          field: "kind",
          classes: [
            {
              value: "a",
              symbol: {
                symbolLayers: [
                  { type: "markerPoint", marker: { fillColor: "#e84a5f", size: 8 } },
                ],
              },
            },
            {
              value: "b",
              symbol: {
                symbolLayers: [
                  { type: "markerPoint", marker: { fillColor: "#00ff00", size: 8 } },
                ],
              },
            },
          ],
        },
        defaultSymbol: {
          symbolLayers: [
            { type: "markerPoint", marker: { fillColor: "#999999", size: 8 } },
          ],
        },
      },
    };

    const result = irToMapLibreLayers("t.pts", "t__pts", layerConfig);
    const circle = result.find((layer) => layer.type === "circle");
    expect(circle.paint["circle-color"]).toEqual([
      "match",
      ["get", "kind"],
      "a",
      "#e84a5f",
      "b",
      "#00ff00",
      "#999999",
    ]);
  });

  it("uses gray fallback and sets _uniqueValuePointColorFallback when no point color is resolvable (no console in bridge)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const layerConfig = {
      geometryType: "point",
      style: {
        renderer: "uniqueValue",
        uniqueValues: {
          field: "k",
          classes: [
            { value: "a", symbol: { symbolLayers: [{ type: "markerPoint", marker: { size: 8 } }] } },
          ],
        },
        defaultSymbol: {
          symbolLayers: [{ type: "markerPoint", marker: { size: 8 } }],
        },
      },
    };
    const result = irToMapLibreLayers("t.nocolor", "t__nocolor", layerConfig);
    const circle = result.find((layer) => layer.type === "circle");
    expect(circle.paint["circle-color"]).toBe("#808080");
    expect(circle._uniqueValuePointColorFallback).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
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

  it("keeps markerLine visible in simple renderer via line fallback", () => {
    const layerConfig = {
      geometryType: "line",
      style: {
        renderer: "simple",
        defaultSymbol: {
          symbolLayers: [
            {
              type: "markerLine",
              marker: {
                strokeColor: "#895a44",
                strokeWidth: 5.333333333333333,
              },
              placement: { mode: "interval", interval: 18 },
            },
          ],
        },
      },
    };

    const result = irToMapLibreLayers("test.markerline", "test__markerline", layerConfig);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("line");
    expect(result[0].paint["line-color"]).toBe("#895a44");
    expect(result[0].paint["line-width"]).toBe(5.333333333333333);
    expect(result[0]._markerLineFallback).toBe(true);
  });

  it("builds uniqueValue markerLine fallback match expressions", () => {
    const layerConfig = {
      geometryType: "line",
      style: {
        renderer: "uniqueValue",
        uniqueValues: {
          field: "kind",
          classes: [
            {
              value: "a",
              symbol: {
                symbolLayers: [
                  { type: "markerLine", marker: { strokeColor: "#ff0000", strokeWidth: 2 } },
                ],
              },
            },
            {
              value: "b",
              symbol: {
                symbolLayers: [
                  { type: "markerLine", marker: { strokeColor: "#00ff00", strokeWidth: 4 } },
                ],
              },
            },
          ],
        },
        defaultSymbol: {
          symbolLayers: [{ type: "markerLine", marker: { strokeColor: "#222222", strokeWidth: 1 } }],
        },
      },
    };

    const result = irToMapLibreLayers("test.markerline.unique", "test__markerline__unique", layerConfig);
    const line = result.find((layer) => layer.type === "line");
    expect(line).toBeDefined();
    expect(line.id).toBe("test__markerline__unique__markerLineFallback__0");
    expect(line.paint["line-color"]).toEqual([
      "match",
      ["get", "kind"],
      "a",
      "#ff0000",
      "b",
      "#00ff00",
      "#222222",
    ]);
    expect(line.paint["line-width"]).toEqual([
      "match",
      ["get", "kind"],
      "a",
      2,
      "b",
      4,
      1,
    ]);
    expect(line._markerLineFallback).toBe(true);
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
    const fill0 = byId.get("landuse__layer__fill__solid__0");
    const fill1 = byId.get("landuse__layer__fill__solid__1");
    const fill2 = byId.get("landuse__layer__fill__solid__2");
    const fill3 = byId.get("landuse__layer__fill__solid__3");

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

  it("emits fill-pattern and hatch metadata for simple hatch fill", () => {
    const layerConfig = {
      geometryType: "polygon",
      style: {
        renderer: "simple",
        defaultSymbol: {
          symbolLayers: [
            {
              type: "fill",
              fillType: "hatch",
              hatch: { color: "#000000", rotation: 45, separation: 10, width: 2 },
              opacity: 0.5,
            },
          ],
        },
      },
    };

    const result = irToMapLibreLayers("test.hatch", "test__hatch", layerConfig);
    const fill = result.find((layer) => layer.type === "fill");
    expect(fill.paint["fill-pattern"]).toBe("hatch_#000000_45_10_2");
    expect(fill.paint["fill-color"]).toBeUndefined();
    expect(fill.paint["fill-opacity"]).toBe(0.5);
    expect(fill._hatchPattern).toBeDefined();
    expect(fill._hatchPattern.patternId).toBe("hatch_#000000_45_10_2");
  });

  it("uses fill-pattern match and _hatchPatterns for uniqueValue hatch", () => {
    const layerConfig = {
      geometryType: "polygon",
      style: {
        renderer: "uniqueValue",
        uniqueValues: {
          field: "kind",
          classes: [
            {
              value: "a",
              symbol: {
                symbolLayers: [
                  {
                    type: "fill",
                    fillType: "hatch",
                    hatch: { color: "#111111", rotation: 0, separation: 8, width: 1 },
                  },
                ],
              },
            },
            {
              value: "b",
              symbol: {
                symbolLayers: [
                  {
                    type: "fill",
                    fillType: "hatch",
                    hatch: { color: "#222222", rotation: 30, separation: 12, width: 2 },
                  },
                ],
              },
            },
          ],
        },
        defaultSymbol: {
          symbolLayers: [
            {
              type: "fill",
              fillType: "hatch",
              hatch: { color: "#808080", rotation: 0, separation: 8, width: 1 },
            },
          ],
        },
      },
    };

    const result = irToMapLibreLayers("z.layer", "z__layer", layerConfig);
    const fill = result.find((layer) => layer.type === "fill");
    expect(fill.id).toBe("z__layer__fill__hatch__0");
    expect(fill.paint["fill-color"]).toBeUndefined();
    expect(fill.paint["fill-pattern"]).toEqual([
      "match",
      ["get", "kind"],
      "a",
      "hatch_#111111_0_8_1",
      "b",
      "hatch_#222222_30_12_2",
      "hatch_#808080_0_8_1",
    ]);
    expect(Array.isArray(fill._hatchPatterns)).toBe(true);
    const ids = fill._hatchPatterns.map((s) => s.patternId).sort();
    expect(ids).toEqual([
      "hatch_#111111_0_8_1",
      "hatch_#222222_30_12_2",
      "hatch_#808080_0_8_1",
    ]);
  });

  it("splits uniqueValue fill at the same index into solid vs hatch groups", () => {
    const layerConfig = {
      geometryType: "polygon",
      style: {
        renderer: "uniqueValue",
        uniqueValues: {
          field: "t",
          classes: [
            {
              value: "h",
              symbol: {
                symbolLayers: [
                  {
                    type: "fill",
                    fillType: "hatch",
                    hatch: { color: "#ff0000", rotation: 0, separation: 8, width: 1 },
                  },
                ],
              },
            },
            {
              value: "s",
              symbol: {
                symbolLayers: [
                  { type: "fill", fillType: "solid", color: "#00ff00", opacity: 1 },
                ],
              },
            },
          ],
        },
        defaultSymbol: {
          symbolLayers: [{ type: "fill", fillType: "solid", color: "#808080" }],
        },
      },
    };

    const result = irToMapLibreLayers("m.layer", "m__layer", layerConfig);
    const hatchFill = result.find((l) => l.id === "m__layer__fill__hatch__0");
    const solidFill = result.find((l) => l.id === "m__layer__fill__solid__0");
    expect(hatchFill).toBeDefined();
    expect(solidFill).toBeDefined();
    expect(hatchFill.paint["fill-pattern"]).toBeDefined();
    expect(solidFill.paint["fill-color"]).toBeDefined();
  });
});

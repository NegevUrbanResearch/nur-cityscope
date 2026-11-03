import { describe, expect, it } from "vitest";
import {
  BUFFERED_GRADIENT_BAND_PROPERTY,
  buildBufferedGradientRenderPlan,
  hasUsableBufferedGradient,
  isBufferedGradientStyle,
} from "../../frontend/src/shared/cim-buffered-gradient.js";

const style = {
  renderer: "uniqueValue",
  uniqueValues: {
    field: "Notes",
    classes: [
      {
        value: "מרחב לחימה - קרב",
        symbol: {
          symbolLayers: [
            { type: "fill", fillType: "gradient", interval: 2, resolvedColors: ["#111111", "#222222"], opacity: 0.6, enable: true },
            { type: "stroke", color: "#333333", width: 1.5, opacity: 0.8, enable: true, lineCap: "round", lineJoin: "round" },
          ],
        },
      },
      {
        value: "שריפה",
        symbol: {
          symbolLayers: [
            { type: "fill", fillType: "gradient", interval: 1, resolvedColors: ["#444444"], opacity: 0.7, enable: true },
            { type: "stroke", color: "#555555", width: 2, opacity: 0.9, enable: true },
          ],
        },
      },
      {
        value: "מוקד חטיפה",
        symbol: { symbolLayers: [{
          type: "fill",
          fillType: "gradient",
          interval: 5,
          resolvedColors: Array(5).fill("#ffff73"),
          resolvedOpacities: [0.14, 0.27, 0.46, 0.68, 1],
          opacity: 0.14,
          enable: true,
        }] },
      },
    ],
  },
};

describe("CIM buffered-gradient style adapter", () => {
  it("extracts authored bands and enabled outlines without theme colors", () => {
    expect(isBufferedGradientStyle(style)).toBe(true);
    const plan = buildBufferedGradientRenderPlan(style);
    expect(plan.field).toBe("Notes");
    expect(plan.classes["מרחב לחימה - קרב"].bands).toEqual([
      { ordinal: 0, color: "#111111", opacity: 0.6 },
      { ordinal: 1, color: "#222222", opacity: 0.6 },
    ]);
    expect(plan.classes["מרחב לחימה - קרב"].outline).toMatchObject({
      color: "#333333",
      width: 1.5,
      opacity: 0.8,
      lineCap: "round",
      lineJoin: "round",
    });
    expect(plan.classes["שריפה"].bands).toEqual([{ ordinal: 0, color: "#444444", opacity: 0.7 }]);
    expect(plan.classes["מוקד חטיפה"].bands).toEqual([
      { ordinal: 0, color: "#ffff73", opacity: 0.14 },
      { ordinal: 1, color: "#ffff73", opacity: 0.27 },
      { ordinal: 2, color: "#ffff73", opacity: 0.46 },
      { ordinal: 3, color: "#ffff73", opacity: 0.68 },
      { ordinal: 4, color: "#ffff73", opacity: 1 },
    ]);
  });

  it("repeats legacy opacity when resolved opacities are absent", () => {
    const legacyStyle = {
      ...style,
      uniqueValues: {
        ...style.uniqueValues,
        classes: [{
          value: "מוקד חטיפה",
          symbol: { symbolLayers: [{
            type: "fill",
            fillType: "gradient",
            interval: 2,
            resolvedColors: ["#ffff73", "#ffff73"],
            opacity: 0.37,
            enable: true,
          }] },
        }],
      },
    };
    expect(buildBufferedGradientRenderPlan(legacyStyle).classes["מוקד חטיפה"].bands)
      .toEqual([
        { ordinal: 0, color: "#ffff73", opacity: 0.37 },
        { ordinal: 1, color: "#ffff73", opacity: 0.37 },
      ]);
  });

  it.each([
    ["opacity count differs from color count", { interval: 2, colors: ["#111", "#222"], opacities: [0.5] }],
    ["color count differs from integer interval", { interval: 2, colors: ["#111"], opacities: [0.5] }],
    ["opacity count differs from integer interval", { interval: 3, colors: ["#111", "#222"], opacities: [0.5, 0.6] }],
    ["non-number opacity", { interval: 1, colors: ["#111"], opacities: [null] }],
    ["empty-string opacity", { interval: 1, colors: ["#111"], opacities: [""] }],
    ["boolean opacity", { interval: 1, colors: ["#111"], opacities: [false] }],
    ["numeric-string opacity", { interval: 1, colors: ["#111"], opacities: ["0.5"] }],
    ["NaN opacity", { interval: 1, colors: ["#111"], opacities: [Number.NaN] }],
    ["infinite opacity", { interval: 1, colors: ["#111"], opacities: [Number.POSITIVE_INFINITY] }],
    ["negative-infinite opacity", { interval: 1, colors: ["#111"], opacities: [Number.NEGATIVE_INFINITY] }],
    ["negative opacity", { interval: 1, colors: ["#111"], opacities: [-0.01] }],
    ["opacity above one", { interval: 1, colors: ["#111"], opacities: [1.01] }],
    ["invalid short resolved color", { interval: 1, colors: ["#12345"], opacities: [0.5] }],
    ["invalid non-hex resolved color", { interval: 1, colors: ["red"], opacities: [0.5] }],
    ["invalid numeric resolved color", { interval: 1, colors: [123456], opacities: [0.5] }],
  ])("rejects %s", (_label, { interval, colors, opacities }) => {
    const malformedStyle = {
      ...style,
      uniqueValues: {
        ...style.uniqueValues,
        classes: [{
          value: "מוקד חטיפה",
          symbol: { symbolLayers: [{
            type: "fill",
            fillType: "gradient",
            interval,
            resolvedColors: colors,
            resolvedOpacities: opacities,
            opacity: 0.4,
            enable: true,
          }] },
        }],
      },
    };
    expect(() => buildBufferedGradientRenderPlan(malformedStyle)).toThrow();
  });

  it.each([
    ["interval mismatch", { interval: 2, colors: ["#111111"], opacities: [0.5] }],
    ["invalid opacity", { interval: 1, colors: ["#111111"], opacities: [1.1] }],
    ["missing bands", { interval: 1, colors: [] }],
  ])("reports malformed processed metadata as unusable: %s", (_label, { interval, colors, opacities }) => {
    const malformedStyle = {
      ...style,
      uniqueValues: {
        ...style.uniqueValues,
        classes: [{
          value: "מוקד חטיפה",
          symbol: { symbolLayers: [{
            type: "fill", fillType: "gradient", interval,
            resolvedColors: colors, resolvedOpacities: opacities, opacity: 0.4, enable: true,
          }] },
        }],
      },
    };
    expect(hasUsableBufferedGradient(malformedStyle, [
      { properties: { Notes: "מוקד חטיפה" } },
    ])).toBe(false);
  });

  it("rejects unusable sidecar rows and accepts a valid banded polygon", () => {
    expect(hasUsableBufferedGradient(style, [
      { properties: { Notes: "not-a-style-class" } },
    ])).toBe(false);
    expect(hasUsableBufferedGradient(style, [
      {
        properties: { Notes: "מוקד חטיפה", [BUFFERED_GRADIENT_BAND_PROPERTY]: 0 },
        geometry: { type: "Polygon", coordinates: [[[34, 31], [34.01, 31], [34, 31.01], [34, 31]]] },
      },
    ])).toBe(true);
  });

  it.each([
    ["missing band", { properties: { Notes: "מוקד חטיפה" } }],
    ["negative band", { properties: { Notes: "מוקד חטיפה", [BUFFERED_GRADIENT_BAND_PROPERTY]: -1 } }],
    ["out-of-range band", { properties: { Notes: "מוקד חטיפה", [BUFFERED_GRADIENT_BAND_PROPERTY]: 5 } }],
    ["numeric-string band", { properties: { Notes: "מוקד חטיפה", [BUFFERED_GRADIENT_BAND_PROPERTY]: "0" } }],
    ["null geometry", { geometry: null }],
    ["non-polygon geometry", { geometry: { type: "LineString", coordinates: [[34, 31], [34.01, 31.01]] } }],
    ["empty coordinates", { geometry: { type: "Polygon", coordinates: [] } }],
    ["empty ring", { geometry: { type: "Polygon", coordinates: [[]] } }],
    ["empty nested ring", { geometry: { type: "Polygon", coordinates: [[[]]] } }],
    ["null position", { geometry: { type: "Polygon", coordinates: [null] } }],
    ["invalid position", { geometry: { type: "Polygon", coordinates: [[[34, 31], [34], [34, 31], [34, 31]]] } }],
    ["nonfinite position", { geometry: { type: "Polygon", coordinates: [[[34, 31], [34, Number.NaN], [34, 31], [34, 31]]] } }],
  ])("rejects sidecar features with %s", (_label, overrides) => {
    const feature = {
      properties: { Notes: "מוקד חטיפה", [BUFFERED_GRADIENT_BAND_PROPERTY]: 0 },
      geometry: { type: "Polygon", coordinates: [[[34, 31], [34.01, 31], [34, 31.01], [34, 31]]] },
      ...overrides,
    };
    expect(hasUsableBufferedGradient(style, [feature])).toBe(false);
  });

  it.each([
    ["Polygon", { type: "Polygon", coordinates: [[[34, 31], [34.01, 31], [34, 31.01], [34, 31]]] }],
    ["MultiPolygon", { type: "MultiPolygon", coordinates: [[[[34, 31], [34.01, 31], [34, 31.01], [34, 31]]]] }],
  ])("accepts a valid %s sidecar feature", (_label, geometry) => {
    expect(hasUsableBufferedGradient(style, [{
      properties: { Notes: "מוקד חטיפה", [BUFFERED_GRADIENT_BAND_PROPERTY]: 0 },
      geometry,
    }])).toBe(true);
  });

  it.each([
    ["3D Polygon", { type: "Polygon", coordinates: [[[34, 31, 10], [34.01, 31, 10], [34, 31.01, 10], [34, 31, 10]]] }],
    ["4D MultiPolygon", { type: "MultiPolygon", coordinates: [[[[34, 31, 10, 1], [34.01, 31, 10, 1], [34, 31.01, 10, 1], [34, 31, 10, 1]]]] }],
  ])("accepts valid optional-dimension positions in a %s", (_label, geometry) => {
    expect(hasUsableBufferedGradient(style, [{
      properties: { Notes: "מוקד חטיפה", [BUFFERED_GRADIENT_BAND_PROPERTY]: 0 },
      geometry,
    }])).toBe(true);
  });

  it.each([
    ["sparse position", (() => {
      const position = [34];
      position.length = 2;
      return { type: "Polygon", coordinates: [[position, [34.01, 31], [34, 31.01], [34, 31]]] };
    })()],
    ["sparse ring", { type: "Polygon", coordinates: [new Array(4)] }],
    ["sparse polygon", { type: "MultiPolygon", coordinates: [new Array(1)] }],
    ["sparse polygons", { type: "MultiPolygon", coordinates: new Array(1) }],
  ])("rejects %s geometry arrays", (_label, geometry) => {
    expect(hasUsableBufferedGradient(style, [{
      properties: { Notes: "מוקד חטיפה", [BUFFERED_GRADIENT_BAND_PROPERTY]: 0 },
      geometry,
    }])).toBe(false);
  });

  it("does not treat a style without a supported buffered fill as processed", () => {
    expect(isBufferedGradientStyle({ renderer: "uniqueValue", uniqueValues: { classes: [] } })).toBe(false);
  });
});

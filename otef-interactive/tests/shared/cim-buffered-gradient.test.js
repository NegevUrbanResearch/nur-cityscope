import { describe, expect, it } from "vitest";
import {
  buildBufferedGradientRenderPlan,
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
    expect(() => buildBufferedGradientRenderPlan(malformedStyle)).toThrow(/resolvedOpacities/);
  });

  it("does not treat a style without a supported buffered fill as processed", () => {
    expect(isBufferedGradientStyle({ renderer: "uniqueValue", uniqueValues: { classes: [] } })).toBe(false);
  });
});

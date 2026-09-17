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
        symbol: { symbolLayers: [{ type: "fill", fillType: "solid", color: "#ffff73", opacity: 0.55 }] },
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
  });

  it("does not treat a style without a supported buffered fill as processed", () => {
    expect(isBufferedGradientStyle({ renderer: "uniqueValue", uniqueValues: { classes: [] } })).toBe(false);
  });
});

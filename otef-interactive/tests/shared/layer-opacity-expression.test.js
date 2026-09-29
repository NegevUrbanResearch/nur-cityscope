import { describe, expect, it } from "vitest";
import { createPropertyExpression, v8 } from "@maplibre/maplibre-gl-style-spec";
import { peopleFocusOpacityExpression } from "../../frontend/src/shared/nli-people-focus-presentation.js";
import {
  opacityChannelsForLayerType,
  paintWithOpacityFactor,
  scaleOpacityExpression,
} from "../../frontend/src/shared/layer-opacity-expression.js";

const PROPERTY_SPECS = {
  "fill-opacity": v8.paint_fill["fill-opacity"],
  "line-opacity": v8.paint_line["line-opacity"],
  "circle-opacity": v8.paint_circle["circle-opacity"],
  "circle-stroke-opacity": v8.paint_circle["circle-stroke-opacity"],
  "icon-opacity": v8.paint_symbol["icon-opacity"],
  "text-opacity": v8.paint_symbol["text-opacity"],
  "raster-opacity": v8.paint_raster["raster-opacity"],
};

/** Case variants match uniqueValueClassificationInputExpression("pid"|"status"). */
function classificationInput(field) {
  const variants = [...new Set([field, field.toLowerCase(), field.toUpperCase(), field.charAt(0).toUpperCase() + field.slice(1).toLowerCase()])].sort();
  return ["to-string", ["coalesce", ...variants.map((name) => ["get", name]), ""]];
}

const statusOpacity = ["match", classificationInput("status"), "Murdered in captivity", 0, 1];
const peopleMatch = ["match", classificationInput("pid"), "11", 1, "22", 1, statusOpacity];
const peopleFocus = peopleFocusOpacityExpression("11", peopleMatch);

const uniqueFill = ["match", classificationInput("status"), "survivor", 0.25, "missing", 0.5, 1];
const zoomInterpolate = ["interpolate", ["linear"], ["zoom"], 10, 0.2, 14, 0.8];
const zoomStep = ["step", ["zoom"], 0.25, 12, 0.75];
const outerLet = ["let", "boost", 2, ["interpolate", ["linear"], ["zoom"], 8, 0.2, 16, ["*", ["var", "boost"], 0.3]]];

function feature(properties) {
  return { type: 1, id: 1, properties };
}

function evaluate(property, expression, globals, properties) {
  const created = createPropertyExpression(expression, PROPERTY_SPECS[property]);
  expect(created.result, JSON.stringify(created.value)).toBe("success");
  return created.value.evaluate(globals, feature(properties));
}

function multiplyCount(value) {
  if (!Array.isArray(value)) return 0;
  return (value[0] === "*" ? 1 : 0) + value.reduce((sum, entry) => sum + multiplyCount(entry), 0);
}

describe("opacity channels", () => {
  it("covers fill, line, circle stroke, symbol icon/text, and raster only", () => {
    expect(opacityChannelsForLayerType("fill")).toEqual(["fill-opacity"]);
    expect(opacityChannelsForLayerType("line")).toEqual(["line-opacity"]);
    expect(opacityChannelsForLayerType("circle")).toEqual(["circle-opacity", "circle-stroke-opacity"]);
    expect(opacityChannelsForLayerType("symbol")).toEqual(["icon-opacity", "text-opacity"]);
    expect(opacityChannelsForLayerType("raster")).toEqual(["raster-opacity"]);
    expect(opacityChannelsForLayerType("background")).toEqual([]);
  });
});

describe("scaleOpacityExpression", () => {
  it("multiplies numeric opacity and restores the same value at factor 1", () => {
    expect(scaleOpacityExpression(0.4, 0)).toBe(0);
    expect(scaleOpacityExpression(0.4, 0.5)).toBe(0.2);
    expect(scaleOpacityExpression(0.4, 1)).toBe(0.4);
  });

  it("scales people match and focus case outputs at 0, 0.5, and 1 without nesting", () => {
    for (const factor of [0, 0.5, 1]) {
      const scaledMatch = scaleOpacityExpression(peopleMatch, factor);
      const scaledFocus = scaleOpacityExpression(peopleFocus, factor);
      expect(scaledMatch[0]).toBe("match");
      expect(scaledFocus[0]).toBe("case");
      expect(evaluate("circle-opacity", scaledMatch, { zoom: 12 }, { pid: "11", status: "survivor" })).toBeCloseTo(factor);
      expect(evaluate("circle-opacity", scaledMatch, { zoom: 12 }, { pid: "99", status: "Murdered in captivity" })).toBe(0);
      expect(evaluate("circle-opacity", scaledMatch, { zoom: 12 }, { pid: "99", status: "survivor" })).toBeCloseTo(factor);
      expect(evaluate("circle-stroke-opacity", scaledFocus, { zoom: 12 }, { pid: "11", status: "survivor" })).toBeCloseTo(factor);
      expect(evaluate("icon-opacity", scaledFocus, { zoom: 12 }, { pid: "99", status: "survivor" })).toBeCloseTo(0.08 * factor);
      expect(evaluate("icon-opacity", scaledFocus, { zoom: 12 }, { pid: "99", status: "Murdered in captivity" })).toBe(0);
      if (factor === 1) {
        expect(scaledMatch).toBe(peopleMatch);
        expect(scaledFocus).toBe(peopleFocus);
      } else {
        expect(multiplyCount(scaledFocus)).toBe(multiplyCount(peopleFocus) + 1);
      }
    }
    const once = scaleOpacityExpression(peopleFocus, 0.5);
    expect(scaleOpacityExpression(peopleFocus, 0.25)[0]).toBe("case");
    expect(multiplyCount(scaleOpacityExpression(peopleFocus, 0.25))).toBe(multiplyCount(once));
  });

  it("scales unique-value fill stops and keeps the match", () => {
    const scaled = scaleOpacityExpression(uniqueFill, 0.5);
    expect(scaled[0]).toBe("match");
    expect(evaluate("fill-opacity", scaled, { zoom: 8 }, { status: "survivor" })).toBeCloseTo(0.125);
    expect(evaluate("fill-opacity", scaled, { zoom: 8 }, { status: "missing" })).toBeCloseTo(0.25);
    expect(evaluate("fill-opacity", scaled, { zoom: 8 }, { status: "other" })).toBeCloseTo(0.5);
    expect(scaleOpacityExpression(uniqueFill, 1)).toBe(uniqueFill);
  });

  it("keeps zoom interpolate and step top-level and scales their outputs", () => {
    const wrapped = ["*", zoomInterpolate, 0.5];
    expect(createPropertyExpression(wrapped, PROPERTY_SPECS["fill-opacity"]).result).toBe("error");

    const interpolated = scaleOpacityExpression(zoomInterpolate, 0.5);
    const stepped = scaleOpacityExpression(zoomStep, 0.5);
    expect(interpolated[0]).toBe("interpolate");
    expect(stepped[0]).toBe("step");
    expect(evaluate("line-opacity", interpolated, { zoom: 10 }, {})).toBeCloseTo(0.1);
    expect(evaluate("line-opacity", interpolated, { zoom: 12 }, {})).toBeCloseTo(0.25);
    expect(evaluate("line-opacity", interpolated, { zoom: 14 }, {})).toBeCloseTo(0.4);
    expect(evaluate("line-opacity", stepped, { zoom: 11 }, {})).toBeCloseTo(0.125);
    expect(evaluate("line-opacity", stepped, { zoom: 12 }, {})).toBeCloseTo(0.375);
    expect(scaleOpacityExpression(zoomInterpolate, 1)).toBe(zoomInterpolate);
    expect(scaleOpacityExpression(zoomStep, 1)).toBe(zoomStep);
  });

  it("preserves outer let bindings and scales the zoom result", () => {
    const scaled = scaleOpacityExpression(outerLet, 0.5);
    expect(scaled[0]).toBe("let");
    expect(scaled[1]).toBe("boost");
    expect(scaled[2]).toBe(2);
    expect(scaled[3][0]).toBe("interpolate");
    expect(evaluate("raster-opacity", scaled, { zoom: 8 }, {})).toBeCloseTo(0.1);
    expect(evaluate("raster-opacity", scaled, { zoom: 16 }, {})).toBeCloseTo(0.3);
    expect(scaleOpacityExpression(outerLet, 1)).toBe(outerLet);
    expect(multiplyCount(scaleOpacityExpression(outerLet, 0.25))).toBe(multiplyCount(scaled));
  });
});

describe("paintWithOpacityFactor", () => {
  it("scales circle stroke with circle opacity and symbol icon with text", () => {
    const circle = paintWithOpacityFactor("circle", { "circle-opacity": 0.4, "circle-radius": 6 }, 0.5);
    expect(circle["circle-opacity"]).toBe(0.2);
    expect(circle["circle-stroke-opacity"]).toBe(0.5);
    expect(circle["circle-radius"]).toBe(6);

    const symbol = paintWithOpacityFactor("symbol", { "icon-opacity": 0.5, "text-opacity": peopleMatch }, 0.5);
    expect(symbol["icon-opacity"]).toBe(0.25);
    expect(symbol["text-opacity"][0]).toBe("match");
    expect(evaluate("text-opacity", symbol["text-opacity"], { zoom: 4 }, { pid: "22", status: "survivor" })).toBeCloseTo(0.5);
  });

  it("uses default 1 for omitted channels and restores property absence at factor 1", () => {
    const authored = { "fill-color": "#fff" };
    const hidden = paintWithOpacityFactor("fill", authored, 0);
    const midway = paintWithOpacityFactor("fill", authored, 0.5);
    const restored = paintWithOpacityFactor("fill", authored, 1);
    expect(hidden["fill-opacity"]).toBe(0);
    expect(midway["fill-opacity"]).toBe(0.5);
    expect(restored).toEqual(authored);
    expect(Object.prototype.hasOwnProperty.call(restored, "fill-opacity")).toBe(false);
    expect(paintWithOpacityFactor("line", {}, 1)).toEqual({});
    expect(paintWithOpacityFactor("raster", { "raster-opacity": 0.8 }, 1)["raster-opacity"]).toBe(0.8);
  });

  it("does not add lifecycle keys for unrelated layer types", () => {
    const paint = { "background-opacity": 0.4 };
    expect(paintWithOpacityFactor("background", paint, 0)).toEqual(paint);
  });
});

import { describe, expect, it } from "vitest";
import { createPropertyExpression, v8 } from "@maplibre/maplibre-gl-style-spec";
import { peopleFocusOpacityExpression } from "../../frontend/src/shared/nli-people-focus-presentation.js";
import {
  emitOpacityMix,
  interpolateOpacityLeaves,
    mixOpacityExpression,
    evaluateOpacityExpression,
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

const citynameOpacity = (name) => ["case", ["==", ["get", "cityname"], name], 1, 0.08];
const objectIdOpacity = (id) => ["case", ["==", ["get", "OBJECTID"], id], 1, 0.08];
const PRUNE_TOTAL = 1e-4;
const RETARGET_T = 66 / 400;

function leafWeightSum(leaves) {
  return leaves.reduce((sum, leaf) => sum + leaf.weight, 0);
}

function caseCityname(goal) {
  return goal[1][2];
}

function evalCaseLeaves(leaves, cityname) {
  return leaves.reduce((sum, leaf) => {
    const on = caseCityname(leaf.value) === cityname ? 1 : 0.08;
    return sum + on * leaf.weight;
  }, 0);
}

function preRetargetWeights(fromLeaves, to, t) {
  const weights = new Map();
  for (const leaf of fromLeaves) {
    const key = JSON.stringify(leaf.value);
    weights.set(key, (weights.get(key) ?? 0) + leaf.weight * (1 - t));
  }
  const toKey = JSON.stringify(to);
  weights.set(toKey, (weights.get(toKey) ?? 0) + t);
  return weights;
}

function discardedWeight(fromLeaves, to, t, nextLeaves) {
  const pre = preRetargetWeights(fromLeaves, to, t);
  const kept = new Set(nextLeaves.map((leaf) => JSON.stringify(leaf.value)));
  let dropped = 0;
  for (const [key, weight] of pre) {
    if (!kept.has(key)) dropped += weight;
  }
  return dropped;
}

describe("mixOpacityExpression", () => {
  it("returns exact endpoints and lerps finite numbers", () => {
    const from = citynameOpacity("א");
    const to = objectIdOpacity(7);
    expect(mixOpacityExpression(from, to, 0)).toBe(from);
    expect(mixOpacityExpression(from, to, -0.25)).toBe(from);
    expect(mixOpacityExpression(from, to, 1)).toBe(to);
    expect(mixOpacityExpression(from, to, 2)).toBe(to);
    expect(mixOpacityExpression(1, 0.08, 0)).toBe(1);
    expect(mixOpacityExpression(1, 0.08, 1)).toBe(0.08);
    expect(mixOpacityExpression(1, 0.08, 0.5)).toBeCloseTo(0.54);
  });

  it("evaluates cityname and OBJECTID midpoints as legal feature expressions", () => {
    const fromNames = citynameOpacity("א");
    const toNames = citynameOpacity("ב");
    const nameMix = mixOpacityExpression(fromNames, toNames, 0.5);
    expect(createPropertyExpression(nameMix, PROPERTY_SPECS["text-opacity"]).result).toBe("success");
    expect(evaluate("text-opacity", nameMix, { zoom: 8 }, { cityname: "א" })).toBeCloseTo(0.54);
    expect(evaluate("text-opacity", nameMix, { zoom: 8 }, { cityname: "ב" })).toBeCloseTo(0.54);
    expect(evaluate("text-opacity", nameMix, { zoom: 8 }, { cityname: "ג" })).toBeCloseTo(0.08);

    const objectMix = mixOpacityExpression(1, objectIdOpacity(7), 0.5);
    expect(createPropertyExpression(objectMix, PROPERTY_SPECS["line-opacity"]).result).toBe("success");
    expect(evaluate("line-opacity", objectMix, { zoom: 8 }, { OBJECTID: 7 })).toBeCloseTo(1);
    expect(evaluate("line-opacity", objectMix, { zoom: 8 }, { OBJECTID: 8 })).toBeCloseTo(0.54);
  });

  it("rejects direct and outer-let zoom curves, including interpolate and step variants", () => {
    const hcl = ["interpolate-hcl", ["linear"], ["zoom"], 0, 0.2, 10, 0.8];
    const lab = ["interpolate-lab", ["linear"], ["zoom"], 0, 0.2, 10, 0.8];
    const featureCurve = ["interpolate", ["linear"], ["get", "x"], 0, 0, 1, 1];
    const nestedZoom = ["case", true, ["interpolate", ["linear"], ["zoom"], 0, 0.2, 10, 0.8], 1];
    for (const illegal of [zoomInterpolate, zoomStep, outerLet, hcl, lab, featureCurve, nestedZoom]) {
      expect(() => mixOpacityExpression(illegal, 1, 0.5)).toThrow(/zoom|interpolate|step/);
      expect(() => mixOpacityExpression(1, illegal, 0.5)).toThrow(/zoom|interpolate|step/);
      expect(() => interpolateOpacityLeaves([{ value: 1, weight: 1 }], illegal, 0.5)).toThrow(/zoom|interpolate|step/);
    }
    const zoomProperty = ["case", ["==", ["get", "zoom"], "near"], 1, 0.08];
    expect(mixOpacityExpression(zoomProperty, 0.08, 1)).toBe(0.08);
  });
});

describe("interpolateOpacityLeaves and emitOpacityMix", () => {
  it("keeps a mix-shaped memorial policy as one opaque leaf", () => {
    const dim = ["case", ["==", ["get", "cityname"], "א"], 1, 0.18];
    const focused = ["case", ["==", ["get", "cityname"], "ב"], 1, 0.18];
    const memorial = ["+", ["*", dim, 0.4], ["*", focused, 0.6]];
    const base = citynameOpacity("א");
    const fromLeaves = [{ value: base, weight: 1 }];
    const next = interpolateOpacityLeaves(fromLeaves, memorial, 0.25);
    expect(fromLeaves).toEqual([{ value: base, weight: 1 }]);
    expect(next.map((leaf) => leaf.value)).toEqual([base, memorial]);
    expect(next[1].value).toBe(memorial);
    expect(leafWeightSum(next)).toBeCloseTo(1);

    const emitted = emitOpacityMix(next);
    expect(emitted[0]).toBe("+");
    expect(emitted.some((part) => Array.isArray(part) && part[1] === memorial)).toBe(true);
    expect(emitted.filter((part) => Array.isArray(part) && part[0] === "+")).toEqual([]);
    expect(createPropertyExpression(emitted, PROPERTY_SPECS["text-opacity"]).result).toBe("success");
    expect(evaluate("text-opacity", emitted, { zoom: 8 }, { cityname: "א" })).toBeCloseTo(1 * 0.75 + (1 * 0.4 + 0.18 * 0.6) * 0.25);
    expect(evaluate("text-opacity", emitted, { zoom: 8 }, { cityname: "ב" })).toBeCloseTo(0.08 * 0.75 + (0.18 * 0.4 + 1 * 0.6) * 0.25);

    const settled = interpolateOpacityLeaves(next, memorial, 1);
    expect(settled).toEqual([{ value: memorial, weight: 1 }]);
    expect(emitOpacityMix(settled)).toBe(memorial);
  });

  it("merges structurally equal leaves and collapses all-numeric mixes", () => {
    const expr = objectIdOpacity(4);
    const copy = JSON.parse(JSON.stringify(expr));
    const merged = interpolateOpacityLeaves(
      [{ value: expr, weight: 0.25 }, { value: copy, weight: 0.75 }],
      expr,
      0,
    );
    expect(merged).toEqual([{ value: expr, weight: 1 }]);
    expect(emitOpacityMix(merged)).toBe(expr);
    expect(emitOpacityMix([{ value: 1, weight: 0.5 }, { value: 0.08, weight: 0.5 }])).toBeCloseTo(0.54);
    expect(emitOpacityMix([{ value: expr, weight: 1 }])).toBe(expr);

    const combined = interpolateOpacityLeaves(
      [{ value: 1, weight: 0.4 }, { value: 0.5, weight: 0.6 }],
      0,
      0,
    );
    expect(combined).toHaveLength(1);
    expect(combined[0].weight).toBe(1);
    expect(combined[0].value).toBeCloseTo(0.7);
    expect(emitOpacityMix(combined)).toBeCloseTo(0.7);
  });

  it("discards only the smallest weights whose total is at most 1e-4 and does not cap leaf count", () => {
    const keep = citynameOpacity("keep");
    const tinyA = citynameOpacity("a");
    const tinyB = citynameOpacity("b");
    const bothTiny = interpolateOpacityLeaves([
      { value: keep, weight: 1 - 6e-5 },
      { value: tinyA, weight: 3e-5 },
      { value: tinyB, weight: 3e-5 },
    ], keep, 0);
    expect(bothTiny).toEqual([{ value: keep, weight: 1 }]);

    const oneTiny = interpolateOpacityLeaves([
      { value: keep, weight: 1 - 1.2e-4 },
      { value: tinyA, weight: 6e-5 },
      { value: tinyB, weight: 6e-5 },
    ], keep, 0);
    expect(oneTiny).toHaveLength(2);
    expect(oneTiny.some((leaf) => leaf.value === tinyA)).toBe(false);
    expect(leafWeightSum(oneTiny)).toBeCloseTo(1);

    const heavy = interpolateOpacityLeaves([
      { value: keep, weight: 1 - 2e-4 },
      { value: tinyA, weight: 2e-4 },
    ], keep, 0);
    expect(heavy).toHaveLength(2);

    const many = Array.from({ length: 80 }, (_, index) => ({
      value: citynameOpacity(`n${index}`),
      weight: 1 / 80,
    }));
    expect(interpolateOpacityLeaves(many, many[0].value, 0)).toHaveLength(80);
  });

  it("keeps prolonged 66ms retargets bounded, continuous, and exactly settled", () => {
    const updates = 1000;
    let leaves = [{ value: citynameOpacity("place-0"), weight: 1 }];
    let unpruned = leaves.map((leaf) => ({ ...leaf }));
    const sizes = [];
    const checkpoints = new Set([1, 66, 400, updates]);

    for (let step = 1; step <= updates; step += 1) {
      const goal = citynameOpacity(`place-${step}`);
      const next = interpolateOpacityLeaves(leaves, goal, RETARGET_T);
      const dropped = discardedWeight(leaves, goal, RETARGET_T, next);
      leaves = next;
      unpruned = [
        ...unpruned.map((leaf) => ({ value: leaf.value, weight: leaf.weight * (1 - RETARGET_T) })),
        { value: goal, weight: RETARGET_T },
      ];
      expect(dropped).toBeLessThanOrEqual(PRUNE_TOTAL + 1e-9);
      expect(leaves.length).toBeLessThanOrEqual(64);
      expect(Math.abs(leafWeightSum(leaves) - 1)).toBeLessThan(1e-9);

      const cities = [`place-${step}`, "missing", `place-${Math.max(0, step - 40)}`];
      for (const cityname of cities) {
        expect(Math.abs(evalCaseLeaves(leaves, cityname) - evalCaseLeaves(unpruned, cityname))).toBeLessThanOrEqual(1e-3);
      }
      sizes.push(JSON.stringify(emitOpacityMix(leaves)).length);

      if (checkpoints.has(step)) {
        const emitted = emitOpacityMix(leaves);
        expect(createPropertyExpression(emitted, PROPERTY_SPECS["text-opacity"]).result).toBe("success");
        for (const cityname of cities) {
          const actual = evaluate("text-opacity", emitted, { zoom: 5 }, { cityname });
          expect(Math.abs(actual - evalCaseLeaves(unpruned, cityname))).toBeLessThanOrEqual(1e-3);
        }
      }
    }

    const late = sizes.slice(120);
    const lateSpan = Math.max(...late) - Math.min(...late);
    expect(lateSpan).toBeLessThan(Math.min(...late) * 0.2);

    const last = citynameOpacity(`place-${updates}`);
    const settled = interpolateOpacityLeaves(leaves, last, 1);
    expect(settled).toEqual([{ value: last, weight: 1 }]);
    expect(emitOpacityMix(settled)).toBe(last);

    let growing = [{ value: ["case", ["in", ["get", "cityname"], ["literal", ["id-0"]]], 1, 0.08], weight: 1 }];
    const growingSizes = [JSON.stringify(emitOpacityMix(growing)).length];
    for (let step = 1; step <= 40; step += 1) {
      const ids = Array.from({ length: step + 1 }, (_, index) => `id-${index}`);
      const goal = ["case", ["in", ["get", "cityname"], ["literal", ids]], 1, 0.08];
      growing = interpolateOpacityLeaves(growing, goal, RETARGET_T);
      growingSizes.push(JSON.stringify(emitOpacityMix(growing)).length);
    }
    expect(growing.length).toBeLessThanOrEqual(64);
    expect(JSON.stringify(emitOpacityMix(growing))).toContain("id-40");
    expect(growingSizes.at(-1)).toBeGreaterThan(growingSizes[5] * 2);
  });
});

describe("evaluateOpacityExpression", () => {
  it("reads achieved and dim citynames from a scaled case policy", () => {
    const policy = scaleOpacityExpression(
      ["case", ["in", ["get", "cityname"], ["literal", ["נירים"]]], 1, 0.08],
      0.5,
    );
    expect(evaluateOpacityExpression(policy, { cityname: "נירים" })).toBeCloseTo(0.5);
    expect(evaluateOpacityExpression(policy, { cityname: "בארי" })).toBeCloseTo(0.04);
  });
});

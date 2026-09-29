import { describe, expect, it } from "vitest";
import {
  PEOPLE_FOCUS_DIM,
  applyPeopleFocusDim,
  clearPeopleFocusDim,
  forgetPeopleFocusLayers,
  peopleFocusOpacityExpression,
} from "../../frontend/src/shared/nli-people-focus-presentation.js";
import { getLayerLifecycleRuntime } from "../../frontend/src/shared/layer-lifecycle-fade.js";
import { scaleOpacityExpression } from "../../frontend/src/shared/layer-opacity-expression.js";

const captivity = ["match", ["get", "status"], "Murdered in captivity", 0, 1];

function createPeopleMap(paints, layers) {
  return {
    getStyle: () => ({ layers }),
    getLayer: (id) => layers.find((layer) => layer.id === id),
    getPaintProperty: (id, property) => paints.get(`${id}:${property}`),
    setPaintProperty: (id, property, value) => paints.set(`${id}:${property}`, value),
  };
}

describe("peopleFocusOpacityExpression", () => {
  it("returns the base when no pid is selected", () => {
    expect(PEOPLE_FOCUS_DIM).toBe(0.08);
    expect(peopleFocusOpacityExpression("", captivity)).toEqual(captivity);
    expect(peopleFocusOpacityExpression(null, 1)).toBe(1);
  });

  it("wraps a pid case and dims others by dimOpacity without lifting captivity 0", () => {
    expect(peopleFocusOpacityExpression("11", captivity)).toEqual([
      "case",
      ["==", ["to-string", ["get", "pid"]], "11"],
      captivity,
      ["*", captivity, 0.08],
    ]);
  });
});

describe("applyPeopleFocusDim", () => {
  it("dims nli.people paint and restores the remembered base", () => {
    const paints = new Map([
      ["nli__people__circle:circle-opacity", captivity],
      ["nli__people__circle:circle-stroke-opacity", captivity],
      ["nli__people__captivity_bleed:icon-opacity", ["match", ["get", "status"], "Murdered in captivity", 1, 0]],
      ["other:circle-opacity", 1],
    ]);
    const layers = [
      { id: "nli__people__circle", type: "circle", source: "nli.people" },
      { id: "nli__people__captivity_bleed", type: "symbol", source: "nli.people" },
      { id: "other", type: "circle", source: "roads" },
    ];
    const map = {
      getStyle: () => ({ layers }),
      getLayer: (id) => layers.find((layer) => layer.id === id),
      getPaintProperty: (id, property) => paints.get(`${id}:${property}`),
      setPaintProperty: (id, property, value) => paints.set(`${id}:${property}`, value),
    };
    applyPeopleFocusDim(map, "11");
    expect(paints.get("nli__people__circle:circle-opacity")[0]).toBe("case");
    expect(paints.get("nli__people__circle:circle-opacity-transition")).toEqual({
      duration: 400,
      delay: 0,
    });
    expect(paints.get("other:circle-opacity")).toBe(1);
    clearPeopleFocusDim(map);
    expect(paints.get("nli__people__circle:circle-opacity")).toEqual(captivity);
  });

  it("apply(11) then apply(11) still has a single case wrapper", () => {
    const paints = new Map([
      ["nli__people__circle:circle-opacity", captivity],
      ["nli__people__circle:circle-stroke-opacity", captivity],
    ]);
    const layers = [{ id: "nli__people__circle", type: "circle", source: "nli.people" }];
    const expected = [
      "case",
      ["==", ["to-string", ["get", "pid"]], "11"],
      captivity,
      ["*", captivity, 0.08],
    ];
    const map = createPeopleMap(paints, layers);
    applyPeopleFocusDim(map, 11);
    applyPeopleFocusDim(map, 11);
    expect(paints.get("nli__people__circle:circle-opacity")).toEqual(expected);

    const leftoverMap = createPeopleMap(paints, layers);
    applyPeopleFocusDim(leftoverMap, 11);
    expect(paints.get("nli__people__circle:circle-opacity")).toEqual(expected);
    expect(paints.get("nli__people__circle:circle-stroke-opacity")).toEqual(expected);
  });

  it("uses the lifecycle authored base while a fade is in progress", () => {
    const paints = new Map();
    const layers = [{ id: "nli__people__circle", type: "circle", source: "nli.people" }];
    const map = createPeopleMap(paints, layers);
    let time = 0;
    let frame = null;
    const hooks = {
      now: () => time,
      requestFrame(callback) {
        frame = callback;
        return 1;
      },
      cancelFrame() {
        frame = null;
      },
      setTimer() {
        return 1;
      },
      clearTimer() {},
    };
    const runtime = getLayerLifecycleRuntime(map, hooks);
    applyPeopleFocusDim(map, "11");
    runtime.setDesiredIds(["nli.people"], { durationMs: 600 });
    runtime.stageMapLayer("nli.people", {
      id: "nli__people__circle",
      type: "circle",
      paint: { "circle-opacity": captivity, "circle-stroke-opacity": captivity },
    });
    runtime.markMemberReady("nli.people");
    runtime.commitBatch();
    time = 300;
    frame?.(time);
    const faded = paints.get("nli__people__circle:circle-opacity");
    expect(faded).toEqual(scaleOpacityExpression(captivity, 0.5));

    applyPeopleFocusDim(map, "11");
    const focused = peopleFocusOpacityExpression("11", captivity);
    expect(paints.get("nli__people__circle:circle-opacity")).toEqual(scaleOpacityExpression(focused, 0.5));
    expect(paints.get("nli__people__circle:circle-stroke-opacity")).toEqual(scaleOpacityExpression(focused, 0.5));

    time = 600;
    frame?.(time);
    expect(paints.get("nli__people__circle:circle-opacity")).toEqual(focused);

    runtime.setDesiredIds([], { durationMs: 600 });
    runtime.commitBatch();
    time = 900;
    frame?.(time);
    clearPeopleFocusDim(map);
    expect(paints.get("nli__people__circle:circle-opacity")).toEqual(scaleOpacityExpression(captivity, 0.5));
  });

  it("does not write a stored snapshot onto a replaced layer instance", () => {
    const paints = new Map([["nli__people__circle:circle-opacity", 0.7]]);
    const layers = [{ id: "nli__people__circle", type: "circle", source: "nli.people" }];
    const map = createPeopleMap(paints, layers);
    applyPeopleFocusDim(map, "11");
    expect(paints.get("nli__people__circle:circle-opacity")[0]).toBe("case");

    layers[0] = { id: "nli__people__circle", type: "circle", source: "nli.people" };
    paints.set("nli__people__circle:circle-opacity", 0.25);
    clearPeopleFocusDim(map);
    expect(paints.get("nli__people__circle:circle-opacity")).toBe(0.25);
  });

  it("drops a stale snapshot when the layer instance is replaced", () => {
    const paints = new Map([["nli__people__circle:circle-opacity", 0.7]]);
    const layers = [{ id: "nli__people__circle", type: "circle", source: "nli.people" }];
    const map = createPeopleMap(paints, layers);
    applyPeopleFocusDim(map, "11");
    expect(paints.get("nli__people__circle:circle-opacity")[0]).toBe("case");

    layers[0] = { id: "nli__people__circle", type: "circle", source: "nli.people" };
    paints.set("nli__people__circle:circle-opacity", 0.25);
    applyPeopleFocusDim(map, "11");
    expect(paints.get("nli__people__circle:circle-opacity")).toEqual(peopleFocusOpacityExpression("11", 0.25));
  });

  it("clears a snapshot when the layer owner drops that instance", () => {
    const paints = new Map([["nli__people__circle:circle-opacity", 0.7]]);
    const layers = [{ id: "nli__people__circle", type: "circle", source: "nli.people" }];
    const map = createPeopleMap(paints, layers);
    applyPeopleFocusDim(map, "11");
    forgetPeopleFocusLayers(map, ["nli__people__circle"]);
    paints.set("nli__people__circle:circle-opacity", 0.25);
    applyPeopleFocusDim(map, "11");
    expect(paints.get("nli__people__circle:circle-opacity")).toEqual(peopleFocusOpacityExpression("11", 0.25));
  });
});

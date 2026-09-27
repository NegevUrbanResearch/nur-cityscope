import { describe, expect, it } from "vitest";
import {
  PEOPLE_FOCUS_DIM,
  applyPeopleFocusDim,
  clearPeopleFocusDim,
  peopleFocusOpacityExpression,
} from "../../frontend/src/shared/nli-people-focus-presentation.js";

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
    expect(PEOPLE_FOCUS_DIM).toBe(0.18);
    expect(peopleFocusOpacityExpression("", captivity)).toEqual(captivity);
    expect(peopleFocusOpacityExpression(null, 1)).toBe(1);
  });

  it("wraps a pid case and dims others by 0.18 without lifting captivity 0", () => {
    expect(peopleFocusOpacityExpression("11", captivity)).toEqual([
      "case",
      ["==", ["to-string", ["get", "pid"]], "11"],
      captivity,
      ["*", captivity, 0.18],
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
      ["*", captivity, 0.18],
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
});

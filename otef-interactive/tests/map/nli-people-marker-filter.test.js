import { describe, expect, test, vi } from "vitest";
import {
  applyNarrativePeopleFilter,
  peopleFilterForNarrative,
  peopleLegendClassVisible,
  KIDNAP_SURVIVOR_STATUS,
  EXCLUDE_SURVIVOR_FILTER,
  HOSTAGES_PEOPLE_FILTER,
  NIR_OZ_PEOPLE_FILTER,
  NOVA_PEOPLE_FILTER,
} from "../../frontend/src/map/nli-people-marker-filter.js";

function createMap(layers) {
  const styleLayers = layers.map((layer) => ({ ...layer }));
  return {
    getStyle: vi.fn(() => ({ layers: styleLayers })),
    getLayer: vi.fn((id) => styleLayers.find((layer) => layer.id === id) || null),
    setFilter: vi.fn(),
  };
}

describe("narrative people marker filter", () => {
  test("general, segev, and sderot exclude kidnap survivors", () => {
    expect(KIDNAP_SURVIVOR_STATUS).toBe("Kidnap survivor");
    expect(peopleFilterForNarrative(null)).toEqual(EXCLUDE_SURVIVOR_FILTER);
    expect(peopleFilterForNarrative("segev")).toEqual(EXCLUDE_SURVIVOR_FILTER);
    expect(peopleFilterForNarrative("sderot")).toEqual(EXCLUDE_SURVIVOR_FILTER);
    expect(peopleFilterForNarrative("unknown")).toEqual(EXCLUDE_SURVIVOR_FILTER);
    expect(EXCLUDE_SURVIVOR_FILTER).toEqual(["!=", ["get", "status"], "Kidnap survivor"]);
  });

  test("replacement sequences end on the exact filter of the new id", () => {
    const map = createMap([{ id: "nli-people", source: "nli.people" }]);
    applyNarrativePeopleFilter(map, "nova");
    applyNarrativePeopleFilter(map, "hostages");
    expect(map.setFilter).toHaveBeenLastCalledWith("nli-people", NIR_OZ_PEOPLE_FILTER);
    applyNarrativePeopleFilter(map, "sderot");
    expect(map.setFilter).toHaveBeenLastCalledWith("nli-people", EXCLUDE_SURVIVOR_FILTER);
    applyNarrativePeopleFilter(map, "hostages_all");
    expect(map.setFilter).toHaveBeenLastCalledWith("nli-people", HOSTAGES_PEOPLE_FILTER);
    applyNarrativePeopleFilter(map, "nova");
    expect(map.setFilter).toHaveBeenLastCalledWith("nli-people", NOVA_PEOPLE_FILTER);
  });

  test("hostages shows every Nir Oz person", () => {
    expect(peopleFilterForNarrative("hostages")).toEqual(NIR_OZ_PEOPLE_FILTER);
    expect(NIR_OZ_PEOPLE_FILTER).toEqual(["==", ["get", "location"], "Nir Oz"]);
  });

  test("all-hostages shows kidnap survivors and people murdered in captivity", () => {
    expect(peopleFilterForNarrative("hostages_all")).toEqual(HOSTAGES_PEOPLE_FILTER);
    expect(HOSTAGES_PEOPLE_FILTER).toEqual([
      "any",
      ["==", ["get", "status"], "Kidnap survivor"],
      ["==", ["get", "status"], "Murdered in captivity"],
    ]);
  });

  test("nova shows every Nova person", () => {
    expect(peopleFilterForNarrative("nova")).toEqual(NOVA_PEOPLE_FILTER);
    expect(NOVA_PEOPLE_FILTER).toEqual(["==", ["get", "location"], "Nova"]);
  });

  test("filters only current nli.people layers", () => {
    const map = createMap([
      { id: "nli-people", source: "nli.people" },
      { id: "nli-people-names", source: "nli.people_names" },
      { id: "unrelated", source: "other" },
    ]);
    expect(applyNarrativePeopleFilter(map, "hostages_all")).toBe(1);
    expect(map.setFilter).toHaveBeenCalledTimes(1);
    expect(map.setFilter).toHaveBeenCalledWith("nli-people", HOSTAGES_PEOPLE_FILTER);
  });

  test("applies the exclude-survivor filter outside Nova instead of null", () => {
    const map = createMap([
      { id: "nli-people", source: "nli.people" },
      { id: "nli-people-names", source: "nli.people_names" },
    ]);
    expect(applyNarrativePeopleFilter(map, "segev")).toBe(1);
    expect(map.setFilter).toHaveBeenCalledWith("nli-people", EXCLUDE_SURVIVOR_FILTER);
    expect(map.setFilter).not.toHaveBeenCalledWith("nli-people", null);
  });

  test("legend class visibility matches the narrative people filter", () => {
    const statuses = [
      "Murdered",
      "Killed on duty",
      "Kidnap survivor",
      "Murdered in captivity",
    ];
    expect(statuses.filter((status) => peopleLegendClassVisible(null, status))).toEqual([
      "Murdered",
      "Killed on duty",
      "Murdered in captivity",
    ]);
    expect(statuses.filter((status) => peopleLegendClassVisible("segev", status))).toEqual([
      "Murdered",
      "Killed on duty",
      "Murdered in captivity",
    ]);
    expect(statuses.filter((status) => peopleLegendClassVisible("sderot", status))).toEqual([
      "Murdered",
      "Killed on duty",
      "Murdered in captivity",
    ]);
    expect(statuses.filter((status) => peopleLegendClassVisible("hostages", status))).toEqual(statuses);
    expect(statuses.filter((status) => peopleLegendClassVisible("hostages_all", status))).toEqual([
      "Kidnap survivor",
      "Murdered in captivity",
    ]);
    expect(statuses.filter((status) => peopleLegendClassVisible("nova", status))).toEqual(statuses);
  });

  test("returns zero without setting a filter when the victim layer is absent", () => {
    const map = createMap([
      { id: "nli-people-names", source: "nli.people_names" },
      { id: "unrelated", source: "other" },
    ]);
    expect(applyNarrativePeopleFilter(map, "nova")).toBe(0);
    expect(map.setFilter).not.toHaveBeenCalled();
  });
});

import fs from "node:fs";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { featureFilter } from "@maplibre/maplibre-gl-style-spec";
import {
  applyNarrativeHouseOutlineFilter,
  applyNarrativePeopleFilter,
  houseOutlineFilterForNarrative,
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

const SEGEV_HOUSE = ["==", ["get", "note"], "בית משפחת שגב"];
const SDEROT_HOUSE = ["==", ["get", "note"], "תחנת משטרה שדרות"];
const HOSTAGES_HOUSE = ["==", ["get", "note"], "בית משפחת פרי"];
const NO_HOUSE = ["==", ["literal", 1], ["literal", 0]];

function houseMap(layers, { style = { layers }, getLayer } = {}) {
  return {
    getStyle: vi.fn(() => style),
    getLayer: getLayer || vi.fn((id) => (style?.layers || []).find((layer) => layer.id === id) || null),
    setFilter: vi.fn(),
  };
}

describe("narrative house outline filter", () => {
  test("matches the Segev, Sderot, and Peri house notes", () => {
    expect(houseOutlineFilterForNarrative("segev")).toEqual(SEGEV_HOUSE);
    expect(houseOutlineFilterForNarrative("sderot")).toEqual(SDEROT_HOUSE);
    expect(houseOutlineFilterForNarrative("hostages")).toEqual(HOSTAGES_HOUSE);
  });

  test("matches nothing for null, Nova, all hostages, Shura, and unknown narratives", () => {
    for (const id of [null, "nova", "hostages_all", "shura", "unknown"]) {
      expect(houseOutlineFilterForNarrative(id)).toEqual(NO_HOUSE);
    }
  });

  test("no-match filters compile with MapLibre and reject every feature", () => {
    const filter = houseOutlineFilterForNarrative("nova");
    const compiled = featureFilter(filter);
    expect(compiled.filter({ zoom: 0 }, { type: 1, id: 1, properties: { note: "בית משפחת שגב" } })).toBe(false);
  });

  test("filters every current narrative polygon layer and skips unrelated sources", () => {
    const map = houseMap([
      { id: "house-fill", source: "nli.narrative_polygon" },
      { id: "house-line", source: "nli.narrative_polygon" },
      { id: "people", source: "nli.people" },
      { id: "other", source: "nli.something_else" },
    ]);
    expect(applyNarrativeHouseOutlineFilter(map, "segev")).toBe(2);
    expect(map.setFilter).toHaveBeenCalledTimes(2);
    expect(map.setFilter).toHaveBeenCalledWith("house-fill", SEGEV_HOUSE);
    expect(map.setFilter).toHaveBeenCalledWith("house-line", SEGEV_HOUSE);
  });

  test("returns zero without setting a filter when style or the outline layer is missing", () => {
    const thrown = houseMap([], {
      style: null,
      getLayer: vi.fn(() => { throw new Error("style gone"); }),
    });
    thrown.getStyle.mockImplementation(() => { throw new Error("style gone"); });
    expect(applyNarrativeHouseOutlineFilter(thrown, "sderot")).toBe(0);
    expect(thrown.setFilter).not.toHaveBeenCalled();

    const absent = houseMap([{ id: "missing", source: "nli.narrative_polygon" }], {
      getLayer: vi.fn(() => null),
    });
    expect(applyNarrativeHouseOutlineFilter(absent, "hostages")).toBe(0);
    expect(absent.setFilter).not.toHaveBeenCalled();

    const exploded = houseMap([{ id: "house-fill", source: "nli.narrative_polygon" }], {
      getLayer: vi.fn(() => { throw new Error("layer gone"); }),
    });
    expect(applyNarrativeHouseOutlineFilter(exploded, "segev")).toBe(0);
    expect(exploded.setFilter).not.toHaveBeenCalled();
  });

  test("reapplies the current narrative after the outline layer is recreated", () => {
    let style = null;
    const map = houseMap([], { style: null });
    map.getStyle.mockImplementation(() => style);
    map.getLayer.mockImplementation((id) => style?.layers?.find((layer) => layer.id === id) || null);

    expect(applyNarrativeHouseOutlineFilter(map, "segev")).toBe(0);
    expect(map.setFilter).not.toHaveBeenCalled();

    style = { layers: [{ id: "house-fill", source: "nli.narrative_polygon" }] };
    expect(applyNarrativeHouseOutlineFilter(map, "sderot")).toBe(1);
    expect(map.setFilter).toHaveBeenCalledWith("house-fill", SDEROT_HOUSE);
  });

  test("places the house filter beside all six people-filter calls", () => {
    const root = path.resolve(import.meta.dirname, "../../frontend/src");
    const files = [
      "entries/map-main.js",
      "map/nli-narrative-controller.js",
      "projection/projection-narrative-controller.js",
      "entries/projection-main.js",
    ];
    const peopleCalls = [];
    const houseCalls = [];
    for (const file of files) {
      const source = fs.readFileSync(path.join(root, file), "utf8");
      const people = [...source.matchAll(/applyNarrativePeopleFilter\(([^;]*)\);/g)];
      const houses = [...source.matchAll(/applyNarrativeHouseOutlineFilter\(([^;]*)\);/g)];
      expect(houses.map((match) => match[1]), file).toEqual(people.map((match) => match[1]));
      const isEntry = file.startsWith("entries/");
      for (const match of people) {
        const after = source.slice(match.index, match.index + match[0].length + 280);
        expect(after, file).toMatch(
          isEntry
            ? /applyNarrativePeopleFilter\([^;]*\);\s*const selectedPid = OTEFDataContext\.getPersonSelection\?\.\(\)\?\.personId;\s*if \(selectedPid\) applyPeopleFocusDim\([^,]+, selectedPid\);\s*else clearPeopleFocusDim\([^)]+\);\s*applyNarrativeHouseOutlineFilter\(/
            : /applyNarrativePeopleFilter\([^;]*\);\s*applyNarrativeHouseOutlineFilter\(/,
        );
      }
      peopleCalls.push(...people);
      houseCalls.push(...houses);
    }
    expect(peopleCalls).toHaveLength(6);
    expect(houseCalls).toHaveLength(6);
  });
});

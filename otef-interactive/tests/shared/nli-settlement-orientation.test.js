import { describe, expect, it, vi } from "vitest";
import {
  achievedSettlementCitynames,
  applySettlementOrientationPaint,
  collectOrientationTargets,
} from "../../frontend/src/shared/nli-settlement-orientation.js";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";

describe("achievedSettlementCitynames", () => {
  it("strips kibbutz prefix and warns on עין הבשור", () => {
    const features = [
      { properties: { outlineObjectId: 1, locations: ["קיבוץ ארז"] } },
      { properties: { outlineObjectId: 2, locations: ["עין הבשור"] } },
    ];
    const knownCitynames = new Set(["ארז", "זיקים"]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const names = achievedSettlementCitynames(["1", "2"], features, knownCitynames);
    expect(names.has("ארז")).toBe(true);
    expect(names.has("עין הבשור")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    achievedSettlementCitynames(["1", "2"], features, knownCitynames);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("does not light a sidecar location that is absent from שמות cityname", () => {
    const features = [{ properties: { outlineObjectId: 1, locations: ["מקום בדוי"] } }];
    const names = achievedSettlementCitynames(["1"], features, new Set(["ארז"]));
    expect(names.size).toBe(0);
  });

  it("lights a shared cityname if either outline is achieved", () => {
    const features = [
      { properties: { outlineObjectId: 1, locations: ["ארז"] } },
      { properties: { outlineObjectId: 2, locations: ["ארז"] } },
    ];
    const names = achievedSettlementCitynames(["2"], features, new Set(["ארז"]));
    expect(names.has("ארז")).toBe(true);
  });
});

describe("narrative settlement orientation", () => {
  const layers = [
    { id: "settlements-fill", property: "fill-opacity", role: "geom" },
    { id: "settlements-line", property: "line-opacity", role: "geom" },
    { id: "settlements-label", property: "text-opacity", role: "label" },
    { id: "Locations_Lines", property: "line-opacity", role: "location-line" },
  ];

  function map() {
    return { setPaintProperty: vi.fn() };
  }

  it("keeps Be'eri labels and geometry at normal opacity while dimming other settlements", () => {
    const target = map();
    applySettlementOrientationPaint(target, {
      phase: "idle",
      mode: "narrative",
      focusCityname: "בארי",
      focusOutlineObjectId: 19,
      layers,
    });

    const label = target.setPaintProperty.mock.calls.find(([id]) => id === "settlements-label")?.[2];
    const fill = target.setPaintProperty.mock.calls.find(([id]) => id === "settlements-fill")?.[2];
    const line = target.setPaintProperty.mock.calls.find(([id]) => id === "settlements-line")?.[2];
    expect(label).toEqual(["case", ["==", ["get", "cityname"], "בארי"], 1, 0.35]);
    expect(fill).toEqual(["case", ["==", ["get", "OBJECTID"], 19], 1, 0.28]);
    expect(line).toEqual(["case", ["==", ["get", "OBJECTID"], 19], 1, 0.28]);
    expect(target.setPaintProperty).not.toHaveBeenCalledWith("Locations_Lines", "line-opacity", expect.anything());
  });

  it("restores normal host paint outside narrative mode", () => {
    const target = map();
    applySettlementOrientationPaint(target, { phase: "idle", mode: "idle", layers });

    expect(target.setPaintProperty).toHaveBeenCalledWith("settlements-fill", "fill-opacity", 1);
    expect(target.setPaintProperty).toHaveBeenCalledWith("settlements-line", "line-opacity", 1);
    expect(target.setPaintProperty).toHaveBeenCalledWith("settlements-label", "text-opacity", 1);
    expect(target.setPaintProperty).toHaveBeenCalledWith("Locations_Lines", "line-opacity", 1);
  });

  it("does not paint the discovered Locations_Lines layer in narrative mode", () => {
    const target = createFakeMapLibreMap({
      layers: [
        { id: "projector_base__ישובים__fill__0", type: "fill" },
        { id: "projector_base__שמות_יישובים__labels", type: "symbol" },
        { id: "projector_base__Locations_Lines__line__0", type: "line" },
      ],
    });

    applySettlementOrientationPaint(target, {
      phase: "idle",
      mode: "narrative",
      focusCityname: "בארי",
      focusOutlineObjectId: 19,
      layers: collectOrientationTargets(target).layers,
    });

    expect(target.calls).not.toContainEqual(expect.objectContaining({
      method: "setPaintProperty",
      id: "projector_base__Locations_Lines__line__0",
    }));
    expect(target.getPaintProperty("projector_base__ישובים__fill__0", "fill-opacity")).toEqual(
      ["case", ["==", ["get", "OBJECTID"], 19], 1, 0.28],
    );
    expect(target.getPaintProperty("projector_base__שמות_יישובים__labels", "text-opacity")).toEqual(
      ["case", ["==", ["get", "cityname"], "בארי"], 1, 0.35],
    );
  });
});

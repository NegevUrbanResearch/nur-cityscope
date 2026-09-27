import { describe, expect, it, vi } from "vitest";
import { NLI_VISUAL_TOKENS } from "../../frontend/src/shared/nli-investigation-theme.js";
import {
  achievedSettlementCitynames,
  applySettlementOrientationPaint,
  collectOrientationTargets,
  collectShemotObjectIdsForCitynames,
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

  function painted(target, id) {
    return [...target.setPaintProperty.mock.calls]
      .reverse()
      .find(([layerId, key]) => layerId === id && !String(key).endsWith("-transition"))?.[2];
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

    const label = painted(target, "settlements-label");
    const fill = painted(target, "settlements-fill");
    const line = painted(target, "settlements-line");
    expect(label).toEqual(["case", ["==", ["get", "cityname"], "בארי"], 1, 0.18]);
    expect(fill).toEqual(["case", ["==", ["get", "OBJECTID"], 19], 1, 0.08]);
    expect(line).toEqual(["case", ["==", ["get", "OBJECTID"], 19], 1, 0.08]);
    expect(target.setPaintProperty).toHaveBeenCalledWith("Locations_Lines", "line-opacity", 0.08);
  });

  it("Nova focus lights yeshuv OBJECTID 43 and the existing נובה place name", () => {
    const target = map();
    applySettlementOrientationPaint(target, {
      phase: "idle",
      mode: "narrative",
      focusCityname: "נובה",
      focusOutlineObjectId: 43,
      keepFocusLabelWithAchieved: true,
      layers,
    });

    const label = painted(target, "settlements-label");
    const fill = painted(target, "settlements-fill");
    const line = painted(target, "settlements-line");
    expect(label).toEqual(["case", ["in", ["get", "cityname"], ["literal", ["נובה"]]], 1, 0.18]);
    expect(fill).toEqual(["case", ["==", ["get", "OBJECTID"], 43], 1, 0.08]);
    expect(line).toEqual(["case", ["==", ["get", "OBJECTID"], 43], 1, 0.08]);
  });

  it("Nova focus keeps נובה lit together with fleeing-achieved settlement names", () => {
    const target = map();
    applySettlementOrientationPaint(target, {
      phase: "idle",
      mode: "narrative",
      focusCityname: "נובה",
      focusOutlineObjectId: 43,
      keepFocusLabelWithAchieved: true,
      achievedCitynames: ["עיר א"],
      layers,
    });

    const label = painted(target, "settlements-label");
    expect(label).toEqual(["case", ["in", ["get", "cityname"], ["literal", ["נובה", "עיר א"]]], 1, 0.18]);
  });

  it("Sderot lights yeshuv OBJECTID 32 and שדרות", () => {
    const target = map();
    applySettlementOrientationPaint(target, {
      phase: "idle",
      mode: "narrative",
      focusCityname: "שדרות",
      focusOutlineObjectId: 32,
      layers,
    });
    const label = painted(target, "settlements-label");
    const fill = painted(target, "settlements-fill");
    expect(label).toEqual(["case", ["==", ["get", "cityname"], "שדרות"], 1, 0.18]);
    expect(fill).toEqual(["case", ["==", ["get", "OBJECTID"], 32], 1, 0.08]);
  });

  it("Hostages lights yeshuv OBJECTID 14 and ניר עוז", () => {
    const target = map();
    applySettlementOrientationPaint(target, {
      phase: "idle",
      mode: "narrative",
      focusCityname: "ניר עוז",
      focusOutlineObjectId: 14,
      layers,
    });
    const label = painted(target, "settlements-label");
    const fill = painted(target, "settlements-fill");
    expect(label).toEqual(["case", ["==", ["get", "cityname"], "ניר עוז"], 1, 0.18]);
    expect(fill).toEqual(["case", ["==", ["get", "OBJECTID"], 14], 1, 0.08]);
  });

  it("Nova registry flag unions achieved labels; Sderot does not", () => {
    const nova = map();
    applySettlementOrientationPaint(nova, {
      phase: "idle",
      mode: "narrative",
      focusCityname: "נובה",
      focusOutlineObjectId: 43,
      keepFocusLabelWithAchieved: true,
      achievedCitynames: ["עיר א"],
      layers,
    });
    expect(painted(nova, "settlements-label"))
      .toEqual(["case", ["in", ["get", "cityname"], ["literal", ["נובה", "עיר א"]]], 1, 0.18]);

    const sderot = map();
    applySettlementOrientationPaint(sderot, {
      phase: "idle",
      mode: "narrative",
      focusCityname: "שדרות",
      focusOutlineObjectId: 32,
      keepFocusLabelWithAchieved: false,
      achievedCitynames: ["עיר א"],
      layers,
    });
    expect(painted(sderot, "settlements-label"))
      .toEqual(["case", ["==", ["get", "cityname"], "שדרות"], 1, 0.18]);
  });

  it("restores normal host paint outside narrative mode", () => {
    const target = map();
    applySettlementOrientationPaint(target, { phase: "idle", mode: "idle", layers });

    expect(target.setPaintProperty).toHaveBeenCalledWith("settlements-fill", "fill-opacity", 1);
    expect(target.setPaintProperty).toHaveBeenCalledWith("settlements-line", "line-opacity", 1);
    expect(target.setPaintProperty).toHaveBeenCalledWith("settlements-label", "text-opacity", 1);
    expect(target.setPaintProperty).toHaveBeenCalledWith("Locations_Lines", "line-opacity", 1);
  });

  it("dims Locations_Lines with the rest of the scene in narrative mode", () => {
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

    expect(target.getPaintProperty("projector_base__Locations_Lines__line__0", "line-opacity")).toBe(0.08);
    expect(target.getPaintProperty("projector_base__ישובים__fill__0", "fill-opacity")).toEqual(
      ["case", ["==", ["get", "OBJECTID"], 19], 1, 0.08],
    );
    expect(target.getPaintProperty("projector_base__שמות_יישובים__labels", "text-opacity")).toEqual(
      ["case", ["==", ["get", "cityname"], "בארי"], 1, 0.18],
    );
  });

  it("keeps dimmed settlement names readable above geometry dim", () => {
    const target = map();
    applySettlementOrientationPaint(target, { phase: "idle", mode: "narrative", layers });
    expect(NLI_VISUAL_TOKENS.dimTextOpacity).toBeGreaterThan(NLI_VISUAL_TOKENS.dimOpacity);
    expect(target.setPaintProperty).toHaveBeenCalledWith(
      "settlements-label",
      "text-opacity",
      NLI_VISUAL_TOKENS.dimTextOpacity,
    );
    expect(target.setPaintProperty).toHaveBeenCalledWith(
      "settlements-fill",
      "fill-opacity",
      NLI_VISUAL_TOKENS.dimOpacity,
    );
  });

  it("fades orientation opacity instead of writing a null transition", () => {
    const target = createFakeMapLibreMap({
      layers: [
        { id: "projector_base__שמות_יישובים__labels", type: "symbol" },
        { id: "projector_base__ישובים__fill__0", type: "fill" },
      ],
    });
    applySettlementOrientationPaint(target, {
      phase: "playing",
      layers: collectOrientationTargets(target).layers,
    });
    const fade = { duration: NLI_VISUAL_TOKENS.highlightOpacityTransitionMs, delay: 0 };
    expect(target.getPaintProperty("projector_base__שמות_יישובים__labels", "text-opacity-transition")).toEqual(fade);
    expect(target.getPaintProperty("projector_base__ישובים__fill__0", "fill-opacity-transition")).toEqual(fade);
  });

  it("Nova idle narrative dims every yeshuv including Reim", () => {
    const target = map();
    applySettlementOrientationPaint(target, {
      phase: "idle",
      mode: "narrative",
      layers,
    });
    expect(target.setPaintProperty).toHaveBeenCalledWith("settlements-fill", "fill-opacity", 0.08);
    expect(target.setPaintProperty).toHaveBeenCalledWith("settlements-line", "line-opacity", 0.08);
    expect(target.setPaintProperty).toHaveBeenCalledWith("settlements-label", "text-opacity", 0.18);
    expect(target.setPaintProperty).toHaveBeenCalledWith("Locations_Lines", "line-opacity", 0.08);
    const fill = painted(target, "settlements-fill");
    expect(JSON.stringify(fill)).not.toMatch(/18/);
  });

  it("Segev idle narrative still keeps Beeri bright", () => {
    const target = map();
    applySettlementOrientationPaint(target, {
      phase: "idle",
      mode: "narrative",
      focusCityname: "בארי",
      focusOutlineObjectId: 19,
      layers,
    });
    expect(painted(target, "settlements-fill"))
      .toEqual(["case", ["==", ["get", "OBJECTID"], 19], 1, 0.08]);
  });

  it("dim-all with achieved citynames lights those labels and keeps other yeshuvs dim", () => {
    const target = map();
    applySettlementOrientationPaint(target, {
      phase: "idle",
      mode: "narrative",
      achievedCitynames: ["בארי"],
      layers,
    });
    expect(painted(target, "settlements-label"))
      .toEqual(["case", ["in", ["get", "cityname"], ["literal", ["בארי"]]], 1, 0.18]);
    expect(target.setPaintProperty).toHaveBeenCalledWith("settlements-fill", "fill-opacity", 0.08);
    expect(JSON.stringify(painted(target, "settlements-fill"))).not.toMatch(/18/);
    expect(target.setPaintProperty).toHaveBeenCalledWith("Locations_Lines", "line-opacity", 0.08);
  });

  it("empty or cleared impact dim-all paints Locations_Lines dimOpacity and does not leave 1", () => {
    const target = map();
    applySettlementOrientationPaint(target, { phase: "idle", mode: "idle", layers });
    expect(target.setPaintProperty).toHaveBeenCalledWith("Locations_Lines", "line-opacity", 1);

    applySettlementOrientationPaint(target, {
      phase: "idle",
      mode: "narrative",
      layers,
      leaderObjectIds: [],
    });
    const locationCalls = target.setPaintProperty.mock.calls.filter(([id, property]) => (
      id === "Locations_Lines" && property === "line-opacity"
    ));
    expect(locationCalls.at(-1)?.[2]).toBe(0.08);
    expect(locationCalls.at(-1)?.[2]).not.toBe(1);
  });

  it("dim-all paints Locations_Lines by שמות OBJECTID, not yeshuv outline id", () => {
    const target = map();
    applySettlementOrientationPaint(target, {
      phase: "idle",
      mode: "narrative",
      achievedCitynames: ["בארי"],
      leaderObjectIds: [77],
      layers,
    });
    expect(painted(target, "Locations_Lines"))
      .toEqual(["case", ["in", ["get", "OBJECTID"], ["literal", [77]]], 1, 0.08]);
    expect(JSON.stringify(target.setPaintProperty.mock.calls)).not.toMatch(/"19"/);
  });

  it("collects שמות callout leader lines and dims them with the names", () => {
    const map = createFakeMapLibreMap({
      layers: [
        { id: "projector_base__שמות_יישובים__leader", type: "line" },
        { id: "projector_base__שמות_יישובים__labels", type: "symbol" },
        { id: "projector_base__ישובים__fill__0", type: "fill" },
      ],
    });
    const collected = collectOrientationTargets(map).layers;
    expect(collected).toContainEqual({
      id: "projector_base__שמות_יישובים__leader",
      property: "line-opacity",
      role: "leader",
    });

    applySettlementOrientationPaint(map, {
      phase: "playing",
      achievedCitynames: ["בארי"],
      layers: collected,
    });
    expect(map.getPaintProperty("projector_base__שמות_יישובים__leader", "line-opacity")).toEqual(
      ["case", ["in", ["get", "cityname"], ["literal", ["בארי"]]], 1, 0.18],
    );
    expect(map.getPaintProperty("projector_base__שמות_יישובים__labels", "text-opacity")).toEqual(
      ["case", ["in", ["get", "cityname"], ["literal", ["בארי"]]], 1, 0.18],
    );
  });

  it("Identity-style dim-all dims settlements, names, and callout leaders", () => {
    const target = map();
    const identityLayers = [
      ...layers,
      { id: "projector_base__שמות_יישובים__leader", property: "line-opacity", role: "leader" },
    ];
    applySettlementOrientationPaint(target, {
      phase: "idle",
      mode: "narrative",
      layers: identityLayers,
    });
    expect(target.setPaintProperty).toHaveBeenCalledWith("settlements-fill", "fill-opacity", 0.08);
    expect(target.setPaintProperty).toHaveBeenCalledWith("settlements-label", "text-opacity", 0.18);
    expect(target.setPaintProperty).toHaveBeenCalledWith(
      "projector_base__שמות_יישובים__leader",
      "line-opacity",
      0.18,
    );
  });

  it("collects שמות OBJECTIDs for achieved citynames from the shemot source", () => {
    const target = createFakeMapLibreMap({
      layers: [{ id: "projector_base__שמות_יישובים__labels", type: "symbol", source: "projector_base.שמות_יישובים" }],
      sources: {
        "projector_base.שמות_יישובים": {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [
              { type: "Feature", properties: { cityname: "בארי", OBJECTID: 77 }, geometry: { type: "Point", coordinates: [0, 0] } },
              { type: "Feature", properties: { cityname: "רעים", OBJECTID: 88 }, geometry: { type: "Point", coordinates: [1, 1] } },
            ],
          },
        },
      },
    });
    expect(collectShemotObjectIdsForCitynames(target, ["בארי"])).toEqual([77]);
  });
});

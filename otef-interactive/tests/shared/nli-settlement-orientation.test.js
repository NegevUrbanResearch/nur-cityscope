import { createPropertyExpression, v8 } from "@maplibre/maplibre-gl-style-spec";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getLayerLifecycleRuntime } from "../../frontend/src/shared/layer-lifecycle-fade.js";
import { NLI_VISUAL_TOKENS } from "../../frontend/src/shared/nli-investigation-theme.js";
import {
  achievedSettlementCitynames,
  applySettlementOrientationPaint,
  attachSettlementOrientationRuntime,
  collectOrientationTargets,
  collectShemotObjectIdsForCitynames,
  refreshMemorialSettlementFocus,
  setMemorialSettlementFocus,
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

const YISHUV_ID = "projector_base.ישובים";
const SHEMOT_ID = "projector_base.שמות_יישובים";
const LINES_ID = "projector_base.Locations_Lines";
const FILL_ID = "projector_base__ישובים__fill";
const LINE_A_ID = "projector_base__ישובים__line__0";
const LINE_B_ID = "projector_base__ישובים__line__1";
const LABEL_ID = "projector_base__שמות_יישובים__labels";
const LOC_ID = "projector_base__Locations_Lines__line";
const CIRCLE_ID = "projector_base__ישובים__circle";
const GLOW_MS = NLI_VISUAL_TOKENS.highlightOpacityTransitionMs;
const FOCUS_CASE = ["case", ["==", ["get", "OBJECTID"], 19], 1, 0.08];
const NEXT_FOCUS_CASE = ["case", ["==", ["get", "OBJECTID"], 32], 1, 0.08];
const LEADER_CASE = ["case", ["in", ["get", "OBJECTID"], ["literal", [77]]], 1, 0.08];
const LABEL_CASE = ["case", ["==", ["get", "cityname"], "בארי"], 1, 0.18];

function evaluatePaint(property, expression, properties) {
  const spec = property === "text-opacity" ? v8.paint_symbol["text-opacity"] : v8.paint_line["line-opacity"];
  const fillSpec = property === "fill-opacity" ? v8.paint_fill["fill-opacity"] : spec;
  const created = createPropertyExpression(expression, property === "fill-opacity" ? fillSpec : spec);
  expect(created.result, JSON.stringify(created.value)).toBe("success");
  return created.value.evaluate({ zoom: 8 }, { type: 1, id: 1, properties });
}

function createHooks() {
  let time = 0;
  let frame = null;
  let nextFrameId = 0;
  return {
    now: () => time,
    setTime(value) {
      time = value;
    },
    requestFrame(callback) {
      nextFrameId += 1;
      frame = { id: nextFrameId, callback };
      return nextFrameId;
    },
    cancelFrame(id) {
      if (frame?.id === id) frame = null;
    },
    flushFrame() {
      const current = frame;
      frame = null;
      current?.callback(time);
    },
    setTimer() {
      return 1;
    },
    clearTimer() {},
    get pendingFrame() {
      return frame;
    },
  };
}

function createOwnedMap() {
  const layers = new Map();
  const paints = new Map();
  const listeners = new Map();
  let styleLocked = false;
  return {
    addLayer(def) {
      layers.set(def.id, def);
      for (const [key, value] of Object.entries(def.paint || {})) paints.set(`${def.id}\0${key}`, value);
    },
    getLayer(id) {
      return layers.get(id) || null;
    },
    setPaintProperty(id, key, value) {
      paints.set(`${id}\0${key}`, value);
    },
    getPaintProperty(id, key) {
      return paints.get(`${id}\0${key}`);
    },
    getStyle() {
      if (styleLocked) throw new Error("style scan during replay");
      return { layers: [...layers.values()] };
    },
    lockStyle() {
      styleLocked = true;
    },
    unlockStyle() {
      styleLocked = false;
    },
    on(type, handler) {
      const list = listeners.get(type) || [];
      list.push(handler);
      listeners.set(type, list);
    },
    off(type, handler) {
      listeners.set(type, (listeners.get(type) || []).filter((entry) => entry !== handler));
    },
    remove() {
      for (const handler of [...(listeners.get("remove") || [])]) handler();
    },
  };
}

function layerDef(id, type, paint) {
  return { id, type, paint };
}

function reveal(map, hooks, entries) {
  const runtime = getLayerLifecycleRuntime(map, hooks);
  runtime.setDesiredIds([...new Set(entries.map((entry) => entry.fullId))], { durationMs: 0 });
  for (const entry of entries) {
    const staged = runtime.stageMapLayer(entry.fullId, entry.def);
    map.addLayer(staged.stagedLayerDef);
  }
  for (const fullId of new Set(entries.map((entry) => entry.fullId))) runtime.markMemberReady(fullId);
  runtime.commitBatch();
  return runtime;
}

describe("owned settlement orientation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("eases owned play and dim on the lifecycle clock and ignores an equal goal", () => {
    const map = createOwnedMap();
    const hooks = createHooks();
    attachSettlementOrientationRuntime(map);
    reveal(map, hooks, [
      { fullId: YISHUV_ID, def: layerDef(FILL_ID, "fill", { "fill-opacity": 1 }) },
      { fullId: SHEMOT_ID, def: layerDef(LABEL_ID, "symbol", { "text-opacity": 1, "icon-opacity": 1 }) },
    ]);
    const writes = [];
    const original = map.setPaintProperty.bind(map);
    map.setPaintProperty = (id, key, value) => {
      writes.push([id, key, value]);
      original(id, key, value);
    };
    hooks.setTime(0);
    applySettlementOrientationPaint(map, {
      phase: "playing",
      achievedCitynames: ["בארי"],
    });
    expect(hooks.pendingFrame).not.toBeNull();
    hooks.setTime(200);
    hooks.flushFrame();
    expect(map.getPaintProperty(FILL_ID, "fill-opacity")).toBeCloseTo(0.54);
    expect(map.getPaintProperty(FILL_ID, "fill-opacity-transition")).toEqual({ duration: 0, delay: 0 });
    expect(map.getPaintProperty(LABEL_ID, "text-opacity-transition")).toEqual({ duration: 0, delay: 0 });
    expect(map.getPaintProperty(LABEL_ID, "text-opacity-transition")).not.toEqual({ duration: 400, delay: 0 });
    expect(map.getPaintProperty(LABEL_ID, "text-opacity-transition")).not.toEqual({ duration: 350, delay: 0 });
    const text = map.getPaintProperty(LABEL_ID, "text-opacity");
    expect(evaluatePaint("text-opacity", text, { cityname: "בארי" })).toBeCloseTo(1);
    expect(evaluatePaint("text-opacity", text, { cityname: "אחר" })).toBeCloseTo(0.59);
    writes.length = 0;
    applySettlementOrientationPaint(map, {
      phase: "playing",
      achievedCitynames: ["בארי"],
    });
    expect(writes).toEqual([]);
    hooks.setTime(GLOW_MS);
    hooks.flushFrame();
    expect(map.getPaintProperty(FILL_ID, "fill-opacity")).toBe(0.08);
    expect(map.getPaintProperty(LABEL_ID, "text-opacity")).toEqual(
      ["case", ["in", ["get", "cityname"], ["literal", ["בארי"]]], 1, 0.18],
    );
  });

  it("holds a structurally equal case to the original deadline and retargets each line layer", () => {
    const map = createOwnedMap();
    const hooks = createHooks();
    attachSettlementOrientationRuntime(map);
    reveal(map, hooks, [
      { fullId: YISHUV_ID, def: layerDef(LINE_A_ID, "line", { "line-opacity": 1 }) },
      { fullId: YISHUV_ID, def: layerDef(LINE_B_ID, "line", { "line-opacity": 1 }) },
      { fullId: LINES_ID, def: layerDef(LOC_ID, "line", { "line-opacity": 1 }) },
    ]);
    const focus = {
      phase: "idle",
      mode: "narrative",
      focusCityname: "בארי",
      focusOutlineObjectId: 19,
    };
    hooks.setTime(0);
    applySettlementOrientationPaint(map, focus);
    for (let time = 66; time < GLOW_MS; time += 66) {
      hooks.setTime(time);
      hooks.flushFrame();
      applySettlementOrientationPaint(map, focus);
    }
    hooks.setTime(200);
    hooks.flushFrame();
    expect(map.getPaintProperty(LINE_A_ID, "line-opacity")).not.toEqual(FOCUS_CASE);
    hooks.setTime(GLOW_MS);
    hooks.flushFrame();
    expect(map.getPaintProperty(LINE_A_ID, "line-opacity")).toEqual(FOCUS_CASE);
    expect(map.getPaintProperty(LINE_B_ID, "line-opacity")).toEqual(FOCUS_CASE);
    expect(map.getPaintProperty(LOC_ID, "line-opacity")).toBe(0.08);
  });

  it("retargets a changed geom goal from the current sample", () => {
    const map = createOwnedMap();
    const hooks = createHooks();
    attachSettlementOrientationRuntime(map);
    reveal(map, hooks, [
      { fullId: YISHUV_ID, def: layerDef(FILL_ID, "fill", { "fill-opacity": 1 }) },
    ]);
    hooks.setTime(0);
    applySettlementOrientationPaint(map, { phase: "playing" });
    hooks.setTime(200);
    hooks.flushFrame();
    expect(map.getPaintProperty(FILL_ID, "fill-opacity")).toBeCloseTo(0.54);
    applySettlementOrientationPaint(map, {
      phase: "idle",
      mode: "narrative",
      focusCityname: "שדרות",
      focusOutlineObjectId: 32,
    });
    hooks.setTime(400);
    hooks.flushFrame();
    expect(evaluatePaint("fill-opacity", map.getPaintProperty(FILL_ID, "fill-opacity"), { OBJECTID: 32 })).toBeCloseTo(0.77);
    expect(evaluatePaint("fill-opacity", map.getPaintProperty(FILL_ID, "fill-opacity"), { OBJECTID: 1 })).toBeCloseTo(0.31);
    hooks.setTime(600);
    hooks.flushFrame();
    expect(map.getPaintProperty(FILL_ID, "fill-opacity")).toEqual(NEXT_FOCUS_CASE);
  });

  it("replays cached policy before addLayer and keeps it across runtime recreation", () => {
    const map = createOwnedMap();
    const hooks = createHooks();
    attachSettlementOrientationRuntime(map);
    applySettlementOrientationPaint(map, { phase: "playing", layers: [] });
    const runtime = getLayerLifecycleRuntime(map, hooks);
    runtime.setDesiredIds([YISHUV_ID, SHEMOT_ID], { durationMs: 600 });
    map.lockStyle();
    const fill = runtime.stageMapLayer(YISHUV_ID, layerDef(FILL_ID, "fill", { "fill-opacity": 1 }));
    const symbol = runtime.stageMapLayer(SHEMOT_ID, layerDef(LABEL_ID, "symbol", {
      "text-opacity": 1,
      "icon-opacity": 1,
    }));
    const circle = runtime.stageMapLayer(YISHUV_ID, layerDef(CIRCLE_ID, "circle", {
      "circle-opacity": 1,
      "circle-stroke-opacity": 1,
    }));
    expect(map.getLayer(FILL_ID)).toBeNull();
    expect(fill.stagedLayerDef.paint["fill-opacity"]).toBe(0);
    map.unlockStyle();
    map.addLayer(fill.stagedLayerDef);
    map.addLayer(symbol.stagedLayerDef);
    map.addLayer(circle.stagedLayerDef);
    runtime.markMemberReady(YISHUV_ID);
    runtime.markMemberReady(SHEMOT_ID);
    runtime.commitBatch();
    hooks.setTime(300);
    hooks.flushFrame();
    expect(map.getPaintProperty(FILL_ID, "fill-opacity")).toBeCloseTo(0.04);
    expect(map.getPaintProperty(LABEL_ID, "icon-opacity")).toBeCloseTo(0.5);
    expect(map.getPaintProperty(CIRCLE_ID, "circle-opacity")).toBeCloseTo(0.5);
    hooks.setTime(600);
    hooks.flushFrame();
    expect(map.getPaintProperty(FILL_ID, "fill-opacity")).toBe(0.08);
    expect(map.getPaintProperty(LABEL_ID, "text-opacity")).toEqual(
      ["case", ["in", ["get", "cityname"], ["literal", []]], 1, 0.18],
    );
    expect(map.getPaintProperty(LABEL_ID, "icon-opacity")).toBe(1);
    expect(map.getPaintProperty(CIRCLE_ID, "circle-opacity")).toBe(1);
    expect(map.getPaintProperty(CIRCLE_ID, "circle-stroke-opacity")).toBe(1);

    runtime.dispose();
    const recreated = getLayerLifecycleRuntime(map, hooks);
    recreated.setDesiredIds([YISHUV_ID], { durationMs: 0 });
    const remounted = recreated.stageMapLayer(YISHUV_ID, layerDef(FILL_ID, "fill", { "fill-opacity": 1 }));
    map.addLayer(remounted.stagedLayerDef);
    recreated.markMemberReady(YISHUV_ID);
    recreated.commitBatch();
    expect(map.getPaintProperty(FILL_ID, "fill-opacity")).toBe(0.08);
  });

  it("defaults a retained location line to authored policy when no earlier goal exists", () => {
    const map = createOwnedMap();
    const hooks = createHooks();
    attachSettlementOrientationRuntime(map);
    reveal(map, hooks, [
      { fullId: LINES_ID, def: layerDef(LOC_ID, "line", { "line-opacity": 0.7 }) },
    ]);
    hooks.setTime(0);
    setMemorialSettlementFocus(map, { active: true, placeName: "בארי", strength: 1 });
    applySettlementOrientationPaint(map, {
      phase: "idle",
      mode: "narrative",
      focusCityname: "בארי",
      focusOutlineObjectId: 19,
    });
    expect(map.getPaintProperty(LOC_ID, "line-opacity")).toBe(0.08);
    setMemorialSettlementFocus(map, { active: false });
    hooks.setTime(GLOW_MS);
    hooks.flushFrame();
    expect(map.getPaintProperty(LOC_ID, "line-opacity")).toBe(0.7);
  });

  it("eases memorial off to authored location-line opacity after a retain miss", () => {
    const map = createOwnedMap();
    const hooks = createHooks();
    attachSettlementOrientationRuntime(map);
    getLayerLifecycleRuntime(map, hooks);
    hooks.setTime(0);
    setMemorialSettlementFocus(map, { active: true, placeName: "בארי", strength: 1 });
    applySettlementOrientationPaint(map, {
      phase: "idle",
      mode: "narrative",
      focusCityname: "בארי",
      focusOutlineObjectId: 19,
      layers: [{ id: LOC_ID, property: "line-opacity", role: "location-line" }],
    });
    reveal(map, hooks, [
      { fullId: LINES_ID, def: layerDef(LOC_ID, "line", { "line-opacity": 0.7 }) },
    ]);
    setMemorialSettlementFocus(map, { active: false });
    hooks.setTime(GLOW_MS);
    hooks.flushFrame();
    expect(map.getPaintProperty(LOC_ID, "line-opacity")).toBe(0.7);
  });

  it("updates the non-memorial cache during memorial and eases to the latest retained goals", () => {
    const map = createOwnedMap();
    const hooks = createHooks();
    attachSettlementOrientationRuntime(map);
    reveal(map, hooks, [
      { fullId: YISHUV_ID, def: layerDef(FILL_ID, "fill", { "fill-opacity": 1 }) },
      { fullId: SHEMOT_ID, def: layerDef(LABEL_ID, "symbol", { "text-opacity": 1, "icon-opacity": 1 }) },
      { fullId: LINES_ID, def: layerDef(LOC_ID, "line", { "line-opacity": 1 }) },
    ]);
    hooks.setTime(0);
    setMemorialSettlementFocus(map, { active: true, placeName: "בארי", strength: 1 });
    expect(map.getPaintProperty(FILL_ID, "fill-opacity")).toBe(0.08);
    expect(map.getPaintProperty(FILL_ID, "fill-opacity-transition")).toEqual({ duration: 0, delay: 0 });
    applySettlementOrientationPaint(map, {
      phase: "idle",
      mode: "narrative",
      achievedCitynames: ["בארי"],
      leaderObjectIds: [77],
    });
    expect(map.getPaintProperty(LOC_ID, "line-opacity")).toBe(0.08);
    applySettlementOrientationPaint(map, {
      phase: "idle",
      mode: "narrative",
      focusCityname: "בארי",
      focusOutlineObjectId: 19,
    });
    expect(map.getPaintProperty(FILL_ID, "fill-opacity")).toBe(0.08);
    expect(map.getPaintProperty(LOC_ID, "line-opacity")).toBe(0.08);
    setMemorialSettlementFocus(map, { active: false });
    hooks.setTime(200);
    hooks.flushFrame();
    expect(map.getPaintProperty(LOC_ID, "line-opacity")).not.toEqual(LEADER_CASE);
    hooks.setTime(GLOW_MS);
    hooks.flushFrame();
    expect(map.getPaintProperty(FILL_ID, "fill-opacity")).toEqual(FOCUS_CASE);
    expect(map.getPaintProperty(LABEL_ID, "text-opacity")).toEqual(LABEL_CASE);
    expect(map.getPaintProperty(LOC_ID, "line-opacity")).toEqual(LEADER_CASE);
  });

  it("tracks memorial strength immediately and eases an unchanged-strength place change", () => {
    const map = createOwnedMap();
    const hooks = createHooks();
    attachSettlementOrientationRuntime(map);
    reveal(map, hooks, [
      { fullId: SHEMOT_ID, def: layerDef(LABEL_ID, "symbol", { "text-opacity": 1, "icon-opacity": 1 }) },
    ]);
    hooks.setTime(0);
    setMemorialSettlementFocus(map, { active: true, placeName: "א", strength: 0.3 });
    expect(hooks.pendingFrame).toBeNull();
    expect(evaluatePaint("text-opacity", map.getPaintProperty(LABEL_ID, "text-opacity"), { cityname: "ב" })).toBeCloseTo(0.754);
    setMemorialSettlementFocus(map, { active: true, placeName: "א", strength: 0.6 });
    expect(hooks.pendingFrame).toBeNull();
    expect(evaluatePaint("text-opacity", map.getPaintProperty(LABEL_ID, "text-opacity"), { cityname: "ב" })).toBeCloseTo(0.508);
    setMemorialSettlementFocus(map, { active: true, placeName: "ב", strength: 0.6 });
    hooks.setTime(200);
    hooks.flushFrame();
    expect(evaluatePaint("text-opacity", map.getPaintProperty(LABEL_ID, "text-opacity"), { cityname: "ב" })).not.toBeCloseTo(1);
    hooks.setTime(GLOW_MS);
    hooks.flushFrame();
    expect(evaluatePaint("text-opacity", map.getPaintProperty(LABEL_ID, "text-opacity"), { cityname: "ב" })).toBeCloseTo(1);
    expect(evaluatePaint("text-opacity", map.getPaintProperty(LABEL_ID, "text-opacity"), { cityname: "א" })).toBeCloseTo(0.508);
  });

  it("replays an active memorial goal and settles it when reduced motion republishes the same goal", () => {
    const map = createOwnedMap();
    const hooks = createHooks();
    attachSettlementOrientationRuntime(map);
    setMemorialSettlementFocus(map, { active: true, placeName: "בארי", strength: 1 });
    const runtime = getLayerLifecycleRuntime(map, hooks);
    runtime.setDesiredIds([SHEMOT_ID], { durationMs: 0 });
    const staged = runtime.stageMapLayer(SHEMOT_ID, layerDef(LABEL_ID, "symbol", {
      "text-opacity": 1,
      "icon-opacity": 1,
    }));
    expect(map.getLayer(LABEL_ID)).toBeNull();
    map.addLayer(staged.stagedLayerDef);
    runtime.markMemberReady(SHEMOT_ID);
    runtime.commitBatch();
    expect(map.getPaintProperty(LABEL_ID, "text-opacity")).toEqual(LABEL_CASE);
    expect(map.getPaintProperty(LABEL_ID, "icon-opacity")).toBe(1);

    hooks.setTime(0);
    setMemorialSettlementFocus(map, { active: true, placeName: "שדרות", strength: 1 });
    hooks.setTime(100);
    hooks.flushFrame();
    expect(map.getPaintProperty(LABEL_ID, "text-opacity")).not.toEqual(
      ["case", ["==", ["get", "cityname"], "שדרות"], 1, 0.18],
    );
    vi.stubGlobal("window", {
      matchMedia: (query) => ({ matches: query === "(prefers-reduced-motion: reduce)" }),
    });
    refreshMemorialSettlementFocus(map);
    expect(map.getPaintProperty(LABEL_ID, "text-opacity")).toEqual(
      ["case", ["==", ["get", "cityname"], "שדרות"], 1, 0.18],
    );
    expect(hooks.pendingFrame).toBeNull();
  });
});

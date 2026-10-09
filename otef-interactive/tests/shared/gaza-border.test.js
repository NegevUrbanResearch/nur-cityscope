import { afterEach, describe, expect, it, vi } from "vitest";
import layerRegistry, { LayerRegistry } from "../../frontend/src/shared/layer-registry.js";
import { irToMapLibreLayers } from "../../frontend/src/shared/maplibre-style-bridge.js";
import { buildLegendModel } from "../../frontend/src/map/legend-model-builder.js";
import { applyLayerGroupsToMap, disposeLayerManagerForMap } from "../../frontend/src/map/maplibre-layer-manager.js";
import { getLayerLifecycleRuntime } from "../../frontend/src/shared/layer-lifecycle-fade.js";
import { HOME_CUE, SCRIPTS } from "../../frontend/src/remote/nli-staff-script.js";
import { isolateLayersWhileVictimNamesShown } from "../../frontend/src/shared/nli-victim-name-layer-isolation.js";
import OTEFDataContext from "../../frontend/src/shared/OTEFDataContext.js";
import { NLI_VISUAL_TOKENS } from "../../frontend/src/shared/nli-investigation-theme.js";
import { OTEF_API } from "../../frontend/src/shared/api-client.js";
import * as borderStyle from "../../frontend/src/shared/gaza-border-style.js";
import { applyStateFromApi } from "../../frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js";

const BORDER = "gaza.gaza_border";
const groups = [{ id: "gaza", enabled: true, layers: [{ id: "gaza_border", enabled: true }] }];

async function registryFixture() {
  const registry = new LayerRegistry({ fetchImpl: async (url) => ({
    ok: true,
    json: async () => url.endsWith("layers-manifest.json") ? { packs: ["gaza"] }
      : url.endsWith("manifest.json") ? { id: "gaza", name: "Gaza", layers: [] } : {},
  }) });
  await registry.init();
  return registry;
}

afterEach(() => vi.restoreAllMocks());

describe("Gaza border", () => {
  it("defaults the shared override to hidden and hydrates it after reload", () => {
    const context = new OTEFDataContext.constructor();
    expect(context.getGazaBorderVisible?.()).toBe(false);
    applyStateFromApi(context, { gaza_border_visible: true });
    expect(context.getGazaBorderVisible()).toBe(true);
    context._setLayerGroups(groups);
    expect(context.getGazaBorderVisible()).toBe(true);
    applyStateFromApi(context, { gaza_border_visible: false }, { notify: false });
    expect(context.getGazaBorderVisible()).toBe(false);
  });

  it("globally hides the border without rewriting scene state or enabling unrelated layers", () => {
    expect(borderStyle.filterGazaBorderVisibility).toBeTypeOf("function");
    const result = borderStyle.filterGazaBorderVisibility(groups, false);
    expect(result[0].layers[0].enabled).toBe(false);
    expect(groups[0].layers[0].enabled).toBe(true);
    expect(borderStyle.filterGazaBorderVisibility(groups, true)[0].layers[0].enabled).toBe(true);
    const off = [{ id: "gaza", layers: [{ id: "gaza_border", enabled: false }] }];
    expect(borderStyle.filterGazaBorderVisibility(off, true)[0].layers[0].enabled).toBe(false);
  });

  it.each([false, true])("keeps a newer visibility receipt when stale REST hydration arrives, previous=%s", previous => {
    const context = new OTEFDataContext.constructor();
    context._setGazaBorderVisible(previous);
    const visibilityReceipt = context._gazaBorderVisibilityReceipt || 0;
    context._setGazaBorderVisible(true);
    applyStateFromApi(context, { gaza_border_visible: false }, { visibilityReceipt });
    expect(context.getGazaBorderVisible()).toBe(true);
  });

  it("keeps a newer visibility event while reconciling a stale narrative command", async () => {
    const context = new OTEFDataContext.constructor();
    context._tableName = "otef";
    let finish;
    const stale = Object.assign(new Error("stale scene"), { status: 409, details: { reason: "stale", narrative_state: {} } });
    vi.spyOn(OTEF_API, "setNarrative").mockRejectedValue(stale);
    vi.spyOn(OTEF_API, "getState").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const changing = context.setNarrative("segev").catch(error => error);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    context._setGazaBorderVisible(true);
    finish({ gaza_border_visible: false });
    await changing;
    expect(context.getGazaBorderVisible()).toBe(true);
  });

  it.each([true, false])("keeps a previously unpersisted border in the Gaza group toggle roundtrip enabled=%s", async (enabled) => {
    const context = new OTEFDataContext.constructor();
    context._tableName = "otef";
    context._setLayerGroups([{ id: "gaza", enabled: !enabled, layers: [{ id: "Gaza_Roads", enabled: !enabled }] }]);
    const serverRows = new Map([["Gaza_Roads", !enabled]]);
    const response = () => ({ layerGroups: [{ id: "gaza", enabled, layers: [...serverRows].map(([id, on]) => ({ id, enabled: on })) }] });
    vi.spyOn(OTEF_API, "setGroupEnabled").mockImplementation(async () => {
      for (const id of serverRows.keys()) serverRows.set(id, enabled);
      return response();
    });
    vi.spyOn(OTEF_API, "setLayerToggles").mockImplementation(async (_table, changes) => {
      for (const change of changes) serverRows.set(change.full_layer_id.split(".")[1], change.enabled);
      return response();
    });
    const result = await context.toggleGroup("gaza", enabled);
    expect(result.ok).toBe(true);
    expect(context.getLayerGroups().find((group) => group.id === "gaza").layers.find((layer) => layer.id === "gaza_border")?.enabled).toBe(enabled);
    expect(serverRows.get("gaza_border")).toBe(enabled);
  });

  it("adds a disabled toggle row to older server state so scene cues can enable the border", () => {
    const context = new OTEFDataContext.constructor();
    const serverGroups = [{ id: "gaza", enabled: true, layers: [{ id: "Gaza_Roads", enabled: true }] }];
    context._setLayerGroups(serverGroups);
    const row = context.getLayerGroups().find((group) => group.id === "gaza").layers.find((layer) => layer.id === "gaza_border");
    expect(row).toEqual({ id: "gaza_border", name: "גבול עזה", enabled: false });
    expect(serverGroups[0].layers).toHaveLength(1);
    context._setLayerGroups(groups);
    expect(context.getLayerGroups().find((group) => group.id === "gaza").layers[0].enabled).toBe(true);
  });

  it("registers the Gaza-facing open line without needing a workstation's generated manifest row", async () => {
    const registry = await registryFixture();
    const config = registry.getLayerConfig(BORDER);
    expect(config).toMatchObject({ name: "גבול עזה", geometryType: "line", format: "geojson" });
    const coordinates = config.data.features[0].geometry.coordinates;
    expect(config.data.features[0].geometry.type).toBe("LineString");
    expect(coordinates[0]).not.toEqual(coordinates.at(-1));
    expect(coordinates[0][1]).toBeCloseTo(31.2241, 3);
    expect(coordinates.at(-1)[1]).toBeCloseTo(31.5954, 3);
    expect(coordinates.every(([lon, lat]) => lon < 34.57 && lat < 31.60)).toBe(true);
    expect(registry.getAllLayerIds().filter((id) => id === BORDER)).toHaveLength(1);
  });

  it.each([false, true])("renders one solid line matching infiltration red on projection=%s", async (projection) => {
    const config = (await registryFixture()).getLayerConfig(BORDER);
    expect(config).not.toBeNull();
    const layers = irToMapLibreLayers(BORDER, BORDER, config, { applyProjectionHatchPresentation: projection });
    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({ type: "line", paint: {
      "line-color": NLI_VISUAL_TOKENS.routeReveal, "line-width": 2.4, "line-opacity": 1,
    } });
    expect(layers[0].paint).not.toHaveProperty("line-dasharray");
    expect(layers[0].paint).not.toHaveProperty("line-pattern");
  });

  it.each(["gis", "projection"])("shows one named border legend row matching infiltration red on %s", async (surface) => {
    const registry = await registryFixture();
    const model = await buildLegendModel({ registry, dataContext: { getLayerGroups: () => groups, getGazaBorderVisible: () => true }, language: "he", surface });
    const border = model.packs.flatMap((pack) => pack.layers).find((layer) => layer.id === BORDER);
    expect(border?.name).toBe("גבול עזה");
    expect(border.items).toHaveLength(1);
    expect(border.items[0]).toMatchObject({ shape: "line", stroke: NLI_VISUAL_TOKENS.routeReveal });
    expect(border.items[0]).not.toHaveProperty("crossbars");
    const globallyHidden = await buildLegendModel({ registry, dataContext: { getLayerGroups: () => groups, getGazaBorderVisible: () => false }, language: "he", surface });
    expect(globallyHidden.packs.flatMap(pack => pack.layers).some(layer => layer.id === BORDER)).toBe(false);
    const names = [{ id: "nli", enabled: true, layers: [{ id: "people_names", enabled: true }] }];
    const hidden = await buildLegendModel({ registry, dataContext: { getLayerGroups: () => [...groups, ...names] }, language: "he", surface });
    expect(hidden.packs.flatMap((pack) => pack.layers).some((layer) => layer.id === BORDER)).toBe(false);
  });

  it("enables the border in every NLI layer cue except wall of names and credits", () => {
    expect(HOME_CUE.layers).toContain(BORDER);
    for (const script of SCRIPTS) {
      for (const step of script.steps) {
        if (!step.cue?.layers) continue;
        const excluded = ["names_wall", "credits"].includes(step.presentation?.segmentId)
          || step.cue.layers.includes("nli.people_names");
        expect(step.cue.layers.includes(BORDER), `${script.id}: ${step.id || step.title.en}`).toBe(!excluded);
      }
    }
    const isolated = isolateLayersWhileVictimNamesShown([...groups, { id: "nli", enabled: true, layers: [{ id: "people_names", enabled: true }] }]);
    expect(isolated.find((group) => group.id === "gaza").layers[0].enabled).toBe(false);
  });

  it("fades the solid line through the shared lifecycle without marker images", async () => {
    const config = (await registryFixture()).getLayerConfig(BORDER);
    expect(config).not.toBeNull();
    vi.spyOn(layerRegistry, "getLayerConfig").mockImplementation((id) => id === BORDER ? config : null);
    const layers = new Map(), sources = new Map(), images = new Set(), listeners = new Map();
    const map = {
      addSource: (id, source) => sources.set(id, source), getSource: (id) => sources.get(id), removeSource: (id) => sources.delete(id),
      addLayer: (layer) => layers.set(layer.id, structuredClone(layer)), getLayer: (id) => layers.get(id), removeLayer: (id) => layers.delete(id),
      getStyle: () => ({ layers: [...layers.values()] }), isSourceLoaded: () => true,
      setPaintProperty: (id, key, value) => { layers.get(id).paint[key] = value; }, getPaintProperty: (id, key) => layers.get(id)?.paint[key],
      setLayoutProperty: (id, key, value) => { layers.get(id).layout[key] = value; }, getLayoutProperty: (id, key) => layers.get(id)?.layout[key],
      addImage: (id) => images.add(id), hasImage: (id) => images.has(id), removeImage: (id) => images.delete(id),
      on: (name, handler) => listeners.set(name, handler), off: (name) => listeners.delete(name), triggerRepaint() {},
    };
    let now = 0, frame;
    const hooks = { now: () => now, requestFrame: (callback) => { frame = callback; return 1; }, cancelFrame: () => { frame = null; }, setTimer: () => 1, clearTimer() {} };
    const runtime = getLayerLifecycleRuntime(map, hooks);
    const advance = (time) => { now = time; const callback = frame; frame = null; callback?.(time); };
    try {
      applyLayerGroupsToMap(map, groups);
      const opacity = () => [...layers.values()].map((layer) => layer.paint[layer.type === "symbol" ? "icon-opacity" : "line-opacity"]);
      expect(sources.get(BORDER).data).toEqual(config.data);
      expect(opacity()).toEqual([0]);
      expect(images.size).toBe(0);
      advance(300);
      expect(opacity()).toEqual([0.5]);
      advance(600);
      expect(opacity()).toEqual([1]);
      applyLayerGroupsToMap(map, []);
      advance(900);
      expect(opacity()).toEqual([0.5]);
      expect(images.size).toBe(0);
      advance(1200);
      expect(layers.size).toBe(0);
      expect(sources.size).toBe(0);
      expect(images.size).toBe(0);
    } finally {
      runtime.dispose();
      disposeLayerManagerForMap(map);
    }
  });
});

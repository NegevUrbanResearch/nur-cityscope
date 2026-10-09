import { expect, test, vi } from "vitest";
const rig = vi.hoisted(() => ({ groups: [], scene: null, config: null, savedSettings: null, fetches: [], legendSnapshot: { entries: ["Home legend"] }, timeline: { caption: "idle" }, surface: null }));
vi.mock("../../frontend/src/config/app-config.js", () => ({ APP_CONFIG: { api: { viewportBase: "/api/otef_viewport/by-table" } } }));
vi.mock("../../frontend/src/shared/layer-registry.js", () => ({ default: { init: vi.fn(async () => {}), getGroups: () => rig.groups, getLayerDataUrl: () => "/settlements.geojson" } }));
vi.mock("../../frontend/src/projection/maplibre-projection.js", () => ({ createProjectionMap: vi.fn(() => rig.map) }));
vi.mock("../../frontend/src/projection/maplibre-projection-layers.js", () => ({ syncProjectionLayers: vi.fn() }));
vi.mock("../../frontend/src/map/maplibre-layer-manager.js", () => ({ disposeLayerManagerForMap: vi.fn() }));
vi.mock("../../frontend/src/projection/projection-span-view.js", () => ({ applyProjectionSpanView: vi.fn(() => true), createProjectionMapDescriptor: vi.fn((value) => { rig.config = value.config; return { map: true }; }) }));
vi.mock("../../frontend/src/projection/projection-browser-route.js", () => ({ createProjectionBrowserSurface: vi.fn(async (options) => {
  rig.scene = options.getScene();
  return { draw: vi.fn(() => { rig.scene = options.getScene(); return true; }), getMesh: vi.fn(() => ({ width: 1920, height: 1080, vertices: [], triangles: [] })),
    requestDraw: vi.fn(), applyConfig: vi.fn(() => true), dispose: vi.fn(), getSettlementAdapter: () => rig.settlementAdapter };
}) }));
vi.mock("../../frontend/src/projection/projection-road-sign-adapter.js", () => ({ createProjectionRoadSignAdapter: vi.fn(() => ({ ready: vi.fn(async () => {}), setState: vi.fn(value => { rig.roadState = value; }), descriptor: () => ({ signs: ["draft"] }), dispose: vi.fn() })) }));
vi.mock("../../frontend/src/remote/nli-staff-script.js", () => ({ HOME_CUE: { layers: ["projector_base.שמות_יישובים", "projector_base.Locations_Lines", "projector_base.ישובים", "nli.ציר_232", "projector_base.SEA", "gaza.Gaza_Roads", "gaza.gaza_border"] } }));
vi.mock("../../frontend/src/shared/settlement-name-settings.js", () => ({ validateSettlementNameSettings: value => ({ errors: [], value }) }));
vi.mock("../../frontend/src/shared/settlement-name-catalog.js", () => ({ loadSettlementNameCatalog: vi.fn(async () => ({ entries: ["catalog"] })) }));
vi.mock("../../frontend/src/shared/nli-investigation-clock.js", () => ({ idleNliClock: () => ({ serverNowMs: 1000 }) }));
vi.mock("../../frontend/src/shared/reduced-motion.js", () => ({ resolveMotionMode: () => "full" }));
vi.mock("../../frontend/src/map/map-legend.js", () => ({ mountMapLegend: vi.fn(() => ({ setEditing: vi.fn(), refresh: vi.fn(async () => {}), dispose: vi.fn() })) }));
vi.mock("../../frontend/src/projection/projection-caption-adapter.js", () => ({ createProjectionCaptionAdapter: vi.fn(() => ({ sync: vi.fn(), draw: () => rig.timeline, dispose: vi.fn() })) }));
vi.mock("../../frontend/src/projection/projection-legend-adapter.js", () => ({ createProjectionLegendAdapter: vi.fn(() => ({ sync: vi.fn(), draw: () => rig.legendSnapshot, dispose: vi.fn() })) }));
vi.mock("../../frontend/src/projection/legend-layout.js", () => ({ resolveLegendLayout: () => ({ leftPct: 1, topPct: 2, widthPct: 30, heightPct: 10, fontPx: 18, rotateDeg: 0 }) }));
vi.mock("../../frontend/src/projection/nli-explainer-overlay.js", () => ({
  applyNliExplainerLayout: vi.fn(), ensureNliExplainerHost: () => ({ host: { style: {}, querySelector: () => ({}) } }), nliExplainerShouldPaintOnSpan: span => span === "left",
}));
vi.mock("../../frontend/src/shared/maplibre-investigation-timeline.js", () => ({
  syncInvestigationTimelineToMap: vi.fn(async () => {}), getInvestigationTimelineRenderSnapshot: () => rig.timeline, disposeInvestigationTimelineForMap: vi.fn(),
}));
vi.mock("../../frontend/src/projection/settlement-name-framing.js", () => ({ createSettlementNameFraming: vi.fn(() => () => ({ matrix: [1, 0, 0, 1, 0, 0] })) }));
vi.mock("../../frontend/src/projection/projection-browser-error.js", () => ({ visibleProjectionBrowserError: vi.fn() }));
vi.mock("../../frontend/src/projection/projection-preview-bridge.js", () => ({ installProjectionRoadSignPreviewBridge: vi.fn(({ win, sessionId, output, renderState }) => {
  win.addEventListener("message", event => { if (event.data?.type === "otef_road_sign_preview_state") void renderState(event.data, { signal: new AbortController().signal, isCurrent: () => true }); });
  win.parent.postMessage({ type: "otef_road_sign_preview_ready", sessionId, output }, win.location.origin);
  return vi.fn();
}) }));
import { syncProjectionLayers } from "../../frontend/src/projection/maplibre-projection-layers.js";
import { mountMapLegend } from "../../frontend/src/map/map-legend.js";
import { loadSettlementNameCatalog } from "../../frontend/src/shared/settlement-name-catalog.js";
import { syncInvestigationTimelineToMap } from "../../frontend/src/shared/maplibre-investigation-timeline.js";
import { DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";
import { emptyRoadSignSettings } from "../../frontend/src/shared/road-sign-settings.js";
import { bootProjectionRoadSignPreview } from "../../frontend/src/projection/projection-road-sign-preview.js";

const sessionId = "11111111-1111-4111-8111-111111111111";
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test.each([false, true])("Road 232 preview composes read-only Home scene labels, overlays, and canonical layers (border visible: %s)", async gazaBorderVisible => {
  vi.clearAllMocks();
  rig.savedSettings = { revision: 534, style: { fontPx: 21 }, outputs: { right: { "0067": { x: 400, y: 200, rotateDeg: 12 } } } };
  rig.groups = [
    { id: "projector_base", enabled: false, layers: [
      { id: "שמות_יישובים", enabled: false }, { id: "Locations_Lines", enabled: false }, { id: "ישובים", enabled: false },
      { id: "SEA", fullId: "projector_base.SEA", enabled: false },
    ] },
    { id: "nli", enabled: false, layers: [{ id: "route-placeholder", fullLayerIds: ["nli.ציר_232"], enabled: false }] },
    { id: "gaza", enabled: true, layers: [{ id: "Gaza_Roads", enabled: false }, { id: "gaza_border", enabled: true }] },
  ];
  const originalGroups = structuredClone(rig.groups);
  rig.fetches = [];
  const replies = [], listeners = new Map();
  const parent = { postMessage: (data, origin) => replies.push({ data, origin }) };
  rig.map = { loaded: () => true, areTilesLoaded: () => true, on: vi.fn(), off: vi.fn(), remove: vi.fn(), getCanvas: () => ({}), getContainer: () => ({ clientWidth: 1920, clientHeight: 1080 }) };
  rig.settlementAdapter = { setFramingProvider: vi.fn(), prepare: vi.fn(async options => { rig.prepared = options; }), commit: vi.fn(), setVisible: vi.fn(), descriptor: () => ({ labels: ["saved-label"] }) };
  const host = { style: {}, appendChild: vi.fn(), getBoundingClientRect: () => ({ width: 1920, height: 1080 }) };
  const image = { style: {}, removeAttribute: vi.fn() };
  const legend = { style: {} };
  const doc = { getElementById: id => ({ displayContainer: host, displayedImage: image, mapLegend: legend }[id] || null), createElement: () => ({}) };
  const win = { parent, proj4: (_from, _to, point) => point, location: { search: `?roadSignsPreview=1&span=right&outputMode=browser&previewSession=${sessionId}`, origin: "http://preview.test" },
    addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) };
  const snapshot = { settlementNameSettings: rig.savedSettings, settlementNameRevision: 534, legend_settings: { language: "he" },
    nli_clock_layout: { projection: { right: { fontPx: 20, leftPct: 2, topPct: 3, widthPct: 20, heightPct: 10, rotateDeg: 0 } } }, gaza_border_visible: gazaBorderVisible };
  const fetchImpl = vi.fn(async (url, options) => {
    rig.fetches.push({ url, options });
    if (String(url).includes("by-table/otef/")) return { ok: true, json: async () => snapshot };
    return { ok: true, json: async () => ({ west: 1, south: 2, east: 3, north: 4, image_width: 100, image_height: 100 }) };
  });
  const dispose = await bootProjectionRoadSignPreview({ window: win, document: doc, fetchImpl });
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG); config.pre.scale = 1.27;
  listeners.get("message")({ origin: win.location.origin, source: parent, data: { type: "otef_road_sign_preview_state", sessionId, requestId: 1,
    output: "right", settings: emptyRoadSignSettings(), config, calibrationRevision: 9 } });
  await tick(); await tick();

  expect(rig.fetches.every(call => !call.options?.method || call.options.method === "GET")).toBe(true);
  expect(rig.fetches.some(call => String(call.url).includes("by-table/otef/"))).toBe(true);
  expect(loadSettlementNameCatalog).toHaveBeenCalledOnce();
  expect(rig.prepared).toMatchObject({ settings: rig.savedSettings, language: "he" });
  expect(rig.scene.settlements).toMatchObject({ labels: ["saved-label"] });
  expect(rig.scene.caption).toBeNull();
  expect(rig.scene.legend).toEqual(rig.legendSnapshot);
  expect(mountMapLegend).toHaveBeenCalledOnce();
  expect(syncInvestigationTimelineToMap).toHaveBeenCalledOnce();
  const homeGroups = syncProjectionLayers.mock.calls.at(-1)[1];
  const enabled = homeGroups.flatMap(group => group.layers.filter(layer => layer.enabled).map(layer => `${group.id}.${layer.id}`));
  expect(enabled).toEqual(expect.arrayContaining(["projector_base.שמות_יישובים", "projector_base.Locations_Lines", "projector_base.ישובים", "nli.route-placeholder", "projector_base.SEA", "gaza.Gaza_Roads"]));
  expect(enabled.includes("gaza.gaza_border")).toBe(gazaBorderVisible);
  expect(rig.config).toEqual(config);
  expect(rig.scene.roadSigns).toEqual({ signs: ["draft"] });
  expect(rig.roadState).toEqual({ settings: emptyRoadSignSettings(), eligible: true });
  expect(rig.groups).toEqual(originalGroups);
  expect(rig.fetches.some(call => ["POST", "PUT", "PATCH"].includes(call.options?.method))).toBe(false);
  expect(JSON.stringify(rig.fetches)).not.toContain("initializeDataContext");
  dispose();
});

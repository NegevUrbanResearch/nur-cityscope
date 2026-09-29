import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { bridgeMock, registryMock } = vi.hoisted(() => ({
  bridgeMock: {
    irToMapLibreLayers: vi.fn(),
  },
  registryMock: {
    getLayerConfig: vi.fn(),
    getLayerDataUrl: vi.fn(),
    getLayerPMTilesUrl: vi.fn(),
  },
}));

vi.mock("../../frontend/src/shared/maplibre-style-bridge.js", () => ({
  irToMapLibreLayers: bridgeMock.irToMapLibreLayers,
}));

vi.mock("../../frontend/src/shared/layer-registry.js", () => ({
  default: registryMock,
}));

import {
  applyLayerGroupsToMap,
  beginSlideshowStage,
  buildPmtilesUrl,
  clearAllLayers,
  commitSlideshowReveal,
  disposeLayerManagerForMap,
  fadeOutAndRemoveEnabledFullIds,
  getVectorSourceLayerName,
  registerCuratedLayerIds,
  removeCuratedLayersByPrefix,
  stageLayerHidden,
  syncTimelineBaseLayerVisibility,
} from "../../frontend/src/map/maplibre-layer-manager.js";
import {
  INVESTIGATION_ALARMS_FULL_ID,
  INVESTIGATION_LINES_FULL_ID,
  syncInvestigationTimelineToMap,
} from "../../frontend/src/shared/maplibre-investigation-timeline.js";
import {
  idleNliClock,
  playNliClock,
} from "../../frontend/src/shared/nli-investigation-clock.js";
import {
  LAYER_FADE_MS,
  getLayerLifecycleRuntime,
  peekLayerLifecycleRuntime,
} from "../../frontend/src/shared/layer-lifecycle-fade.js";
import { scaleOpacityExpression } from "../../frontend/src/shared/layer-opacity-expression.js";
import { NLI_VISUAL_TOKENS } from "../../frontend/src/shared/nli-investigation-theme.js";
import {
  applySettlementOrientationPaint,
  attachSettlementOrientationRuntime,
} from "../../frontend/src/shared/nli-settlement-orientation.js";
import {
  BIBAS_CAPTIVITY_PIDS,
  MURDERED_IN_CAPTIVITY_STATUS,
} from "../../frontend/src/shared/captivity-bleed-marker.js";

function createMapMock() {
  const sources = new Map();
  const layers = new Set();
  const layerDefsById = new Map();
  const images = new Set();
  /** @type {Map<string, Record<string, unknown>>} */
  const paintByLayerId = new Map();
  /** @type {Map<string, Record<string, unknown>>} */
  const layoutByLayerId = new Map();
  const listenersByEvent = new Map();
  const mutations = [];

  const map = {
    addSource: vi.fn((sourceId) => {
      if (sources.has(sourceId)) {
        throw new Error(`source already exists: ${sourceId}`);
      }
      sources.set(sourceId, { id: sourceId, setData: vi.fn() });
    }),
    getSource: vi.fn((sourceId) => sources.get(sourceId)),
    removeSource: vi.fn((sourceId) => {
      sources.delete(sourceId);
    }),
    hasImage: vi.fn((imageId) => images.has(imageId)),
    addImage: vi.fn((imageId) => {
      images.add(imageId);
      mutations.push({ type: "image", id: imageId });
    }),
    removeImage: vi.fn((imageId) => {
      images.delete(imageId);
    }),
    addLayer: vi.fn((layerDef) => {
      layers.add(layerDef.id);
      layerDefsById.set(layerDef.id, { ...layerDef, layout: { ...(layerDef.layout || {}) } });
      paintByLayerId.set(layerDef.id, { ...(layerDef.paint || {}) });
      mutations.push({ type: "layer", id: layerDef.id });
      layoutByLayerId.set(layerDef.id, { ...(layerDef.layout || {}) });
    }),
    getLayer: vi.fn((layerId) => layers.has(layerId) ? layerDefsById.get(layerId) || { id: layerId } : undefined),
    getStyle: vi.fn(() => ({ layers: [...layerDefsById.values()] })),
    removeLayer: vi.fn((layerId) => {
      layers.delete(layerId);
      layerDefsById.delete(layerId);
      paintByLayerId.delete(layerId);
      layoutByLayerId.delete(layerId);
    }),
    setLayoutProperty: vi.fn((layerId, name, value) => {
      if (!layoutByLayerId.has(layerId)) {
        layoutByLayerId.set(layerId, {});
      }
      layoutByLayerId.get(layerId)[name] = value;
      const layer = layerDefsById.get(layerId);
      if (layer) layer.layout = { ...(layer.layout || {}), [name]: value };
    }),
    setPaintProperty: vi.fn((layerId, name, value) => {
      if (!paintByLayerId.has(layerId)) {
        paintByLayerId.set(layerId, {});
      }
      paintByLayerId.get(layerId)[name] = value;
    }),
    getPaintProperty: vi.fn((layerId, name) => paintByLayerId.get(layerId)?.[name]),
    getLayoutProperty: vi.fn((layerId, name) => layoutByLayerId.get(layerId)?.[name]),
    setFeatureState: vi.fn(),
    getContainer: vi.fn(() => ({ querySelector: () => null, appendChild: vi.fn() })),
    on: vi.fn((event, listener) => {
      if (!listenersByEvent.has(event)) listenersByEvent.set(event, new Set());
      listenersByEvent.get(event).add(listener);
    }),
    off: vi.fn((event, listener) => listenersByEvent.get(event)?.delete(listener)),
    emit(event, payload) {
      for (const listener of listenersByEvent.get(event) || []) listener(payload);
    },
    listenerCount(event) {
      return listenersByEvent.get(event)?.size || 0;
    },
    _layers: layers,
    _images: images,
    _paintByLayerId: paintByLayerId,
    _layoutByLayerId: layoutByLayerId,
    _mutations: mutations,
  };

  return map;
}

const enabledGroups = [{ id: "group_a", layers: [{ id: "layer_1", enabled: true }] }];

function applyInstant(map, groups, options) {
  applyLayerGroupsToMap(map, groups, {
    ...(options || {}),
    transition: { ...(options?.transition || {}), transitionMs: 0 },
  });
}

function createLifecycleHooks() {
  let time = 0;
  let frame = null;
  let nextFrameId = 0;
  let nextTimerId = 0;
  const timers = new Map();
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
    setTimer(callback, delay) {
      nextTimerId += 1;
      timers.set(nextTimerId, { callback, at: time + delay });
      return nextTimerId;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    fireDueTimers() {
      for (const [id, timer] of [...timers]) {
        if (timer.at <= time) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
    get pendingFrame() {
      return frame;
    },
  };
}

function groupsFor(fullIds) {
  const byGroup = new Map();
  for (const fullId of fullIds) {
    const dot = fullId.indexOf(".");
    const groupId = fullId.slice(0, dot);
    const layerId = fullId.slice(dot + 1);
    if (!byGroup.has(groupId)) byGroup.set(groupId, []);
    byGroup.get(groupId).push({ id: layerId, enabled: true });
  }
  return [...byGroup].map(([id, layers]) => ({ id, layers }));
}

function peopleCircleOpacity() {
  const variants = ["status", "Status", "STATUS"].sort();
  const statusInput = ["to-string", ["coalesce", ...variants.map((name) => ["get", name]), ""]];
  const pidVariants = ["pid", "Pid", "PID"].sort();
  const pidInput = ["to-string", ["coalesce", ...pidVariants.map((name) => ["get", name]), ""]];
  const statusMatch = ["match", statusInput, MURDERED_IN_CAPTIVITY_STATUS, 0, 1];
  const expr = ["match", pidInput];
  for (const pid of BIBAS_CAPTIVITY_PIDS) expr.push(pid, 1);
  expr.push(statusMatch);
  return expr;
}

function withCanvasStub(run) {
  const prevDoc = globalThis.document;
  const ctxStub = {
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    setLineJoin: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    clip: vi.fn(),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    getImageData: (x, y, w, h) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(w * h * 4),
    }),
  };
  globalThis.document = {
    createElement: (tag) => {
      if (tag !== "canvas") return {};
      return {
        width: 0,
        height: 0,
        getContext: (t) => (t === "2d" ? ctxStub : null),
      };
    },
  };

  try {
    run();
  } finally {
    if (prevDoc === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = prevDoc;
    }
  }
}

describe("maplibre-layer-manager", () => {
  beforeEach(() => {
    bridgeMock.irToMapLibreLayers.mockReset();
    registryMock.getLayerConfig.mockReset();
    registryMock.getLayerDataUrl.mockReset();
    registryMock.getLayerPMTilesUrl.mockReset();

    registryMock.getLayerConfig.mockReturnValue({ format: "geojson" });
    registryMock.getLayerDataUrl.mockReturnValue("/data/layer.geojson");
  });

  it("recovers a missing owned captivity image from its registered spec", () => {
    const map = createMapMock();
    const spec = { imageId: "otef_captivity_bleed_test", radius: 12 };
    bridgeMock.irToMapLibreLayers.mockReturnValue([
      {
        id: "group_a.layer_1-captivity",
        type: "symbol",
        layout: { "icon-image": spec.imageId },
        _captivityBleedPattern: spec,
      },
    ]);

    withCanvasStub(() => {
      applyInstant(map, enabledGroups);
      map._images.delete(spec.imageId);
      map.emit("styleimagemissing", { id: spec.imageId });
    });

    expect(map.hasImage(spec.imageId)).toBe(true);
  });

  it("recovers missing owned hatch and marker-square images from their specs", () => {
    const map = createMapMock();
    const hatchSpec = {
      patternId: "hatch_#f00_0_8_1",
      color: "#f00",
      rotation: 0,
      separation: 8,
      width: 1,
    };
    const markerSpec = {
      imageId: "otef_mlsq_v1_#f00_#0f0_5_1_9",
      size: 5,
      fill: "#f00",
      stroke: "#0f0",
      strokeWidth: 1,
      side: 9,
    };
    bridgeMock.irToMapLibreLayers.mockReturnValue([
      {
        id: "group_a.layer_1-hatch",
        type: "fill",
        paint: { "fill-pattern": hatchSpec.patternId },
        _hatchPattern: hatchSpec,
      },
      {
        id: "group_a.layer_1-marker",
        type: "symbol",
        layout: { "icon-image": markerSpec.imageId },
        _markerLineSquarePattern: markerSpec,
      },
    ]);

    withCanvasStub(() => {
      applyInstant(map, enabledGroups);
      map._images.delete(hatchSpec.patternId);
      map._images.delete(markerSpec.imageId);
      map.emit("styleimagemissing", { id: hatchSpec.patternId });
      map.emit("styleimagemissing", { id: markerSpec.imageId });
    });

    expect(map.hasImage(hatchSpec.patternId)).toBe(true);
    expect(map.hasImage(markerSpec.imageId)).toBe(true);
  });

  it("preserves hatch pixelRatio when recovering a missing owned image", () => {
    const map = createMapMock();
    const spec = {
      patternId: "hatch_#f00_0_8_1@2x",
      color: "#f00",
      rotation: 0,
      separation: 8,
      width: 1,
      pixelRatio: 2,
    };
    bridgeMock.irToMapLibreLayers.mockReturnValue([
      {
        id: "group_a.layer_1-hatch",
        type: "fill",
        paint: { "fill-pattern": spec.patternId },
        _hatchPattern: spec,
      },
    ]);

    withCanvasStub(() => {
      applyInstant(map, enabledGroups);
      map._images.delete(spec.patternId);
      map.emit("styleimagemissing", { id: spec.patternId });
    });

    const imageCalls = map.addImage.mock.calls.filter(([imageId]) => imageId === spec.patternId);
    expect(imageCalls).toHaveLength(2);
    expect(imageCalls[0][2]).toEqual({ pixelRatio: 2 });
    expect(imageCalls[1][2]).toEqual({ pixelRatio: 2 });
  });

  it("does not intercept an unrelated missing sprite", () => {
    const map = createMapMock();
    bridgeMock.irToMapLibreLayers.mockReturnValue([]);
    applyInstant(map, enabledGroups);
    map.emit("styleimagemissing", { id: "wood-pattern" });
    expect(map.hasImage("wood-pattern")).toBe(false);
  });

  it("dispose removes the owned-image listener", () => {
    const map = createMapMock();
    bridgeMock.irToMapLibreLayers.mockReturnValue([]);
    applyInstant(map, enabledGroups);
    expect(map.listenerCount("styleimagemissing")).toBe(1);
    disposeLayerManagerForMap(map);
    expect(map.listenerCount("styleimagemissing")).toBe(0);
  });

  it("does not recreate an image after its last owner is removed", () => {
    const map = createMapMock();
    const spec = { imageId: "otef_captivity_bleed_test", radius: 12 };
    bridgeMock.irToMapLibreLayers.mockReturnValue([
      {
        id: "group_a.layer_1-captivity",
        type: "symbol",
        layout: { "icon-image": spec.imageId },
        _captivityBleedPattern: spec,
      },
    ]);
    withCanvasStub(() => {
      applyInstant(map, enabledGroups);
      clearAllLayers(map);
      map.emit("styleimagemissing", { id: spec.imageId });
    });
    expect(map.hasImage(spec.imageId)).toBe(false);
  });

  it("registers captivity images before adding their dependent layer", () => {
    const map = createMapMock();
    const spec = { imageId: "otef_captivity_bleed_test", radius: 12 };
    bridgeMock.irToMapLibreLayers.mockReturnValue([
      {
        id: "group_a.layer_1-captivity",
        type: "symbol",
        layout: { "icon-image": spec.imageId },
        _captivityBleedPattern: spec,
      },
    ]);
    withCanvasStub(() => applyInstant(map, enabledGroups));

    const imageMutation = map._mutations.findIndex(
      (mutation) => mutation.type === "image" && mutation.id === spec.imageId,
    );
    const layerMutation = map._mutations.findIndex(
      (mutation) => mutation.type === "layer" && mutation.id.endsWith("-captivity"),
    );
    expect(imageMutation).toBeGreaterThanOrEqual(0);
    expect(layerMutation).toBeGreaterThan(imageMutation);
  });

  it("rolls back source and retries when no style layer is added", () => {
    const map = createMapMock();
    bridgeMock.irToMapLibreLayers.mockReturnValue([{ id: "group_a.layer_1-fill", type: "fill" }]);
    map.addLayer.mockImplementation(() => {
      throw new Error("addLayer failed");
    });

    applyInstant(map, enabledGroups);
    applyInstant(map, enabledGroups);

    expect(map.addSource).toHaveBeenCalledTimes(2);
    expect(map.removeSource).toHaveBeenCalledTimes(2);
  });

  it("rolls back all style layers for fullId when a later addLayer throws", () => {
    const map = createMapMock();
    bridgeMock.irToMapLibreLayers.mockReturnValue([
      { id: "group_a.layer_1-fill", type: "fill" },
      { id: "group_a.layer_1-line", type: "line" },
    ]);
    map.addLayer.mockImplementation((def) => {
      if (def.id === "group_a.layer_1-line") {
        throw new Error("second layer failed");
      }
      map._layers.add(def.id);
    });

    applyInstant(map, enabledGroups);

    expect(map.removeLayer).toHaveBeenCalledWith("group_a.layer_1-fill");
    expect(map.removeSource).toHaveBeenCalledWith("group_a.layer_1");
    expect(map._layers.has("group_a.layer_1-fill")).toBe(false);
  });

  it("tracks state per map instance (no cross-map leakage)", () => {
    const mapA = createMapMock();
    const mapB = createMapMock();
    bridgeMock.irToMapLibreLayers.mockReturnValue([{ id: "group_a.layer_1-fill", type: "fill" }]);

    applyInstant(mapA, enabledGroups);
    applyInstant(mapB, enabledGroups);

    expect(mapA.addSource).toHaveBeenCalledTimes(1);
    expect(mapB.addSource).toHaveBeenCalledTimes(1);
  });

  it("applies layer when layer.enabled=true even if group.enabled=false", () => {
    const map = createMapMock();
    bridgeMock.irToMapLibreLayers.mockReturnValue([{ id: "greens.agri-fill", type: "fill" }]);
    applyInstant(map, [
      { id: "greens", enabled: false, layers: [{ id: "agri", enabled: true }] },
    ]);
    expect(map.addSource).toHaveBeenCalledWith("greens.agri", expect.any(Object));
    expect(map.addLayer).toHaveBeenCalled();
  });

  it("clearAllLayers removes source even when style layer is already orphaned", () => {
    const map = createMapMock();
    bridgeMock.irToMapLibreLayers.mockReturnValue([{ id: "group_a.layer_1-fill", type: "fill" }]);

    applyInstant(map, enabledGroups);

    // Simulate out-of-band style mutation where the layer was removed elsewhere.
    map._layers.clear();
    clearAllLayers(map);

    expect(map.removeSource).toHaveBeenCalledWith("group_a.layer_1");
  });

  it("applyLayerGroupsToMap removes disabled layers and sources by default", () => {
    const map = createMapMock();
    bridgeMock.irToMapLibreLayers.mockReturnValue([
      { id: "group_a.layer_1-fill", type: "fill", layout: {} },
    ]);

    applyInstant(map, enabledGroups);
    map.removeLayer.mockClear();
    map.removeSource.mockClear();
    map.setLayoutProperty.mockClear();

    applyInstant(map, []);

    expect(map.removeLayer).toHaveBeenCalledWith("group_a.layer_1-fill");
    expect(map.removeSource).toHaveBeenCalledWith("group_a.layer_1");
    expect(map.setLayoutProperty).not.toHaveBeenCalled();
  });

  it("retains disabled tracked full ids warm and restores visibility on re-enable", () => {
    const map = createMapMock();
    const fullId = "group_a.layer_1";
    const layerId = "group_a.layer_1-fill";
    const lifecycle = { retainDisabled: true };
    bridgeMock.irToMapLibreLayers.mockReturnValue([
      { id: layerId, type: "fill", layout: {} },
    ]);

    applyInstant(map, enabledGroups, { lifecycle });
    expect(map.addSource).toHaveBeenCalledTimes(1);

    map.removeLayer.mockClear();
    map.removeSource.mockClear();
    map.setLayoutProperty.mockClear();
    applyInstant(map, [], { lifecycle });

    expect(map.setLayoutProperty).toHaveBeenCalledWith(layerId, "visibility", "none");
    expect(map.removeLayer).not.toHaveBeenCalled();
    expect(map.removeSource).not.toHaveBeenCalled();
    expect(map._layers.has(layerId)).toBe(true);

    map.addSource.mockClear();
    map.addLayer.mockClear();
    map.setLayoutProperty.mockClear();
    applyInstant(map, enabledGroups, { lifecycle });

    expect(map.addSource).not.toHaveBeenCalled();
    expect(map.addLayer).not.toHaveBeenCalled();
    expect(map.setLayoutProperty).toHaveBeenCalledWith(layerId, "visibility", "visible");
    expect(map._layoutByLayerId.get(layerId)?.visibility).toBe("visible");
    expect(map.getSource(fullId)).toBeDefined();
  });

  it("keeps renderer-owned timeline bases hidden on creation and retained re-enable", () => {
    const map = createMapMock();
    const groups = [{ id: "nli", layers: [
      { id: "investigation_polygons", enabled: true },
      { id: "lines", enabled: true },
      { id: "alarms", enabled: true },
      { id: "unrelated", enabled: true },
    ] }];
    const lifecycle = { lifecycle: { retainDisabled: true } };
    bridgeMock.irToMapLibreLayers.mockImplementation((fullId) => [
      { id: `${fullId.replace(/\./g, "__")}__authored`, type: "line", layout: { visibility: "visible" } },
    ]);

    syncTimelineBaseLayerVisibility(map, {
      suppressedFullIds: ["nli.investigation_polygons", "nli.lines", "nli.alarms"],
      enabledFullIds: ["nli.investigation_polygons", "nli.lines", "nli.alarms", "nli.unrelated"],
    });
    applyInstant(map, groups, lifecycle);

    for (const id of ["nli__investigation_polygons__authored", "nli__lines__authored", "nli__alarms__authored"]) {
      expect(map._layoutByLayerId.get(id)?.visibility).toBe("none");
    }
    expect(map._layoutByLayerId.get("nli__unrelated__authored")?.visibility).toBe("visible");

    applyInstant(map, [{ id: "nli", layers: [] }], lifecycle);
    applyInstant(map, groups, lifecycle);

    for (const id of ["nli__investigation_polygons__authored", "nli__lines__authored", "nli__alarms__authored"]) {
      expect(map._layoutByLayerId.get(id)?.visibility).toBe("none");
    }
    expect(map._layoutByLayerId.get("nli__unrelated__authored")?.visibility).toBe("visible");
  });

  it("applies a playing clock before layer creation while timeline assets are deferred", async () => {
    const map = createMapMock();
    const groups = [{ id: "nli", layers: [
      { id: "lines", enabled: true },
      { id: "alarms", enabled: true },
    ] }];
    const disabledGroups = [{ id: "nli", layers: [
      { id: "lines", enabled: false },
      { id: "alarms", enabled: true },
    ] }];
    const playingClock = playNliClock(
      idleNliClock(),
      [INVESTIGATION_LINES_FULL_ID, INVESTIGATION_ALARMS_FULL_ID],
      [400],
      0,
    );
    const lineUrl = "https://example.test/deferred-route.geojson";
    let releaseLines;
    let assetsResolved = false;
    const deferredLines = new Promise((resolve) => { releaseLines = resolve; });
    bridgeMock.irToMapLibreLayers.mockImplementation((fullId) => [{
      id: `${fullId.replace(/\./g, "__")}__authored`,
      type: fullId === INVESTIGATION_ALARMS_FULL_ID ? "circle" : "line",
      layout: { visibility: "visible" },
      paint: fullId === INVESTIGATION_ALARMS_FULL_ID
        ? { "circle-opacity": 0.5, "circle-radius": 4 }
        : { "line-opacity": 1 },
    }]);
    const pending = syncInvestigationTimelineToMap(
      map,
      playingClock,
      groups,
      {
        getLayerDataUrl: (fullId) => fullId === INVESTIGATION_LINES_FULL_ID ? lineUrl : null,
        investigationSettlementsUrl: null,
        featuresById: {
          [INVESTIGATION_ALARMS_FULL_ID]: [{
            properties: { city: "Test", alarm_minutes: [400] },
            geometry: { type: "Point", coordinates: [34, 31] },
          }],
        },
        fetchJson: (url) => url === lineUrl
          ? deferredLines.then((data) => { assetsResolved = true; return data; })
          : Promise.resolve({ features: [] }),
        now: () => 0,
      },
    );

    applyLayerGroupsToMap(map, groups);
    expect(assetsResolved).toBe(false);
    expect(map.getLayoutProperty("nli__lines__authored", "visibility")).toBe("none");
    expect(map.getLayoutProperty("nli__alarms__authored", "visibility")).toBe("none");

    clearAllLayers(map);
    applyLayerGroupsToMap(map, groups);
    expect(map.getLayoutProperty("nli__lines__authored", "visibility")).toBe("none");
    expect(map.getLayoutProperty("nli__alarms__authored", "visibility")).toBe("none");

    applyLayerGroupsToMap(map, disabledGroups);
    const disabledSync = syncInvestigationTimelineToMap(map, playingClock, disabledGroups, {
      investigationSettlementsUrl: null,
      featuresById: {
        [INVESTIGATION_ALARMS_FULL_ID]: [{
          properties: { city: "Test", alarm_minutes: [400] },
          geometry: { type: "Point", coordinates: [34, 31] },
        }],
      },
      getLayerDataUrl: (fullId) => fullId === INVESTIGATION_LINES_FULL_ID ? lineUrl : null,
      fetchJson: (url) => url === lineUrl ? deferredLines : Promise.resolve({ features: [] }),
      now: () => 0,
    });
    applyLayerGroupsToMap(map, groups);
    expect(map.getLayoutProperty("nli__lines__authored", "visibility")).toBe("none");
    expect(map.getLayoutProperty("nli__alarms__authored", "visibility")).toBe("none");
    const reenabledSync = syncInvestigationTimelineToMap(map, playingClock, groups, {
      investigationSettlementsUrl: null,
      featuresById: {
        [INVESTIGATION_ALARMS_FULL_ID]: [{
          properties: { city: "Test", alarm_minutes: [400] },
          geometry: { type: "Point", coordinates: [34, 31] },
        }],
      },
      getLayerDataUrl: (fullId) => fullId === INVESTIGATION_LINES_FULL_ID ? lineUrl : null,
      fetchJson: (url) => url === lineUrl ? deferredLines : Promise.resolve({ features: [] }),
      now: () => 0,
    });
    expect(map.getLayoutProperty("nli__lines__authored", "visibility")).toBe("none");
    expect(map.getLayoutProperty("nli__alarms__authored", "visibility")).toBe("none");

    releaseLines({ features: [{ properties: { OBJECTID: 1, timeline_minutes: 400 }, geometry: { type: "LineString", coordinates: [[34, 31], [34.1, 31.1]] } }] });
    await Promise.all([pending, disabledSync, reenabledSync]);
    expect(map.getLayer("nli-investigation-line-active-line")).toBeTruthy();
    expect(map.getLayer("nli-investigation-alarm-circles")).toBeTruthy();

    await syncInvestigationTimelineToMap(map, idleNliClock(), groups, {
      featuresById: {
        [INVESTIGATION_LINES_FULL_ID]: [{ properties: { OBJECTID: 1, timeline_minutes: 400 }, geometry: { type: "LineString", coordinates: [[34, 31], [34.1, 31.1]] } }],
        [INVESTIGATION_ALARMS_FULL_ID]: [{
          properties: { city: "Test", alarm_minutes: [400] },
          geometry: { type: "Point", coordinates: [34, 31] },
        }],
      },
      now: () => 0,
    });
    expect(map.getLayoutProperty("nli__lines__authored", "visibility")).toBe("visible");
    expect(map.getLayoutProperty("nli__alarms__authored", "visibility")).toBe("visible");
  });

  it("fadeOutAndRemoveEnabledFullIds can retain outgoing full ids warm", async () => {
    const map = createMapMock();
    const fullId = "group_a.layer_1";
    const layerId = "group_a.layer_1-fill";
    const lifecycle = { retainDisabled: true, maxRetainedSources: 2 };
    bridgeMock.irToMapLibreLayers.mockReturnValue([
      { id: layerId, type: "fill", layout: {}, paint: { "fill-opacity": 0.65 } },
    ]);

    applyInstant(map, enabledGroups, { lifecycle });
    map._paintByLayerId.set(layerId, { "fill-opacity": 0.65 });
    map.removeLayer.mockClear();
    map.removeSource.mockClear();
    map.setLayoutProperty.mockClear();
    map.setPaintProperty.mockClear();

    await fadeOutAndRemoveEnabledFullIds(map, [fullId], 1, { lifecycle });

    expect(map.setPaintProperty).toHaveBeenCalledWith(layerId, "fill-opacity", 0);
    expect(map.setPaintProperty).toHaveBeenCalledWith(layerId, "fill-opacity", 0.65);
    expect(map.setLayoutProperty).toHaveBeenCalledWith(layerId, "visibility", "none");
    expect(map.removeLayer).not.toHaveBeenCalled();
    expect(map.removeSource).not.toHaveBeenCalled();
    expect(map._layers.has(layerId)).toBe(true);
    expect(map.getSource(fullId)).toBeDefined();
  });

  it("recreates a retained layer when its style layers disappear out of band", () => {
    const map = createMapMock();
    const fullId = "group_a.layer_1";
    const layerId = "group_a.layer_1-fill";
    const lifecycle = { retainDisabled: true };
    bridgeMock.irToMapLibreLayers.mockReturnValue([
      { id: layerId, type: "fill", layout: {} },
    ]);

    applyInstant(map, enabledGroups, { lifecycle });
    applyInstant(map, [], { lifecycle });
    map._layers.delete(layerId);
    map._layoutByLayerId.delete(layerId);

    map.addSource.mockClear();
    map.addLayer.mockClear();
    map.removeSource.mockClear();
    map.setLayoutProperty.mockClear();
    applyInstant(map, enabledGroups, { lifecycle });

    expect(map.removeSource).toHaveBeenCalledWith(fullId);
    expect(map.addSource).toHaveBeenCalledWith(fullId, expect.any(Object));
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: layerId }));
    expect(map._layers.has(layerId)).toBe(true);
  });

  it("recreates a retained multi-style layer when one style layer disappears out of band", () => {
    const map = createMapMock();
    const fullId = "group_a.layer_1";
    const fillLayerId = "group_a.layer_1-fill";
    const lineLayerId = "group_a.layer_1-line";
    const lifecycle = { retainDisabled: true };
    bridgeMock.irToMapLibreLayers.mockReturnValue([
      { id: fillLayerId, type: "fill", layout: {} },
      { id: lineLayerId, type: "line", layout: {} },
    ]);

    applyInstant(map, enabledGroups, { lifecycle });
    applyInstant(map, [], { lifecycle });
    map._layers.delete(lineLayerId);
    map._layoutByLayerId.delete(lineLayerId);

    map.addSource.mockClear();
    map.addLayer.mockClear();
    map.removeLayer.mockClear();
    map.removeSource.mockClear();
    map.setLayoutProperty.mockClear();
    applyInstant(map, enabledGroups, { lifecycle });

    expect(map.removeLayer).toHaveBeenCalledWith(fillLayerId);
    expect(map.removeLayer).not.toHaveBeenCalledWith(lineLayerId);
    expect(map.removeSource).toHaveBeenCalledWith(fullId);
    expect(map.addSource).toHaveBeenCalledWith(fullId, expect.any(Object));
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: fillLayerId }));
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: lineLayerId }));
    expect(map.setLayoutProperty).not.toHaveBeenCalledWith(
      fillLayerId,
      "visibility",
      "visible",
    );
    expect(map._layers.has(fillLayerId)).toBe(true);
    expect(map._layers.has(lineLayerId)).toBe(true);
  });

  it("keeps hatch and marker images while retained warm, then releases when retention is disabled", () => {
    const map = createMapMock();
    const hatchId = "hatch_#f00_0_8_1";
    const markerId = "otef_mlsq_v1_#f00_#0f0_5_1_9";
    const lifecycle = { retainDisabled: true };
    bridgeMock.irToMapLibreLayers.mockReturnValue([
      {
        id: "group_a.layer_1__fill",
        type: "fill",
        paint: { "fill-pattern": hatchId },
        layout: {},
        _hatchPattern: {
          patternId: hatchId,
          color: "#f00",
          rotation: 0,
          separation: 8,
          width: 1,
        },
      },
      {
        id: "group_a.layer_1__ml",
        type: "symbol",
        paint: {},
        layout: { "icon-image": markerId, "symbol-placement": "line" },
        _markerLineSquarePattern: {
          imageId: markerId,
          size: 5,
          fill: "#f00",
          stroke: "#0f0",
          strokeWidth: 1,
          side: 9,
        },
      },
    ]);

    withCanvasStub(() => {
      applyInstant(map, enabledGroups, { lifecycle });
      map.removeImage.mockClear();
      applyInstant(map, [], { lifecycle });

      expect(map.removeImage).not.toHaveBeenCalled();
      expect(map._images.has(hatchId)).toBe(true);
      expect(map._images.has(markerId)).toBe(true);

      applyInstant(map, []);
    });

    expect(map.removeImage).toHaveBeenCalledWith(hatchId);
    expect(map.removeImage).toHaveBeenCalledWith(markerId);
    expect(map._images.has(hatchId)).toBe(false);
    expect(map._images.has(markerId)).toBe(false);
  });

  it("evicts oldest hidden retained full ids when maxRetainedSources is exceeded", () => {
    const map = createMapMock();
    const lifecycle = { retainDisabled: true, maxRetainedSources: 1 };
    const twoEnabledGroups = [
      { id: "group_a", layers: [{ id: "layer_1", enabled: true }] },
      { id: "group_b", layers: [{ id: "layer_2", enabled: true }] },
    ];
    bridgeMock.irToMapLibreLayers.mockImplementation((fullId) => [
      { id: `${fullId}-fill`, type: "fill", layout: {} },
    ]);

    applyInstant(map, twoEnabledGroups, { lifecycle });
    map.removeLayer.mockClear();
    map.removeSource.mockClear();

    applyInstant(map, [], { lifecycle });

    expect(map.setLayoutProperty).toHaveBeenCalledWith(
      "group_a.layer_1-fill",
      "visibility",
      "none",
    );
    expect(map.setLayoutProperty).toHaveBeenCalledWith(
      "group_b.layer_2-fill",
      "visibility",
      "none",
    );
    expect(map.removeLayer).toHaveBeenCalledWith("group_a.layer_1-fill");
    expect(map.removeSource).toHaveBeenCalledWith("group_a.layer_1");
    expect(map.removeLayer).not.toHaveBeenCalledWith("group_b.layer_2-fill");
    expect(map.removeSource).not.toHaveBeenCalledWith("group_b.layer_2");
    expect(map._layers.has("group_a.layer_1-fill")).toBe(false);
    expect(map._layers.has("group_b.layer_2-fill")).toBe(true);
  });

  it("does not evict an incoming enabled retained full id before it can restore", () => {
    const map = createMapMock();
    const lifecycle = { retainDisabled: true, maxRetainedSources: 1 };
    const groupA = [{ id: "group_a", layers: [{ id: "layer_1", enabled: true }] }];
    const groupB = [{ id: "group_b", layers: [{ id: "layer_2", enabled: true }] }];
    const swapToA = [
      { id: "group_a", layers: [{ id: "layer_1", enabled: true }] },
      { id: "group_b", layers: [{ id: "layer_2", enabled: false }] },
    ];
    bridgeMock.irToMapLibreLayers.mockImplementation((fullId) => [
      { id: `${fullId}-fill`, type: "fill", layout: {} },
    ]);

    applyInstant(map, groupA, { lifecycle });
    applyInstant(map, [], { lifecycle });
    applyInstant(map, groupB, { lifecycle });

    map.addSource.mockClear();
    map.addLayer.mockClear();
    map.removeLayer.mockClear();
    map.removeSource.mockClear();
    map.setLayoutProperty.mockClear();
    applyInstant(map, swapToA, { lifecycle });

    expect(map.addSource).not.toHaveBeenCalledWith("group_a.layer_1", expect.anything());
    expect(map.addLayer).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: "group_a.layer_1-fill" }),
    );
    expect(map.removeLayer).not.toHaveBeenCalledWith("group_a.layer_1-fill");
    expect(map.removeSource).not.toHaveBeenCalledWith("group_a.layer_1");
    expect(map.setLayoutProperty).toHaveBeenCalledWith(
      "group_a.layer_1-fill",
      "visibility",
      "visible",
    );
    expect(map._layers.has("group_a.layer_1-fill")).toBe(true);
    expect(map._layers.has("group_b.layer_2-fill")).toBe(false);
    expect(map.getSource("group_b.layer_2")).toBeUndefined();
  });

  it("registers hatch pattern images and strips metadata before addLayer", () => {
    const map = createMapMock();
    const patternId = "hatch_#f00_0_8_1";
    bridgeMock.irToMapLibreLayers.mockReturnValue([
      {
        id: "group_a.layer_1__fill",
        type: "fill",
        paint: { "fill-pattern": patternId },
        layout: {},
        _hatchPattern: {
          patternId,
          color: "#f00",
          rotation: 0,
          separation: 8,
          width: 1,
        },
      },
    ]);
    withCanvasStub(() => {
      applyInstant(map, enabledGroups);
    });

    expect(map.hasImage).toHaveBeenCalledWith(patternId);
    expect(map.addImage).toHaveBeenCalledWith(
      patternId,
      expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) }),
    );
    const added = map.addLayer.mock.calls.find(
      (c) => c[0]?.id === "group_a.layer_1__fill",
    );
    expect(added).toBeDefined();
    expect(added[0]).not.toHaveProperty("_hatchPattern");
    expect(added[0]).not.toHaveProperty("_hatchPatterns");
  });

  it("removes hatch image when layer is disabled and no longer referenced", () => {
    const map = createMapMock();
    const patternId = "hatch_#f00_0_8_1";
    bridgeMock.irToMapLibreLayers.mockReturnValue([
      {
        id: "group_a.layer_1__fill",
        type: "fill",
        paint: { "fill-pattern": patternId },
        layout: {},
        _hatchPattern: {
          patternId,
          color: "#f00",
          rotation: 0,
          separation: 8,
          width: 1,
        },
      },
    ]);

    withCanvasStub(() => {
      applyInstant(map, enabledGroups);
      applyInstant(map, []);
    });

    expect(map.addImage).toHaveBeenCalledWith(
      patternId,
      expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) }),
    );
    expect(map.removeImage).toHaveBeenCalledWith(patternId);
    expect(map._images.has(patternId)).toBe(false);
  });

  it("registers marker line square images and strips metadata before addLayer", () => {
    const map = createMapMock();
    const imageId = "otef_mlsq_v1_#f00_#0f0_5_1_9";
    const spec = {
      imageId,
      size: 5,
      fill: "#f00",
      stroke: "#0f0",
      strokeWidth: 1,
      side: 9,
    };
    bridgeMock.irToMapLibreLayers.mockReturnValue([
      {
        id: "group_a.layer_1__ml",
        type: "symbol",
        paint: {},
        layout: { "icon-image": imageId, "symbol-placement": "line" },
        _markerLineSquarePattern: spec,
      },
    ]);
    withCanvasStub(() => {
      applyInstant(map, enabledGroups);
    });

    expect(map.hasImage).toHaveBeenCalledWith(imageId);
    expect(map.addImage).toHaveBeenCalledWith(
      imageId,
      expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) }),
    );
    const added = map.addLayer.mock.calls.find((c) => c[0]?.id === "group_a.layer_1__ml");
    expect(added).toBeDefined();
    expect(added[0]).not.toHaveProperty("_markerLineSquarePattern");
    expect(added[0]).not.toHaveProperty("_markerLineSquarePatterns");
  });

  it("registers all marker line square pattern variants and does not double-ref duplicate ids", () => {
    const map = createMapMock();
    const idA = "otef_mlsq_v1_#a_#b_5_1_9";
    const idB = "otef_mlsq_v1_#c_#d_5_1_9";
    const specA = { imageId: idA, size: 5, fill: "#a", stroke: "#b", strokeWidth: 1, side: 9 };
    const specB = { imageId: idB, size: 5, fill: "#c", stroke: "#d", strokeWidth: 1, side: 9 };
    bridgeMock.irToMapLibreLayers.mockReturnValue([
      {
        id: "group_a.layer_1__ml_uv",
        type: "symbol",
        paint: {},
        layout: {},
        _markerLineSquarePatterns: [specA, specB, specA],
      },
    ]);
    withCanvasStub(() => {
      applyInstant(map, enabledGroups);
    });
    expect(map.addImage).toHaveBeenCalledWith(
      idA,
      expect.objectContaining({ width: expect.any(Number) }),
    );
    expect(map.addImage).toHaveBeenCalledWith(
      idB,
      expect.objectContaining({ width: expect.any(Number) }),
    );
    expect(map.addImage.mock.calls.filter((c) => c[0] === idA)).toHaveLength(1);
  });

  it("removes marker line square image when layer is disabled and no longer referenced", () => {
    const map = createMapMock();
    const imageId = "otef_mlsq_v1_#f00_#0f0_5_1_9";
    const spec = {
      imageId,
      size: 5,
      fill: "#f00",
      stroke: "#0f0",
      strokeWidth: 1,
      side: 9,
    };
    bridgeMock.irToMapLibreLayers.mockReturnValue([
      {
        id: "group_a.layer_1__ml",
        type: "symbol",
        paint: {},
        layout: { "icon-image": imageId, "symbol-placement": "line" },
        _markerLineSquarePattern: spec,
      },
    ]);

    withCanvasStub(() => {
      applyInstant(map, enabledGroups);
      applyInstant(map, []);
    });

    expect(map.addImage).toHaveBeenCalledWith(
      imageId,
      expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) }),
    );
    expect(map.removeImage).toHaveBeenCalledWith(imageId);
    expect(map._images.has(imageId)).toBe(false);
  });

  it("rolls back layers, source, and hatch refs when hatch registration fails", () => {
    const map = createMapMock();
    const firstPattern = "hatch_#f00_0_8_1";
    const failingPattern = "hatch_#0f0_45_10_2";
    bridgeMock.irToMapLibreLayers.mockReturnValue([
      {
        id: "group_a.layer_1__fill_a",
        type: "fill",
        paint: { "fill-pattern": firstPattern },
        layout: {},
        _hatchPattern: {
          patternId: firstPattern,
          color: "#f00",
          rotation: 0,
          separation: 8,
          width: 1,
        },
      },
      {
        id: "group_a.layer_1__fill_b",
        type: "fill",
        paint: { "fill-pattern": failingPattern },
        layout: {},
        _hatchPattern: {
          patternId: failingPattern,
          color: "#0f0",
          rotation: 45,
          separation: 10,
          width: 2,
        },
      },
    ]);

    map.addImage.mockImplementation((imageId) => {
      if (imageId === failingPattern) {
        throw new Error("boom");
      }
      map._images.add(imageId);
    });

    withCanvasStub(() => {
      applyInstant(map, enabledGroups);
      applyInstant(map, enabledGroups);
    });

    expect(map.addSource).toHaveBeenCalledTimes(2);
    expect(map.removeSource).toHaveBeenCalledTimes(2);
    expect(map.removeLayer).toHaveBeenCalledWith("group_a.layer_1__fill_a");
    expect(map.removeImage).toHaveBeenCalledWith(firstPattern);
    expect(map._images.has(firstPattern)).toBe(false);
  });

  it("skips format image layers (DOM-backed) and does not retry addSource on each sync", () => {
    const map = createMapMock();
    const imageGroups = [{ id: "projector_base", layers: [{ id: "model_base", enabled: true }] }];
    registryMock.getLayerConfig.mockReturnValue({ format: "image" });

    applyInstant(map, imageGroups);
    applyInstant(map, imageGroups);

    expect(map.addSource).not.toHaveBeenCalled();
    expect(bridgeMock.irToMapLibreLayers).not.toHaveBeenCalled();
  });

  it("skips geometryType image layers without MapLibre sources", () => {
    const map = createMapMock();
    const imageGroups = [{ id: "g", layers: [{ id: "x", enabled: true }] }];
    registryMock.getLayerConfig.mockReturnValue({ format: "geojson", geometryType: "image" });

    applyInstant(map, imageGroups);

    expect(map.addSource).not.toHaveBeenCalled();
  });

  it("uses explicit sourceLayer from config for PMTiles vector source-layer (GIS/projection path)", () => {
    const map = createMapMock();
    const prevWin = globalThis.window;
    globalThis.window = { location: { origin: "http://localhost" } };
    try {
      bridgeMock.irToMapLibreLayers.mockReturnValue([
        { id: "greens.agri__fill", type: "fill", paint: { "fill-color": "#f00" }, layout: {} },
      ]);
      registryMock.getLayerConfig.mockReturnValue({
        pmtilesFile: "agri.pmtiles",
        sourceLayer: "agri_tiles",
        id: "agri",
        style: {},
      });
      registryMock.getLayerPMTilesUrl.mockReturnValue("/processed/layers/greens/agri.pmtiles");

      applyInstant(map, [
        { id: "greens", layers: [{ id: "agri", enabled: true }] },
      ]);

      const added = map.addLayer.mock.calls.find((c) => c[0]?.id === "greens.agri__fill");
      expect(added).toBeDefined();
      expect(added[0]["source-layer"]).toBe("agri_tiles");
    } finally {
      if (prevWin === undefined) {
        delete globalThis.window;
      } else {
        globalThis.window = prevWin;
      }
    }
  });

  it("uses source_layer snake_case when sourceLayer is absent", () => {
    expect(
      getVectorSourceLayerName("g.l", { pmtilesFile: "f.pmtiles", source_layer: "layer_a", id: "l" }),
    ).toBe("layer_a");
  });

  it("prioritizes explicit sourceLayer over source_layer", () => {
    expect(
      getVectorSourceLayerName("greens.agri", {
        pmtilesFile: "agri.pmtiles",
        sourceLayer: "camel_case_wins",
        source_layer: "snake_case",
        id: "agri",
      }),
    ).toBe("camel_case_wins");
  });

  it("uses tiling pipeline default source-layer when no explicit sourceLayer is set", () => {
    expect(getVectorSourceLayerName("greens.agri", { id: "agri" })).toBe("layer");
  });

  it("buildPmtilesUrl returns null when path is empty", () => {
    expect(buildPmtilesUrl("")).toBeNull();
    expect(buildPmtilesUrl(null)).toBeNull();
  });

  it("buildPmtilesUrl resolves origin from globalThis.location or globalThis.window", () => {
    const prevLoc = globalThis.location;
    const prevWin = globalThis.window;
    try {
      Object.defineProperty(globalThis, "location", {
        value: { origin: "https://a.example" },
        configurable: true,
      });
      expect(buildPmtilesUrl("/tiles/x.pmtiles")).toBe("pmtiles://https://a.example/tiles/x.pmtiles");
      Object.defineProperty(globalThis, "location", {
        value: undefined,
        configurable: true,
      });
      globalThis.window = { location: { origin: "https://b.example" } };
      expect(buildPmtilesUrl("/p/y.pmtiles")).toBe("pmtiles://https://b.example/p/y.pmtiles");
    } finally {
      Object.defineProperty(globalThis, "location", { value: prevLoc, configurable: true });
      globalThis.window = prevWin;
    }
  });

  it("buildPmtilesUrl returns null when no origin is available (non-browser)", () => {
    const prevLoc = globalThis.location;
    const prevWin = globalThis.window;
    try {
      Object.defineProperty(globalThis, "location", { value: undefined, configurable: true });
      globalThis.window = undefined;
      expect(buildPmtilesUrl("/x.pmtiles")).toBeNull();
    } finally {
      Object.defineProperty(globalThis, "location", { value: prevLoc, configurable: true });
      globalThis.window = prevWin;
    }
  });

  it("adds PMTiles vector layer using default source-layer when manifest omits sourceLayer", () => {
    const map = createMapMock();
    const prevWin = globalThis.window;
    globalThis.window = { location: { origin: "http://localhost" } };

    try {
      bridgeMock.irToMapLibreLayers.mockReturnValue([
        { id: "g.l-f", type: "fill", paint: {}, layout: {} },
      ]);
      registryMock.getLayerConfig.mockReturnValue({
        pmtilesFile: "x.pmtiles",
        id: "l",
      });
      registryMock.getLayerPMTilesUrl.mockReturnValue("/p/x.pmtiles");

      applyInstant(map, [{ id: "g", layers: [{ id: "l", enabled: true }] }]);

      expect(map.addSource).toHaveBeenCalledWith(
        "g.l",
        expect.objectContaining({ type: "vector", url: "pmtiles://http://localhost/p/x.pmtiles" }),
      );
      expect(map.addLayer).toHaveBeenCalledWith(
        expect.objectContaining({ id: "g.l-f", source: "g.l", "source-layer": "layer" }),
      );
    } finally {
      if (prevWin === undefined) {
        delete globalThis.window;
      } else {
        globalThis.window = prevWin;
      }
    }
  });

  it("applyLayerGroupsToMap keeps curated pack when only the logical fullLayerId is registered", () => {
    const map = createMapMock();
    const logicalId = "curated_moresht_axis.solidLine";
    const layerA = `${logicalId}__proposedLine__0`;
    const layerB = `${logicalId}__solidLine__0`;
    map._layers.add(layerA);
    map._layers.add(layerB);
    registerCuratedLayerIds(map, logicalId, `${logicalId}__src`, [layerA, layerB]);

    map.removeLayer.mockClear();

    applyInstant(map, [
      { id: "curated_moresht_axis", layers: [{ id: "solidLine", enabled: true }] },
    ]);

    expect(map.removeLayer).not.toHaveBeenCalled();
  });

  it("applyLayerGroupsToMap prunes per-source state keys (not OTEF layer ids) so they must not be registered", () => {
    const map = createMapMock();
    const logicalId = "curated_moresht_axis.solidLine";
    const internalKey = `${logicalId}__proposedLine__src`;
    const layerId = `${logicalId}__proposedLine__0`;
    map._layers.add(layerId);
    registerCuratedLayerIds(map, internalKey, internalKey, [layerId]);

    map.removeLayer.mockClear();

    applyInstant(map, [
      { id: "curated_moresht_axis", layers: [{ id: "solidLine", enabled: true }] },
    ]);

    expect(map.removeLayer).toHaveBeenCalledWith(layerId);
  });

  it("removeCuratedLayersByPrefix can retain tracked curated layers during slideshow", () => {
    const map = createMapMock();
    const logicalId = "curated_moresht_axis.solidLine";
    const layerA = `${logicalId}__proposedLine__0`;
    const layerB = `${logicalId}__solidLine__0`;
    const sourceA = `${logicalId}__proposedLine__src`;
    const sourceB = `${logicalId}__solidLine__src`;
    const untrackedLayer = `${logicalId}__stale`;
    const untrackedSource = `${logicalId}__stale_src`;
    map.addSource(sourceA, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addSource(sourceB, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addSource(untrackedSource, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map._layers.add(layerA);
    map._layers.add(layerB);
    map._layers.add(untrackedLayer);
    map.getStyle = vi.fn(() => ({
      layers: [{ id: layerA }, { id: layerB }, { id: untrackedLayer }],
      sources: { [sourceA]: {}, [sourceB]: {}, [untrackedSource]: {} },
    }));
    registerCuratedLayerIds(map, logicalId, [sourceA, sourceB], [layerA, layerB]);

    map.removeLayer.mockClear();
    map.removeSource.mockClear();
    map.setLayoutProperty.mockClear();

    removeCuratedLayersByPrefix(map, logicalId, {
      lifecycle: { retainDisabled: true, maxRetainedSources: 2 },
    });

    expect(map.setLayoutProperty).toHaveBeenCalledWith(layerA, "visibility", "none");
    expect(map.setLayoutProperty).toHaveBeenCalledWith(layerB, "visibility", "none");
    expect(map.removeLayer).toHaveBeenCalledWith(untrackedLayer);
    expect(map.removeSource).toHaveBeenCalledWith(untrackedSource);
    expect(map.removeLayer).not.toHaveBeenCalledWith(layerA);
    expect(map.removeLayer).not.toHaveBeenCalledWith(layerB);
    expect(map.removeSource).not.toHaveBeenCalledWith(sourceA);
    expect(map.removeSource).not.toHaveBeenCalledWith(sourceB);
  });

  it("stageLayerHidden zeros numeric circle-opacity and records restore target", () => {
    const { stagedLayerDef, targetOpacity } = stageLayerHidden({
      id: "group_a.layer_1-pts",
      type: "circle",
      paint: {
        "circle-radius": 5,
        "circle-color": "#112233",
        "circle-opacity": 0.72,
      },
      layout: {},
    });
    expect(stagedLayerDef.paint["circle-opacity"]).toBe(0);
    expect(targetOpacity).toEqual({ "circle-opacity": 0.72 });
  });

  it("fadeOutAndRemoveEnabledFullIds animates circle-opacity to 0 before remove", async () => {
    vi.useFakeTimers();
    const map = createMapMock();
    const fullId = "pack.points";
    const layerId = "pack.points-circle";
    map.addSource(fullId);
    map._layers.add(layerId);
    registerCuratedLayerIds(map, fullId, fullId, [layerId]);
    map.setPaintProperty(layerId, "circle-opacity", 0.55);

    const p = fadeOutAndRemoveEnabledFullIds(map, [fullId], 90);
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      layerId,
      "circle-opacity-transition",
      { duration: 90, delay: 0 },
    );
    expect(map.setPaintProperty).toHaveBeenCalledWith(layerId, "circle-opacity", 0);

    await vi.advanceTimersByTimeAsync(90);
    await p;

    expect(map.removeLayer).toHaveBeenCalledWith(layerId);
    expect(map.removeSource).toHaveBeenCalledWith(fullId);
    vi.useRealTimers();
  });

  it("beginSlideshowStage hides new layers then commitSlideshowReveal sets paint transitions and targets", () => {
    const map = createMapMock();
    const layerId = "group_a.layer_1-fill";
    bridgeMock.irToMapLibreLayers.mockReturnValue([
      {
        id: layerId,
        type: "fill",
        paint: { "fill-color": "#f00", "fill-opacity": 0.85 },
        layout: {},
      },
    ]);

    const staged = beginSlideshowStage(map, enabledGroups, {
      transition: { transitionMs: 400 },
    });

    const addedDef = map.addLayer.mock.calls.find((c) => c[0]?.id === layerId)?.[0];
    expect(addedDef).toBeDefined();
    expect(addedDef.paint["fill-opacity"]).toBe(0);
    expect(staged.addedLayerIds).toContain(layerId);
    expect(staged.targetOpacityByLayerId[layerId]).toEqual({ "fill-opacity": 0.85 });
    expect(staged.stagedFullIds).toContain("group_a.layer_1");

    map.setPaintProperty.mockClear();
    commitSlideshowReveal(map, staged, 250);

    expect(map.setPaintProperty).toHaveBeenCalledWith(
      layerId,
      "fill-opacity-transition",
      { duration: 250, delay: 0 },
    );
    expect(map.setPaintProperty).toHaveBeenCalledWith(layerId, "fill-opacity", 0.85);
  });

  it("beginSlideshowStage keeps retained layers hidden until reveal", () => {
    const map = createMapMock();
    const fullId = "pack.area";
    const layerId = "pack.area-fill";
    map.addSource(fullId);
    map._layers.add(layerId);
    registerCuratedLayerIds(map, fullId, fullId, [layerId]);
    map.setPaintProperty(layerId, "fill-opacity", 0.7);

    applyInstant(
      map,
      [{ id: "pack", layers: [{ id: "area", enabled: false }] }],
      { lifecycle: { retainDisabled: true, maxRetainedSources: 2 } },
    );
    map.setPaintProperty.mockClear();
    map.setLayoutProperty.mockClear();

    const staged = beginSlideshowStage(
      map,
      [{ id: "pack", layers: [{ id: "area", enabled: true }] }],
      {
        lifecycle: { retainDisabled: true, maxRetainedSources: 2 },
        transition: { stageHidden: true, transitionMs: 120 },
      },
    );

    expect(map.setLayoutProperty).toHaveBeenCalledWith(layerId, "visibility", "visible");
    expect(map.setPaintProperty).toHaveBeenCalledWith(layerId, "fill-opacity", 0);
    expect(staged.addedLayerIds).toContain(layerId);
    expect(staged.targetOpacityByLayerId[layerId]).toEqual({ "fill-opacity": 0.7 });

    map.setPaintProperty.mockClear();
    commitSlideshowReveal(map, staged, 120);
    expect(map.setPaintProperty).toHaveBeenCalledWith(layerId, "fill-opacity", 0.7);
  });

  it("fadeOutAndRemoveEnabledFullIds sets paint to 0 with transition then removes after timeout", async () => {
    vi.useFakeTimers();
    const map = createMapMock();
    const fullId = "pack.layer_x";
    const layerId = "pack.layer_x-fill";
    map.addSource(fullId);
    map._layers.add(layerId);
    registerCuratedLayerIds(map, fullId, fullId, [layerId]);
    map.setPaintProperty(layerId, "fill-opacity", 0.75);

    const p = fadeOutAndRemoveEnabledFullIds(map, [fullId], 120);
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      layerId,
      "fill-opacity-transition",
      { duration: 120, delay: 0 },
    );
    expect(map.setPaintProperty).toHaveBeenCalledWith(layerId, "fill-opacity", 0);

    await vi.advanceTimersByTimeAsync(120);
    await p;

    expect(map.removeLayer).toHaveBeenCalledWith(layerId);
    expect(map.removeSource).toHaveBeenCalledWith(fullId);
    vi.useRealTimers();
  });

  it("fadeOutAndRemoveEnabledFullIds with transitionMs 0 removes immediately without fade", () => {
    const map = createMapMock();
    const fullId = "g.l";
    const layerId = "g.l-fill";
    map.addSource(fullId);
    map._layers.add(layerId);
    registerCuratedLayerIds(map, fullId, fullId, [layerId]);

    map.setPaintProperty.mockClear();
    void fadeOutAndRemoveEnabledFullIds(map, [fullId], 0);

    expect(map.setPaintProperty).not.toHaveBeenCalled();
    expect(map.removeLayer).toHaveBeenCalledWith(layerId);
    expect(map.removeSource).toHaveBeenCalledWith(fullId);
  });

  it("fades numeric opacity in from zero, restores transitions, and removes only at zero", () => {
    const map = createMapMock();
    const hooks = createLifecycleHooks();
    getLayerLifecycleRuntime(map, hooks);
    const fullId = "group_a.layer_1";
    const layerId = "group_a.layer_1-fill";
    const transition = { duration: 40, delay: 5 };
    bridgeMock.irToMapLibreLayers.mockReturnValue([{
      id: layerId,
      type: "fill",
      paint: { "fill-color": "#abc", "fill-opacity": 0.8, "fill-opacity-transition": transition },
      layout: {},
    }]);

    applyLayerGroupsToMap(map, groupsFor([fullId]));
    expect(map.addLayer.mock.calls.at(-1)[0].paint["fill-opacity"]).toBe(0);
    expect(map.getPaintProperty(layerId, "fill-opacity")).toBe(0);
    expect(map.getLayer(layerId)).toBeTruthy();

    hooks.setTime(300);
    hooks.flushFrame();
    expect(map.getPaintProperty(layerId, "fill-opacity")).toBeCloseTo(0.4);
    expect(map.getPaintProperty(layerId, "fill-opacity-transition")).toEqual({ duration: 0, delay: 0 });

    hooks.setTime(LAYER_FADE_MS);
    hooks.flushFrame();
    expect(map.getPaintProperty(layerId, "fill-opacity")).toBe(0.8);
    expect(map.getPaintProperty(layerId, "fill-opacity-transition")).toEqual(transition);

    applyLayerGroupsToMap(map, []);
    hooks.setTime(LAYER_FADE_MS + 300);
    hooks.flushFrame();
    expect(map.getLayer(layerId)).toBeTruthy();
    expect(map.getSource(fullId)).toBeTruthy();
    expect(map.getPaintProperty(layerId, "fill-opacity")).toBeCloseTo(0.4);

    hooks.setTime(LAYER_FADE_MS * 2 - 1);
    hooks.flushFrame();
    expect(map.getLayer(layerId)).toBeTruthy();

    hooks.setTime(LAYER_FADE_MS * 2);
    hooks.flushFrame();
    expect(map.getLayer(layerId)).toBeFalsy();
    expect(map.getSource(fullId)).toBeFalsy();
  });

  it("fades omitted opacity from the default and restores property absence", () => {
    const map = createMapMock();
    const hooks = createLifecycleHooks();
    getLayerLifecycleRuntime(map, hooks);
    const layerId = "group_a.layer_1-fill";
    bridgeMock.irToMapLibreLayers.mockReturnValue([{
      id: layerId,
      type: "fill",
      paint: { "fill-color": "#abc" },
      layout: {},
    }]);

    applyLayerGroupsToMap(map, enabledGroups);
    expect(map.addLayer.mock.calls.at(-1)[0].paint["fill-opacity"]).toBe(0);

    hooks.setTime(300);
    hooks.flushFrame();
    expect(map.getPaintProperty(layerId, "fill-opacity")).toBeCloseTo(0.5);

    hooks.setTime(LAYER_FADE_MS);
    hooks.flushFrame();
    expect(map.getPaintProperty(layerId, "fill-opacity")).toBeUndefined();
    expect(map.getPaintProperty(layerId, "fill-opacity-transition")).toBeUndefined();
  });

  it("fades real people circle, stroke, and captivity expressions together", () => {
    const map = createMapMock();
    const hooks = createLifecycleHooks();
    getLayerLifecycleRuntime(map, hooks);
    const fullId = "nli.people";
    const circleId = "nli__people__circle";
    const iconId = "nli__people__captivity_bleed";
    const circleOpacity = peopleCircleOpacity();
    const iconOpacity = ["match", ["get", "status"], MURDERED_IN_CAPTIVITY_STATUS, 1, 0];
    bridgeMock.irToMapLibreLayers.mockReturnValue([
      {
        id: circleId,
        type: "circle",
        paint: {
          "circle-opacity": circleOpacity,
          "circle-stroke-opacity": circleOpacity,
          "circle-radius": 6,
        },
        layout: {},
      },
      {
        id: iconId,
        type: "symbol",
        paint: { "icon-opacity": iconOpacity },
        layout: { "icon-image": "captivity" },
      },
    ]);

    applyLayerGroupsToMap(map, groupsFor([fullId]));
    expect(map.addLayer.mock.calls.find((call) => call[0].id === circleId)[0].paint["circle-opacity"]).toEqual(
      scaleOpacityExpression(circleOpacity, 0),
    );
    expect(map.addLayer.mock.calls.find((call) => call[0].id === iconId)[0].paint["icon-opacity"]).toEqual(
      scaleOpacityExpression(iconOpacity, 0),
    );

    hooks.setTime(300);
    hooks.flushFrame();
    expect(map.getPaintProperty(circleId, "circle-opacity")).toEqual(scaleOpacityExpression(circleOpacity, 0.5));
    expect(map.getPaintProperty(circleId, "circle-stroke-opacity")).toEqual(scaleOpacityExpression(circleOpacity, 0.5));
    expect(map.getPaintProperty(iconId, "icon-opacity")).toEqual(scaleOpacityExpression(iconOpacity, 0.5));

    hooks.setTime(LAYER_FADE_MS);
    hooks.flushFrame();
    expect(map.getPaintProperty(circleId, "circle-opacity")).toEqual(circleOpacity);
    expect(map.getPaintProperty(iconId, "icon-opacity")).toEqual(iconOpacity);
  });

  it("keeps an already shown layer at its authored opacity while a new layer fades in", () => {
    const map = createMapMock();
    const hooks = createLifecycleHooks();
    getLayerLifecycleRuntime(map, hooks);
    const kept = "group_a.layer_1";
    const added = "group_b.layer_2";
    const keptLayer = "group_a.layer_1-fill";
    const addedLayer = "group_b.layer_2-fill";
    bridgeMock.irToMapLibreLayers.mockImplementation((fullId) => [{
      id: fullId === kept ? keptLayer : addedLayer,
      type: "fill",
      paint: { "fill-opacity": fullId === kept ? 0.8 : 0.2 },
      layout: {},
    }]);

    applyLayerGroupsToMap(map, groupsFor([kept]));
    hooks.setTime(LAYER_FADE_MS);
    hooks.flushFrame();
    expect(map.getPaintProperty(keptLayer, "fill-opacity")).toBe(0.8);

    applyLayerGroupsToMap(map, groupsFor([kept, added]));
    expect(map.getPaintProperty(keptLayer, "fill-opacity")).toBe(0.8);
    expect(map.getPaintProperty(addedLayer, "fill-opacity")).toBe(0);

    hooks.setTime(LAYER_FADE_MS + 300);
    hooks.flushFrame();
    expect(map.getPaintProperty(keptLayer, "fill-opacity")).toBe(0.8);
    expect(map.getPaintProperty(addedLayer, "fill-opacity")).toBeCloseTo(0.1);
  });

  it("reverses from the latest enabled set and does not restart an identical exit", () => {
    const map = createMapMock();
    const hooks = createLifecycleHooks();
    getLayerLifecycleRuntime(map, hooks);
    const fullA = "group_a.layer_1";
    const fullB = "group_b.layer_2";
    const layerA = "group_a.layer_1-fill";
    const layerB = "group_b.layer_2-fill";
    bridgeMock.irToMapLibreLayers.mockImplementation((fullId) => [{
      id: fullId === fullA ? layerA : layerB,
      type: "fill",
      paint: { "fill-opacity": 1 },
      layout: {},
    }]);

    applyLayerGroupsToMap(map, groupsFor([fullA]));
    hooks.setTime(100);
    applyLayerGroupsToMap(map, groupsFor([fullB]));
    hooks.setTime(100 + LAYER_FADE_MS);
    hooks.flushFrame();
    expect(map.getLayer(layerA)).toBeFalsy();
    expect(map.getPaintProperty(layerB, "fill-opacity")).toBe(1);

    applyLayerGroupsToMap(map, []);
    hooks.setTime(100 + LAYER_FADE_MS + 300);
    hooks.flushFrame();
    expect(map.getPaintProperty(layerB, "fill-opacity")).toBeCloseTo(0.5);

    applyLayerGroupsToMap(map, groupsFor([fullB]));
    hooks.setTime(100 + (LAYER_FADE_MS * 2) + 300);
    hooks.flushFrame();
    expect(map.getLayer(layerB)).toBeTruthy();
    expect(map.getPaintProperty(layerB, "fill-opacity")).toBe(1);

    const exitStart = 100 + (LAYER_FADE_MS * 2) + 300;
    applyLayerGroupsToMap(map, []);
    hooks.setTime(exitStart + 200);
    applyLayerGroupsToMap(map, []);
    hooks.setTime(exitStart + LAYER_FADE_MS);
    hooks.flushFrame();
    expect(map.getLayer(layerB)).toBeFalsy();
  });

  it("rolls back a failed fade add and releases hatch images only when the fade reaches zero", () => {
    const map = createMapMock();
    const hooks = createLifecycleHooks();
    getLayerLifecycleRuntime(map, hooks);
    const patternId = "hatch_fade_owner";
    bridgeMock.irToMapLibreLayers.mockReturnValue([
      {
        id: "group_a.layer_1-fill",
        type: "fill",
        paint: { "fill-opacity": 1, "fill-pattern": patternId },
        layout: {},
        _hatchPattern: { patternId, color: "#f00", rotation: 0, separation: 8, width: 1 },
      },
      { id: "group_a.layer_1-line", type: "line", paint: { "line-opacity": 1 }, layout: {} },
    ]);
    map.addLayer.mockImplementation((def) => {
      if (def.id.endsWith("-line")) throw new Error("addLayer failed");
      map._layers.add(def.id);
      map._paintByLayerId.set(def.id, { ...(def.paint || {}) });
    });

    withCanvasStub(() => {
      applyLayerGroupsToMap(map, enabledGroups);
      expect(map.getSource("group_a.layer_1")).toBeFalsy();
      expect(map.hasImage(patternId)).toBe(false);
      hooks.setTime(LAYER_FADE_MS);
      hooks.flushFrame();
      expect(map.getLayer("group_a.layer_1-fill")).toBeFalsy();
    });
  });

  it("raises an unchanged layer when a fading layer is added above it", () => {
    const map = createMapMock();
    const hooks = createLifecycleHooks();
    getLayerLifecycleRuntime(map, hooks);
    map.moveLayer = vi.fn();
    const kept = "group_a.layer_1";
    const added = "group_b.layer_2";
    bridgeMock.irToMapLibreLayers.mockImplementation((fullId) => [{
      id: `${fullId}-fill`,
      type: "fill",
      paint: { "fill-opacity": 1 },
      layout: {},
    }]);

    applyLayerGroupsToMap(map, groupsFor([kept]));
    hooks.setTime(LAYER_FADE_MS);
    hooks.flushFrame();
    map.moveLayer.mockClear();

    applyLayerGroupsToMap(map, groupsFor([kept, added]));
    expect(map.moveLayer).toHaveBeenCalledWith(`${kept}-fill`);
    expect(map.getLayer(`${added}-fill`)).toBeTruthy();
    expect(map.getPaintProperty(`${kept}-fill`, "fill-opacity")).toBe(1);
    expect(map.getPaintProperty(`${added}-fill`, "fill-opacity")).toBe(0);
  });

  it("does not override timeline visibility none while opacity fades", () => {
    const map = createMapMock();
    const hooks = createLifecycleHooks();
    getLayerLifecycleRuntime(map, hooks);
    const fullId = INVESTIGATION_LINES_FULL_ID;
    const layerId = "nli__lines__authored";
    bridgeMock.irToMapLibreLayers.mockReturnValue([{
      id: layerId,
      type: "line",
      paint: { "line-opacity": 1 },
      layout: { visibility: "visible" },
    }]);
    syncTimelineBaseLayerVisibility(map, {
      suppressedFullIds: [fullId],
      enabledFullIds: [fullId],
    });

    applyLayerGroupsToMap(map, groupsFor([fullId]));
    hooks.setTime(300);
    hooks.flushFrame();
    expect(map.getLayoutProperty(layerId, "visibility")).toBe("none");
    expect(map.getPaintProperty(layerId, "line-opacity")).toBeCloseTo(0.5);

    hooks.setTime(LAYER_FADE_MS);
    hooks.flushFrame();
    expect(map.getLayoutProperty(layerId, "visibility")).toBe("none");
    expect(map.getPaintProperty(layerId, "line-opacity")).toBe(1);
  });

  it("skips curated-owned resources during live sync", () => {
    const map = createMapMock();
    for (const fullId of ["curated.4", "curated.42"]) {
      const layerId = `${fullId}__line__0`;
      map._layers.add(layerId);
      registerCuratedLayerIds(map, fullId, fullId, [layerId]);
    }
    map.removeLayer.mockClear();
    map.removeSource.mockClear();

    applyLayerGroupsToMap(map, []);

    expect(map.removeLayer).not.toHaveBeenCalled();
    expect(map.removeSource).not.toHaveBeenCalled();
    expect(map.getLayer("curated.4__line__0")).toBeTruthy();
    expect(map.getLayer("curated.42__line__0")).toBeTruthy();
  });

  it("joins an already opened batch and waits for the caller to commit", () => {
    const map = createMapMock();
    const hooks = createLifecycleHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    const layerId = "group_a.layer_1-fill";
    bridgeMock.irToMapLibreLayers.mockReturnValue([{
      id: layerId,
      type: "fill",
      paint: { "fill-opacity": 0.8 },
      layout: {},
    }]);
    runtime.setDesiredIds(["group_a.layer_1"], { durationMs: LAYER_FADE_MS });
    const batch = runtime.getPendingBatch();

    applyLayerGroupsToMap(map, enabledGroups, { lifecycle: { joinBatch: true } });

    expect(runtime.getPendingBatch()).toBe(batch);
    expect(map.getPaintProperty(layerId, "fill-opacity")).toBe(0);
    expect(hooks.pendingFrame).toBeNull();

    runtime.commitBatch();
    hooks.setTime(300);
    hooks.flushFrame();
    expect(map.getPaintProperty(layerId, "fill-opacity")).toBeCloseTo(0.4);
  });

  it("records a joined enabled set so handoff restores mounted targets", () => {
    const map = createMapMock();
    const hooks = createLifecycleHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    const layerId = "group_a.layer_1-fill";
    bridgeMock.irToMapLibreLayers.mockReturnValue([{
      id: layerId,
      type: "fill",
      paint: { "fill-opacity": 0.8 },
      layout: {},
    }]);
    runtime.setDesiredIds(["group_a.layer_1"], { durationMs: LAYER_FADE_MS });

    applyLayerGroupsToMap(map, enabledGroups, { lifecycle: { joinBatch: true } });
    expect(map.getPaintProperty(layerId, "fill-opacity")).toBe(0);

    beginSlideshowStage(map, enabledGroups, { transition: { transitionMs: 80 } });
    expect(map.getLayer(layerId)).toBeTruthy();
    expect(map.getPaintProperty(layerId, "fill-opacity")).toBe(0.8);
  });

  it("adopts already-mounted layers into a joined batch without sealing it", () => {
    const map = createMapMock();
    const hooks = createLifecycleHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    const kept = "group_a.layer_1";
    const outgoing = "group_b.layer_2";
    const incoming = "group_c.layer_3";
    const keptLayer = `${kept}-fill`;
    const outgoingLayer = `${outgoing}-fill`;
    const incomingLayer = `${incoming}-fill`;
    bridgeMock.irToMapLibreLayers.mockImplementation((fullId) => [{
      id: `${fullId}-fill`,
      type: "fill",
      paint: { "fill-opacity": fullId === outgoing ? 0.4 : 0.8 },
      layout: {},
    }]);

    applyLayerGroupsToMap(map, groupsFor([kept, outgoing]), {
      lifecycle: { retainDisabled: true },
    });
    expect(map.getPaintProperty(keptLayer, "fill-opacity")).toBe(0.8);
    expect(map.getPaintProperty(outgoingLayer, "fill-opacity")).toBe(0.4);

    runtime.setDesiredIds([kept, incoming], { durationMs: LAYER_FADE_MS });
    const batch = runtime.getPendingBatch();
    applyLayerGroupsToMap(map, groupsFor([kept, incoming]), { lifecycle: { joinBatch: true } });

    expect(runtime.getPendingBatch()).toBe(batch);
    expect(batch.sealed).toBe(false);
    expect(hooks.pendingFrame).toBeNull();
    expect(batch.membership).toContain(kept);
    expect(map.getLayer(outgoingLayer)).toBeTruthy();
    expect(map.getPaintProperty(outgoingLayer, "fill-opacity")).toBe(0.4);
    expect(map.getPaintProperty(keptLayer, "fill-opacity")).toBe(0.8);
    expect(map.getPaintProperty(incomingLayer, "fill-opacity")).toBe(0);

    runtime.commitBatch();
    hooks.setTime(300);
    hooks.flushFrame();
    expect(map.getLayer(outgoingLayer)).toBeTruthy();
    expect(map.getPaintProperty(outgoingLayer, "fill-opacity")).toBeCloseTo(0.2);
    expect(map.getPaintProperty(keptLayer, "fill-opacity")).toBe(0.8);
    expect(map.getPaintProperty(incomingLayer, "fill-opacity")).toBeCloseTo(0.4);
  });

  it("waits for source readiness before starting the fade", () => {
    const map = createMapMock();
    const hooks = createLifecycleHooks();
    getLayerLifecycleRuntime(map, hooks);
    const fullId = "group_a.layer_1";
    const layerId = "group_a.layer_1-fill";
    map.isSourceLoaded = vi.fn(() => false);
    bridgeMock.irToMapLibreLayers.mockReturnValue([{
      id: layerId,
      type: "fill",
      paint: { "fill-opacity": 0.8 },
      layout: {},
    }]);

    applyLayerGroupsToMap(map, groupsFor([fullId]));
    expect(map.getPaintProperty(layerId, "fill-opacity")).toBe(0);
    expect(hooks.pendingFrame).toBeNull();

    map.isSourceLoaded.mockReturnValue(true);
    map.emit("sourcedata", { sourceId: fullId, isSourceLoaded: true });
    expect(map.getPaintProperty(layerId, "fill-opacity")).toBe(0);
    hooks.setTime(300);
    hooks.flushFrame();
    expect(map.getPaintProperty(layerId, "fill-opacity")).toBeCloseTo(0.4);
  });

  it("hands a live fade to slideshow before native paint and leaves staged zeros", async () => {
    vi.useFakeTimers();
    const map = createMapMock();
    const hooks = createLifecycleHooks();
    getLayerLifecycleRuntime(map, hooks);
    const liveId = "group_a.layer_1";
    const liveLayer = "group_a.layer_1-fill";
    const nextId = "group_b.layer_2";
    const nextLayer = "group_b.layer_2-fill";
    bridgeMock.irToMapLibreLayers.mockImplementation((fullId) => [{
      id: fullId === liveId ? liveLayer : nextLayer,
      type: "fill",
      paint: { "fill-opacity": fullId === liveId ? 0.8 : 0.7 },
      layout: {},
    }]);

    applyLayerGroupsToMap(map, groupsFor([liveId]));
    hooks.setTime(300);
    hooks.flushFrame();
    expect(map.getPaintProperty(liveLayer, "fill-opacity")).toBeCloseTo(0.4);

    map.setPaintProperty.mockClear();
    const fadePromise = fadeOutAndRemoveEnabledFullIds(map, [liveId], 80);
    const opacityWrites = map.setPaintProperty.mock.calls.filter((call) => call[1] === "fill-opacity");
    const restoredAt = opacityWrites.findIndex((call) => call[2] === 0.8);
    const zeroAt = opacityWrites.findIndex((call) => call[2] === 0);
    expect(restoredAt).toBeGreaterThanOrEqual(0);
    expect(zeroAt).toBeGreaterThan(restoredAt);

    hooks.setTime(400);
    hooks.flushFrame();
    expect(map.getPaintProperty(liveLayer, "fill-opacity")).toBe(0);

    await vi.advanceTimersByTimeAsync(80);
    await fadePromise;

    const staged = beginSlideshowStage(map, groupsFor([nextId]), {
      lifecycle: { retainDisabled: true, maxRetainedSources: 2 },
      transition: { transitionMs: 80 },
    });
    expect(map.getPaintProperty(nextLayer, "fill-opacity")).toBe(0);
    applyLayerGroupsToMap(map, groupsFor([nextId]), {
      lifecycle: { retainDisabled: true, maxRetainedSources: 2 },
    });
    expect(map.getPaintProperty(nextLayer, "fill-opacity")).toBe(0);
    expect(staged.targetOpacityByLayerId[nextLayer]).toEqual({ "fill-opacity": 0.7 });

    commitSlideshowReveal(map, staged, 80);
    expect(map.getPaintProperty(nextLayer, "fill-opacity")).toBe(0.7);

    applyLayerGroupsToMap(map, groupsFor([liveId]));
    expect(map.addLayer.mock.calls.filter((call) => call[0]?.id === liveLayer).at(-1)[0].paint["fill-opacity"]).toBe(0);
    hooks.setTime(hooks.now() + 300);
    hooks.flushFrame();
    expect(map.getPaintProperty(liveLayer, "fill-opacity")).toBeCloseTo(0.4);
    vi.useRealTimers();
  });

  it("cancels live work for a direct stage and a duration-0 apply", () => {
    const map = createMapMock();
    const hooks = createLifecycleHooks();
    getLayerLifecycleRuntime(map, hooks);
    const liveId = "group_a.layer_1";
    const liveLayer = "group_a.layer_1-fill";
    const nextLayer = "group_b.layer_2-fill";
    bridgeMock.irToMapLibreLayers.mockImplementation((fullId) => [{
      id: fullId === liveId ? liveLayer : nextLayer,
      type: "fill",
      paint: { "fill-opacity": fullId === liveId ? 0.8 : 0.7 },
      layout: {},
    }]);

    applyLayerGroupsToMap(map, groupsFor([liveId]));
    hooks.setTime(300);
    hooks.flushFrame();
    expect(hooks.pendingFrame).toBeTruthy();

    const staged = beginSlideshowStage(map, groupsFor(["group_b.layer_2"]), {
      transition: { transitionMs: 80 },
    });
    expect(map.getPaintProperty(nextLayer, "fill-opacity")).toBe(0);
    hooks.setTime(900);
    hooks.flushFrame();
    expect(map.getPaintProperty(nextLayer, "fill-opacity")).toBe(0);
    expect(staged.targetOpacityByLayerId[nextLayer]).toEqual({ "fill-opacity": 0.7 });

    const instantMap = createMapMock();
    const instantHooks = createLifecycleHooks();
    getLayerLifecycleRuntime(instantMap, instantHooks);
    bridgeMock.irToMapLibreLayers.mockReturnValue([{
      id: liveLayer,
      type: "fill",
      paint: { "fill-opacity": 0.8 },
      layout: {},
    }]);
    applyLayerGroupsToMap(instantMap, groupsFor([liveId]));
    instantHooks.setTime(300);
    instantHooks.flushFrame();
    applyLayerGroupsToMap(instantMap, [], { transition: { transitionMs: 0 } });
    expect(instantMap.getLayer(liveLayer)).toBeFalsy();
    instantMap._layers.add(liveLayer);
    instantMap.setPaintProperty(liveLayer, "fill-opacity", 0.33);
    instantHooks.setTime(900);
    instantHooks.flushFrame();
    expect(instantMap.getPaintProperty(liveLayer, "fill-opacity")).toBe(0.33);
  });

  it("cancels clear, dispose, and style reset without painting reconstructed layers", () => {
    for (const stop of [clearAllLayers, disposeLayerManagerForMap]) {
      const map = createMapMock();
      const hooks = createLifecycleHooks();
      getLayerLifecycleRuntime(map, hooks);
      const layerId = "group_a.layer_1-fill";
      bridgeMock.irToMapLibreLayers.mockReturnValue([{
        id: layerId,
        type: "fill",
        paint: { "fill-opacity": 0.8 },
        layout: {},
      }]);
      applyLayerGroupsToMap(map, enabledGroups);
      hooks.setTime(300);
      hooks.flushFrame();
      expect(map.getPaintProperty(layerId, "fill-opacity")).toBeCloseTo(0.4);

      stop(map);
      map._layers.add(layerId);
      map.setPaintProperty(layerId, "fill-opacity", 0.91);
      hooks.setTime(LAYER_FADE_MS);
      hooks.flushFrame();
      hooks.fireDueTimers();
      expect(map.getPaintProperty(layerId, "fill-opacity")).toBe(0.91);
    }
  });

  it("keeps a hatch image until the faded layer reaches zero", () => {
    const map = createMapMock();
    const hooks = createLifecycleHooks();
    getLayerLifecycleRuntime(map, hooks);
    const patternId = "hatch_until_zero";
    const layerId = "group_a.layer_1-fill";
    bridgeMock.irToMapLibreLayers.mockReturnValue([{
      id: layerId,
      type: "fill",
      paint: { "fill-opacity": 1, "fill-pattern": patternId },
      layout: {},
      _hatchPattern: { patternId, color: "#0f0", rotation: 0, separation: 8, width: 1 },
    }]);

    withCanvasStub(() => {
      applyLayerGroupsToMap(map, enabledGroups);
      hooks.setTime(300);
      hooks.flushFrame();
      expect(map.hasImage(patternId)).toBe(true);
      expect(map.getSource("group_a.layer_1")).toBeTruthy();

      applyLayerGroupsToMap(map, []);
      hooks.setTime(300 + LAYER_FADE_MS - 1);
      hooks.flushFrame();
      expect(map.hasImage(patternId)).toBe(true);

      hooks.setTime(300 + LAYER_FADE_MS);
      hooks.flushFrame();
      expect(map.hasImage(patternId)).toBe(false);
      expect(map.getSource("group_a.layer_1")).toBeFalsy();
    });
  });
});

const YISHUV_ID = "projector_base.ישובים";
const YISHUV_LAYER = "projector_base__ישובים-fill";
const DIM_OPACITY = NLI_VISUAL_TOKENS.dimOpacity;
const GLOW_MS = NLI_VISUAL_TOKENS.highlightOpacityTransitionMs;

function useSettlementFill(opacity = 1) {
  bridgeMock.irToMapLibreLayers.mockImplementation((fullId) => [{
    id: fullId === YISHUV_ID ? YISHUV_LAYER : `${fullId}-fill`,
    type: "fill",
    paint: { "fill-opacity": fullId === YISHUV_ID ? opacity : 1 },
    layout: {},
  }]);
}

function preferReducedMotion() {
  vi.stubGlobal("window", {
    matchMedia: (query) => ({ matches: query === "(prefers-reduced-motion: reduce)" }),
  });
}

function ownedSettlement(map) {
  return peekLayerLifecycleRuntime(map)?.hasPaintChannel?.(YISHUV_ID, "fill-opacity") === true;
}

describe("ordinary live settlement ownership", () => {
  beforeEach(() => {
    bridgeMock.irToMapLibreLayers.mockReset();
    registryMock.getLayerConfig.mockReset();
    registryMock.getLayerDataUrl.mockReset();
    registryMock.getLayerPMTilesUrl.mockReset();
    registryMock.getLayerConfig.mockReturnValue({ format: "geojson" });
    registryMock.getLayerDataUrl.mockReturnValue("/data/layer.geojson");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["reduced motion", () => preferReducedMotion(), undefined],
    ["explicit transitionMs 0", () => {}, { transition: { transitionMs: 0 } }],
  ])("mounts a fresh %s settlement in cached policy without waiting for the source", (_label, arrangeMotion, options) => {
    arrangeMotion();
    const map = createMapMock();
    const hooks = createLifecycleHooks();
    getLayerLifecycleRuntime(map, hooks);
    map.isSourceLoaded = vi.fn(() => false);
    useSettlementFill(1);
    attachSettlementOrientationRuntime(map);
    applySettlementOrientationPaint(map, { phase: "playing" });

    applyLayerGroupsToMap(map, groupsFor([YISHUV_ID]), options);

    expect(map.isSourceLoaded).not.toHaveBeenCalled();
    expect(map.addLayer.mock.calls.at(-1)[0].paint["fill-opacity"]).not.toBe(1);
    expect(map.getPaintProperty(YISHUV_LAYER, "fill-opacity")).toBe(DIM_OPACITY);
    expect(ownedSettlement(map)).toBe(true);
    expect(hooks.pendingFrame).toBeNull();
  });

  it("keeps a later full-motion policy on the 400ms clock after an explicit zero mount", () => {
    const map = createMapMock();
    const hooks = createLifecycleHooks();
    getLayerLifecycleRuntime(map, hooks);
    map.isSourceLoaded = vi.fn(() => false);
    useSettlementFill(1);
    attachSettlementOrientationRuntime(map);
    applySettlementOrientationPaint(map, { phase: "playing" });
    applyLayerGroupsToMap(map, groupsFor([YISHUV_ID]), { transition: { transitionMs: 0 } });
    expect(map.getPaintProperty(YISHUV_LAYER, "fill-opacity")).toBe(DIM_OPACITY);

    hooks.setTime(0);
    applySettlementOrientationPaint(map, { phase: "idle" });
    expect(map.getPaintProperty(YISHUV_LAYER, "fill-opacity")).toBe(DIM_OPACITY);
    expect(hooks.pendingFrame).not.toBeNull();
    hooks.setTime(GLOW_MS / 2);
    hooks.flushFrame();
    expect(map.getPaintProperty(YISHUV_LAYER, "fill-opacity")).toBeCloseTo(0.54);
    hooks.setTime(GLOW_MS);
    hooks.flushFrame();
    expect(map.getPaintProperty(YISHUV_LAYER, "fill-opacity")).toBe(1);
    expect(hooks.pendingFrame).toBeNull();
  });

  it("adopts an already mounted unbound settlement without changing its paint", () => {
    const map = createMapMock();
    const hooks = createLifecycleHooks();
    getLayerLifecycleRuntime(map, hooks);
    useSettlementFill(0.42);
    applyLayerGroupsToMap(map, groupsFor([YISHUV_ID]), {
      lifecycle: { retainDisabled: true },
    });
    expect(map.getPaintProperty(YISHUV_LAYER, "fill-opacity")).toBe(0.42);
    expect(ownedSettlement(map)).toBe(false);

    applyLayerGroupsToMap(map, groupsFor([YISHUV_ID]), { transition: { transitionMs: 0 } });

    expect(map.getPaintProperty(YISHUV_LAYER, "fill-opacity")).toBe(0.42);
    expect(ownedSettlement(map)).toBe(true);
    expect(hooks.pendingFrame).toBeNull();
  });

  it("settles factor and effective on a same-set instant apply", () => {
    const map = createMapMock();
    const hooks = createLifecycleHooks();
    getLayerLifecycleRuntime(map, hooks);
    useSettlementFill(1);
    attachSettlementOrientationRuntime(map);
    applyLayerGroupsToMap(map, groupsFor([YISHUV_ID]));
    hooks.setTime(300);
    hooks.flushFrame();
    applySettlementOrientationPaint(map, { phase: "playing" });
    hooks.setTime(400);
    hooks.flushFrame();
    const factor = 400 / LAYER_FADE_MS;
    expect(map.getPaintProperty(YISHUV_LAYER, "fill-opacity")).toBeCloseTo(
      scaleOpacityExpression(1 + (DIM_OPACITY - 1) * (100 / GLOW_MS), factor),
    );

    applyLayerGroupsToMap(map, groupsFor([YISHUV_ID]), { transition: { transitionMs: 0 } });

    expect(map.getPaintProperty(YISHUV_LAYER, "fill-opacity")).toBe(DIM_OPACITY);
    expect(hooks.pendingFrame).toBeNull();

    hooks.setTime(LAYER_FADE_MS);
    applySettlementOrientationPaint(map, { phase: "idle" });
    expect(hooks.pendingFrame).not.toBeNull();
    hooks.setTime(LAYER_FADE_MS + GLOW_MS / 2);
    hooks.flushFrame();
    expect(map.getPaintProperty(YISHUV_LAYER, "fill-opacity")).toBeCloseTo(0.54);
    hooks.setTime(LAYER_FADE_MS + GLOW_MS);
    hooks.flushFrame();
    expect(map.getPaintProperty(YISHUV_LAYER, "fill-opacity")).toBe(1);
  });

  it("commits an in-progress fade immediately when reduced motion is preferred", () => {
    const map = createMapMock();
    const hooks = createLifecycleHooks();
    getLayerLifecycleRuntime(map, hooks);
    useSettlementFill(1);
    attachSettlementOrientationRuntime(map);
    applyLayerGroupsToMap(map, groupsFor([YISHUV_ID]));
    hooks.setTime(300);
    hooks.flushFrame();
    expect(map.getPaintProperty(YISHUV_LAYER, "fill-opacity")).toBeCloseTo(0.5);

    preferReducedMotion();
    applyLayerGroupsToMap(map, groupsFor([YISHUV_ID]));

    expect(map.getPaintProperty(YISHUV_LAYER, "fill-opacity")).toBe(1);
    expect(hooks.pendingFrame).toBeNull();
  });

  it("adopts an unbound mounted fill into a cached playing dim", () => {
    const map = createMapMock();
    const hooks = createLifecycleHooks();
    getLayerLifecycleRuntime(map, hooks);
    useSettlementFill(1);
    applyLayerGroupsToMap(map, groupsFor([YISHUV_ID]), {
      lifecycle: { retainDisabled: true },
    });
    expect(map.getPaintProperty(YISHUV_LAYER, "fill-opacity")).toBe(1);
    expect(ownedSettlement(map)).toBe(false);

    attachSettlementOrientationRuntime(map);
    applySettlementOrientationPaint(map, { phase: "playing", layers: [] });
    expect(map.getPaintProperty(YISHUV_LAYER, "fill-opacity")).toBe(1);

    applyLayerGroupsToMap(map, groupsFor([YISHUV_ID]), { transition: { transitionMs: 0 } });

    expect(map.getPaintProperty(YISHUV_LAYER, "fill-opacity")).toBe(DIM_OPACITY);
    expect(ownedSettlement(map)).toBe(true);
    expect(hooks.pendingFrame).toBeNull();
  });

  it("does not take slideshow ownership or replay policy over staged zeros", async () => {
    vi.useFakeTimers();
    const map = createMapMock();
    const hooks = createLifecycleHooks();
    getLayerLifecycleRuntime(map, hooks);
    useSettlementFill(1);
    attachSettlementOrientationRuntime(map);
    applyLayerGroupsToMap(map, groupsFor([YISHUV_ID]));
    hooks.setTime(LAYER_FADE_MS);
    hooks.flushFrame();
    hooks.setTime(LAYER_FADE_MS);
    applySettlementOrientationPaint(map, { phase: "playing" });
    hooks.setTime(LAYER_FADE_MS + 100);
    hooks.flushFrame();
    expect(map.getPaintProperty(YISHUV_LAYER, "fill-opacity")).not.toBe(DIM_OPACITY);

    const fadePromise = fadeOutAndRemoveEnabledFullIds(map, [YISHUV_ID], 80, {
      lifecycle: { retainDisabled: true },
    });
    expect(hooks.pendingFrame).toBeNull();
    hooks.setTime(LAYER_FADE_MS + GLOW_MS);
    hooks.flushFrame();
    expect(map.getPaintProperty(YISHUV_LAYER, "fill-opacity")).toBe(0);

    await vi.advanceTimersByTimeAsync(80);
    await fadePromise;

    const staged = beginSlideshowStage(map, groupsFor([YISHUV_ID]), {
      lifecycle: { retainDisabled: true },
      transition: { stageHidden: true, transitionMs: 80 },
    });
    expect(map.getPaintProperty(YISHUV_LAYER, "fill-opacity")).toBe(0);
    applyLayerGroupsToMap(map, groupsFor([YISHUV_ID]), {
      lifecycle: { retainDisabled: true },
    });
    expect(map.getPaintProperty(YISHUV_LAYER, "fill-opacity")).toBe(0);
    expect(ownedSettlement(map)).toBe(false);
    hooks.setTime(hooks.now() + GLOW_MS);
    hooks.flushFrame();
    expect(map.getPaintProperty(YISHUV_LAYER, "fill-opacity")).toBe(0);

    commitSlideshowReveal(map, staged, 0);
    expect(map.getPaintProperty(YISHUV_LAYER, "fill-opacity")).toBe(staged.targetOpacityByLayerId[YISHUV_LAYER]["fill-opacity"]);
    expect(map.getPaintProperty(YISHUV_LAYER, "fill-opacity")).not.toBe(0);
    vi.useRealTimers();
  });

  it("does not tear down a curated or extra desired member on an instant registry apply", () => {
    const map = createMapMock();
    const hooks = createLifecycleHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    const kept = "group_a.layer_1";
    const outgoing = "group_b.layer_2";
    const curatedId = "curated.4";
    const curatedLayer = `${curatedId}__line__0`;
    const extraId = "proj.wmts_base";
    const extraLayer = `wmts__${extraId}__raster`;
    map._layers.add(curatedLayer);
    map._layers.add(extraLayer);
    registerCuratedLayerIds(map, curatedId, curatedId, [curatedLayer]);
    bridgeMock.irToMapLibreLayers.mockImplementation((fullId) => [{
      id: `${fullId}-fill`,
      type: "fill",
      paint: { "fill-opacity": 1 },
      layout: {},
    }]);

    runtime.setDesiredIds([kept, outgoing, curatedId, extraId], { durationMs: LAYER_FADE_MS });
    runtime.stageMapLayer(curatedId, {
      id: `${curatedId}__lifecycle`,
      type: "fill",
      paint: { "fill-opacity": 1 },
    }, {
      onTeardown: () => removeCuratedLayersByPrefix(map, curatedId),
    });
    runtime.stageMapLayer(extraId, {
      id: extraLayer,
      type: "raster",
      paint: { "raster-opacity": 1 },
    }, {
      onTeardown: () => {
        if (map.getLayer(extraLayer)) map.removeLayer(extraLayer);
      },
    });
    runtime.markMemberReady(curatedId);
    runtime.markMemberReady(extraId);
    applyLayerGroupsToMap(map, groupsFor([kept, outgoing, curatedId]), {
      lifecycle: { joinBatch: true },
    });
    runtime.commitBatch();
    hooks.setTime(LAYER_FADE_MS);
    hooks.flushFrame();
    expect(map.getLayer(curatedLayer)).toBeTruthy();
    expect(map.getLayer(extraLayer)).toBeTruthy();
    expect(runtime.getDesiredIds()).toEqual(expect.arrayContaining([curatedId, extraId]));

    applyLayerGroupsToMap(map, groupsFor([kept, curatedId]), { transition: { transitionMs: 0 } });

    expect(runtime.getDesiredIds().slice().sort()).toEqual([curatedId, extraId, kept].sort());
    expect(map.getLayer(curatedLayer)).toBeTruthy();
    expect(map.getLayer(extraLayer)).toBeTruthy();
    expect(map.getLayer(`${outgoing}-fill`)).toBeFalsy();
  });

  it("snaps leaving people and playables to hidden while a settlement fade stays in flight", () => {
    const map = createMapMock();
    const hooks = createLifecycleHooks();
    getLayerLifecycleRuntime(map, hooks);
    const peopleId = "nli.people";
    const playableId = "nli.investigation_polygons";
    const settlementId = "settlements.names";
    const peopleLayer = "nli__people__circle";
    const playableLayer = "nli__investigation_polygons__fill";
    const settlementLayer = "settlements.names-fill";
    bridgeMock.irToMapLibreLayers.mockImplementation((fullId) => {
      if (fullId === peopleId) {
        return [{ id: peopleLayer, type: "circle", paint: { "circle-opacity": 1 }, layout: {} }];
      }
      if (fullId === playableId) {
        return [{ id: playableLayer, type: "fill", paint: { "fill-opacity": 1 }, layout: {} }];
      }
      return [{ id: `${fullId}-fill`, type: "fill", paint: { "fill-opacity": 1 }, layout: {} }];
    });

    applyLayerGroupsToMap(map, groupsFor([peopleId, playableId, settlementId]));
    hooks.setTime(300);
    hooks.flushFrame();
    expect(map.getPaintProperty(settlementLayer, "fill-opacity")).toBeCloseTo(0.5);
    expect(map.getPaintProperty(peopleLayer, "circle-opacity")).toBeCloseTo(0.5);

    applyLayerGroupsToMap(map, groupsFor([settlementId]));

    expect(map.getLayer(peopleLayer)).toBeFalsy();
    expect(map.getLayer(playableLayer)).toBeFalsy();
    expect(map.getPaintProperty(settlementLayer, "fill-opacity")).toBeCloseTo(0.5);

    hooks.setTime(600);
    hooks.flushFrame();
    expect(map.getPaintProperty(settlementLayer, "fill-opacity")).toBe(1);
    expect(map.getLayer(settlementLayer)).toBeTruthy();
  });

  it("snaps leaving people and playables inside an open joined batch without sealing it", () => {
    const map = createMapMock();
    const hooks = createLifecycleHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    const peopleId = "nli.people";
    const playableId = "nli.investigation_polygons";
    const settlementId = "settlements.names";
    const peopleLayer = "nli__people__circle";
    const playableLayer = "nli__investigation_polygons__fill";
    const settlementLayer = "settlements.names-fill";
    bridgeMock.irToMapLibreLayers.mockImplementation((fullId) => {
      if (fullId === peopleId) {
        return [{ id: peopleLayer, type: "circle", paint: { "circle-opacity": 1 }, layout: {} }];
      }
      if (fullId === playableId) {
        return [{ id: playableLayer, type: "fill", paint: { "fill-opacity": 1 }, layout: {} }];
      }
      return [{ id: `${fullId}-fill`, type: "fill", paint: { "fill-opacity": 1 }, layout: {} }];
    });

    applyLayerGroupsToMap(map, groupsFor([peopleId, playableId, settlementId]));
    hooks.setTime(300);
    hooks.flushFrame();
    expect(map.getPaintProperty(settlementLayer, "fill-opacity")).toBeCloseTo(0.5);

    runtime.setDesiredIds([settlementId], { durationMs: LAYER_FADE_MS });
    const batch = runtime.getPendingBatch();
    expect(batch?.sealed).toBe(false);

    applyLayerGroupsToMap(map, groupsFor([settlementId]), { lifecycle: { joinBatch: true } });

    expect(map.getLayer(peopleLayer)).toBeFalsy();
    expect(map.getLayer(playableLayer)).toBeFalsy();
    expect(map.getPaintProperty(settlementLayer, "fill-opacity")).toBeCloseTo(0.5);
    expect(runtime.getPendingBatch()).toBe(batch);
    expect(batch.sealed).toBe(false);

    runtime.commitBatch();
    hooks.setTime(600);
    hooks.flushFrame();
    expect(map.getPaintProperty(settlementLayer, "fill-opacity")).toBe(1);
    expect(map.getLayer(settlementLayer)).toBeTruthy();
  });
});

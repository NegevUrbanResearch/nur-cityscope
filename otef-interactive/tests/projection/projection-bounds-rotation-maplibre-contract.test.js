const fs = require("fs");
const path = require("path");

function read(p) {
  return fs.readFileSync(path.resolve(__dirname, "../../", p), "utf8");
}

/** Minimal DOM + MapLibre globals so maplibre-projection.js can load in Node. */
function createProjectionDomElement(size) {
  const styleStore = {};
  const style = new Proxy(styleStore, {
    get(target, prop) {
      if (typeof prop === "symbol") return Reflect.get(target, prop);
      return target[prop] ?? "";
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
  const el = {
    className: "",
    dataset: {},
    parentElement: null,
    _kids: [],
    _cw: size?.w ?? 0,
    _ch: size?.h ?? 0,
    get clientWidth() {
      return this._cw;
    },
    get clientHeight() {
      return this._ch;
    },
    style,
    appendChild(child) {
      child.parentElement = this;
      this._kids.push(child);
    },
    querySelector(sel) {
      if (sel === ".highlight-box") {
        return this._kids.find((c) => c.className === "highlight-box") ?? null;
      }
      if (sel === ".highlight-box-fill") {
        return this._kids.find((c) => c.className === "highlight-box-fill") ?? null;
      }
      return null;
    },
  };
  return el;
}

const EXPECTED_RTL_PLUGIN_URL =
  "https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.js";

async function loadProjectionHighlightModule() {
  vi.resetModules();
  globalThis.maplibregl = {
    addProtocol: vi.fn(),
    getRTLTextPluginStatus: vi.fn(() => "unavailable"),
    setRTLTextPlugin: vi.fn(),
  };
  globalThis.pmtiles = {
    Protocol: class {
      constructor() {
        this.tile = vi.fn();
      }
    },
  };
  globalThis.document = {
    createElement() {
      return createProjectionDomElement({ w: 0, h: 0 });
    },
  };
  return import("../../frontend/src/projection/maplibre-projection.js");
}

/** @param {string} status value from getRTLTextPluginStatus (e.g. unavailable, loaded) */
async function loadProjectionModuleWithRtlStatus(status) {
  vi.resetModules();
  globalThis.maplibregl = {
    addProtocol: vi.fn(),
    getRTLTextPluginStatus: vi.fn(() => status),
    setRTLTextPlugin: vi.fn(),
  };
  globalThis.pmtiles = {
    Protocol: class {
      constructor() {
        this.tile = vi.fn();
      }
    },
  };
  globalThis.document = {
    createElement() {
      return createProjectionDomElement({ w: 0, h: 0 });
    },
  };
  return import("../../frontend/src/projection/maplibre-projection.js");
}

test("bounds and rotation editor modules are callback-based (no Leaflet/canvas map APIs)", () => {
  const bounds = read("frontend/src/projection/projection-bounds-editor.js");
  const rotation = read("frontend/src/projection/projection-rotation-editor.js");

  for (const [name, src] of [
    ["projection-bounds-editor.js", bounds],
    ["projection-rotation-editor.js", rotation],
  ]) {
    expect(src, name).toMatch(/window\.Projection(Bounds|Rotation)Editor/);
    expect(src, name).toMatch(/\bfunction configure\b/);
    expect(src.toLowerCase(), name).not.toMatch(/\bleaflet\b/);
    expect(src, name).not.toMatch(/\bL\.(map|latLng|icon)\b/);
  }

  expect(bounds).toMatch(/getDisplayedImageBounds/);
  expect(bounds).toMatch(/itmToDisplayPixels/);
  expect(bounds).toMatch(/displayPixelsToItm/);
  expect(bounds).toMatch(/displayPixelsToItmCallback/);
  expect(rotation).toMatch(/getDisplayedImageBounds/);
});

test("projection entry loads editors, injects MapLibre-safe callbacks, and wires B / R keys", () => {
  const src = read("frontend/src/entries/projection-main.js");

  expect(src).toContain('await import("../projection/projection-bounds-editor.js")');
  expect(src).toContain('await import("../projection/projection-rotation-editor.js")');

  expect(src).toContain("ProjectionBoundsEditor.configure");
  expect(src).toContain("getDisplayedImageBounds");
  expect(src).toContain("itmToDisplayPixels");
  expect(src).toContain("displayPixelsToItm");
  expect(src).toContain('map.unproject([');
  expect(src).toContain('proj4("EPSG:4326", "EPSG:2039"');
  expect(src).toContain("ProjectionRotationEditor.configure");
  expect(src).toContain("getModelBounds: () => itmBounds");
  expect(src).toContain("viewer_angle_deg: modelBoundsData.viewer_angle_deg");

  expect(src).toMatch(/import\s*\{\s*dispatchProjectionDisplayHotkey,\s*readProjectionDisplayHotkey,?\s*\}\s*from\s*["']\.\.\/projection\/projection-display-hotkeys\.js["']/);
  expect(src).toContain("const action = readProjectionDisplayHotkey(event)");
  expect(src).toContain("dispatchProjectionDisplayHotkey(action, {");
  expect(src).toContain("window.ProjectionBoundsEditor");
  expect(src).toContain("ProjectionBoundsEditor.toggle");
  expect(src).toContain("ProjectionRotationEditor.toggle");
});

test("projection entry keeps ResizeObserver reflow with window resize fallback", () => {
  const src = read("frontend/src/entries/projection-main.js");

  expect(src).toContain("typeof ResizeObserver !== \"undefined\"");
  expect(src).toContain("new ResizeObserver(() => onResize())");
  expect(src).toContain("window.addEventListener(\"resize\", handleWindowResize)");
  expect(src).toContain("window.removeEventListener(\"resize\", handleWindowResize)");
  expect(src).toContain("map.resize()");
  expect(src).toContain("pendingResizeIdleHandler");
  expect(src).toContain("map.off(\"idle\", pendingResizeIdleHandler)");
  expect(src).toContain("runWhenMapIdle");
  const onResizeStart = src.indexOf("const onResize = () => {");
  const onResizeSlice =
    onResizeStart >= 0
      ? src.slice(onResizeStart, src.indexOf("const handleWindowResize", onResizeStart))
      : "";
  expect(onResizeSlice.indexOf("map.resize()")).toBeLessThan(
    onResizeSlice.indexOf("runWhenMapIdle"),
  );
});

test("projection entry applies span view after full-model fitBounds on resize", () => {
  const src = read("frontend/src/entries/projection-main.js");
  expect(src).toContain("parseProjectionSpanId");
  expect(src).toContain("applyProjectionSpanView");
  expect(src).toContain('from "../projection/projection-span-view.js"');
  expect(src).toContain("runWhenMapIdle");
  expect(src).toContain("clearProjectionSpanBase");

  const onResizeStart = src.indexOf("const onResize = () => {");
  const onResizeSlice =
    onResizeStart >= 0
      ? src.slice(onResizeStart, src.indexOf("const handleWindowResize", onResizeStart))
      : "";
  expect(onResizeSlice).toContain("map.fitBounds(modelBounds.bounds");
  // MapLibre fitBounds defaults bearing to 0. Passing viewer_angle here, then
  // span-adding transform3 -50, stacked ~-109° vs old TD (north-up map + raster -50).
  expect(onResizeSlice).not.toContain("bearing: modelBounds.bearing");
  const spanApplyName = onResizeSlice.includes("applySpanCamera")
    ? "applySpanCamera"
    : "applyProjectionSpanView";
  expect(onResizeSlice).toContain(spanApplyName);
  expect(onResizeSlice).toContain("runWhenMapIdle");
  expect(onResizeSlice.indexOf("map.fitBounds")).toBeLessThan(
    onResizeSlice.indexOf(spanApplyName),
  );
});

test("createProjectionMap fitBounds does not pass viewer_angle (defaults to north-up like old TD)", () => {
  const src = read("frontend/src/projection/maplibre-projection.js");
  const start = src.indexOf("export function createProjectionMap");
  const end = src.indexOf("export function updateProjectionViewport");
  const slice = start >= 0 ? src.slice(start, end > start ? end : start + 900) : "";
  const fb = slice.indexOf("map.fitBounds");
  expect(fb).toBeGreaterThan(-1);
  const fbSlice = slice.slice(fb, fb + 280);
  expect(fbSlice).toContain("modelBounds.bounds");
  expect(fbSlice).not.toMatch(/\bbearing\s*:/);
});

test("projection entry applies span after load fitBounds without CSS pixel-ratio pumping", () => {
  const src = read("frontend/src/entries/projection-main.js");
  expect(src).toContain("applyProjectionSpanView");
  expect(src).not.toContain("computeSpanJumpTo");
  expect(src).not.toContain("spanHorizontalScale");

  const mapCreate = src.indexOf("createProjectionMap(");
  expect(mapCreate).toBeGreaterThan(-1);
  const beforeMap = src.slice(0, mapCreate);
  expect(beforeMap).toContain("parseProjectionSpanId");
  expect(beforeMap).toContain("applyProjectionSpanView");

  const loadStart = src.indexOf('map.on("load"');
  const loadSlice =
    loadStart >= 0 ? src.slice(loadStart, src.indexOf("await import", loadStart)) : "";
  const loadApplyName = loadSlice.includes("applySpanCamera")
    ? "applySpanCamera"
    : "applyProjectionSpanView";
  expect(loadSlice).toContain(loadApplyName);
  expect(loadSlice).toContain("runWhenMapIdle");
  expect(loadSlice).toContain("clearProjectionSpanBase");
  expect(loadSlice.indexOf(loadApplyName)).toBeLessThan(
    loadSlice.indexOf("ensureProjectionHighlightLayers"),
  );
});

test("projection entry does not consume place catalog or navigation command inputs for viewport highlight", () => {
  const src = read("frontend/src/entries/projection-main.js");

  expect(src).not.toContain("place-catalog");
  expect(src).not.toContain("searchPlaces");
  expect(src).not.toContain("cameraHint");
  expect(src).not.toContain("navigationCommand");
});

test("viewportToHighlightGeoJSON returns Polygon feature for bbox viewport", async () => {
  const { viewportToHighlightGeoJSON } = await import(
    "../../frontend/src/projection/maplibre-projection-viewport-geojson.js",
  );
  globalThis.proj4 = (from, to, coords) => {
    if (from === "EPSG:2039" && to === "EPSG:4326")
      return [coords[0] * 1e-6, coords[1] * 1e-6];
    return coords;
  };
  const modelBounds = { itm: { west: 0, south: 0, east: 1000, north: 800 } };
  const fc = viewportToHighlightGeoJSON({ bbox: [100, 100, 500, 500], zoom: 13 }, modelBounds);
  expect(fc && fc.features.length).toBe(1);
  expect(fc.features[0].geometry.type).toBe("Polygon");
  delete globalThis.proj4;
});

const HIGHLIGHT_MODEL_BOUNDS = { itm: { west: 0, south: 0, east: 1000, north: 800 } };
const HIGHLIGHT_VALID_CORNERS = {
  sw: { x: 120, y: 120 },
  se: { x: 640, y: 90 },
  ne: { x: 710, y: 690 },
  nw: { x: 140, y: 720 },
};
const HIGHLIGHT_SMALL_BBOX = [100, 100, 500, 500];

function stubHighlightProj4() {
  globalThis.proj4 = (from, to, coords) => {
    if (from === "EPSG:2039" && to === "EPSG:4326")
      return [coords[0] * 1e-6, coords[1] * 1e-6];
    return coords;
  };
}

test("keeps highlight geometry below zoom 13", async () => {
  const { viewportToHighlightGeoJSON } = await import(
    "../../frontend/src/projection/maplibre-projection-viewport-geojson.js",
  );
  stubHighlightProj4();
  const fc = viewportToHighlightGeoJSON(
    { bbox: HIGHLIGHT_SMALL_BBOX, zoom: 12, corners: HIGHLIGHT_VALID_CORNERS },
    HIGHLIGHT_MODEL_BOUNDS,
  );
  expect(fc.features.length).toBe(1);
  expect(fc.features[0].geometry.type).toBe("Polygon");
  const atDefaultGisZoom = viewportToHighlightGeoJSON(
    { bbox: HIGHLIGHT_SMALL_BBOX, zoom: 11, corners: HIGHLIGHT_VALID_CORNERS },
    HIGHLIGHT_MODEL_BOUNDS,
  );
  expect(atDefaultGisZoom.features.length).toBe(1);
  delete globalThis.proj4;
});

test("keeps highlight geometry when viewport zoom is missing or non-finite", async () => {
  const { viewportToHighlightGeoJSON } = await import(
    "../../frontend/src/projection/maplibre-projection-viewport-geojson.js",
  );
  stubHighlightProj4();
  const noZoom = viewportToHighlightGeoJSON(
    { bbox: HIGHLIGHT_SMALL_BBOX, corners: HIGHLIGHT_VALID_CORNERS },
    HIGHLIGHT_MODEL_BOUNDS,
  );
  expect(noZoom.features.length).toBe(1);
  expect(noZoom.features[0].geometry.type).toBe("Polygon");
  const undefinedZoom = viewportToHighlightGeoJSON(
    { bbox: HIGHLIGHT_SMALL_BBOX, zoom: undefined, corners: HIGHLIGHT_VALID_CORNERS },
    HIGHLIGHT_MODEL_BOUNDS,
  );
  expect(undefinedZoom.features.length).toBe(1);
  const nanZoom = viewportToHighlightGeoJSON(
    { bbox: HIGHLIGHT_SMALL_BBOX, zoom: Number.NaN, corners: HIGHLIGHT_VALID_CORNERS },
    HIGHLIGHT_MODEL_BOUNDS,
  );
  expect(nanZoom.features.length).toBe(1);
  delete globalThis.proj4;
});

test("shows highlight at zoom 13 when not full extent", async () => {
  const { viewportToHighlightGeoJSON } = await import(
    "../../frontend/src/projection/maplibre-projection-viewport-geojson.js",
  );
  stubHighlightProj4();
  const fc = viewportToHighlightGeoJSON(
    { bbox: HIGHLIGHT_SMALL_BBOX, zoom: 13, corners: HIGHLIGHT_VALID_CORNERS },
    HIGHLIGHT_MODEL_BOUNDS,
  );
  expect(fc.features.length).toBe(1);
  delete globalThis.proj4;
});

test("ensureProjectionHighlightLayers fill and line opacity default to 0", async () => {
  const {
    ensureProjectionHighlightLayers,
    PROJECTION_HIGHLIGHT_FILL_LAYER_ID,
    PROJECTION_HIGHLIGHT_LINE_LAYER_ID,
  } = await loadProjectionHighlightModule();
  const { NLI_VISUAL_TOKENS } = await import(
    "../../frontend/src/shared/nli-investigation-theme.js",
  );
  const added = [];
  const mockMap = {
    getSource: vi.fn(() => null),
    addSource: vi.fn(),
    addLayer: vi.fn((layer) => added.push(layer)),
  };
  ensureProjectionHighlightLayers(mockMap);
  const fill = added.find((layer) => layer.id === PROJECTION_HIGHLIGHT_FILL_LAYER_ID);
  const line = added.find((layer) => layer.id === PROJECTION_HIGHLIGHT_LINE_LAYER_ID);
  expect(fill.paint["fill-opacity"]).toBe(0);
  expect(line.paint["line-opacity"]).toBe(0);
  expect(line.paint["line-color"]).toBe("rgba(255,255,255,0.35)");
  expect(line.paint["line-color"]).toBe(NLI_VISUAL_TOKENS.highlightLineColor);
  expect(line.paint["line-width"]).toBe(1);
});

function createHighlightMockMap(setData, sourceId) {
  return {
    getSource: vi.fn((id) => (id === sourceId ? { setData } : null)),
    getLayer: vi.fn(),
    setPaintProperty: vi.fn(),
    getContainer: vi.fn(() => ({ clientWidth: 800, clientHeight: 600 })),
  };
}

test("highlight layers fade opacity across zoom 13 instead of emptying the source", async () => {
  const {
    ensureProjectionHighlightLayers,
    updateHighlightFromViewport,
    PROJECTION_HIGHLIGHT_FILL_LAYER_ID,
    PROJECTION_HIGHLIGHT_LINE_LAYER_ID,
    PROJECTION_HIGHLIGHT_SOURCE_ID,
  } = await loadProjectionHighlightModule();
  stubHighlightProj4();
  const paints = new Map();
  const setData = vi.fn();
  const mockMap = {
    getSource: vi.fn(() => null),
    getLayer: vi.fn((id) => paints.has(id) || true),
    addSource: vi.fn(),
    addLayer: vi.fn((layer) => paints.set(layer.id, layer.paint)),
    setPaintProperty: vi.fn((id, key, value) => {
      const paint = paints.get(id) || {};
      paint[key] = value;
      paints.set(id, paint);
    }),
    getContainer: vi.fn(() => ({ clientWidth: 800, clientHeight: 600 })),
  };
  ensureProjectionHighlightLayers(mockMap);
  const fill = [...paints.values()][0] || mockMap.addLayer.mock.calls[0][0].paint;
  expect(mockMap.addLayer.mock.calls[0][0].paint["fill-opacity-transition"]).toEqual({ duration: 400 });
  expect(mockMap.addLayer.mock.calls[1][0].paint["line-opacity-transition"]).toEqual({ duration: 400 });
  mockMap.getSource = vi.fn((id) =>
    id === PROJECTION_HIGHLIGHT_SOURCE_ID ? { setData } : null,
  );
  updateHighlightFromViewport(
    mockMap,
    { bbox: HIGHLIGHT_SMALL_BBOX, zoom: 12, corners: HIGHLIGHT_VALID_CORNERS },
    HIGHLIGHT_MODEL_BOUNDS,
    null,
  );
  expect(setData.mock.calls.at(-1)[0].features.length).toBe(1);
  expect(mockMap.setPaintProperty).toHaveBeenCalledWith(
    PROJECTION_HIGHLIGHT_FILL_LAYER_ID,
    "fill-opacity",
    0,
  );
  expect(mockMap.setPaintProperty).toHaveBeenCalledWith(
    PROJECTION_HIGHLIGHT_LINE_LAYER_ID,
    "line-opacity",
    0,
  );
  updateHighlightFromViewport(
    mockMap,
    { bbox: HIGHLIGHT_SMALL_BBOX, zoom: 13, corners: HIGHLIGHT_VALID_CORNERS },
    HIGHLIGHT_MODEL_BOUNDS,
    null,
  );
  expect(setData.mock.calls.at(-1)[0].features.length).toBe(1);
  expect(mockMap.setPaintProperty).toHaveBeenCalledWith(
    PROJECTION_HIGHLIGHT_FILL_LAYER_ID,
    "fill-opacity",
    0.05,
  );
  expect(mockMap.setPaintProperty).toHaveBeenCalledWith(
    PROJECTION_HIGHLIGHT_LINE_LAYER_ID,
    "line-opacity",
    1,
  );
  void fill;
  delete globalThis.proj4;
});

test("MapLibre projection highlight: GeoJSON path calls setData with FeatureCollection when highlight source exists", async () => {
  globalThis.proj4 = (from, to, coords) => {
    if (from === "EPSG:2039" && to === "EPSG:4326")
      return [coords[0] * 1e-6, coords[1] * 1e-6];
    return coords;
  };
  const { updateHighlightFromViewport, PROJECTION_HIGHLIGHT_SOURCE_ID } =
    await loadProjectionHighlightModule();

  const setData = vi.fn();
  const mockMap = createHighlightMockMap(setData, PROJECTION_HIGHLIGHT_SOURCE_ID);

  const itm = { west: 0, south: 0, east: 1000, north: 800 };
  const modelBounds = { itm };
  const highlightEl = createProjectionDomElement({ w: 0, h: 0 });

  const viewport = { bbox: [100, 150, 600, 550], zoom: 13 };
  updateHighlightFromViewport(mockMap, viewport, modelBounds, highlightEl);

  expect(mockMap.getSource).toHaveBeenCalledWith(PROJECTION_HIGHLIGHT_SOURCE_ID);
  expect(setData).toHaveBeenCalledTimes(1);
  const payload = setData.mock.calls[0][0];
  expect(payload.type).toBe("FeatureCollection");
  expect(Array.isArray(payload.features)).toBe(true);
  expect(payload.features.length).toBe(1);
  expect(payload.features[0].geometry.type).toBe("Polygon");
  expect(highlightEl.querySelector(".highlight-box")).toBeNull();
  delete globalThis.proj4;
});

test("MapLibre projection highlight: GeoJSON path keeps geometry at full extent", async () => {
  globalThis.proj4 = (from, to, coords) => {
    if (from === "EPSG:2039" && to === "EPSG:4326")
      return [coords[0] * 1e-6, coords[1] * 1e-6];
    return coords;
  };
  const {
    updateHighlightFromViewport,
    PROJECTION_HIGHLIGHT_SOURCE_ID,
    PROJECTION_HIGHLIGHT_FILL_LAYER_ID,
    PROJECTION_HIGHLIGHT_LINE_LAYER_ID,
  } = await loadProjectionHighlightModule();

  const setData = vi.fn();
  const mockMap = createHighlightMockMap(setData, PROJECTION_HIGHLIGHT_SOURCE_ID);

  const itm = { west: 0, south: 0, east: 1000, north: 800 };
  const modelBounds = { itm };
  const highlightEl = createProjectionDomElement({ w: 0, h: 0 });

  updateHighlightFromViewport(mockMap, { bbox: [0, 0, 1000, 800] }, modelBounds, highlightEl);

  const payload = setData.mock.calls.at(-1)[0];
  expect(payload.type).toBe("FeatureCollection");
  expect(payload.features.length).toBe(1);
  expect(payload.features[0].geometry.type).toBe("Polygon");
  expect(mockMap.setPaintProperty).toHaveBeenCalledWith(
    PROJECTION_HIGHLIGHT_FILL_LAYER_ID,
    "fill-opacity",
    0,
  );
  expect(mockMap.setPaintProperty).toHaveBeenCalledWith(
    PROJECTION_HIGHLIGHT_LINE_LAYER_ID,
    "line-opacity",
    0,
  );
  delete globalThis.proj4;
});

test("MapLibre projection highlight: updateHighlightFromViewport creates .highlight-box without border or cssText", async () => {
  const { updateHighlightFromViewport } = await loadProjectionHighlightModule();

  const itm = { west: 0, south: 0, east: 1000, north: 800 };
  const modelBounds = { itm };
  const container = createProjectionDomElement({ w: 1000, h: 800 });
  const highlightEl = createProjectionDomElement({ w: 0, h: 0 });
  container.appendChild(highlightEl);

  const viewport = { bbox: [100, 150, 600, 550] };
  updateHighlightFromViewport(null, viewport, modelBounds, highlightEl);

  expect(highlightEl.style.display).not.toBe("none");
  const box = highlightEl.querySelector(".highlight-box");
  expect(box).toBeTruthy();
  expect(box.style.border).toBe("");
});

test("MapLibre projection highlight: uses corners-first quad when valid corners exist", async () => {
  const { updateHighlightFromViewport } = await loadProjectionHighlightModule();

  const itm = { west: 0, south: 0, east: 1000, north: 800 };
  const modelBounds = { itm };
  const container = createProjectionDomElement({ w: 1000, h: 800 });
  const highlightEl = createProjectionDomElement({ w: 0, h: 0 });
  container.appendChild(highlightEl);

  const viewport = {
    bbox: [100, 100, 700, 700],
    corners: {
      sw: { x: 120, y: 120 },
      se: { x: 640, y: 90 },
      ne: { x: 710, y: 690 },
      nw: { x: 140, y: 720 },
    },
  };
  updateHighlightFromViewport(null, viewport, modelBounds, highlightEl);

  const box = highlightEl.querySelector(".highlight-box");
  expect(box).toBeTruthy();
  const fill = box.querySelector(".highlight-box-fill");
  expect(fill).toBeTruthy();
  expect(fill.style.clipPath).toContain("polygon(");
  expect(highlightEl.dataset.highlightShape).toBe("quad");
});

test("MapLibre projection highlight: bbox rectangle fallback remains when corners are missing", async () => {
  const { updateHighlightFromViewport } = await loadProjectionHighlightModule();

  const itm = { west: 0, south: 0, east: 1000, north: 800 };
  const modelBounds = { itm };
  const container = createProjectionDomElement({ w: 1000, h: 800 });
  const highlightEl = createProjectionDomElement({ w: 0, h: 0 });
  container.appendChild(highlightEl);

  const viewport = { bbox: [100, 150, 600, 550] };
  updateHighlightFromViewport(null, viewport, modelBounds, highlightEl);

  const box = highlightEl.querySelector(".highlight-box");
  expect(box).toBeTruthy();
  const fill = box.querySelector(".highlight-box-fill");
  expect(fill).toBeTruthy();
  expect(fill.style.clipPath).toBe("");
  expect(highlightEl.dataset.highlightShape).toBe("bbox");
});

test("MapLibre projection highlight: invalid corners fall back safely to bbox rectangle", async () => {
  const { updateHighlightFromViewport } = await loadProjectionHighlightModule();

  const itm = { west: 0, south: 0, east: 1000, north: 800 };
  const modelBounds = { itm };
  const container = createProjectionDomElement({ w: 1000, h: 800 });
  const highlightEl = createProjectionDomElement({ w: 0, h: 0 });
  container.appendChild(highlightEl);

  const viewport = {
    bbox: [100, 150, 600, 550],
    corners: {
      sw: { x: 100, y: 150 },
      se: { x: 600, y: 150 },
      nw: { x: 100, y: 550 },
    },
  };
  updateHighlightFromViewport(null, viewport, modelBounds, highlightEl);

  const box = highlightEl.querySelector(".highlight-box");
  expect(box).toBeTruthy();
  const fill = box.querySelector(".highlight-box-fill");
  expect(fill).toBeTruthy();
  expect(fill.style.clipPath).toBe("");
  expect(highlightEl.dataset.highlightShape).toBe("bbox");
});

test("MapLibre projection highlight: full extent keeps overlay hidden", async () => {
  const { updateHighlightFromViewport } = await loadProjectionHighlightModule();

  const itm = { west: 0, south: 0, east: 1000, north: 800 };
  const modelBounds = { itm };
  const container = createProjectionDomElement({ w: 1000, h: 800 });
  const highlightEl = createProjectionDomElement({ w: 0, h: 0 });
  highlightEl.style.display = "";
  container.appendChild(highlightEl);

  const viewport = { bbox: [0, 0, 1000, 800] };
  updateHighlightFromViewport(null, viewport, modelBounds, highlightEl);

  expect(highlightEl.style.display).toBe("none");
});

test("MapLibre projection highlight: invalid container geometry hides overlay (no stale visibility)", async () => {
  const { updateHighlightFromViewport } = await loadProjectionHighlightModule();

  const itm = { west: 0, south: 0, east: 1000, north: 800 };
  const modelBounds = { itm };
  const container = createProjectionDomElement({ w: 0, h: 800 });
  const highlightEl = createProjectionDomElement({ w: 0, h: 0 });
  highlightEl.style.display = "";
  container.appendChild(highlightEl);

  const viewport = { bbox: [100, 150, 600, 550] };
  updateHighlightFromViewport(null, viewport, modelBounds, highlightEl);

  expect(highlightEl.style.display).toBe("none");
});

test("MapLibre projection highlight: uses map.project when map is provided", async () => {
  globalThis.proj4 = vi.fn((from, to, xy) => {
    void from;
    void to;
    return [xy[0] / 1000, xy[1] / 1000];
  });
  const { updateHighlightFromViewport } = await loadProjectionHighlightModule();

  const projectSpy = vi.fn((lngLat) => {
    const lng = Array.isArray(lngLat) ? lngLat[0] : lngLat.lng;
    const lat = Array.isArray(lngLat) ? lngLat[1] : lngLat.lat;
    return { x: lng * 400 + 10, y: lat * 400 + 20 };
  });
  const mockMap = {
    project: projectSpy,
    getContainer: () => ({
      clientWidth: 800,
      clientHeight: 600,
      getBoundingClientRect: () => ({
        left: 5,
        top: 7,
        width: 800,
        height: 600,
      }),
    }),
  };

  const itm = { west: 0, south: 0, east: 1000, north: 800 };
  const modelBounds = { itm };
  const container = createProjectionDomElement({ w: 800, h: 600 });
  const highlightEl = createProjectionDomElement({ w: 0, h: 0 });
  container.appendChild(highlightEl);
  container.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 800,
    height: 600,
  });

  const viewport = {
    bbox: [100, 100, 700, 700],
    corners: {
      sw: { x: 100, y: 100 },
      se: { x: 700, y: 100 },
      ne: { x: 700, y: 700 },
      nw: { x: 100, y: 700 },
    },
  };
  updateHighlightFromViewport(mockMap, viewport, modelBounds, highlightEl);

  expect(projectSpy).toHaveBeenCalled();
  const box = highlightEl.querySelector(".highlight-box");
  expect(box).toBeTruthy();
  const fill = box.querySelector(".highlight-box-fill");
  expect(fill).toBeTruthy();
  expect(highlightEl.dataset.highlightShape).toBe("quad");
  expect(fill.style.clipPath).toContain("polygon(");
  delete globalThis.proj4;
});

test("MapLibre projection: RTL text plugin is set once with URL, null callback, and lazy third arg", async () => {
  await loadProjectionHighlightModule();
  const set = globalThis.maplibregl.setRTLTextPlugin;
  expect(set).toHaveBeenCalledTimes(1);
  expect(set).toHaveBeenCalledWith(EXPECTED_RTL_PLUGIN_URL, null, true);
});

test("MapLibre projection: skips setRTLTextPlugin when getRTLTextPluginStatus is loaded", async () => {
  await loadProjectionModuleWithRtlStatus("loaded");
  const set = globalThis.maplibregl.setRTLTextPlugin;
  expect(set).not.toHaveBeenCalled();
});

test("MapLibre projection: skips setRTLTextPlugin when getRTLTextPluginStatus is loading", async () => {
  await loadProjectionModuleWithRtlStatus("loading");
  expect(globalThis.maplibregl.setRTLTextPlugin).not.toHaveBeenCalled();
});

test("render debug overlay reports span query", () => {
  const src = read("frontend/src/projection/projection-render-debug-overlay.js");
  expect(src).toContain("parseProjectionSpanId");
  expect(src).toContain("span");
});

test("projection help documents span query", () => {
  const html = read("frontend/projection.html");
  expect(html).toContain("span=left");
  expect(html).toContain("span=right");
});

test("projection entry exposes Tesuga presentation flag via title, dataset, and window", () => {
  const src = read("frontend/src/entries/projection-main.js");
  expect(src).toContain("pres=on");
  expect(src).toContain("pres=off");
  expect(src).toContain("OTEFPresentationActive");
  expect(src).toContain("dataset.presentation");
});

test("projection entry publishes its live map for lab measurements", () => {
  const src = read("frontend/src/entries/projection-main.js");
  const mapCreate = src.indexOf('const map = createProjectionMap("projectionMap"');
  const mapPublish = src.indexOf("window._maplibreMap = map", mapCreate);
  expect(mapCreate).toBeGreaterThan(-1);
  expect(mapPublish).toBeGreaterThan(mapCreate);
});

test("projection entry subscribes to narrative state while viewport remains the only highlight-camera path", () => {
  const src = read("frontend/src/entries/projection-main.js");
  expect(src).toContain("createProjectionNarrativeController");
  expect(src).toMatch(/subscribe\("narrativeState"/);
  expect(src).toContain("syncProjectionHighlight(viewport)");
  expect(src).not.toContain("narrativeController.flyTo");
  expect(src).not.toContain("narrativeController.jumpTo");
  expect(src).not.toContain("narrativeController.easeTo");
});

test("Zikim measurement uses the projection runtime EPSG:2039 transform", () => {
  const projectionHtml = read("frontend/projection.html");
  const measurementScript = read("scripts/measure-zikim-span-uv.mjs");
  const runtimeTransform =
    "+towgs84=-24.0024,-17.1032,-17.8444,0.33077,-1.85269,1.66969,5.4248";
  expect(projectionHtml).toContain(runtimeTransform);
  expect(measurementScript).toContain(runtimeTransform);
});

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
      return null;
    },
  };
  return el;
}

async function loadProjectionHighlightModule() {
  vi.resetModules();
  globalThis.maplibregl = {
    addProtocol: vi.fn(),
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
  expect(rotation).toMatch(/getDisplayedImageBounds/);
});

test("projection entry loads editors, injects MapLibre-safe callbacks, and wires B / R keys", () => {
  const src = read("frontend/src/entries/projection-main.js");

  expect(src).toContain('await import("../projection/projection-bounds-editor.js")');
  expect(src).toContain('await import("../projection/projection-rotation-editor.js")');

  expect(src).toContain("ProjectionBoundsEditor.configure");
  expect(src).toContain("getDisplayedImageBounds");
  expect(src).toContain("itmToDisplayPixels");
  expect(src).toContain("ProjectionRotationEditor.configure");
  expect(src).toContain("getModelBounds: () => itmBounds");
  expect(src).toContain("viewer_angle_deg: modelBoundsData.viewer_angle_deg");

  expect(src).toContain('key === "b"');
  expect(src).toContain("window.ProjectionBoundsEditor");
  expect(src).toContain("ProjectionBoundsEditor.toggle");
  expect(src).toContain('key === "r"');
  expect(src).toContain("ProjectionRotationEditor.toggle");
});

test("projection entry keeps ResizeObserver reflow with window resize fallback", () => {
  const src = read("frontend/src/entries/projection-main.js");

  expect(src).toContain("typeof ResizeObserver !== \"undefined\"");
  expect(src).toContain("new ResizeObserver(() => onResize(\"observer\"))");
  expect(src).toContain("window.addEventListener(\"resize\", handleWindowResize)");
  expect(src).toContain("window.removeEventListener(\"resize\", handleWindowResize)");
  expect(src).toContain("map.resize();");
  expect(src).toContain("window.requestAnimationFrame(() => {");
});

test("MapLibre projection highlight: updateHighlightFromViewport creates .highlight-box without border or cssText", async () => {
  const { updateHighlightFromViewport } = await loadProjectionHighlightModule();

  const itm = { west: 0, south: 0, east: 1000, north: 800 };
  const modelBounds = { itm };
  const container = createProjectionDomElement({ w: 1000, h: 800 });
  const highlightEl = createProjectionDomElement({ w: 0, h: 0 });
  container.appendChild(highlightEl);

  const viewport = { bbox: [100, 150, 600, 550] };
  updateHighlightFromViewport(viewport, modelBounds, highlightEl);

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
  updateHighlightFromViewport(viewport, modelBounds, highlightEl);

  const box = highlightEl.querySelector(".highlight-box");
  expect(box).toBeTruthy();
  expect(box.style.clipPath).toContain("polygon(");
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
  updateHighlightFromViewport(viewport, modelBounds, highlightEl);

  const box = highlightEl.querySelector(".highlight-box");
  expect(box).toBeTruthy();
  expect(box.style.clipPath).toBe("");
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
  updateHighlightFromViewport(viewport, modelBounds, highlightEl);

  const box = highlightEl.querySelector(".highlight-box");
  expect(box).toBeTruthy();
  expect(box.style.clipPath).toBe("");
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
  updateHighlightFromViewport(viewport, modelBounds, highlightEl);

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
  updateHighlightFromViewport(viewport, modelBounds, highlightEl);

  expect(highlightEl.style.display).toBe("none");
});

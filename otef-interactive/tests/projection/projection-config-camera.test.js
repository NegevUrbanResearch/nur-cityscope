import { describe, expect, test, vi } from "vitest";
import { DEFAULT_PROJECTION_CONFIG as DEFAULTS } from "../../frontend/src/shared/projection-config-schema.js";
import {
  applyProjectionSpanView,
  clearProjectionSpanBase,
} from "../../frontend/src/projection/projection-span-view.js";

function node(id, width = 1600, height = 900) {
  return {
    id,
    style: {},
    children: [],
    parentElement: null,
    clientWidth: width,
    clientHeight: height,
    get firstChild() {
      return this.children[0] ?? null;
    },
    appendChild(child) {
      if (child.parentElement) child.parentElement.removeChild(child);
      child.parentElement = this;
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      child.parentElement = null;
      return child;
    },
    querySelector(selector) {
      const wanted = selector.slice(1);
      if (this.id === wanted) return this;
      for (const child of this.children) {
        const found = child.querySelector(selector);
        if (found) return found;
      }
      return null;
    },
  };
}

function fixture() {
  const display = node("displayContainer");
  const image = node("displayedImage");
  const mapContainer = node("projectionMap");
  display.appendChild(image);
  display.appendChild(mapContainer);
  let camera = {
    center: { lng: 34.5, lat: 31.5 },
    zoom: 10,
    bearing: 7,
    pitch: 0,
    padding: { top: 1, right: 2, bottom: 3, left: 4 },
  };
  const jumpTo = vi.fn((next) => {
    if (next.center) camera.center = { ...next.center };
    for (const key of ["zoom", "bearing", "pitch", "padding"]) {
      if (next[key] !== undefined) camera[key] = typeof next[key] === "object" ? { ...next[key] } : next[key];
    }
  });
  const cameraScale = () => 1000 * 2 ** (camera.zoom - 10);
  const map = {
    jumpTo,
    unproject: vi.fn(([x, y]) => {
      const scale = cameraScale();
      const angle = (camera.bearing * Math.PI) / 180;
      const dx = (x - mapContainer.clientWidth / 2) / scale;
      const dy = (y - mapContainer.clientHeight / 2) / scale;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      return { lng: camera.center.lng + cos * dx + sin * dy, lat: camera.center.lat - sin * dx + cos * dy };
    }),
    project: vi.fn(([lng, lat]) => {
      const scale = cameraScale();
      const angle = (camera.bearing * Math.PI) / 180;
      const dx = (lng - camera.center.lng) * scale;
      const dy = (camera.center.lat - lat) * scale;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      return { x: mapContainer.clientWidth / 2 + cos * dx - sin * dy, y: mapContainer.clientHeight / 2 + sin * dx + cos * dy };
    }),
    getCenter: () => ({ ...camera.center }),
    getZoom: () => camera.zoom,
    getBearing: () => camera.bearing,
    getPitch: () => camera.pitch,
    getPadding: () => ({ ...camera.padding }),
    getContainer: () => mapContainer,
    getCanvas: () => ({ style: {} }),
    camera: () => ({ ...camera, center: { ...camera.center }, padding: { ...camera.padding } }),
  };
  globalThis.document = { createElement: () => node("") };
  return { display, image, mapContainer, map, jumpTo, camera: () => map.camera() };
}

function configWith(change) {
  return {
    ...DEFAULTS,
    pre: { ...DEFAULTS.pre, ...(change.pre || {}) },
    outputs: {
      left: { crop: { ...DEFAULTS.outputs.left.crop, ...(change.left?.crop || {}) }, post: { ...DEFAULTS.outputs.left.post, ...(change.left?.post || {}) } },
      right: { crop: { ...DEFAULTS.outputs.right.crop, ...(change.right?.crop || {}) }, post: { ...DEFAULTS.outputs.right.post, ...(change.right?.post || {}) } },
    },
  };
}

describe("projection config camera integration", () => {
  test("captures and restores the complete uncalibrated camera for full output", () => {
    const { display, image, map } = fixture();
    const original = map.camera();
    applyProjectionSpanView({ map, imageEl: image, containerEl: display, spanId: "left", config: DEFAULTS, revision: 1 });
    expect(map.camera()).not.toEqual(original);
    applyProjectionSpanView({ map, imageEl: image, containerEl: display, spanId: null, config: DEFAULTS, revision: 2 });
    expect(map.camera()).toEqual(original);
  });

  test("100 identical applications remain stable and preserve all base fields", () => {
    const { display, image, map } = fixture();
    applyProjectionSpanView({ map, imageEl: image, containerEl: display, spanId: "left", config: DEFAULTS, revision: 3 });
    const once = map.camera();
    for (let i = 1; i < 100; i++) applyProjectionSpanView({ map, imageEl: image, containerEl: display, spanId: "left", config: DEFAULTS, revision: 3 });
    expect(map.camera().center.lng).toBeCloseTo(once.center.lng, 12);
    expect(map.camera().center.lat).toBeCloseTo(once.center.lat, 12);
    expect(map.camera().zoom).toBeCloseTo(once.zoom, 12);
    expect(map.camera().bearing).toBeCloseTo(once.bearing, 12);
    expect(map.camera().pitch).toBe(0);
    expect(map.camera().padding).toEqual({ top: 1, right: 2, bottom: 3, left: 4 });
  });

  test("A to B to A evaluates every config from the same base camera", () => {
    const { display, image, map } = fixture();
    const a = configWith({ pre: { tx: 0.01 } });
    const b = configWith({ pre: { tx: 0.13, ty: -0.11, scale: 1.7, rotateDeg: 16 }, left: { post: { scale: 0.7, tx: 0.2, ty: -0.2 } } });
    applyProjectionSpanView({ map, imageEl: image, containerEl: display, spanId: "left", config: a, revision: 4 });
    const aCamera = map.camera();
    applyProjectionSpanView({ map, imageEl: image, containerEl: display, spanId: "left", config: b, revision: 5 });
    expect(map.camera()).not.toEqual(aCamera);
    applyProjectionSpanView({ map, imageEl: image, containerEl: display, spanId: "left", config: a, revision: 6 });
    expect(map.camera().center.lng).toBeCloseTo(aCamera.center.lng, 12);
    expect(map.camera().center.lat).toBeCloseTo(aCamera.center.lat, 12);
    expect(map.camera().zoom).toBeCloseTo(aCamera.zoom, 12);
    expect(map.camera().bearing).toBeCloseTo(aCamera.bearing, 12);
  });

  test("bounds replacement invalidates the complete base snapshot", () => {
    const { display, image, map } = fixture();
    applyProjectionSpanView({ map, imageEl: image, containerEl: display, spanId: "left", config: DEFAULTS, revision: 7 });
    map.jumpTo({ center: { lng: 35, lat: 32 }, zoom: 12, bearing: 25, pitch: 0, padding: 0, animate: false });
    clearProjectionSpanBase(map);
    applyProjectionSpanView({ map, imageEl: image, containerEl: display, spanId: "left", config: DEFAULTS, revision: 8 });
    expect(map.camera().center).not.toEqual({ lng: 34.5, lat: 31.5 });
  });

  test("resize recaptures CSS dimensions after the old base is cleared", () => {
    const { display, image, map, mapContainer } = fixture();
    applyProjectionSpanView({ map, imageEl: image, containerEl: display, spanId: "left", config: DEFAULTS, revision: 12 });
    mapContainer.clientWidth = 1200;
    mapContainer.clientHeight = 700;
    clearProjectionSpanBase(map);
    applyProjectionSpanView({ map, imageEl: image, containerEl: display, spanId: "left", config: DEFAULTS, revision: 13 });
    expect(map._otefSpanBase).toEqual(expect.objectContaining({ width: 1200, height: 700 }));
  });

  test("calibrated camera keeps model handles on the geographic image corners", () => {
    const { display, image, map } = fixture();
    image.__otefProjectionImage = {
      bounds: [[34, 31], [35, 32]],
      width: 1000,
      height: 500,
    };
    applyProjectionSpanView({ map, imageEl: image, containerEl: display, spanId: "right", config: DEFAULTS, revision: 14 });
    expect(map.project).toHaveBeenCalledTimes(4);
    expect(map.project.mock.calls.map(([point]) => point)).toEqual([
      [34, 32],
      [35, 32],
      [35, 31],
      [34, 31],
    ]);
  });
});

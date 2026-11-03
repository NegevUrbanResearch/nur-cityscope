import { describe, expect, test, vi } from "vitest";
import { DEFAULT_PROJECTION_CONFIG as DEFAULTS } from "../../frontend/src/shared/projection-config-schema.js";
import { visibleT3Rect } from "../../frontend/src/shared/projection-config-geometry.js";
import {
  applyProjectionSpanView,
  fitImageHomography,
  getProjectionSpanRect,
} from "../../frontend/src/projection/projection-span-view.js";

function element(id, width = 1600, height = 900) {
  return {
    id,
    style: {},
    clientWidth: width,
    clientHeight: height,
    children: [],
    parentElement: null,
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
    },
    removeChild(child) {
      this.children = this.children.filter((item) => item !== child);
      child.parentElement = null;
    },
    querySelector(selector) {
      return this.children.find((item) => item.id === selector.slice(1)) || null;
    },
  };
}

function makeFixture() {
  const containerEl = element("displayContainer");
  const imageEl = element("displayedImage");
  const mapEl = element("projectionMap");
  containerEl.appendChild(imageEl);
  containerEl.appendChild(mapEl);
  let camera = { center: { lng: 34, lat: 31 }, zoom: 10, bearing: 0, pitch: 0, padding: 0 };
  const map = {
    getContainer: () => mapEl,
    getCanvas: () => ({ style: {} }),
    getCenter: () => ({ ...camera.center }),
    getZoom: () => camera.zoom,
    getBearing: () => camera.bearing,
    getPitch: () => camera.pitch,
    getPadding: () => camera.padding,
    jumpTo(next) {
      camera = { ...camera, ...next, center: next.center ? { ...next.center } : camera.center };
    },
    unproject([x, y]) {
      return { lng: camera.center.lng + (x - 800) / 1000, lat: camera.center.lat - (y - 450) / 1000 };
    },
    project: vi.fn(([lng, lat]) => {
      return { x: 800 + (lng - camera.center.lng) * 1000, y: 450 - (lat - camera.center.lat) * 1000 };
    }),
  };
  imageEl.__otefProjectionImage = {
    bounds: { west: 33.5, south: 30.5, east: 34.5, north: 31.5 },
    width: 1000,
    height: 500,
  };
  globalThis.document = { createElement: () => element("") };
  return { containerEl, imageEl, mapEl, map };
}

describe("projection config clipping and image alignment", () => {
  test("span rect returns all crop coordinates from the effective config", () => {
    const config = { ...DEFAULTS, outputs: { ...DEFAULTS.outputs, left: { ...DEFAULTS.outputs.left, crop: { x0: 0.2, x1: 0.8, y0: 0.15, y1: 0.85 } } } };
    expect(getProjectionSpanRect("left", config)).toEqual({ x0: 0.2, x1: 0.8, y0: 0.15, y1: 0.85 });
  });

  test("clips map and image to the visible crop intersection and projects image corners geographically", () => {
    const { containerEl, imageEl, mapEl, map } = makeFixture();
    const config = {
      ...DEFAULTS,
      outputs: {
        ...DEFAULTS.outputs,
        left: { crop: { x0: 0.2, x1: 0.8, y0: 0.2, y1: 0.8 }, post: { scale: 0.5, tx: 0.7, ty: -0.6 } },
      },
    };
    applyProjectionSpanView({ map, imageEl, containerEl, spanId: "left", config, revision: 10 });
    const visible = visibleT3Rect(config.outputs.left);
    expect(visible).toEqual(expect.objectContaining({ x0: expect.any(Number), x1: expect.any(Number) }));
    expect(mapEl.style.clipPath).toMatch(/^inset\(/);
    expect(imageEl.style.clipPath).toBe(mapEl.style.clipPath);
    expect(imageEl.style.transform).toMatch(/^matrix3d\(/);
    expect(imageEl.style.transformOrigin).toBe("0 0");
  });

  test("empty crop intersection hides both source surfaces", () => {
    const { containerEl, imageEl, mapEl, map } = makeFixture();
    const config = {
      ...DEFAULTS,
      outputs: {
        ...DEFAULTS.outputs,
        left: { crop: { x0: 0.2, x1: 0.8, y0: 0.2, y1: 0.8 }, post: { scale: 1, tx: 4, ty: 4 } },
      },
    };
    applyProjectionSpanView({ map, imageEl, containerEl, spanId: "left", config, revision: 11 });
    expect(mapEl.style.clipPath).toBe("inset(100% 100% 100% 100%)");
    expect(imageEl.style.clipPath).toBe("inset(100% 100% 100% 100%)");
  });

  test("fits a non-parallelogram four-corner raster to all geographic projections", () => {
    const corners = [
      { x: 12, y: 20 },
      { x: 108, y: 18 },
      { x: 130, y: 96 },
      { x: 4, y: 101 },
    ];
    const matrix = fitImageHomography(corners, 1000, 500);
    expect(matrix).toHaveLength(16);
    const transform = (x, y) => {
      const denominator = matrix[3] * x + matrix[7] * y + matrix[15];
      return {
        x: (matrix[0] * x + matrix[4] * y + matrix[12]) / denominator,
        y: (matrix[1] * x + matrix[5] * y + matrix[13]) / denominator,
      };
    };
    [[0, 0], [1000, 0], [1000, 500], [0, 500]].forEach(([x, y], index) => {
      expect(transform(x, y).x).toBeCloseTo(corners[index].x, 8);
      expect(transform(x, y).y).toBeCloseTo(corners[index].y, 8);
    });
  });

  test("uses explicit ITM-derived geographic corner metadata instead of inferred WGS84 bounds", () => {
    const { containerEl, imageEl, map } = makeFixture();
    const corners = [[34.1, 31.6], [34.9, 31.58], [35.02, 30.9], [34.0, 30.95]];
    imageEl.__otefProjectionImage.corners = corners;
    delete imageEl.__otefProjectionImage.bounds;
    applyProjectionSpanView({ map, imageEl, containerEl, spanId: "right", config: DEFAULTS, revision: 12 });
    expect(map.project.mock.calls.map(([point]) => point)).toEqual(corners);
    expect(imageEl.style.transform).toMatch(/^matrix3d\(/);
  });
});

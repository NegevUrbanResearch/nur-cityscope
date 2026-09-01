import { describe, expect, test, vi } from "vitest";
import { MapProjectionConfig } from "../../frontend/src/shared/map-projection-config.js";
import {
  applyProjectionSpanView,
  clearProjectionSpanView,
  computeSpanJumpTo,
  computeTesugaPostFillJumpTo,
  computeTesugaPreT3JumpTo,
  getProjectionSpanRect,
  parseProjectionSpanId,
  runWhenMapIdle,
  spanHorizontalScale,
  spanVisibleCenterInT3,
  spanWidthZoomDelta,
} from "../../frontend/src/projection/projection-span-view.js";

function createDomNode(tag = "div", id = "") {
  const node = {
    id,
    tagName: String(tag).toUpperCase(),
    style: {},
    parentElement: null,
    children: [],
    get firstChild() {
      return this.children[0] ?? null;
    },
    appendChild(child) {
      if (child.parentElement) {
        child.parentElement.removeChild(child);
      }
      child.parentElement = this;
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) this.children.splice(i, 1);
      child.parentElement = null;
      return child;
    },
    querySelector(sel) {
      if (!sel?.startsWith("#")) return null;
      const want = sel.slice(1);
      const walk = (n) => {
        if (n.id === want) return n;
        for (const c of n.children) {
          const found = walk(c);
          if (found) return found;
        }
        return null;
      };
      return walk(this);
    },
  };
  return node;
}

function installFakeDocument() {
  globalThis.document = {
    createElement(tag) {
      return createDomNode(tag);
    },
  };
}

function makeSpanFixture() {
  installFakeDocument();
  const containerEl = createDomNode("div", "displayContainer");
  const imageEl = createDomNode("img", "displayedImage");
  const mapContainerEl = createDomNode("div", "projectionMap");
  const canvasEl = createDomNode("canvas");
  containerEl.appendChild(imageEl);
  containerEl.appendChild(mapContainerEl);
  let zoom = 10;
  let bearing = 0;
  const jumpTo = vi.fn((opts) => {
    if (typeof opts?.zoom === "number") zoom = opts.zoom;
    if (typeof opts?.bearing === "number") bearing = opts.bearing;
  });
  const fitBounds = vi.fn();
  const map = {
    getZoom: () => zoom,
    getBearing: () => bearing,
    unproject: (p) => ({ lng: p[0], lat: p[1] }),
    jumpTo,
    fitBounds,
    getCanvas: () => canvasEl,
    getContainer: () => mapContainerEl,
  };
  return { containerEl, imageEl, mapContainerEl, canvasEl, map, jumpTo, fitBounds };
}

test("PROJECTION_SPAN matches TouchDesigner crop fractions and transform3", () => {
  const s = MapProjectionConfig.PROJECTION_SPAN;
  expect(s.LEFT_X0).toBe(0);
  expect(s.LEFT_X1).toBe(0.6);
  expect(s.RIGHT_X0).toBe(0.4);
  expect(s.RIGHT_X1).toBe(1);
  expect(s.PRE_SCALE).toBe(1.41);
  expect(s.PRE_ROTATE_DEG).toBe(-50);
  expect(s.PRE_TX).toBe(0.01);
  expect(s.PRE_TY).toBe(0);
  expect(s.POST_SCALE).toBe(2);
  expect(s.POST_TY).toBe(-0.049);
});

test("2× fill overlap is 10% of transform3 so seam names are not double-painted", () => {
  const s = MapProjectionConfig.PROJECTION_SPAN;
  const half = 1 / (2 * s.POST_SCALE);
  const left = spanVisibleCenterInT3({ x0: 0, x1: 0.6 });
  const right = spanVisibleCenterInT3({ x0: 0.4, x1: 1 });
  const leftX1 = left.x + half;
  const rightX0 = right.x - half;
  expect(s.POST_SCALE).toBe(2);
  expect(leftX1).toBeCloseTo(0.55, 5);
  expect(rightX0).toBeCloseTo(0.45, 5);
  expect(leftX1 - rightX0).toBeCloseTo(0.1, 5);
  expect(leftX1 - rightX0).toBeLessThan(0.15);
});

test("runWhenMapIdle applies immediately when the map is already idle", () => {
  const fn = vi.fn();
  const once = vi.fn();
  runWhenMapIdle({ isMoving: () => false, once }, fn);
  expect(fn).toHaveBeenCalledTimes(1);
  expect(once).not.toHaveBeenCalled();
});

test("runWhenMapIdle waits for idle only while the camera is moving", () => {
  const fn = vi.fn();
  const once = vi.fn();
  runWhenMapIdle({ isMoving: () => true, once }, fn);
  expect(fn).not.toHaveBeenCalled();
  expect(once).toHaveBeenCalledWith("idle", fn);
});

describe("parseProjectionSpanId", () => {
  test("reads span=left and span=right", () => {
    expect(parseProjectionSpanId("?span=left")).toBe("left");
    expect(parseProjectionSpanId("?prd=1&span=right")).toBe("right");
  });

  test("returns null when missing or invalid", () => {
    expect(parseProjectionSpanId("")).toBe(null);
    expect(parseProjectionSpanId("?prd=1")).toBe(null);
    expect(parseProjectionSpanId("?span=full")).toBe(null);
    expect(parseProjectionSpanId("?span=")).toBe(null);
  });
});

test("getProjectionSpanRect maps ids to crop windows", () => {
  expect(getProjectionSpanRect("left")).toEqual({ x0: 0, x1: 0.6 });
  expect(getProjectionSpanRect("right")).toEqual({ x0: 0.4, x1: 1 });
  expect(getProjectionSpanRect(null)).toBe(null);
});

test("spanHorizontalScale is inverse width fraction", () => {
  expect(spanHorizontalScale(0, 0.6)).toBeCloseTo(1 / 0.6, 10);
  expect(spanHorizontalScale(0.4, 1)).toBeCloseTo(1 / 0.6, 10);
});

test("span fill camera zooms to the 60% Tesuga crop so 1920 samples are native", () => {
  const visLeft = spanVisibleCenterInT3({ x0: 0, x1: 0.6 });
  const visRight = spanVisibleCenterInT3({ x0: 0.4, x1: 1 });
  expect(visLeft.x).toBeCloseTo(0.3, 5);
  expect(visRight.x).toBeCloseTo(0.7, 5);
  expect(visLeft.y).toBeCloseTo(0.5 - -0.049 / 2, 5);
  const jump = computeTesugaPostFillJumpTo({
    zoom: 10 + Math.log2(1.41),
    bearing: -50,
    width: 1920,
    height: 1080,
    unproject: (p) => ({ lng: p[0], lat: p[1] }),
    x0: 0,
    x1: 0.6,
  });
  expect(jump.zoom).toBeCloseTo(10 + Math.log2(1.41 * 2), 10);
  expect(jump.bearing).toBe(-50);
  expect(jump.center.lng).toBeCloseTo(0.3 * 1920, 5);
});

test("spanWidthZoomDelta is log2 of inverse width fraction and is not a camera zoom", () => {
  expect(spanWidthZoomDelta(0, 0.6)).toBeCloseTo(Math.log2(1 / 0.6), 10);
  expect(spanWidthZoomDelta(0.4, 1)).toBeCloseTo(Math.log2(1 / 0.6), 10);
});

test("span transform3 rotate is -50 from fitBounds north-up, not stacked on viewer_angle", () => {
  const unproject = (p) => ({ lng: p[0], lat: p[1] });
  const fromNorthUp = computeTesugaPreT3JumpTo({
    zoom: 10,
    bearing: 0,
    width: 1920,
    height: 1080,
    unproject,
  });
  const fromViewerAngle = computeTesugaPreT3JumpTo({
    zoom: 10,
    bearing: -59.007,
    width: 1920,
    height: 1080,
    unproject,
  });
  expect(fromNorthUp.bearing).toBe(-50);
  expect(fromViewerAngle.bearing).toBeCloseTo(-109.007, 5);
});

test("computeTesugaPreT3JumpTo adds transform3 scale and rotate to the fitBounds camera", () => {
  const unproject = (p) => ({ lng: p[0], lat: p[1] });
  const jump = computeTesugaPreT3JumpTo({
    zoom: 10,
    bearing: 0,
    width: 1920,
    height: 1080,
    unproject,
  });
  expect(jump.animate).toBe(false);
  expect(jump.bearing).toBe(-50);
  expect(jump.zoom).toBeCloseTo(10 + Math.log2(1.41), 10);
  expect(jump.center).toEqual({ lng: (0.5 - 0.01) * 1920, lat: 0.5 * 1080 });
});

test("computeSpanJumpTo pans to crop center and keeps the same zoom", () => {
  const unproject = (p) => ({ lng: p[0], lat: p[1] });
  const jump = computeSpanJumpTo({
    zoom: 12,
    bearing: 17,
    width: 1920,
    height: 1080,
    unproject,
    x0: 0,
    x1: 0.6,
  });
  expect(jump.animate).toBe(false);
  expect(jump.bearing).toBe(17);
  expect(jump.zoom).toBe(12);
  expect(jump.zoom).not.toBeCloseTo(12 + spanWidthZoomDelta(0, 0.6), 10);
  expect(jump.center).toEqual({ lng: 0.3 * 1920, lat: 0.5 * 1080 });
});

test("applyProjectionSpanView jumpTos T3 then transform1 fill and does not wrap the map", () => {
  const { containerEl, imageEl, mapContainerEl, canvasEl, map, jumpTo, fitBounds } =
    makeSpanFixture();
  applyProjectionSpanView({ map, imageEl, containerEl, spanId: "left" });
  expect(fitBounds).not.toHaveBeenCalled();
  expect(jumpTo).toHaveBeenCalledTimes(2);
  expect(jumpTo.mock.calls[0][0]).toEqual(
    expect.objectContaining({
      zoom: 10 + Math.log2(1.41),
      bearing: -50,
      animate: false,
    }),
  );
  expect(jumpTo.mock.calls[1][0]).toEqual(
    expect.objectContaining({
      zoom: 10 + Math.log2(1.41 * 2),
      bearing: -50,
      animate: false,
    }),
  );
  expect(containerEl.style.overflow).toBe("hidden");
  expect(containerEl.querySelector("#projectionSpanFitBest")).toBe(null);
  expect(containerEl.querySelector("#projectionSpanCropFit")).toBe(null);
  expect(containerEl.querySelector("#projectionSpanPreT3")).toBe(null);
  expect(containerEl.children).toEqual([imageEl, mapContainerEl]);
  expect(mapContainerEl.style.transform || "").toBe("");
  expect(canvasEl.style.transform).toBeUndefined();
  expect(imageEl.style.transform).toContain("rotate(-50deg)");
  expect(imageEl.style.transform).toContain(`scale(${1.41 * 2})`);
  const visLeft = spanVisibleCenterInT3({ x0: 0, x1: 0.6 });
  expect(imageEl.style.transformOrigin).toBe(`${visLeft.x * 100}% ${visLeft.y * 100}%`);
});

test("applyProjectionSpanView pans the fill camera to the right-eye T3 window", () => {
  const { containerEl, imageEl, mapContainerEl, map, jumpTo } = makeSpanFixture();
  applyProjectionSpanView({ map, imageEl, containerEl, spanId: "right" });
  expect(jumpTo).toHaveBeenCalledTimes(2);
  const fill = jumpTo.mock.calls[1][0];
  const visRight = spanVisibleCenterInT3({ x0: 0.4, x1: 1 });
  expect(fill.center.lng).toBeCloseTo(visRight.x * 1920, 5);
  expect(fill.center.lat).toBeCloseTo(visRight.y * 1080, 5);
  expect(containerEl.children).toEqual([imageEl, mapContainerEl]);
});

test("applyProjectionSpanView is idempotent and does not insert wrappers", () => {
  const { containerEl, imageEl, map, mapContainerEl } = makeSpanFixture();
  applyProjectionSpanView({ map, imageEl, containerEl, spanId: "left" });
  applyProjectionSpanView({ map, imageEl, containerEl, spanId: "right" });
  expect(containerEl.children).toEqual([imageEl, mapContainerEl]);
  expect(containerEl.querySelector("#projectionSpanFitBest")).toBe(null);
});

test("applyProjectionSpanView left then left does not stack bearing or fill zoom", () => {
  const { containerEl, imageEl, map } = makeSpanFixture();
  expect(map.getZoom()).toBe(10);
  expect(map.getBearing()).toBe(0);
  applyProjectionSpanView({ map, imageEl, containerEl, spanId: "left" });
  applyProjectionSpanView({ map, imageEl, containerEl, spanId: "left" });
  expect(map.getBearing()).toBe(-50);
  expect(map.getZoom()).toBeCloseTo(10 + Math.log2(1.41 * 2), 10);
});

test("applyProjectionSpanView unwraps leftover Tesuga wrappers", () => {
  const { containerEl, imageEl, mapContainerEl, map } = makeSpanFixture();
  const fitBest = createDomNode("div", "projectionSpanFitBest");
  const cropFit = createDomNode("div", "projectionSpanCropFit");
  const preT3 = createDomNode("div", "projectionSpanPreT3");
  containerEl.removeChild(imageEl);
  containerEl.removeChild(mapContainerEl);
  preT3.appendChild(imageEl);
  preT3.appendChild(mapContainerEl);
  cropFit.appendChild(preT3);
  fitBest.appendChild(cropFit);
  containerEl.appendChild(fitBest);
  applyProjectionSpanView({ map, imageEl, containerEl, spanId: "left" });
  expect(containerEl.querySelector("#projectionSpanFitBest")).toBe(null);
  expect(containerEl.querySelector("#projectionSpanCropFit")).toBe(null);
  expect(containerEl.querySelector("#projectionSpanPreT3")).toBe(null);
  expect(containerEl.children).toEqual([imageEl, mapContainerEl]);
  expect(imageEl.parentElement).toBe(containerEl);
  expect(mapContainerEl.parentElement).toBe(containerEl);
});

test("applyProjectionSpanView no-ops for null span and leaves the full page untransformed", () => {
  const { containerEl, imageEl, mapContainerEl, map, jumpTo } = makeSpanFixture();
  applyProjectionSpanView({ map, imageEl, containerEl, spanId: null });
  expect(jumpTo).not.toHaveBeenCalled();
  expect(containerEl.querySelector("#projectionSpanCropFit")).toBe(null);
  expect(containerEl.querySelector("#projectionSpanPreT3")).toBe(null);
  expect(containerEl.children).toEqual([imageEl, mapContainerEl]);
  expect(imageEl.parentElement).toBe(containerEl);
  expect(mapContainerEl.parentElement).toBe(containerEl);
  expect(imageEl.style.transform || "").toBe("");
  expect(mapContainerEl.style.transform || "").toBe("");
  expect(containerEl.style.overflow || "").toBe("");
});

test("applyProjectionSpanView unwraps Tesuga layers when span becomes null", () => {
  const { containerEl, imageEl, mapContainerEl, map } = makeSpanFixture();
  applyProjectionSpanView({ map, imageEl, containerEl, spanId: "left" });
  applyProjectionSpanView({ map, imageEl, containerEl, spanId: null });
  expect(containerEl.querySelector("#projectionSpanCropFit")).toBe(null);
  expect(containerEl.querySelector("#projectionSpanPreT3")).toBe(null);
  expect(containerEl.children).toEqual([imageEl, mapContainerEl]);
  expect(imageEl.parentElement).toBe(containerEl);
  expect(mapContainerEl.parentElement).toBe(containerEl);
  expect(containerEl.style.overflow || "").toBe("");
});

test("clearProjectionSpanView unwraps layers and does not jumpTo", () => {
  const { containerEl, imageEl, mapContainerEl, map, jumpTo, fitBounds } = makeSpanFixture();
  applyProjectionSpanView({ map, imageEl, containerEl, spanId: "right" });
  jumpTo.mockClear();
  clearProjectionSpanView({ map, imageEl, containerEl });
  expect(jumpTo).not.toHaveBeenCalled();
  expect(fitBounds).not.toHaveBeenCalled();
  expect(containerEl.querySelector("#projectionSpanCropFit")).toBe(null);
  expect(containerEl.querySelector("#projectionSpanPreT3")).toBe(null);
  expect(containerEl.children).toEqual([imageEl, mapContainerEl]);
  expect(imageEl.style.transform || "").toBe("");
  expect(mapContainerEl.style.transform || "").toBe("");
  expect(containerEl.style.overflow || "").toBe("");
});

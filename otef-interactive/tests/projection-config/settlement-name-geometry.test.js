import { expect, test } from "vitest";
import { mapOverlayOutline } from "../../frontend/src/projection-config/clock-layout-geometry.js";
import {
  beginSettlementPointerGesture,
  hitTestSettlementLabels,
  referencePointFromAnchor,
  settlementOutline,
  settlementPointerToReference,
} from "../../frontend/src/projection-config/settlement-name-geometry.js";

const mesh = {
  width: 1920,
  height: 1080,
  vertices: [
    { u: 0, v: 0, x: 0.1, y: 0.1 },
    { u: 1, v: 0, x: 0.9, y: 0.1 },
    { u: 1, v: 1, x: 0.9, y: 0.9 },
    { u: 0, v: 1, x: 0.1, y: 0.9 },
  ],
  triangles: [0, 1, 2, 0, 2, 3],
};

test("maps an output point through a nonidentity mesh into reference pixels", () => {
  const point = settlementPointerToReference(mesh, { x: 0.7, y: 0.3 });
  expect(point.x).toBeCloseTo(0.75 * 1920, 4);
  expect(point.y).toBeCloseTo(0.25 * 1080, 4);
});

test("returns null when the output point is not a unique mesh mapping", () => {
  const overlapping = {
    width: 1920,
    height: 1080,
    vertices: [
      { u: 0, v: 0, x: 0.1, y: 0.1 },
      { u: 1, v: 0, x: 0.9, y: 0.1 },
      { u: 0, v: 1, x: 0.1, y: 0.9 },
      { u: 0.2, v: 0.2, x: 0.1, y: 0.1 },
      { u: 0.8, v: 0.2, x: 0.9, y: 0.1 },
      { u: 0.2, v: 0.8, x: 0.1, y: 0.9 },
    ],
    triangles: [0, 1, 2, 3, 4, 5],
  };
  expect(settlementPointerToReference(overlapping, { x: 0.5, y: 0.3 })).toBeNull();
});

test("converts a measured ink box into the split overlay outline", () => {
  const label = {
    x: 960,
    y: 540,
    rotateDeg: 0,
    inkBox: { left: 384, top: 324, right: 1536, bottom: 648 },
  };
  const outline = settlementOutline(mesh, label);
  const direct = mapOverlayOutline(mesh, {
    leftPct: 20,
    topPct: 30,
    widthPct: 60,
    heightPct: 30,
    rotateDeg: 0,
  });
  expect(outline).toEqual(direct);
  expect(outline.length).toBeGreaterThan(4);
});

test("keeps the current selection when measured labels overlap", () => {
  const labels = [
    { citycode: "0067", x: 100, y: 100, rotateDeg: 0, inkBox: { left: 80, top: 90, right: 140, bottom: 120 } },
    { citycode: "0424", x: 110, y: 100, rotateDeg: 0, inkBox: { left: 90, top: 90, right: 150, bottom: 120 } },
  ];
  expect(hitTestSettlementLabels(labels, { x: 100, y: 100 }, "0424")).toBe("0424");
  expect(hitTestSettlementLabels(labels, { x: 100, y: 100 }, null)).toBe("0067");
  expect(hitTestSettlementLabels(labels, { x: 10, y: 10 }, "0067")).toBeNull();
});

test("freezes the mesh, fit, and start position at pointer down", () => {
  const fit = { scale: 1, output: "left" };
  const position = { x: 10, y: 20 };
  const gesture = beginSettlementPointerGesture({ mesh, fit, position });
  mesh.vertices[0].x = 0.4;
  fit.scale = 2;
  position.x = 99;
  expect(gesture.mesh.vertices[0].x).toBe(0.1);
  expect(gesture.fit.scale).toBe(1);
  expect(gesture.start).toEqual({ x: 10, y: 20 });
  expect(Object.isFrozen(gesture.mesh.vertices[0])).toBe(true);
  expect(Object.isFrozen(gesture)).toBe(true);
});

test("projects a rotated em offset through css ratio and the descriptor", () => {
  const point = referencePointFromAnchor({
    anchor: { x: 100, y: 200 },
    offsetEm: [1, 0],
    fontPx: 14,
    rotateDeg: 90,
    bearingDeg: 0,
    cssSize: { width: 960, height: 540 },
    canvasSize: { width: 1920, height: 1080 },
    descriptor: { matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], clip: [0, 0, 1, 1] },
  });
  expect(point.x).toBeCloseTo(200, 5);
  expect(point.y).toBeCloseTo(428, 5);
});

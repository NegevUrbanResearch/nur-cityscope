import { describe, expect, test } from "vitest";
import {
  copyProjectionMesh,
  mapOutputToSourceUv,
  mapOverlayOutline,
  mapSourceUvToOutput,
  moveLayout,
  resizeClockLayout,
  resizeLegendLayout,
} from "../../frontend/src/projection-config/clock-layout-geometry.js";

const mesh = { width: 1920, height: 1080, vertices: [
  { u: 0, v: 0, x: 0.1, y: 0.1 }, { u: 1, v: 0, x: 0.9, y: 0.1 },
  { u: 1, v: 1, x: 0.9, y: 0.9 }, { u: 0, v: 1, x: 0.1, y: 0.9 },
], triangles: [0, 1, 2, 0, 2, 3] };

describe("clock layout mesh geometry", () => {
  test("maps source UV and output XY through nonidentity triangles", () => {
    const output = mapSourceUvToOutput(mesh, { u: 0.75, v: 0.25 });
    expect(output.x).toBeCloseTo(0.7, 7);
    expect(output.y).toBeCloseTo(0.3, 7);
    const source = mapOutputToSourceUv(mesh, { x: 0.7, y: 0.3 });
    expect(source.u).toBeCloseTo(0.75, 7);
    expect(source.v).toBeCloseTo(0.25, 7);
    const secondTriangle = mapSourceUvToOutput(mesh, { u: 0.25, v: 0.75 });
    expect(secondTriangle.x).toBeCloseTo(0.3, 7);
    expect(secondTriangle.y).toBeCloseTo(0.7, 7);
    const inverseSecond = mapOutputToSourceUv(mesh, { x: 0.3, y: 0.7 });
    expect(inverseSecond.u).toBeCloseTo(0.25, 7);
    expect(inverseSecond.v).toBeCloseTo(0.75, 7);
  });

  test("accepts a shared edge when both triangles resolve to the same source point", () => {
    expect(mapOutputToSourceUv(mesh, { x: 0.5, y: 0.5 })).toMatchObject({ u: 0.5, v: 0.5 });
    const output = mapSourceUvToOutput(mesh, { u: 0.25, v: 0.5 });
    expect(output.x).toBeCloseTo(0.3, 7);
    expect(output.y).toBeCloseTo(0.5, 7);
  });

  test("rejects outside, degenerate, and ambiguous destination hits", () => {
    expect(mapOutputToSourceUv(mesh, { x: 0.02, y: 0.5 })).toBeNull();
    const degenerate = { ...mesh, triangles: [0, 0, 1] };
    expect(mapOutputToSourceUv(degenerate, { x: 0.5, y: 0.5 })).toBeNull();
    const overlapping = {
      width: 1920, height: 1080,
      vertices: [
        { u: 0, v: 0, x: 0.1, y: 0.1 }, { u: 1, v: 0, x: 0.9, y: 0.1 }, { u: 0, v: 1, x: 0.1, y: 0.9 },
        { u: 0.2, v: 0.2, x: 0.1, y: 0.1 }, { u: 0.8, v: 0.2, x: 0.9, y: 0.1 }, { u: 0.2, v: 0.8, x: 0.1, y: 0.9 },
      ], triangles: [0, 1, 2, 3, 4, 5],
    };
    expect(mapOutputToSourceUv(overlapping, { x: 0.5, y: 0.3 })).toBeNull();
  });

  test("copies and freezes mesh arrays and vertices", () => {
    const copied = copyProjectionMesh(mesh);
    expect(copied).not.toBe(mesh);
    expect(copied.vertices).not.toBe(mesh.vertices);
    expect(Object.isFrozen(copied.vertices[0])).toBe(true);
    expect(Object.isFrozen(copied.triangles)).toBe(true);
    expect(() => { copied.vertices[0].x = 0.4; }).toThrow();
    expect(mesh.vertices[0].x).toBe(0.1);
  });

  test("splits each source box edge where it crosses a mesh triangle boundary", () => {
    const outline = mapOverlayOutline(mesh, { leftPct: 20, topPct: 30, widthPct: 60, heightPct: 30, rotateDeg: 0 });
    expect(outline).toHaveLength(6);
    expect(outline.every((segment) => segment.start && segment.end)).toBe(true);
  });
});

describe("projector plane gesture math", () => {
  const base = { leftPct: 30, topPct: 25, widthPct: 20, heightPct: 20, fontPx: 20, rotateDeg: 45, dwellSeconds: 8 };
  const rotatedTopLeft = (layout) => {
    const width = layout.widthPct * 1920 / 100; const height = layout.heightPct * 1080 / 100;
    const centerX = (layout.leftPct + layout.widthPct / 2) * 1920 / 100;
    const centerY = (layout.topPct + layout.heightPct / 2) * 1080 / 100;
    const angle = layout.rotateDeg * Math.PI / 180;
    return { x: centerX - width / 2 * Math.cos(angle) + height / 2 * Math.sin(angle), y: centerY - width / 2 * Math.sin(angle) - height / 2 * Math.cos(angle) };
  };

  test("moves by projector pixels while clamping the layout inside the plane", () => {
    expect(moveLayout(base, { x: 192, y: -108 })).toMatchObject({ leftPct: 40, topPct: 15 });
    expect(moveLayout({ ...base, leftPct: 90 }, { x: 1000, y: 0 }).leftPct).toBe(80);
  });

  test("resizes a rotated clock uniformly around its opposite corner", () => {
    const resized = resizeClockLayout(base, "bottom-right", { x: 100, y: 100 });
    expect(resized.widthPct / base.widthPct).toBeCloseTo(resized.heightPct / base.heightPct, 7);
    expect(resized.fontPx / base.fontPx).toBeCloseTo(resized.widthPct / base.widthPct, 7);
    const anchorBefore = rotatedTopLeft(base);
    const anchorAfter = rotatedTopLeft(resized);
    expect(anchorAfter.x).toBeCloseTo(anchorBefore.x, 5);
    expect(anchorAfter.y).toBeCloseTo(anchorBefore.y, 5);
  });

  test("resizes a rotated legend from a corner and preserves the opposite corner", () => {
    const resized = resizeLegendLayout(base, "bottom-right", { x: 80, y: 40 });
    expect(resized.widthPct).not.toBe(base.widthPct);
    expect(resized.heightPct).not.toBe(base.heightPct);
    const anchorBefore = rotatedTopLeft(base);
    const anchorAfter = rotatedTopLeft(resized);
    expect(anchorAfter.x).toBeCloseTo(anchorBefore.x, 5);
    expect(anchorAfter.y).toBeCloseTo(anchorBefore.y, 5);
  });
});

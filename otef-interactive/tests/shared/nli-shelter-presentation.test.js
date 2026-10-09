import { describe, it, expect } from "vitest";
import {
  resolveShelterPresentation,
  layoutShelterOffsets,
} from "../../frontend/src/shared/nli-shelter-presentation.js";
const mesh = {
  width: 1920,
  height: 1080,
  vertices: [
    { u: 0, v: 0, x: 0, y: 0 },
    { u: 1, v: 0, x: 1, y: 0 },
    { u: 1, v: 1, x: 1, y: 1 },
    { u: 0, v: 1, x: 0, y: 1 },
  ],
  triangles: [0, 1, 2, 0, 2, 3],
};
const inputs = {
  displayProfile: "projection",
  sourceDimensions: { width: 960, height: 540 },
  outputResolution: { width: 1920, height: 1080 },
  mesh,
};
describe("shelter display units", () => {
  it("accounts for the projection glyph rotation in bounds and MapLibre offsets", () => {
    const p = resolveShelterPresentation(inputs);
    const a = p.at({ x: 480, y: 270 });
    expect(a.rotationDeg).toBe(85);
    expect(a.bodyWidth).toBeCloseTo(12);
    expect(a.bodyHeight).toBeGreaterThan(a.bodyWidth);
    const anchors = [
      { id: "a", anchor: { x: 480, y: 270 } },
      { id: "b", anchor: { x: 483.5, y: 270 } },
    ];
    const rows = layoutShelterOffsets(anchors, p);
    const row = rows.get("b");
    expect(
      Math.abs(row.displacement.x) + Math.abs(row.displacement.y),
    ).toBeGreaterThan(0);
    const angle = (85 * Math.PI) / 180;
    const [x, y] = row.offset.map((value) => value * row.size);
    const source = {
      x: 483.5 + x * Math.cos(angle) - y * Math.sin(angle),
      y: 270 + x * Math.sin(angle) + y * Math.cos(angle),
    };
    const moved = p.forward(source),
      original = p.forward(anchors[1].anchor);
    expect(moved.x - original.x).toBeCloseTo(row.displacement.x, 7);
    expect(moved.y - original.y).toBeCloseTo(row.displacement.y, 7);
  });
  it("grows modestly on GIS zoom without changing source positions or projection size", () => {
    for (const [zoom, width] of [
      [10, 12],
      [13, 15],
      [16, 18],
      [21, 18],
    ]) {
      const profile = resolveShelterPresentation({
        displayProfile: "gis",
        zoom,
      });
      expect(profile.at({ x: 300, y: 300 }).bodyWidth).toBeCloseTo(width);
      expect(profile.forward({ x: 300, y: 300 })).toEqual({ x: 300, y: 300 });
    }
    expect(
      resolveShelterPresentation({ ...inputs, zoom: 21 }).at({ x: 480, y: 270 })
        .bodyWidth,
    ).toBeCloseTo(12);
  });
  it("GIS has a 12 CSS-pixel body with no offset by default", () => {
    const p = resolveShelterPresentation({ displayProfile: "gis" });
    const a = p.at({ x: 300, y: 300 });
    expect(a.bodyWidth).toBe(12);
    expect(a.size).toBe(0.5);
    expect(
      layoutShelterOffsets([{ id: "a", anchor: { x: 300, y: 300 } }], p).get(
        "a",
      ).offset,
    ).toEqual([0, 0]);
  });
  it("projection measures body after anisotropic mapping and output scaling", () => {
    const p = resolveShelterPresentation(inputs),
      a = p.at({ x: 480, y: 270 });
    expect(a.bodyWidth).toBeCloseTo(12, 6);
    // Hand-derived bounds of the 48px-wide, 97/116 × .86 miniature at 85 degrees.
    const angle = (85 * Math.PI) / 180;
    expect(a.size).toBeCloseTo(
      12 / (48 * Math.cos(angle) + (48 * 97 / 116 * .86) * Math.sin(angle)),
      6,
    );
    expect(p.forward({ x: 480, y: 270 })).toEqual({ x: 960, y: 540 });
    expect(p.inverse({ x: 1000, y: 580 }).x).toBeCloseTo(500, 8);
    expect(p.inverse({ x: 1000, y: 580 }).y).toBeCloseTo(290, 8);
    const bigger = resolveShelterPresentation({
      ...inputs,
      outputResolution: { width: 3840, height: 2160 },
    });
    expect(bigger.at({ x: 480, y: 270 }).bodyWidth).toBeCloseTo(24, 6);
  });
  it("preserves point/inverse mapping through rotation and a locally stretched mesh", () => {
    const rotated = {
      ...mesh,
      vertices: mesh.vertices.map((v) => ({ ...v, x: 1 - v.v, y: v.u })),
    };
    const p = resolveShelterPresentation({ ...inputs, mesh: rotated });
    const a = p.at({ x: 240, y: 135 });
    expect(a.bodyWidth).toBeCloseTo(12, 5);
    expect(p.inverse(p.forward({ x: 240, y: 135 }))).toEqual({
      x: 240,
      y: 135,
    });
    const warped = {
      ...mesh,
      vertices: mesh.vertices.map((v) => ({ ...v, x: v.x * 0.8 + 0.05 * v.y })),
    };
    const w = resolveShelterPresentation({ ...inputs, mesh: warped });
    expect(w.at({ x: 480, y: 270 }).bodyWidth).toBeCloseTo(12, 4);
  });
  it("keeps both close anchors, with final-display bounded, state-independent nudges", () => {
    const p = resolveShelterPresentation(inputs);
    const anchors = [
      { id: "a", anchor: { x: 480, y: 270 } },
      { id: "b", anchor: { x: 485, y: 270 } },
    ];
    const result = layoutShelterOffsets(anchors, p);
    expect(result.size).toBe(2);
    for (const row of result.values()) {
      expect(Math.abs(row.displacement.x)).toBeLessThanOrEqual(
        row.bodyWidth / 2 + 1e-6,
      );
      expect(Math.abs(row.displacement.y)).toBeLessThanOrEqual(
        row.bodyHeight / 2 + 1e-6,
      );
    }
    expect(layoutShelterOffsets(anchors, p)).toEqual(result);
  });
  it("renders the TD input capture without guessing its downstream warp or nudging", () => {
    const p = resolveShelterPresentation({
      displayProfile: "projection",
      inputCapture: true,
      sourceDimensions: { width: 1920, height: 1080 },
      outputResolution: { width: 1920, height: 1080 },
    });
    expect(p.stage).toBe("input-capture");
    expect(p.at({ x: 500, y: 500 }).bodyWidth).toBeCloseTo(12);
    const rows = layoutShelterOffsets(
      [
        { id: "a", anchor: { x: 500, y: 500 } },
        { id: "b", anchor: { x: 501, y: 500 } },
      ],
      p,
    );
    expect([...rows.values()].map((r) => r.offset)).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });
  it("rejects absent projection geometry", () => {
    expect(() =>
      resolveShelterPresentation({ displayProfile: "projection" }),
    ).toThrow();
  });
});

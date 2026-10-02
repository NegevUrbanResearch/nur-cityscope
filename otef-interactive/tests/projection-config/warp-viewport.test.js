import { expect, test } from "vitest";
import { fitWarpViewport, transformWarpViewBox, warpMarkerRadius, warpPointFromClient } from "../../frontend/src/projection-config/warp-viewport.js";

test("warp marker radius maps to a fixed CSS-pixel radius across zoom and viewport refresh", () => {
  const fit = { x: 0, y: 0, width: 1920, height: 1080 };
  const zoomed = { x: 480, y: 270, width: 960, height: 540 };
  const screenRadius = (viewBox, width, height, radius) => warpMarkerRadius(viewBox, width, height, radius) * fitWarpViewport(viewBox, width, height).scale;
  expect(screenRadius(fit, 1200, 700, 12)).toBeCloseTo(12);
  expect(screenRadius(zoomed, 1200, 700, 12)).toBeCloseTo(12);
  expect(screenRadius(zoomed, 900, 600, 12)).toBeCloseTo(12);
  expect(screenRadius(fit, 1200, 700, 18)).toBeCloseTo(18);
});

test("padded TD viewBox uses one aspect-preserving image and pointer mapping", () => {
  const viewBox = { x: -240, y: -90, width: 2400, height: 1260 };
  const mapping = fitWarpViewport(viewBox, 1200, 700);
  expect(mapping.scale).toBeCloseTo(0.5);
  expect(mapping.insetX).toBeCloseTo(0);
  expect(mapping.insetY).toBeCloseTo(35);
  expect(mapping.image).toMatchObject({ left: 120, top: 80, width: 960, height: 540 });
  expect(warpPointFromClient({ clientX: 1080, clientY: 620 }, { left: 0, top: 0, width: 1200, height: 700 }, viewBox)).toEqual({ x: 1920, y: 1080 });
});

test("warp view transform keeps the output point under the gesture anchor", () => {
  const viewBox = { x: -240, y: -90, width: 2400, height: 1260 };
  const rect = { left: 0, top: 0, width: 1200, height: 700 };
  const cursor = { clientX: 1080, clientY: 620 };
  const before = warpPointFromClient(cursor, rect, viewBox);

  const zoomed = transformWarpViewBox(viewBox, rect, { from: cursor, factor: 2 });
  expect(zoomed).toMatchObject({ width: 1200, height: 630 });
  expect(warpPointFromClient(cursor, rect, zoomed).x).toBeCloseTo(before.x);
  expect(warpPointFromClient(cursor, rect, zoomed).y).toBeCloseTo(before.y);
});

test("warp view transform pans by the pointer delta in output coordinates", () => {
  const viewBox = { x: -240, y: -90, width: 2400, height: 1260 };
  const rect = { left: 0, top: 0, width: 1200, height: 700 };
  const moved = transformWarpViewBox(viewBox, rect, {
    from: { clientX: 500, clientY: 300 },
    to: { clientX: 520, clientY: 300 },
  });

  expect(moved.x).toBeCloseTo(viewBox.x - 40);
  expect(moved.y).toBeCloseTo(viewBox.y);
});

test("warp view transform combines pinch zoom with midpoint pan", () => {
  const viewBox = { x: 0, y: 0, width: 1920, height: 1080 };
  const rect = { left: 0, top: 0, width: 960, height: 540 };
  const transformed = transformWarpViewBox(viewBox, rect, {
    from: { clientX: 200, clientY: 200 },
    to: { clientX: 250, clientY: 220 },
    factor: 2,
  });

  expect(transformed).toEqual({ x: 150, y: 180, width: 960, height: 540 });
});

test("warp view transform ignores invalid gesture inputs", () => {
  const viewBox = { x: -240, y: -90, width: 2400, height: 1260 };
  const rect = { left: 0, top: 0, width: 1200, height: 700 };
  const from = { clientX: 500, clientY: 300 };

  expect(transformWarpViewBox(viewBox, rect, { from, factor: 0 })).toBe(viewBox);
  expect(transformWarpViewBox(viewBox, { ...rect, width: 0 }, { from })).toBe(viewBox);
  expect(transformWarpViewBox(viewBox, rect, { from: { clientX: NaN, clientY: 300 } })).toBe(viewBox);
});

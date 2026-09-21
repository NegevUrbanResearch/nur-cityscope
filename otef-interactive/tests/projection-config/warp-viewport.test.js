import { expect, test } from "vitest";
import { fitWarpViewport, warpPointFromClient } from "../../frontend/src/projection-config/warp-viewport.js";

test("padded TD viewBox uses one aspect-preserving image and pointer mapping", () => {
  const viewBox = { x: -240, y: -90, width: 2400, height: 1260 };
  const mapping = fitWarpViewport(viewBox, 1200, 700);
  expect(mapping.scale).toBeCloseTo(0.5);
  expect(mapping.insetX).toBeCloseTo(0);
  expect(mapping.insetY).toBeCloseTo(35);
  expect(mapping.image).toMatchObject({ left: 120, top: 80, width: 960, height: 540 });
  expect(warpPointFromClient({ clientX: 1080, clientY: 620 }, { left: 0, top: 0, width: 1200, height: 700 }, viewBox)).toEqual({ x: 1920, y: 1080 });
});

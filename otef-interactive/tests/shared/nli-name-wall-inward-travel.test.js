import { expect, test } from 'vitest';
import { DEFAULT_PROJECTION_CONFIG } from '../../frontend/src/shared/projection-config-schema.js';
import { inwardPageTravel } from '../../frontend/src/shared/nli-name-wall-inward-travel.js';

const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
config.pre = { scale: 1, rotateDeg: 0, tx: 0, ty: 0 };
for (const side of ['left', 'right']) {
  config.outputs[side].crop = { x0: 0, x1: 1, y0: 0, y1: 1 };
  config.outputs[side].post = { scale: 1, tx: 0, ty: 0 };
}
const page = { left: -10, right: 10, y0: 0, y1: 118 };
const logicalPlane = { heading: 0, planeScale: 1 };
function meshAt(slopes) {
  const levels = [0, 0.55, 1];
  const vertices = levels.flatMap((v, row) => [0, 1].map((u) => ({ u, v, x: u + slopes[row], y: v })));
  return { vertices, triangles: [0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5] };
}

test('inward travel follows actual output x and stops when a mesh segment turns outward', () => {
  const args = { page, occupiedRows: 1, pitch: 10, config, logicalPlane };
  expect(inwardPageTravel({ ...args, output: 'right', mesh: meshAt([0, -0.2, -0.4]) })).toBe(108);
  expect(inwardPageTravel({ ...args, output: 'right', mesh: meshAt([0, 0.2, 0.4]) })).toBe(0);
  expect(inwardPageTravel({ ...args, output: 'left', mesh: meshAt([0, 0.2, 0.1]) })).toBeCloseTo(49, 6);
  expect(inwardPageTravel({ ...args, output: 'left', mesh: null })).toBe(0);
});

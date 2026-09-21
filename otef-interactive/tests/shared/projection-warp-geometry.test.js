import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createFullFrameProjectionMesh, evaluateWarpPoint, evaluateWarpMesh, interpolateGridOffset, validateWarpMesh } from '../../frontend/src/shared/projection-warp-geometry.js';

const golden = JSON.parse(readFileSync(new URL('../../../nur-io/django_api/backend/tests/fixtures/projection-warp-golden.json', import.meta.url)));
const warp = golden.identity.warp;
const mesh = golden.identity.mesh;

test('identity homography preserves all four corners', () => {
  for (const [input, expected] of golden.samples.identityCorners.map((point) => [point, point])) {
    expect(evaluateWarpPoint(input[0], input[1], warp)).toEqual(expected);
  }
});

test('grid interpolation uses interior logical offsets and clamps at boundaries', () => {
  const value = structuredClone(warp);
  const sample = golden.samples.oneCell;
  value.grid.offsets[0] = sample.cornerOffsets[0];
  value.grid.offsets[1] = sample.cornerOffsets[1];
  value.grid.offsets[7] = sample.cornerOffsets[2];
  value.grid.offsets[8] = sample.cornerOffsets[3];
  expect(interpolateGridOffset(...sample.point, value.grid)).toEqual([0.09600000000000003, 0.12000000000000002]);
  expect(interpolateGridOffset(-1, -1, value.grid)).toEqual([0, 0]);
});

test('mesh evaluation changes destination coordinates but preserves sampled UV and topology', () => {
  const value = structuredClone(warp);
  value.grid.offsets[golden.samples.bilinearCenter.index] = [0.01, 0];
  const result = evaluateWarpMesh(mesh, value);
  expect(result.triangles).toEqual(mesh.triangles);
  expect(result.vertices.map(({ u, v }) => [u, v])).toEqual(mesh.vertices.map(({ u, v }) => [u, v]));
  expect(result.vertices[golden.samples.bilinearCenter.index]).toMatchObject({ x: 0.51, y: 0.5 });
  expect(validateWarpMesh(result)).toBe(result);
});

test('identity baseline supplies fixed left and right logical mesh topologies', () => {
  const left = evaluateWarpMesh(null, golden.identity.warp);
  const right = evaluateWarpMesh(null, golden.rightIdentity.warp);
  expect(left.vertices).toEqual(golden.identity.mesh.vertices);
  expect(left.triangles).toEqual(golden.identity.mesh.triangles);
  expect(right.vertices).toEqual(golden.rightIdentity.mesh.vertices);
  expect(right.triangles).toEqual(golden.rightIdentity.mesh.triangles);

  const changed = structuredClone(golden.identity.warp);
  changed.grid.offsets[golden.samples.bilinearCenter.index] = [0.01, 0];
  const moved = evaluateWarpMesh(null, changed);
  expect(moved.vertices[golden.samples.bilinearCenter.index].x).toBeCloseTo(0.51);
});

test('projective corner samples use the shared golden fixture', () => {
  const value = structuredClone(warp);
  value.keystone.corners = golden.samples.projectiveCorners.corners;
  for (const sample of golden.samples.projectiveCorners.points) {
    const result = evaluateWarpPoint(...sample.point, value);
    expect(result[0]).toBeCloseTo(sample.expected[0]);
    expect(result[1]).toBeCloseTo(sample.expected[1]);
  }
});

test('rejects inverted or degenerate evaluated triangles', () => {
  const invalid = structuredClone(mesh);
  invalid.vertices[1].x = 0;
  expect(() => validateWarpMesh(invalid)).toThrow(/degenerate|inverted/i);
});

test('disabled warp returns a fixed full-frame quad without loading baseline geometry', () => {
  const value = structuredClone(warp);
  value.enabled = false;
  const result = evaluateWarpMesh(null, value);
  expect(result).toEqual(createFullFrameProjectionMesh({ side: 'left' }));

  const right = structuredClone(golden.rightIdentity.warp);
  right.enabled = false;
  expect(evaluateWarpMesh(null, right)).toEqual(createFullFrameProjectionMesh({ side: 'right' }));
});

test('malformed non-object baseline without a mesh fails with a controlled validation error', () => {
  for (const baseline of [null, 'identity', []]) {
    const value = structuredClone(warp);
    value.baseline = baseline;
    expect(() => evaluateWarpMesh(null, value)).toThrow(Error);
  }
});

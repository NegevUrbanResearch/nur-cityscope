import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

let samplerModule;
try { samplerModule = await import("../../frontend/src/shared/projection-baseline-sampler.js"); } catch { samplerModule = {}; }
const fixture = JSON.parse(readFileSync(new URL("../../../nur-io/django_api/backend/tests/fixtures/projection-grid-parity.json", import.meta.url), "utf8"));
const requireSampler = () => { expect(samplerModule.createBaselineSampler).toBeTypeOf("function"); return samplerModule.createBaselineSampler; };

test("baseline sampler interpolates x/y and u/v in triangle interiors and chooses the lowest ID on shared edges", () => {
  const createBaselineSampler = requireSampler();
  const sample = createBaselineSampler(fixture.mesh);
  for (const { point, expected, triangleId } of fixture.baselineSamples) {
    const actual = sample(...point);
    expect(actual.triangleId).toBe(triangleId);
    for (const key of ["x", "y", "u", "v"]) expect(actual[key]).toBeCloseTo(expected[key], 14);
  }
  expect(sample(0.8, 0.8, 1).triangleId).toBe(1);
});

test("baseline sampling rejects uncovered or invalid source coordinates without mutating the mesh", () => {
  const createBaselineSampler = requireSampler();
  const mesh = structuredClone(fixture.mesh);
  const original = structuredClone(mesh);
  const sample = createBaselineSampler(mesh);
  expect(() => sample(-0.01, 0.2)).toThrow(/outside|covered/i);
  expect(() => sample(0.5, 0.5, 99)).toThrow();
  const hole = { ...mesh, triangles: [0, 1, 2] };
  expect(() => createBaselineSampler(hole)(0.8, 0.8)).toThrow(/cover/i);
  expect(() => createBaselineSampler({ ...mesh, triangles: [0, 2, 1, 2, 1, 3] })).toThrow(/orientation/i);
  expect(mesh).toEqual(original);
});

test.each(['vertex-object', 'vertex-array', 'source-coordinates', 'triangle-indices'])(
  'a new sampler reflects same-identity %s replacement after an earlier sampler was warmed', (mutation) => {
    const createBaselineSampler = requireSampler();
    const mesh = structuredClone(fixture.mesh);
    createBaselineSampler(mesh)(.2, .2);
    if (mutation === 'vertex-object') mesh.vertices[0] = { ...mesh.vertices[0], u: mesh.vertices[0].u + .01 };
    if (mutation === 'vertex-array') mesh.vertices = mesh.vertices.map((point, index) => index === 1 ? { ...point, x: point.x + .01 } : point);
    if (mutation === 'source-coordinates') {
      mesh.vertices[1] = { ...mesh.vertices[1], s: .99 };
      mesh.vertices[3] = { ...mesh.vertices[3], s: .99 };
    }
    if (mutation === 'triangle-indices') mesh.triangles = [2, 1, 3, 0, 1, 2];
    const actual = createBaselineSampler(mesh)(mutation === 'triangle-indices' ? .8 : .2, mutation === 'triangle-indices' ? .8 : .2);
    const expected = createBaselineSampler(structuredClone(mesh))(mutation === 'triangle-indices' ? .8 : .2, mutation === 'triangle-indices' ? .8 : .2);
    expect(actual).toEqual(expected);
    if (mutation === 'vertex-object') expect(actual.u).toBeCloseTo(expected.u, 14);
    if (mutation === 'triangle-indices') expect(actual.triangleId).toBe(0);
  },
);

test('unchanged same-identity mesh reuses its built sampler index', () => {
  const createBaselineSampler = requireSampler();
  let vertexReads = 0;
  const mesh = { triangles: fixture.mesh.triangles, get vertices() { vertexReads += 1; return fixture.mesh.vertices; } };
  createBaselineSampler(mesh)(.2, .2);
  createBaselineSampler(mesh)(.8, .8);
  expect(vertexReads).toBe(4); // signature on each request; index reads only on the first
});

test.each([
  ["vertical", [0.5 - 1e-14, 0.25], [0.5 - 1e-10, 0.25], [0.5, 0.25]],
  ["horizontal", [0.25, 0.5 - 1e-14], [0.25, 0.5 - 1e-10], [0.25, 0.5]],
])("%s bin-boundary candidates honor barycentric tolerance and lowest-ID ownership", (_axis, near, outside, exact) => {
  const createBaselineSampler = requireSampler();
  const vertices = _axis === "vertical"
    ? [[0.5, 0], [1, 0], [0.5, 1], [0, 0]]
    : [[0, 0.5], [1, 0.5], [0.5, 1], [0.5, 0]];
  const mesh = {
    vertices: vertices.map(([s, t]) => ({ s, t, x: s, y: t, u: s, v: t })),
    triangles: _axis === "vertical" ? [0, 1, 2, 3, 0, 2] : [0, 1, 2, 0, 3, 1],
  };
  const sample = createBaselineSampler(mesh);
  expect(sample(...exact).triangleId).toBe(0);
  expect(sample(...near).triangleId).toBe(0);
  expect(sample(...near, 0).triangleId).toBe(0);
  expect(sample(...outside).triangleId).toBe(1);
  expect(() => sample(...outside, 0)).toThrow(/does not contain/i);
});

test.each(["left", "right"])("actual %s TD baseline samples an off-vertex source coordinate", (side) => {
  const createBaselineSampler = requireSampler();
  const mesh = JSON.parse(readFileSync(new URL(`../../public/projection-calibration/td-baselines/${side}.json`, import.meta.url), "utf8"));
  const sample = createBaselineSampler(mesh)(0.123456, 0.234567);
  expect(sample).toMatchObject({ s: 0.123456, t: 0.234567 });
  expect(mesh.vertices.some((point) => point.s === sample.s && point.t === sample.t)).toBe(false);
  expect([sample.x, sample.y, sample.u, sample.v].every(Number.isFinite)).toBe(true);
  expect(sample.x !== sample.s || sample.y !== sample.t).toBe(true);
});

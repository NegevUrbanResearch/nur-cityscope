import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

let topology;
try { topology = await import("../../frontend/src/shared/projection-grid-topology.js"); } catch { topology = {}; }
const fixture = JSON.parse(readFileSync(new URL("../../../nur-io/django_api/backend/tests/fixtures/projection-grid-parity.json", import.meta.url), "utf8"));
const requireTopology = () => { expect(topology.uniformAxis).toBeTypeOf("function"); expect(topology.gridInterval).toBeTypeOf("function"); expect(topology.sampleGridOffset).toBeTypeOf("function"); expect(topology.resampleGrid).toBeTypeOf("function"); return topology; };

test("grid interval uses nonuniform axes, clamps finite residual samples, and uses the last interval at one", () => {
  const { uniformAxis, gridInterval, sampleGridOffset } = requireTopology();
  expect(uniformAxis(4)).toEqual([0, 1 / 3, 2 / 3, 1]);
  expect(gridInterval(fixture.grid.columnPositions, 0.25)).toEqual({ index: 1, fraction: 0 });
  expect(gridInterval(fixture.grid.columnPositions, 1)).toEqual({ index: 1, fraction: 1 });
  expect(gridInterval(fixture.grid.columnPositions, -5)).toEqual({ index: 0, fraction: 0 });
  const sampled = sampleGridOffset(0.625, 0.3, fixture.grid);
  expect(sampled[0]).toBeCloseTo(0.3, 14);
  expect(sampled[1]).toBeCloseTo(0.35, 14);
  expect(sampleGridOffset(-1, -1, fixture.grid)).toEqual([0, 0]);
  const legacy = { columns: 2, rows: 2, offsets: [[0, 0], [1, 0], [0, 1], [1, 1]] };
  expect(sampleGridOffset(0.5, 0.5, legacy)).toEqual([0.5, 0.5]);
});

test("nested row and column insertions preserve the old residual field at off-knot samples", () => {
  const { sampleGridOffset, insertGridLine } = requireTopology();
  const original = structuredClone(fixture.grid);
  const inserted = insertGridLine(insertGridLine(original, "column", 0.5), "row", 0.3);
  expect(inserted.columnPositions).toEqual([0, 0.25, 0.5, 1]);
  expect(inserted.rowPositions).toEqual([0, 0.3, 0.6, 1]);
  for (const [s, t] of [[0.1, 0.1], [0.4, 0.5], [0.8, 0.9]]) {
    const before = sampleGridOffset(s, t, original);
    const after = sampleGridOffset(s, t, inserted);
    expect(after[0]).toBeCloseTo(before[0], 14);
    expect(after[1]).toBeCloseTo(before[1], 14);
  }
  expect(original).toEqual(fixture.grid);
});

test("remove, move, and uniform count changes return independent resampled grids", () => {
  const { sampleGridOffset, removeGridLine, moveGridLine, uniformGrid } = requireTopology();
  const original = structuredClone(fixture.grid);
  const removed = removeGridLine(original, "column", 1);
  expect(removed.columnPositions).toEqual([0, 1]);
  expect(removed.offsets).toHaveLength(6);
  const moved = moveGridLine(original, "row", 1, 0.4);
  expect(moved.rowPositions).toEqual([0, 0.4, 1]);
  expect(sampleGridOffset(0.4, 0.5, moved)).not.toEqual(sampleGridOffset(0.4, 0.5, original));
  const redistributed = uniformGrid(original, 4, 5);
  expect(redistributed).toMatchObject({ columns: 4, rows: 5, columnPositions: [0, 1 / 3, 2 / 3, 1], rowPositions: [0, 0.25, 0.5, 0.75, 1] });
  expect(redistributed.offsets).toHaveLength(20);
  expect(original).toEqual(fixture.grid);
  expect(removed.offsets).not.toBe(original.offsets);
});

test("topology rejects invalid axes, counts, line edits, and nonfinite samples", () => {
  const { uniformAxis, gridInterval, sampleGridOffset, insertGridLine, removeGridLine, moveGridLine, uniformGrid } = requireTopology();
  for (const count of [true, 1, 17, 2.5, Infinity, NaN]) expect(() => uniformAxis(count)).toThrow();
  for (const axis of [[0, 0.5, 0.5, 1], [0.1, 1], [0, 1.1], [0, NaN, 1]]) expect(() => gridInterval(axis, 0.2)).toThrow();
  expect(() => gridInterval([0, 1], Infinity)).toThrow();
  expect(() => sampleGridOffset(NaN, 0.5, fixture.grid)).toThrow();
  expect(() => sampleGridOffset(0.5, 0.5, { ...fixture.grid, columnPositions: null })).toThrow();
  expect(() => insertGridLine(fixture.grid, "column", 0.25)).toThrow();
  expect(() => insertGridLine({ ...fixture.grid, columns: 16, columnPositions: [...Array.from({ length: 15 }, (_, i) => i / 15), 1], offsets: Array.from({ length: 48 }, () => [0, 0]) }, "column", 0.5)).toThrow();
  expect(() => removeGridLine(fixture.grid, "row", 0)).toThrow();
  expect(() => removeGridLine({ ...fixture.grid, rows: 2, rowPositions: [0, 1], offsets: Array.from({ length: 6 }, () => [0, 0]) }, "row", 1)).toThrow();
  expect(() => moveGridLine(fixture.grid, "column", 0, 0.1)).toThrow();
  expect(() => moveGridLine(fixture.grid, "column", 1, 1)).toThrow();
  expect(() => uniformGrid(fixture.grid, true, 4)).toThrow();
});

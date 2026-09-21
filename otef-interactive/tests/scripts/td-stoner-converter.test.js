import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { convertTdStonerExport, parseTdTable, stableJson } from "../../scripts/td-warp/convert-td-stoner-export.mjs";

const raw = ({ side = "left", columns = 2, rows = 2 } = {}) => ({
  schemaVersion: 1,
  side,
  width: 1920,
  height: 1080,
  camera: {
    width: 1920,
    height: 1080,
    projection: [0.0010416667209938169, 0, 0, 0, 0, 0.0018518518190830946, 0, 0, 0, 0, -0.0010000999318435788, 0, -0, -0, -0.00010001000191550702, 1],
    world: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 5, 1],
    geometryWorld: [1920, 0, 0, 0, 0, 1080, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    passthroughWorld: [1920, 0, 0, 0, 0, 1080, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  },
  settings: { path: "/fixture/settingsUI", parameters: {} },
  tableFingerprints: { before: { fixture: "stable" }, after: { fixture: "stable" } },
  tables: {
    evaluatedPositions: [
      "index\tP(0)\tP(1)\tP(2)",
      "0\t-1\t-1\t0",
      "1\t1\t-1\t0",
      "2\t-1\t1\t0",
      "3\t1\t1\t0",
    ].join("\n"),
    undeformedLattice: [
      "index\tvindex\tuv(0)\tuv(1)\tuv(2)",
      "0\t0\t0\t0\t0",
      "0\t1\t1\t0\t0",
      "0\t2\t0\t1\t0",
      "0\t3\t1\t1\t0",
    ].join("\n"),
    topology: "index\trIndex\tP(0)\tP(1)\tP(2)\nl\n",
  },
  evaluatedMesh: {
    columns,
    points: [[-1, -1, 0], [1, -1, 0], [-1, 1, 0], [1, 1, 0]],
    primitives: [[
      { point: 0, uv: [0, 0, 0] }, { point: 1, uv: [1, 0, 0] },
      { point: 3, uv: [1, 1, 0] }, { point: 2, uv: [0, 1, 0] },
    ]],
  },
  columns,
  rows,
});

describe("TD Stoner converter", () => {
  test("captured baseline assets have trusted deterministic hashes and expected grids", () => {
    const directory = path.resolve("public/projection-calibration/td-baselines");
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
    const framing = fs.readFileSync(path.resolve("public/projection-calibration/td-source-config.json"));
    expect(crypto.createHash("sha256").update(framing).digest("hex")).toBe(manifest.framing.sha256);
    for (const side of ["left", "right"]) {
      const asset = manifest.assets[side];
      const bytes = fs.readFileSync(path.join(directory, asset.path));
      expect(crypto.createHash("sha256").update(bytes).digest("hex")).toBe(asset.sha256);
      const mesh = JSON.parse(bytes);
      expect(mesh.logicalGrid).toEqual(asset.logicalGrid);
      expect(mesh.denseGrid).toEqual(asset.denseGrid);
      expect(mesh.vertices.length).toBe(asset.denseGrid.columns * asset.denseGrid.rows);
      expect(mesh.triangles.length).toBe((asset.denseGrid.columns - 1) * (asset.denseGrid.rows - 1) * 6);
    }
  });

  test("parses TSV tables and converts NDC positions to top-left normalized mesh points", () => {
    expect(parseTdTable("index\tP(0)\n0\t1")).toEqual([{ index: 0, "P(0)": 1 }]);
    const result = convertTdStonerExport(raw());
    expect(result.vertices).toEqual([
      { s: 0, t: 1, x: -0.5, y: 1.5, u: 0, v: 1 },
      { s: 1, t: 1, x: 1.5, y: 1.5, u: 1, v: 1 },
      { s: 0, t: 0, x: -0.5, y: -0.5, u: 0, v: 0 },
      { s: 1, t: 0, x: 1.5, y: -0.5, u: 1, v: 0 },
    ]);
  });

  test("preserves evaluated mesh UVs and emits positive top-left triangle areas", () => {
    const directory = path.resolve("public/projection-calibration/td-baselines");
    const mesh = JSON.parse(fs.readFileSync(path.join(directory, "left.json"), "utf8"));
    for (let index = 0; index < 12; index += 3) {
      const [a, b, c] = mesh.triangles.slice(index, index + 3).map((point) => mesh.vertices[point]);
      expect((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)).toBeGreaterThan(0);
    }
    expect(mesh.vertices[0].u).toBe(0);
    expect(mesh.vertices.at(-1).u).toBe(1);
  });

  test("uses positive top-left signed-area winding and deterministic JSON data", () => {
    const result = convertTdStonerExport(raw());
    expect(result.triangles).toEqual([0, 2, 1, 1, 2, 3]);
    expect(JSON.stringify(result)).toBe(JSON.stringify(convertTdStonerExport(raw())));
    expect(stableJson(result)).toBe(`${JSON.stringify(result)}\n`);
    expect(stableJson(result).trim().includes("\n")).toBe(false);
  });

  test("derives dense dimensions from topology and keeps top-left parameters separate from sampled UV", () => {
    const right = raw({ side: "right", columns: 2, rows: 2 });
    right.logicalGrid = { columns: 8, rows: 7 };
    right.evaluatedMesh = {
      columns: 2,
      points: [[-1, -1, 0], [0, -1, 0], [1, -1, 0], [-1, 1, 0], [0, 1, 0], [1, 1, 0]],
      primitives: [
        [{ point: 0, uv: [0.2, 0.3] }, { point: 1, uv: [0.7, 0.3] }, { point: 4, uv: [0.7, 0.8] }, { point: 3, uv: [0.2, 0.8] }],
        [{ point: 1, uv: [0.7, 0.3] }, { point: 2, uv: [0.9, 0.3] }, { point: 5, uv: [0.9, 0.8] }, { point: 4, uv: [0.7, 0.8] }],
      ],
    };
    expect(() => convertTdStonerExport(right)).toThrow(/columns disagree/);
    delete right.evaluatedMesh.columns;
    const mesh = convertTdStonerExport(right);
    expect(mesh.denseGrid).toEqual({ columns: 3, rows: 2 });
    expect(mesh.vertices[0]).toMatchObject({ s: 0, t: 1, u: 0.2, v: 0.7 });
    expect(mesh.vertices[3]).toMatchObject({ s: 0, t: 0, u: 0.2 });
    expect(mesh.vertices[3].v).toBeCloseTo(0.2);
    expect(mesh.vertices[0].t).not.toBe(mesh.vertices[0].v);
  });

  test("rejects out-of-range coordinates and incomplete or duplicate topology", () => {
    const outside = raw();
    outside.evaluatedMesh.points[0] = [3, -1, 0];
    expect(() => convertTdStonerExport(outside)).toThrow(/safe extent/);
    const duplicate = raw();
    duplicate.evaluatedMesh.primitives.push(duplicate.evaluatedMesh.primitives[0]);
    expect(() => convertTdStonerExport(duplicate)).toThrow(/missing or has extra|duplicate/);
    const missing = raw();
    missing.evaluatedMesh.primitives = [];
    expect(() => convertTdStonerExport(missing)).toThrow(/topology/);
  });

  test("rejects missing or changed capture assumptions", () => {
    const missingCamera = raw();
    delete missingCamera.camera;
    expect(() => convertTdStonerExport(missingCamera)).toThrow(/camera matrices/);
    const changedCamera = raw();
    changedCamera.camera.projection[0] += 0.01;
    expect(() => convertTdStonerExport(changedCamera)).toThrow(/matrices changed/);
    const changedFingerprint = raw();
    changedFingerprint.tableFingerprints.after.fixture = "changed";
    expect(() => convertTdStonerExport(changedFingerprint)).toThrow(/fingerprints changed/);
  });

  test("rejects conflicting per-point sampled UVs", () => {
    const conflict = raw({ side: "right" });
    conflict.logicalGrid = { columns: 8, rows: 7 };
    conflict.evaluatedMesh = {
      points: [[-1, -1, 0], [0, -1, 0], [1, -1, 0], [-1, 1, 0], [0, 1, 0], [1, 1, 0]],
      primitives: [
        [{ point: 0, uv: [0, 0] }, { point: 1, uv: [0.5, 0] }, { point: 4, uv: [0.5, 1] }, { point: 3, uv: [0, 1] }],
        [{ point: 1, uv: [0.25, 0] }, { point: 2, uv: [1, 0] }, { point: 5, uv: [1, 1] }, { point: 4, uv: [0.5, 1] }],
      ],
    };
    expect(() => convertTdStonerExport(conflict)).toThrow(/conflicting UVs/);
  });

  test("rejects malformed, non-finite, and wrong-size exports", () => {
    expect(() => convertTdStonerExport({ ...raw(), evaluatedMesh: { ...raw().evaluatedMesh, points: [["nope", 1, 0], ...raw().evaluatedMesh.points.slice(1)] } })).toThrow(/finite numeric/i);
    expect(() => convertTdStonerExport({ ...raw(), side: "right", logicalGrid: { columns: 2, rows: 2 } })).toThrow(/right.*8x7/i);
    expect(() => convertTdStonerExport({ ...raw(), evaluatedMesh: { ...raw().evaluatedMesh, points: [["NaN", 1, 0], ...raw().evaluatedMesh.points.slice(1)] } })).toThrow(/finite/i);
  });
});

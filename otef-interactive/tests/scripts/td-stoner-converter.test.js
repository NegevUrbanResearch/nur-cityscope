import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { convertFile, convertTdStonerExport, logicalGridFromTopology, parseTdTable, stableJson } from "../../scripts/td-warp/convert-td-stoner-export.mjs";
import { variableTdCapture, variableTdMesh } from "../fixtures/td-variable-grid.js";

const logicalTopology = (columns, rows) => {
  const lines = ["index\trIndex\tl\tr\tt\tb"];
  for (let index = 0; index < columns * rows; index += 1) {
    const row = Math.floor(index / columns); const column = index % columns; const rid = index * 10;
    lines.push([index, rid, column === 0 ? -1 : rid - 1, column === columns - 1 ? -1 : rid + 1,
      row === rows - 1 ? -1 : rid + 2, row === 0 ? -1 : rid + 3].join("\t"));
  }
  return lines.join("\n");
};

const logicalGrid = { columns: 2, rows: 2 };

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
    topology: logicalTopology(logicalGrid.columns, logicalGrid.rows),
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
  logicalGrid: { ...logicalGrid },
});

describe("TD Stoner converter", () => {
  test.each([[3, 4], [5, 3], [7, 7], [8, 7]])("derives actual %ix%i logical dimensions", (columns, rows) => {
    expect(logicalGridFromTopology(logicalTopology(columns, rows))).toEqual({ columns, rows });
  });

  test("accepts topology rows reordered by index and rejects duplicate or missing indexes", () => {
    const lines = logicalTopology(3, 4).split("\n");
    expect(logicalGridFromTopology([lines[0], ...lines.slice(1).reverse()].join("\n"))).toEqual({ columns: 3, rows: 4 });
    expect(() => logicalGridFromTopology([lines[0], ...lines.slice(1, -1), lines[1]].join("\n"))).toThrow(/indexes/);
    expect(() => logicalGridFromTopology(lines.slice(0, -1).join("\n"))).toThrow(/indexes|rectangular/);
  });

  test("applies strict TSV integer parsing in parity with Python", () => {
    const valid = logicalTopology(3, 4);
    const malformed = [
      valid.replace("index\trIndex", "index\tindex"),
      valid.replace("0\t0\t-1", "0.0\t0\t-1"),
      valid.replace("0\t0\t-1", "0e0\t0\t-1"),
      valid.replace("0\t0\t-1", "0_0\t0\t-1"),
      valid.replace("0\t0\t-1", "9007199254740992\t0\t-1"),
      "index\trIndex\tl\tr\tt\tb\textra\n" + valid.split("\n").slice(1).join("\n"),
      "index\trIndex\tl\tr\tt\tb\n" + valid.split("\n").slice(1).map((line) => `${line}\tignored`).join("\n"),
      "index\trIndex\tl\tr\tt\tb\n" + valid.split("\n").slice(1).map((line) => line.slice(0, line.lastIndexOf("\t"))).join("\n"),
    ];
    for (const text of malformed) expect(() => logicalGridFromTopology(text)).toThrow();
    expect(logicalGridFromTopology(valid + "\n\t \t \t \t \t ")).toEqual({ columns: 3, rows: 4 });
    const illegal = valid.replace("0\t0\t-1", "0\t0\t-2");
    expect(() => logicalGridFromTopology(illegal)).toThrow(/neighbor/);
    expect(() => logicalGridFromTopology(valid.replace("1\t10\t9\t11", "1\t10\t-1\t11"))).toThrow(/boundary|rectangular/);
    expect(() => logicalGridFromTopology(valid.replace("index\trIndex\tl\tr\tt\tb", "index\trIndex\tl\tr\tt\tb\n0\t0\t-1\t1\t2\t-1"))).toThrow();
  });

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

  test.each(["left", "right"])("converts the complete variable-grid %s fixture to independent expected output", (side) => {
    const actual = convertTdStonerExport(variableTdCapture(side));
    const expected = variableTdMesh(side);
    const { vertices: _actualVertices, ...actualMetadata } = actual;
    const { vertices: _expectedVertices, ...expectedMetadata } = expected;
    expect(actualMetadata).toEqual(expectedMetadata);
    expect(actual.vertices).toHaveLength(expected.vertices.length);
    for (const [index, vertex] of actual.vertices.entries()) {
      for (const key of ["s", "t", "x", "y", "u", "v"]) expect(vertex[key]).toBeCloseTo(expected.vertices[index][key], 12);
    }
  });

  test("derives a changed logical grid and rejects disagreement, missing topology, source folds, and oversized geometry", () => {
    const changed = variableTdCapture("left");
    delete changed.logicalGrid;
    expect(convertTdStonerExport(changed).logicalGrid).toEqual({ columns: 3, rows: 4 });
    changed.logicalGrid = { columns: 5, rows: 3 };
    expect(() => convertTdStonerExport(changed)).toThrow(/disagrees/);
    changed.logicalGrid = null;
    expect(() => convertTdStonerExport(changed)).toThrow(/malformed/);
    const missing = variableTdCapture("left"); delete missing.tables.topology;
    expect(() => convertTdStonerExport(missing)).toThrow(/topology/);
    const folded = variableTdCapture("left"); folded.evaluatedMesh.points[1] = folded.evaluatedMesh.points[0];
    expect(() => convertTdStonerExport(folded)).toThrow(/source triangle|destination triangle/);
    const oversized = variableTdCapture("left"); oversized.evaluatedMesh.points = new Array(65537).fill([0, 0, 0]);
    expect(() => convertTdStonerExport(oversized)).toThrow(/65536/);
    const incomplete = variableTdCapture("left"); incomplete.evaluatedMesh.primitives.pop();
    expect(() => convertTdStonerExport(incomplete)).toThrow(/missing or has extra/);
  });

  test.each([
    ["repeated corners", [1, 2, 1, 6]],
    ["crossed corners", [1, 2, 6, 7]],
  ])("rejects %s in a later dense cell", (_label, malformed) => {
    const capture = variableTdCapture("left");
    const sampledUv = new Map(capture.evaluatedMesh.primitives.flat().map(({ point, uv }) => [point, uv]));
    capture.evaluatedMesh.primitives[1] = malformed.map((point) => ({ point, uv: sampledUv.get(point) }));
    expect(() => convertTdStonerExport(capture)).toThrow(/quad|cell|perimeter/);
  });

  test("accepts cyclic rotations and reversed perimeter winding without changing supplied vertex order", () => {
    const capture = variableTdCapture("left");
    const sampledUv = new Map(capture.evaluatedMesh.primitives.flat().map(({ point, uv }) => [point, uv]));
    capture.evaluatedMesh.primitives[1] = [7, 6, 1, 2].map((point) => ({ point, uv: sampledUv.get(point) }));
    const mesh = convertTdStonerExport(capture);
    expect(mesh.triangles.slice(6, 12)).toEqual([7, 2, 6, 6, 2, 1]);
  });

  test("rejects nonzero reversed winding and both signed destination areas at tolerance", () => {
    const reversed = variableTdCapture("left");
    reversed.evaluatedMesh.points = reversed.evaluatedMesh.points.map(([x, y, z]) => [-x, y, z]);
    expect(() => convertTdStonerExport(reversed)).toThrow(/destination triangle/);

    const tiny = variableTdCapture("left");
    const [x0, y0] = tiny.evaluatedMesh.points[0];
    tiny.evaluatedMesh.points[5][0] = x0;
    tiny.evaluatedMesh.points[5][1] = y0 - (1e-5 / (tiny.evaluatedMesh.points[1][0] - x0));
    expect(() => convertTdStonerExport(tiny)).toThrow(/destination triangle/);

    const positiveTiny = variableTdCapture("left");
    positiveTiny.evaluatedMesh.points = positiveTiny.evaluatedMesh.points.map(([x, y, z]) => [x * 0.001, y * 0.001, z]);
    const primitive = positiveTiny.evaluatedMesh.primitives[0];
    const [a, b, c] = primitive.slice(0, 3).map(({ point }) => positiveTiny.evaluatedMesh.points[point]);
    const positiveArea = Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])) / 4;
    expect(positiveArea).toBeGreaterThan(0);
    expect(positiveArea).toBeLessThanOrEqual(1e-5);
    expect(() => convertTdStonerExport(positiveTiny)).toThrow(/destination triangle/);
  });

  test("preserves existing output after conversion fails and still loads the separate evaluated mesh file", () => {
    const directory = fs.mkdtempSync(path.join(process.cwd(), ".td-converter-test-"));
    try {
      const inputPath = path.join(directory, "left-raw.json");
      const outputPath = path.join(directory, "left.json");
      const capture = variableTdCapture("left"); delete capture.evaluatedMesh;
      fs.writeFileSync(inputPath, JSON.stringify(capture));
      const sentinel = Buffer.from("existing mesh must survive");
      fs.writeFileSync(outputPath, sentinel);
      expect(() => convertFile(inputPath, outputPath)).toThrow(/evaluated mesh/);
      expect(fs.readFileSync(outputPath)).toEqual(sentinel);
      fs.writeFileSync(path.join(directory, "left-evaluated-mesh.json"), JSON.stringify(variableTdCapture("left").evaluatedMesh));
      expect(convertFile(inputPath, outputPath).triangles).toEqual(variableTdMesh("left").triangles);
      expect(fs.existsSync(outputPath)).toBe(true);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
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
    right.logicalGrid = { columns: 2, rows: 2 };
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
    conflict.logicalGrid = { columns: 2, rows: 2 };
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
    expect(() => convertTdStonerExport({ ...raw(), side: "right", logicalGrid: { columns: 8, rows: 7 } })).toThrow(/disagrees/);
    expect(() => convertTdStonerExport({ ...raw(), evaluatedMesh: { ...raw().evaluatedMesh, points: [["NaN", 1, 0], ...raw().evaluatedMesh.points.slice(1)] } })).toThrow(/finite/i);
  });
});

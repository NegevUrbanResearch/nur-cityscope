import fs from "node:fs";
import crypto from "node:crypto";

const EXPECTED_LOGICAL_GRID = Object.freeze({ left: { columns: 7, rows: 7 }, right: { columns: 8, rows: 7 } });
const EXPECTED_CAMERA = Object.freeze({
  projection: [0.0010416667209938169, 0, 0, 0, 0, 0.0018518518190830946, 0, 0, 0, 0, -0.0010000999318435788, 0, -0, -0, -0.00010001000191550702, 1],
  world: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 5, 1],
  geometryWorld: [1920, 0, 0, 0, 0, 1080, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  passthroughWorld: [1920, 0, 0, 0, 0, 1080, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
});

export function parseTdTable(text) {
  if (typeof text !== "string" || !text.trim()) throw new Error("TD table must be a non-empty TSV string");
  const rows = text.replace(/\r/g, "").trim().split("\n").map((line) => line.split("\t"));
  const headers = rows.shift();
  if (!headers?.length || headers.some((header) => !header.trim())) throw new Error("TD table has invalid headers");
  return rows.filter((row) => row.some((cell) => cell.trim())).map((row, rowIndex) => {
    const record = {};
    for (let i = 0; i < headers.length; i += 1) {
      const value = (row[i] ?? "").trim();
      if (value === "") continue;
      const number = Number(value);
      record[headers[i]] = Number.isFinite(number) && value !== "NaN" ? number : value;
    }
    return record;
  });
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite numeric data`);
  return number;
}

export function convertTdStonerExport(input) {
  if (!input || typeof input !== "object") throw new Error("TD export must be an object");
  const side = input.side;
  if (!EXPECTED_LOGICAL_GRID[side]) throw new Error(`Unknown TD export side: ${side}`);
  const expected = EXPECTED_LOGICAL_GRID[side];
  const logicalGrid = input.logicalGrid ?? expected;
  if (logicalGrid.columns !== expected.columns || logicalGrid.rows !== expected.rows) {
    throw new Error(`${side} logical grid must be ${expected.columns}x${expected.rows}`);
  }
  if (input.width !== 1920 || input.height !== 1080) throw new Error("TD export dimensions must be 1920x1080");
  validateCapture(input);
  if (!input.evaluatedMesh?.points || !input.evaluatedMesh?.primitives) throw new Error("TD export is missing evaluated mesh geometry");
  return convertEvaluatedMesh(input, expected, logicalGrid);
}

function validateCapture(input) {
  const camera = input.camera;
  if (!camera || !Array.isArray(camera.projection) || !Array.isArray(camera.world) || !Array.isArray(camera.geometryWorld) || !Array.isArray(camera.passthroughWorld)) {
    throw new Error("TD export is missing captured camera matrices");
  }
  const close = (actual, expected) => actual.length === expected.length && actual.every((value, index) => Number.isFinite(value) && Math.abs(value - expected[index]) <= 1e-6);
  if (!close(camera.projection, EXPECTED_CAMERA.projection) || !close(camera.world, EXPECTED_CAMERA.world) || !close(camera.geometryWorld, EXPECTED_CAMERA.geometryWorld) || !close(camera.passthroughWorld, EXPECTED_CAMERA.passthroughWorld)) {
    throw new Error("TD camera matrices changed; refusing hardcoded normalized coordinate conversion");
  }
  if (camera.width !== 1920 || camera.height !== 1080) throw new Error("TD camera capture dimensions must be 1920x1080");
  if (!input.settings?.path || !input.settings?.parameters) throw new Error("TD export is missing captured settings metadata");
  const fingerprints = input.tableFingerprints;
  if (!fingerprints?.before || !fingerprints?.after || JSON.stringify(fingerprints.before) !== JSON.stringify(fingerprints.after)) {
    throw new Error("TD table fingerprints changed during capture");
  }
}

function convertEvaluatedMesh(input, expected, logicalGrid) {
  const source = input.evaluatedMesh;
  const pointCount = source.points.length;
  if (!Array.isArray(source.primitives) || source.primitives.length === 0) throw new Error("Evaluated topology must contain quads");
  const first = source.primitives[0];
  if (!Array.isArray(first) || first.length !== 4 || Number(first[0]?.point) !== 0 || Number(first[1]?.point) !== 1) {
    throw new Error("Evaluated topology must begin with the canonical rectangular grid quad");
  }
  const columns = Number(first[3]?.point);
  if (!Number.isInteger(columns) || columns < 2 || Number(first[2]?.point) !== columns + 1 || pointCount % columns !== 0) {
    throw new Error("Evaluated topology does not define a rectangular grid stride");
  }
  const dense = { columns, rows: pointCount / columns };
  if (source.columns != null && Number(source.columns) !== columns) throw new Error("Evaluated topology columns disagree with its row stride");
  if (source.rows != null && Number(source.rows) !== dense.rows) throw new Error("Evaluated topology rows disagree with its point count");
  const expectedQuadCount = (columns - 1) * (dense.rows - 1);
  if (source.primitives.length !== expectedQuadCount) throw new Error("Evaluated topology is missing or has extra grid quads");
  const uvByPoint = new Array(pointCount);
  const quads = [];
  const seenCells = new Set();
  for (const primitive of source.primitives) {
    const points = primitive.map((vertex) => {
      const index = Number(vertex.point);
      if (!Number.isInteger(index) || index < 0 || index >= pointCount) throw new Error("Evaluated topology references an invalid point");
      const uv = vertex.uv ?? [];
      const sampled = [finite(uv[0], `UV ${index} u`), finite(uv[1], `UV ${index} v`)];
      if (uvByPoint[index] && (uvByPoint[index][0] !== sampled[0] || uvByPoint[index][1] !== sampled[1])) throw new Error(`Evaluated topology has conflicting UVs for point ${index}`);
      uvByPoint[index] ??= sampled;
      return index;
    });
    if (points.length !== 4) throw new Error("Evaluated Stoner topology must contain quads");
    const min = Math.min(...points);
    const row = Math.floor(min / columns);
    const column = min % columns;
    if (row >= dense.rows - 1 || column >= columns - 1) throw new Error("Evaluated topology contains a quad outside the rectangular grid");
    const expectedPoints = new Set([min, min + 1, min + columns, min + columns + 1]);
    if (expectedPoints.size !== 4 || points.some((point) => !expectedPoints.has(point))) throw new Error("Evaluated topology contains a non-adjacent quad");
    const cell = `${row}:${column}`;
    if (seenCells.has(cell)) throw new Error("Evaluated topology contains a duplicate grid quad");
    seenCells.add(cell);
    quads.push(points);
  }
  if (seenCells.size !== expectedQuadCount) throw new Error("Evaluated topology does not cover every grid cell");
  const vertices = source.points.map((point, index) => {
    const px = finite(point[0], `position ${index} P(0)`);
    const py = finite(point[1], `position ${index} P(1)`);
    const uv = uvByPoint[index];
    if (!uv) throw new Error(`Evaluated point ${index} has no UV`);
    const column = index % dense.columns;
    const row = Math.floor(index / dense.columns);
    const x = px + 0.5;
    const y = 0.5 - py;
    const u = uv[0];
    const v = 1 - uv[1];
    for (const [value, label] of [[x, `position ${index} x`], [y, `position ${index} y`], [u, `UV ${index} u`], [v, `UV ${index} v`]]) {
      if (value < -1 || value > 2) throw new Error(`${label} is outside safe extent [-1, 2]`);
    }
    return { s: column / (dense.columns - 1), t: 1 - row / (dense.rows - 1), x, y, u, v };
  });
  const triangles = [];
  for (const [a, b, c, d] of quads) {
    const addTriangle = (first, second, third) => {
      const p = vertices[first]; const q = vertices[second]; const r = vertices[third];
      const area = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
      if (!Number.isFinite(area) || area === 0) throw new Error("Evaluated topology contains a degenerate triangle");
      if (area > 0) triangles.push(first, second, third); else triangles.push(first, third, second);
    };
    addTriangle(a, b, d);
    addTriangle(b, c, d);
  }
  return { version: 1, type: "tdMesh", side: input.side, width: input.width, height: input.height, origin: "top-left", logicalGrid, denseGrid: dense, vertices, triangles };
}

export function stableJson(value) { return `${JSON.stringify(value)}\n`; }
export function sha256(value) { return crypto.createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex"); }

export function convertFile(inputPath, outputPath) {
  const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const evaluatedPath = inputPath.replace(/-raw\.json$/i, "-evaluated-mesh.json");
  if (!input.evaluatedMesh && fs.existsSync(evaluatedPath)) input.evaluatedMesh = JSON.parse(fs.readFileSync(evaluatedPath, "utf8"));
  const mesh = convertTdStonerExport(input);
  fs.writeFileSync(outputPath, stableJson(mesh), "utf8");
  return mesh;
}

if (process.argv[1] && process.argv[1].endsWith("convert-td-stoner-export.mjs") && process.argv.length >= 4) convertFile(process.argv[2], process.argv[3]);

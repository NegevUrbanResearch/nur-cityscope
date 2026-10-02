import fs from "node:fs";
import crypto from "node:crypto";

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

export function logicalGridFromTopology(text) {
  if (typeof text !== "string" || !text.trim()) throw new Error("Stoner logical topology is missing");
  const lines = text.replace(/\r/g, "").split("\n").filter((line) => line.trim());
  const headers = lines[0].split("\t").map((value) => value.trim());
  const required = ["index", "rIndex", "l", "r", "t", "b"];
  if (headers.some((header) => !header) || new Set(headers).size !== headers.length || required.some((key) => !headers.includes(key))) {
    throw new Error("Stoner logical topology has unsupported headers");
  }
  const positions = Object.fromEntries(required.map((key) => [key, headers.indexOf(key)]));
  const records = lines.slice(1).map((line) => {
    const cells = line.split("\t");
    if (cells.length !== headers.length) throw new Error("Stoner logical topology has an invalid row width");
    const record = {};
    for (const key of required) {
      const value = cells[positions[key]].trim();
      if (!/^[+-]?[0-9]+$/.test(value)) throw new Error("Stoner logical topology requires integer IDs and neighbors");
      const number = Number(value);
      if (!Number.isSafeInteger(number)) throw new Error("Stoner topology IDs exceed the safe integer range");
      record[key] = number;
    }
    return record;
  }).sort((a, b) => a.index - b.index);
  const count = records.length;
  if (count < 4 || count > 65536) throw new Error("Stoner logical topology has an unsupported point count");
  if (records.some((record, index) => record.index !== index)) throw new Error("Stoner logical indexes must cover every point exactly once");
  if (new Set(records.map(({ rIndex }) => rIndex)).size !== count || records.some(({ rIndex }) => rIndex < 0)) {
    throw new Error("Stoner lattice indexes must be unique and nonnegative");
  }
  if (records.some((record) => ["l", "r", "t", "b"].some((key) => record[key] < -1))) {
    throw new Error("Stoner neighbor IDs must be >= -1");
  }
  const columns = records.filter((record) => record.b === -1).length;
  const rows = records.filter((record) => record.l === -1).length;
  if (columns < 2 || rows < 2 || columns * rows !== count) throw new Error("Stoner logical topology is not a supported rectangular grid");
  records.forEach((record, index) => {
    const expectedAbsent = {
      l: index % columns === 0,
      r: index % columns === columns - 1,
      b: Math.floor(index / columns) === 0,
      t: Math.floor(index / columns) === rows - 1,
    };
    if (Object.entries(expectedAbsent).some(([key, absent]) => (record[key] === -1) !== absent)) {
      throw new Error("Stoner logical boundary pattern is inconsistent");
    }
  });
  return { columns, rows };
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite numeric data`);
  return number;
}

export function convertTdStonerExport(input) {
  if (!input || typeof input !== "object") throw new Error("TD export must be an object");
  const side = input.side;
  if (side !== "left" && side !== "right") throw new Error(`Unknown TD export side: ${side}`);
  const derived = logicalGridFromTopology(input.tables?.topology);
  if (Object.hasOwn(input, "logicalGrid") && (!input.logicalGrid || typeof input.logicalGrid !== "object" || Array.isArray(input.logicalGrid))) {
    throw new Error(`${side} logical grid metadata is malformed`);
  }
  const logicalGrid = input.logicalGrid === undefined ? derived : input.logicalGrid;
  if (!Number.isInteger(logicalGrid.columns) || !Number.isInteger(logicalGrid.rows)
      || logicalGrid.columns < 2 || logicalGrid.rows < 2 || logicalGrid.columns * logicalGrid.rows > 65536
      || logicalGrid.columns !== derived.columns || logicalGrid.rows !== derived.rows) {
    throw new Error(`${side} logical grid metadata disagrees with captured topology`);
  }
  if (input.width !== 1920 || input.height !== 1080) throw new Error("TD export dimensions must be 1920x1080");
  validateCapture(input);
  if (!Array.isArray(input.evaluatedMesh?.points) || !Array.isArray(input.evaluatedMesh?.primitives)) throw new Error("TD export is missing evaluated mesh geometry");
  return convertEvaluatedMesh(input, logicalGrid);
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

function convertEvaluatedMesh(input, logicalGrid) {
  const source = input.evaluatedMesh;
  const pointCount = source.points.length;
  if (pointCount < 4 || pointCount > 65536 || source.primitives.length === 0) throw new Error("Evaluated topology must contain 4..65536 points and quads");
  const first = source.primitives[0];
  if (!Array.isArray(first) || first.length !== 4 || Number(first[0]?.point) !== 0 || Number(first[1]?.point) !== 1) {
    throw new Error("Evaluated topology must begin with the canonical rectangular grid quad");
  }
  const columns = Number(first[3]?.point);
  if (!Number.isInteger(columns) || columns < 2 || Number(first[2]?.point) !== columns + 1 || pointCount % columns !== 0 || pointCount / columns < 2) {
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
    const perimeter = [min, min + 1, min + columns + 1, min + columns];
    const expectedPoints = new Set(perimeter);
    if (new Set(points).size !== 4 || points.some((point) => !expectedPoints.has(point))) {
      throw new Error("Evaluated topology quad must contain four distinct corners of one grid cell");
    }
    const isCyclicPerimeter = [1, -1].some((direction) => perimeter.some((_, start) =>
      points.every((point, index) => point === perimeter[(start + direction * index + perimeter.length * 2) % perimeter.length])));
    if (!isCyclicPerimeter) throw new Error("Evaluated topology quad corners are not in cyclic perimeter order");
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
      let ids = [first, second, third];
      const signedArea = (p, q, r, a, b) => (q[a] - p[a]) * (r[b] - p[b]) - (q[b] - p[b]) * (r[a] - p[a]);
      const sourceArea = signedArea(...ids.map((id) => vertices[id]), "s", "t");
      if (!Number.isFinite(sourceArea) || sourceArea === 0) throw new Error("TD source triangle is degenerate");
      if (sourceArea < 0) ids = [first, third, second];
      const destinationArea = signedArea(...ids.map((id) => vertices[id]), "x", "y");
      if (!(destinationArea > 1e-5)) throw new Error("TD destination triangle is folded or degenerate");
      triangles.push(...ids);
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

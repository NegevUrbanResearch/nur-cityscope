import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";
import {
  NOVA_ESCAPE_INDEX_SCHEMA_VERSION,
  encodeNovaEscapeIndex,
  parseNovaEscapeIndex,
} from "../../frontend/src/shared/nli-nova-escape-index.js";
import { buildNovaEscapeIndex } from "../../scripts/generate-nova-escape-index.mjs";

const repoDir = fileURLToPath(new URL("../..", import.meta.url));
const generatorPath = path.join(repoDir, "scripts", "generate-nova-escape-index.mjs");

const polygon = (id, minX, maxX, minY = -1, maxY = 1) => ({
  type: "Feature",
  properties: { OBJECTID: id },
  geometry: {
    type: "Polygon",
    coordinates: [[[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]]],
  },
});

const line = (id, coordinates) => ({
  type: "Feature",
  properties: { OBJECTID: id },
  geometry: { type: "LineString", coordinates },
});

const collection = (features) => ({ type: "FeatureCollection", features });

describe("Nova escape index format", () => {
  test("encodes sorted, compact tuples and round-trips them", () => {
    const encoded = encodeNovaEscapeIndex({
      routeIds: ["2", "1"],
      parallelCrossingIndex: new Map([
        ["2:line:68", 0.75],
        ["1:polygon:19", 0.25],
      ]),
      settlementContacts: [{ routeId: "2", outlineObjectId: "18", u: 0.6 }],
    });

    expect(encoded).toEqual({
      schemaVersion: 1,
      routeIds: ["1", "2"],
      parallelCrossings: [
        ["1", "polygon", "19", 0.25],
        ["2", "line", "68", 0.75],
      ],
      settlementCrossings: [["2", "18", 0.6]],
    });
    const parsed = parseNovaEscapeIndex(encoded, [1, 2]);
    expect(parsed).toEqual({
      crossingIndex: new Map([
        ["1:polygon:19", 0.25],
        ["2:line:68", 0.75],
      ]),
      settlementContacts: [{ routeId: "2", outlineObjectId: "18", u: 0.6 }],
    });
  });

  test("sorts parallel rows by route, kind, feature, then progress", () => {
    const encoded = encodeNovaEscapeIndex({
      routeIds: ["10", "2", "1"],
      parallelCrossingIndex: new Map([
        ["2:polygon:9", 0.8],
        ["1:line:10", 0.2],
        ["1:line:2", 0.7],
        ["1:polygon:2", 0.4],
        ["1:polygon:20", 0.1],
      ]),
      settlementContacts: [],
    });
    expect(encoded.routeIds).toEqual(["1", "10", "2"]);
    expect(encoded.parallelCrossings).toEqual([
      ["1", "line", "10", 0.2],
      ["1", "line", "2", 0.7],
      ["1", "polygon", "2", 0.4],
      ["1", "polygon", "20", 0.1],
      ["2", "polygon", "9", 0.8],
    ]);
  });

  test.each([
    ["wrong schema", { schemaVersion: 2 }],
    ["missing route IDs", { schemaVersion: 1, routeIds: null }],
    ["duplicate route IDs", { schemaVersion: 1, routeIds: ["1", 1] }],
    ["unknown crossing route", { schemaVersion: 1, routeIds: ["1"], parallelCrossings: [["2", "line", "3", 0.2]], settlementCrossings: [] }],
    ["unknown crossing kind", { schemaVersion: 1, routeIds: ["1"], parallelCrossings: [["1", "ring", "3", 0.2]], settlementCrossings: [] }],
    ["string progress", { schemaVersion: 1, routeIds: ["1"], parallelCrossings: [["1", "line", "3", "0.2"]], settlementCrossings: [] }],
    ["out of range progress", { schemaVersion: 1, routeIds: ["1"], parallelCrossings: [["1", "line", "3", 1.1]], settlementCrossings: [] }],
  ])("rejects %s", (_name, raw) => {
    expect(parseNovaEscapeIndex(raw, ["1"])).toBeNull();
  });

  test("rejects non-finite, empty, and duplicate IDs during encoding", () => {
    expect(() => encodeNovaEscapeIndex({ routeIds: ["", "1"], parallelCrossingIndex: new Map(), settlementContacts: [] })).toThrow();
    expect(() => encodeNovaEscapeIndex({ routeIds: [1, "1"], parallelCrossingIndex: new Map(), settlementContacts: [] })).toThrow();
    expect(() => encodeNovaEscapeIndex({ routeIds: [Infinity], parallelCrossingIndex: new Map(), settlementContacts: [] })).toThrow();
  });

  test("rejects duplicate settlement contacts during encoding", () => {
    expect(() => encodeNovaEscapeIndex({
      routeIds: ["1"],
      parallelCrossingIndex: new Map(),
      settlementContacts: [
        { routeId: "1", outlineObjectId: "18", u: 0.2 },
        { routeId: "1", outlineObjectId: "18", u: 0.8 },
      ],
    })).toThrow();
  });

  test("rejects whitespace-only crossing feature IDs during encoding", () => {
    expect(() => encodeNovaEscapeIndex({
      routeIds: ["1"],
      parallelCrossingIndex: new Map([["1:line:   ", 0.2]]),
      settlementContacts: [],
    })).toThrow();
  });
});

describe("Nova escape index generator", () => {
  test("builds exact polygon, line, and settlement tuples from numeric OBJECTIDs", () => {
    const routes = collection([line(2, [[0, 0], [10, 0]]), line(1, [[0, 0], [10, 0]])]);
    const polygons = collection([polygon(19, 4, 6)]);
    const lines = collection([line(68, [[7, -1], [7, 1]])]);
    const settlements = collection([polygon(18, 2, 4), polygon(100, -1, 1)]);
    expect(buildNovaEscapeIndex({ routes, polygons, lines, settlements })).toEqual({
      schemaVersion: NOVA_ESCAPE_INDEX_SCHEMA_VERSION,
      routeIds: ["1", "2"],
      parallelCrossings: [
        ["1", "line", "68", 0.7],
        ["1", "polygon", "19", 0.4],
        ["2", "line", "68", 0.7],
        ["2", "polygon", "19", 0.4],
      ],
      settlementCrossings: [
        ["1", "18", 0.2],
        ["2", "18", 0.2],
      ],
    });
  });

  test.each([
    ["missing", undefined],
    ["boolean", true],
    ["object", { route: 1 }],
  ])("rejects %s raw route IDs in the generator", (_label, routeId) => {
    expect(() => buildNovaEscapeIndex({
      routes: collection([line(routeId, [[0, 0], [10, 0]])]),
      polygons: collection([]),
      lines: collection([]),
      settlements: collection([]),
    })).toThrow();
  });

  test("CLI writes newline-terminated output, rejects invalid input, and is import-safe", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nova-index-"));
    const inputPaths = [
      ["routes", collection([line(1, [[0, 0], [10, 0]])])],
      ["polygons", collection([polygon(19, 4, 6)])],
      ["lines", collection([line(68, [[7, -1], [7, 1]])])],
      ["settlements", collection([polygon(18, 2, 4)])],
    ].map(([name, value]) => {
      const file = path.join(tempDir, `${name}.geojson`);
      fs.writeFileSync(file, JSON.stringify(value));
      return file;
    });
    const output = path.join(tempDir, "impacts.json");
    const result = spawnSync(process.execPath, ["--experimental-detect-module", generatorPath, ...inputPaths, output], {
      cwd: repoDir,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(fs.readFileSync(output, "utf8").endsWith("\n")).toBe(true);

    const missing = spawnSync(process.execPath, ["--experimental-detect-module", generatorPath, ...inputPaths.slice(0, 3), path.join(tempDir, "missing.geojson"), path.join(tempDir, "missing-output.json")], { cwd: repoDir, encoding: "utf8" });
    expect(missing.status).not.toBe(0);
    expect(fs.existsSync(path.join(tempDir, "missing-output.json"))).toBe(false);

    const invalid = path.join(tempDir, "invalid.geojson");
    fs.writeFileSync(invalid, JSON.stringify({ type: "Feature", properties: {}, geometry: null }));
    const invalidOutput = path.join(tempDir, "invalid-output.json");
    const invalidResult = spawnSync(process.execPath, ["--experimental-detect-module", generatorPath, ...inputPaths.slice(0, 2), inputPaths[2], invalid, invalidOutput], { cwd: repoDir, encoding: "utf8" });
    expect(invalidResult.status).not.toBe(0);
    expect(fs.existsSync(invalidOutput)).toBe(false);
    expect(spawnSync(process.execPath, ["--experimental-detect-module", "-e", `import(${JSON.stringify(pathToFileURL(generatorPath).href)})`], { cwd: repoDir, encoding: "utf8" }).status).toBe(0);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

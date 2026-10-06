import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "td-variable-grid.json");
const fixtures = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

export function variableTdCapture(side) {
  const fixture = fixtures[side];
  if (!fixture) throw new Error(`Unknown fixture side: ${side}`);
  return structuredClone(fixture.capture);
}

export function variableTdMesh(side) {
  const fixture = fixtures[side];
  if (!fixture) throw new Error(`Unknown fixture side: ${side}`);
  return structuredClone(fixture.expectedMesh);
}

export function variableTdBaseline(side) {
  const mesh = variableTdMesh(side);
  const assets = Object.fromEntries(['left', 'right'].map(output => [output, {
    assetId: `fixture-${output}`, path: `${output}.json`, sha256: 'a'.repeat(64),
    logicalGrid: variableTdMesh(output).logicalGrid, width: 1920, height: 1080, origin: 'top-left',
  }]));
  return { mesh, baseline: { type: 'tdMesh', assetId: assets[side].assetId, sha256: assets[side].sha256,
    width: 1920, height: 1080, origin: 'top-left' },
  manifest: { schemaVersion: 1, width: 1920, height: 1080, assets,
    framing: { path: 'framing.json', sha256: 'b'.repeat(64) } } };
}

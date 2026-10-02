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

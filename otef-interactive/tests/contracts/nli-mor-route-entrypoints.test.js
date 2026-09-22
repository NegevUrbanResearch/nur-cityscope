import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

function source(name) {
  return fs.readFileSync(path.resolve(import.meta.dirname, `../../frontend/src/entries/${name}`), "utf8");
}

describe("Mor route entrypoints", () => {
  for (const entry of ["map-main.js", "projection-main.js"]) {
    test(`${entry} mounts and restores the shared route coordinator`, () => {
      const code = source(entry);
      expect(code).toMatch(/import \{ createMorRouteCoordinator \} from "\.\.\/shared\/nli-mor-route-coordinator\.js"/);
      expect(code).toMatch(/createMorRouteCoordinator\(\{[\s\S]*?map,[\s\S]*?dataContext: OTEFDataContext,[\s\S]*?profile: "(?:gis|projection)"/);
      expect(code).toMatch(/morRouteCoordinator\?\.onStyleLoad\?\.\(/);
      expect(code).toMatch(/morRouteCoordinator\?\.dispose\?\.\(/);
    });
  }
});

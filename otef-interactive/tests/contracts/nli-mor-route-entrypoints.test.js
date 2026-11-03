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
      if (entry === "map-main.js") {
        expect(code).toContain("void sceneBinding.onStyleLoad()");
        expect(code).toMatch(/narrativeController, escapeCoordinator: novaEscapeCoordinator, morCoordinator/);
        const binding = fs.readFileSync(path.resolve(import.meta.dirname, "../../frontend/src/shared/nli-scene-display-binding.js"), "utf8");
        expect(binding).toContain("morCoordinator?.resetStyle?.()");
        expect(binding).toContain("morCoordinator?.applySnapshot?.(snapshot, options)");
      } else expect(code).toMatch(/morRouteCoordinator\?\.onStyleLoad\?\.\(/);
      expect(code).toMatch(/morRouteCoordinator\?\.dispose\?\.\(/);
    });
  }
});

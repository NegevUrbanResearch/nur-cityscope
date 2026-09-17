import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("projection Nova marker filter wiring", () => {
  test("filters people synchronously immediately after projection layer sync", () => {
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../frontend/src/entries/projection-main.js"),
      "utf8",
    );
    expect(source).toMatch(
      /function syncProjectionLayersWithNarrative\(targetMap, groups, options\) \{\s*syncProjectionLayers\(targetMap, groups, options\);\s*applyNarrativePeopleFilter\(targetMap, OTEFDataContext\.getNarrativeState\?\.\(\)\?\.id \?\? null\);\s*\}/,
    );
  });
});

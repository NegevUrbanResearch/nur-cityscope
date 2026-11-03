import { describe, it, expect } from "vitest";
import path from "node:path";
import { readFileSync } from "node:fs";

describe("pink node order GIS loader contract", () => {
  it("loader imports shared readPinkNodeOrder; helper references pink_node_order", () => {
    const loaderPath = path.resolve(
      __dirname,
      "../../frontend/src/map/maplibre-curated-layer-loader.js",
    );
    const helperPath = path.resolve(
      __dirname,
      "../../frontend/src/map-utils/pink-node-order.js",
    );
    const loaderSrc = readFileSync(loaderPath, "utf8");
    const helperSrc = readFileSync(helperPath, "utf8");
    expect(loaderSrc).toContain("readPinkNodeOrder");
    const hits =
      (loaderSrc.match(/pink_node_order/g) || []).length +
      (helperSrc.match(/pink_node_order/g) || []).length;
    expect(hits).toBeGreaterThanOrEqual(1);
  });
});

import { readFileSync } from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

const REPO = path.resolve(__dirname, "../..");
const loaderPath = path.join(
  REPO,
  "frontend/src/map/maplibre-curated-layer-loader.js",
);
const layerStatePath = path.join(
  REPO,
  "frontend/src/map/maplibre-layer-manager.js",
);

describe("pack vs curated coexistence (no auto-disable)", () => {
  it("curated loader never references pack-disable tokens", () => {
    const loader = readFileSync(loaderPath, "utf8");
    expect(loader).not.toContain("disableFuture");
    expect(loader).not.toContain("hidePackPink");
  });

  it("layer-state-manager never ties curated load to hiding pack pink", () => {
    const src = readFileSync(layerStatePath, "utf8");
    expect(src).not.toContain("hidePackPink");
    expect(src).not.toContain("disableFuture");
  });
});

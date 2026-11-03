import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolvedColorsToLegendFill } from "../../frontend/src/shared/nli-investigation-legend.js";

describe("nli investigation legend", () => {
  it("converts processed gradient colors and opacity into nested swatches", () => {
    expect(
      resolvedColorsToLegendFill(
        ["#ffff73", "#ffff73", "#ffff73", "#ffff73", "#ffff73"],
        [0.14, 0.27, 0.46, 0.68, 1],
      ),
    ).toBe([
      "linear-gradient(rgba(255, 255, 115, 1) 0 0) center / 20% 20% no-repeat",
      "linear-gradient(rgba(255, 255, 115, 0.68) 0 0) center / 40% 40% no-repeat",
      "linear-gradient(rgba(255, 255, 115, 0.46) 0 0) center / 60% 60% no-repeat",
      "linear-gradient(rgba(255, 255, 115, 0.27) 0 0) center / 80% 80% no-repeat",
      "linear-gradient(rgba(255, 255, 115, 0.14) 0 0) center / 100% 100% no-repeat",
    ].join(", "));
  });

  it("keeps legacy color-only swatches and safely ignores malformed opacity metadata", () => {
    expect(resolvedColorsToLegendFill(["#111111", "#222222"])).toContain("#111111");
    expect(resolvedColorsToLegendFill(["#111111", "#222222"], [0.2])).toContain("#111111");
    expect(resolvedColorsToLegendFill(["#111111", "#222222"], [0.2, "0.8"])).toContain("#111111");
  });

});

const here = path.dirname(fileURLToPath(import.meta.url));

describe("nli investigation legend wiring", () => {
  it("does not mount #nliInvestigationLegend overlay from GIS or projection entries", () => {
    const mapMain = readFileSync(path.resolve(here, "../../frontend/src/entries/map-main.js"), "utf8");
    const projectionMain = readFileSync(path.resolve(here, "../../frontend/src/entries/projection-main.js"), "utf8");
    const projectionHtml = readFileSync(path.resolve(here, "../../frontend/projection.html"), "utf8");
    expect(mapMain).not.toContain("mountNliInvestigationLegend");
    expect(projectionMain).not.toContain("mountNliInvestigationLegend");
    expect(mapMain).toMatch(/installMapLegendLifecycle\(\{[\s\S]*?surface:\s*"gis"/);
    expect(projectionMain).toMatch(/installMapLegendLifecycle\(\{[\s\S]*?surface:\s*"projection"/);
    expect(projectionHtml).toContain('id="mapLegend"');
  });

  it("refreshes the mounted legends when the narrative changes", () => {
    const integration = readFileSync(path.resolve(here, "../../frontend/src/map/legend-integration.js"), "utf8");
    const builder = readFileSync(path.resolve(here, "../../frontend/src/map/legend-model-builder.js"), "utf8");
    expect(integration).toContain('"narrativeState"');
    expect(builder).toMatch(/getNarrativeState/);
    expect(builder).toMatch(/narrativeId/);
  });

  it("does not style #nliInvestigationLegend as a second overlay HUD", () => {
    const css = readFileSync(path.resolve(here, "../../frontend/css/styles.css"), "utf8");
    expect(css).not.toMatch(/#nliInvestigationLegend\s*\{/);
  });
});

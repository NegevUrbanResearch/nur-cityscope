import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NLI_VISUAL_TOKENS } from "../../frontend/src/shared/nli-investigation-theme.js";
import {
  investigationPolygonLegendItems,
  polygonGroupEnabled,
} from "../../frontend/src/shared/nli-investigation-legend.js";

describe("nli investigation legend", () => {
  it("builds three short Hebrew polygon items from category fill tokens", () => {
    const items = investigationPolygonLegendItems();
    expect(items).toHaveLength(3);
    expect(items.map((item) => item.label)).toEqual(["קרב", "חטיפה", "שריפה"]);
    expect(items.map((item) => item.fill)).toEqual([
      NLI_VISUAL_TOKENS.polygonCategories["מרחב לחימה - קרב"].fill,
      NLI_VISUAL_TOKENS.polygonCategories["מוקד חטיפה"].fill,
      NLI_VISUAL_TOKENS.polygonCategories["שריפה"].fill,
    ]);
    expect(items.every((item) => item.shape === "polygon")).toBe(true);
  });

  it("enables when nli.investigation_polygons is on", () => {
    expect(
      polygonGroupEnabled([
        {
          id: "nli",
          layers: [{ id: "investigation_polygons", enabled: true }],
        },
      ]),
    ).toBe(true);
    expect(
      polygonGroupEnabled([
        {
          id: "nli",
          layers: [{ id: "investigation_polygons", enabled: false }],
        },
      ]),
    ).toBe(false);
    expect(polygonGroupEnabled([])).toBe(false);
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
    expect(mapMain).toContain('updateMapLegend({ surface: "gis" })');
    expect(projectionMain).toContain('updateMapLegend({ surface: "projection" })');
    expect(projectionHtml).toContain('id="mapLegend"');
  });

  it("does not style #nliInvestigationLegend as a second overlay HUD", () => {
    const css = readFileSync(path.resolve(here, "../../frontend/css/styles.css"), "utf8");
    expect(css).not.toMatch(/#nliInvestigationLegend\s*\{/);
  });
});

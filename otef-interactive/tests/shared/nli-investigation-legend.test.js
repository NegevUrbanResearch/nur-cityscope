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
  it("builds the authoritative Hebrew labels in battle, fire, kidnapping order", () => {
    const items = investigationPolygonLegendItems();
    expect(items).toHaveLength(3);
    expect(items.map((item) => item.label)).toEqual([
      "מוקד קרב/טבח",
      "מוקד שריפה",
      "מוקד חטיפה",
    ]);
    expect(items.map((item) => item.fill)).toEqual([
      NLI_VISUAL_TOKENS.polygonCategories["מרחב לחימה - קרב"].fill,
      NLI_VISUAL_TOKENS.polygonCategories["שריפה"].fill,
      "#ffff73",
    ]);
    expect(items.every((item) => item.shape === "polygon")).toBe(true);
  });

  it("uses processed class displayLabel and resolved gradient colors", () => {
    const items = investigationPolygonLegendItems({
      renderer: "uniqueValue",
      uniqueValues: {
        field: "Notes",
        classes: [
          {
            value: "מוקד חטיפה",
            displayLabel: "מוקד חטיפה",
            symbol: { symbolLayers: [{ type: "fill", color: "#ffff73" }] },
          },
          {
            value: "שריפה",
            displayLabel: "מוקד שריפה",
            symbol: {
              symbolLayers: [
                { type: "stroke", color: "#a33d12" },
                { type: "fill", fillType: "gradient", resolvedColors: ["#7b5622", "#ffc400"] },
              ],
            },
          },
          {
            value: "מרחב לחימה - קרב",
            displayLabel: "תווית מעובדת לקרב",
            symbol: {
              symbolLayers: [
                { type: "stroke", color: "#2a6b62" },
                { type: "fill", fillType: "gradient", resolvedColors: ["#8e0912", "#fdd1be"] },
              ],
            },
          },
        ],
      },
    });
    expect(items[0].label).toBe("תווית מעובדת לקרב");
    expect(items.slice(1).map((item) => item.label)).toEqual(["מוקד שריפה", "מוקד חטיפה"]);
    expect(items[0].fill).toContain("#8e0912");
    expect(items[0].fill).toContain("#fdd1be");
    expect(items[0].fill).toContain("no-repeat");
    expect(items[0].stroke).toBe("#2a6b62");
    expect(items[1].fill).toContain("#7b5622");
    expect(items[1].fill).toContain("#ffc400");
    expect(items[2].fill).toBe("#ffff73");
  });

  it("uses an explicit transparent stroke when a processed class has no enabled authored stroke", () => {
    const items = investigationPolygonLegendItems({
      renderer: "uniqueValue",
      uniqueValues: {
        field: "Notes",
        classes: [
          {
            value: "מרחב לחימה - קרב",
            displayLabel: "מוקד קרב/טבח",
            symbol: { symbolLayers: [{ type: "fill", fillType: "gradient", resolvedColors: ["#111111"] }] },
          },
          {
            value: "שריפה",
            displayLabel: "מוקד שריפה",
            symbol: { symbolLayers: [{ type: "fill", fillType: "gradient", resolvedColors: ["#222222"] }, { type: "stroke", enable: true, color: "#6e6e6e" }] },
          },
          {
            value: "מוקד חטיפה",
            displayLabel: "מוקד חטיפה",
            symbol: { symbolLayers: [{ type: "fill", color: "#ffff73" }] },
          },
        ],
      },
    });
    expect(items.map((item) => item.stroke)).toEqual(["transparent", "#6e6e6e", "transparent"]);
  });

  it("keeps the fallback category pairs in one explicit ordered array", () => {
    const source = readFileSync(
      path.resolve(here, "../../frontend/src/shared/nli-investigation-legend.js"),
      "utf8",
    );
    expect(source).not.toMatch(/NLI_LEGEND_SHORT_LABELS\s*=\s*Object\.freeze\(\{/);
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

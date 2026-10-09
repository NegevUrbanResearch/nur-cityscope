import { describe, expect, it } from "vitest";
import { beatsForMembership } from "../../frontend/src/shared/nli-investigation-clock.js";
import { HOME_LAYER_IDS, IDENTITY_LAYER_IDS } from "../../frontend/src/remote/nli-staff-script.js";
import { legendLayerFromConfig } from "../../frontend/src/map/legend-model-builder.js";
import { irToMapLibreLayers } from "../../frontend/src/shared/maplibre-style-bridge.js";
import { createInvestigationTimelineData, buildInvestigationSettlementOutlineIdsForFrame } from "../../frontend/src/shared/nli-investigation-timeline-data.js";

const style = { renderer: "uniqueValue", uniqueValues: { field: "Notes", classes: [
  { value: "מרחב לחימה - קרב", symbol: { symbolLayers: [{ type: "fill", color: "#880000" }] } },
  { value: "שריפה", symbol: { symbolLayers: [{ type: "fill", color: "#ff8800" }] } },
  { value: "מוקד חטיפה", symbol: { symbolLayers: [{ type: "fill", color: "#ffff00" }] } },
] } };

describe("NLI exhibit visibility policy", () => {
  it("Identity is Home with markers and without Gaza roads", () => {
    expect(new Set(IDENTITY_LAYER_IDS)).toEqual(new Set([
      "projector_base.שמות_יישובים", "projector_base.Locations_Lines", "projector_base.ישובים",
      "nli.ציר_232", "projector_base.SEA", "gaza.gaza_border", "nli.people",
    ]));
    expect(HOME_LAYER_IDS).toContain("gaza.Gaza_Roads");
  });

  it("removes fire-only beats but retains route and battle events at shared times", () => {
    expect(beatsForMembership(["nli.investigation_polygons", "nli.lines"], {
      polygonFeatures: [
        { properties: { Notes: "שריפה", timeline_minutes: 572 } },
        { properties: { Notes: "שריפה", timeline_minutes: 636 } },
        { properties: { Notes: "מרחב לחימה - קרב", timeline_minutes: 636 } },
        { properties: { Notes: "שריפה", timeline_minutes: 724 } },
      ],
      lineFeatures: [{ properties: { timeline_minutes: 724 } }],
    })).toEqual([636, 724]);
  });

  it.each(["gis", "projection"])("omits fire from the %s legend", (surface) => {
    const result = legendLayerFromConfig({ id: "investigation_polygons", geometryType: "polygon", style },
      { id: "investigation_polygons" }, { fullId: "nli.investigation_polygons", surface });
    expect(result.items.map(item => item.id)).toEqual(["nli.investigation_polygons:מרחב לחימה - קרב", "nli.investigation_polygons:מוקד חטיפה"]);
  });

  it("excludes fire from base polygon layers before the timeline mounts", () => {
    const layers = irToMapLibreLayers("nli.investigation_polygons", "polygons", { geometryType: "polygon", style });
    expect(layers.length).toBeGreaterThan(0);
    for (const layer of layers) expect(JSON.stringify(layer.filter) || "").toContain('["!=",["get","Notes"],"שריפה"]');
  });

  it("fire polygons do not light settlements at a shared battle timestamp", () => {
    const data = createInvestigationTimelineData({
      featuresById: { "nli.investigation_polygons": [
        { properties: { Notes: "שריפה", timeline_minutes: 636, מיקום: "עלומים" } },
        { properties: { Notes: "מרחב לחימה - קרב", timeline_minutes: 636, מיקום: "בארי" } },
      ] },
      locationToOutlineObjectId: { "עלומים": 20, "בארי": 19 }, settlementFeatures: [],
    });
    expect(buildInvestigationSettlementOutlineIdsForFrame(data, { achievedPolygonBeats: [636], routeTimelineEnabled: false }))
      .toEqual(new Set(["19"]));
  });
});

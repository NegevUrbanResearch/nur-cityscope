import { describe, expect, test } from "vitest";
import { irToMapLibreLayers } from "../../frontend/src/shared/maplibre-style-bridge.js";
import {
  GIS_NLI_PEOPLE_POINT_RADIUS_SCALE,
  PROJECTION_NLI_PEOPLE_POINT_RADIUS_SCALE,
  PROJECTION_MAPLIBRE_POINT_RADIUS_SCALE,
} from "../../frontend/src/shared/hatch-projection-presentation.js";
import nliStyles from "../../public/processed/layers/nli/styles.json";

describe("NLI people marker sizing", () => {
  test("uses a slightly smaller GIS radius and a slightly smaller projection radius", () => {
    const gis = irToMapLibreLayers("nli.people", "nli__people", {
      geometryType: nliStyles.people.type,
      style: nliStyles.people,
    });
    const projection = irToMapLibreLayers("nli.people", "nli__people", {
      geometryType: nliStyles.people.type,
      style: nliStyles.people,
    }, { applyProjectionHatchPresentation: true });
    const gisCircle = gis.find((layer) => layer.type === "circle");
    const projectionCircle = projection.find((layer) => layer.type === "circle");
    const baseRadius = 8;

    expect(gisCircle.paint["circle-radius"]).toBeCloseTo(baseRadius * GIS_NLI_PEOPLE_POINT_RADIUS_SCALE);
    expect(projectionCircle.paint["circle-radius"]).toBeCloseTo(
      baseRadius * PROJECTION_MAPLIBRE_POINT_RADIUS_SCALE * PROJECTION_NLI_PEOPLE_POINT_RADIUS_SCALE,
    );
    expect(gisCircle.paint["circle-radius"]).toBeLessThan(baseRadius);
    expect(projectionCircle.paint["circle-radius"]).toBeLessThan(baseRadius * PROJECTION_MAPLIBRE_POINT_RADIUS_SCALE);
  });
});

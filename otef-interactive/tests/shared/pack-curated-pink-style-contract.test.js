import { describe, it, expect, vi } from "vitest";

const { layerRegistryMock } = vi.hoisted(() => ({
  layerRegistryMock: {
    init: vi.fn().mockResolvedValue(undefined),
    getLayerDataUrl: vi.fn(() => null),
    getAllLayerIds: vi.fn(() => []),
    getPackStyleJsonForLayer: vi.fn(() => null),
    getLayerConfig: vi.fn(() => null),
  },
}));

vi.mock("../../frontend/src/shared/layer-registry.js", () => ({
  default: layerRegistryMock,
}));

import { resolvePinkLinePackStyleBundle } from "../../frontend/src/shared/curated-layer-service.js";
import { routeLineStylesForDisplayColor } from "../../frontend/src/map-utils/pink-route-map-styles.js";

describe("pack vs curated pink symbology", () => {
  it("MATCH: pack primary stroke matches curated axisPackLine tokens", async () => {
    const bundle = await resolvePinkLinePackStyleBundle();
    const curated = routeLineStylesForDisplayColor(null);
    expect(bundle.leafletPolylineOptions.color.toUpperCase()).toBe(
      curated.axisPackLine.color.toUpperCase(),
    );
    expect(bundle.leafletPolylineOptions.weight).toBe(curated.axisPackLine.weight);
    expect(bundle.leafletPolylineOptions.opacity).toBe(curated.axisPackLine.opacity);
    expect(bundle.leafletPolylineOptions.lineCap).toBe(curated.axisPackLine.lineCap);
    expect(bundle.leafletPolylineOptions.lineJoin).toBe(curated.axisPackLine.lineJoin);
  });
});

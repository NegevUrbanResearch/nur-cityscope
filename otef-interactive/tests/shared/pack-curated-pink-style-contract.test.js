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
  it("MATCH: pack primary stroke matches curated solidLine tokens", async () => {
    const bundle = await resolvePinkLinePackStyleBundle();
    const curated = routeLineStylesForDisplayColor(null);
    expect(bundle.leafletPolylineOptions.color.toUpperCase()).toBe(
      curated.solidLine.color.toUpperCase(),
    );
    expect(bundle.leafletPolylineOptions.weight).toBe(curated.solidLine.weight);
    expect(bundle.leafletPolylineOptions.opacity).toBe(curated.solidLine.opacity);
    expect(bundle.leafletPolylineOptions.lineCap).toBe(curated.solidLine.lineCap);
    expect(bundle.leafletPolylineOptions.lineJoin).toBe(curated.solidLine.lineJoin);
  });
});

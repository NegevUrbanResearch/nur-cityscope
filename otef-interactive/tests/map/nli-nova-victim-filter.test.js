import { describe, expect, test, vi } from "vitest";
import { applyNovaMarkerFilter } from "../../frontend/src/map/nli-nova-marker-filter.js";

function createMap(layers) {
  const styleLayers = layers.map((layer) => ({ ...layer }));
  return {
    getStyle: vi.fn(() => ({ layers: styleLayers })),
    getLayer: vi.fn((id) => styleLayers.find((layer) => layer.id === id) || null),
    setFilter: vi.fn(),
  };
}

describe("Nova marker filter", () => {
  test("filters only current nli.people layers for Nova", () => {
    const map = createMap([
      { id: "nli-people", source: "nli.people" },
      { id: "nli-people-names", source: "nli.people_names" },
      { id: "unrelated", source: "other" },
    ]);

    expect(applyNovaMarkerFilter(map, "nova")).toBe(1);
    expect(map.setFilter).toHaveBeenCalledTimes(1);
    expect(map.setFilter).toHaveBeenCalledWith("nli-people", ["==", ["get", "location"], "Nova"]);
  });

  test("clears only the victim layer outside Nova", () => {
    const map = createMap([
      { id: "nli-people", source: "nli.people" },
      { id: "nli-people-names", source: "nli.people_names" },
    ]);

    expect(applyNovaMarkerFilter(map, "segev")).toBe(1);
    expect(map.setFilter).toHaveBeenCalledTimes(1);
    expect(map.setFilter).toHaveBeenCalledWith("nli-people", null);
  });

  test("returns zero without setting a filter when the victim layer is absent", () => {
    const map = createMap([
      { id: "nli-people-names", source: "nli.people_names" },
      { id: "unrelated", source: "other" },
    ]);

    expect(applyNovaMarkerFilter(map, "nova")).toBe(0);
    expect(map.setFilter).not.toHaveBeenCalled();
  });
});

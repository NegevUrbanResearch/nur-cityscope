const {
  shouldShowLayerOnGisMap,
  filterGroupsForGisMap,
} = require("../../frontend/js/shared/gis-layer-filter");

describe("gis-layer-filter: shouldShowLayerOnGisMap", () => {
  test("returns false for projector_base when layer is not Tkuma_Area_LIne", () => {
    expect(shouldShowLayerOnGisMap("projector_base", "model_base")).toBe(false);
    expect(shouldShowLayerOnGisMap("projector_base", "other_layer")).toBe(
      false
    );
  });

  test("returns true for projector_base.Tkuma_Area_LIne", () => {
    expect(shouldShowLayerOnGisMap("projector_base", "Tkuma_Area_LIne")).toBe(
      true
    );
  });

  test("returns true for all other groups", () => {
    expect(shouldShowLayerOnGisMap("map_3_future", "mimushim")).toBe(true);
    expect(shouldShowLayerOnGisMap("land_use", "parcels")).toBe(true);
    expect(shouldShowLayerOnGisMap("other_group", "any_layer")).toBe(true);
  });
});

describe("gis-layer-filter: filterGroupsForGisMap", () => {
  test("filters out projector_base layers except Tkuma_Area_LIne", () => {
    const layerGroups = [
      {
        id: "projector_base",
        layers: [
          { id: "model_base", enabled: true },
          { id: "Tkuma_Area_LIne", enabled: true },
        ],
      },
      {
        id: "map_3_future",
        layers: [{ id: "mimushim", enabled: true }],
      },
    ];
    const filtered = filterGroupsForGisMap(layerGroups);
    expect(filtered).toHaveLength(2);
    expect(filtered[0].id).toBe("projector_base");
    expect(filtered[0].layers).toHaveLength(1);
    expect(filtered[0].layers[0].id).toBe("Tkuma_Area_LIne");
    expect(filtered[1].id).toBe("map_3_future");
    expect(filtered[1].layers).toHaveLength(1);
  });

  test("returns empty layers for projector_base when only non-GIS layers", () => {
    const layerGroups = [
      { id: "projector_base", layers: [{ id: "model_base", enabled: true }] },
    ];
    const filtered = filterGroupsForGisMap(layerGroups);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].layers).toHaveLength(0);
  });
});

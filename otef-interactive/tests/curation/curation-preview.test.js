const {
  createCurationPreviewState,
} = require("../../frontend/src/curation/curation");

const curatedServiceModule = require("../../frontend/src/shared/curated-layer-service.js");
const {
  MEMORIAL_ICON_URLS,
  getMemorialIconForFeature,
} = curatedServiceModule;

describe("curation preview state controller", () => {
  test("tracks per-feature layers and visibility", () => {
    const state = createCurationPreviewState();

    const layerA1 = { id: "a1" };
    const layerA2 = { id: "a2" };
    const layerB1 = { id: "b1" };

    state.registerFeatureLayers("f1", [layerA1, layerA2]);
    state.registerFeatureLayers("f2", [layerB1]);

    expect(Array.from(state.featureLayers.keys())).toEqual(["f1", "f2"]);
    expect(state.featureLayers.get("f1")).toEqual([layerA1, layerA2]);
    expect(state.featureLayers.get("f2")).toEqual([layerB1]);

    // By default, features are visible.
    expect(state.getVisibleLayers()).toEqual([layerA1, layerA2, layerB1]);

    // Hiding one feature removes only its layers from the visible set.
    state.setFeatureVisible("f1", false);
    expect(state.getVisibleLayers()).toEqual([layerB1]);

    // Re-enabling restores its layers.
    state.setFeatureVisible("f1", true);
    expect(state.getVisibleLayers()).toEqual([layerA1, layerA2, layerB1]);
  });

  test("clearing preview resets layers, visibility, and highlight", () => {
    const state = createCurationPreviewState();

    state.registerFeatureLayers("f1", [{ id: "a1" }]);
    state.registerFeatureLayers("f2", [{ id: "b1" }]);
    state.setFeatureVisible("f1", false);
    state.highlightFeature("f2");

    expect(state.featureLayers.size).toBe(2);
    expect(state.visibleFeatures.size).toBe(2);
    expect(state.highlightedFeatureId).toBe("f2");

    state.clearPreview();

    expect(state.featureLayers.size).toBe(0);
    expect(state.visibleFeatures.size).toBe(0);
    expect(state.highlightedFeatureId).toBeNull();
    expect(state.getVisibleLayers()).toEqual([]);
  });

  test("highlight state transitions between features", () => {
    const state = createCurationPreviewState();

    state.registerFeatureLayers("f1", [{ id: "a1" }]);
    state.registerFeatureLayers("f2", [{ id: "b1" }]);

    expect(state.highlightedFeatureId).toBeNull();

    state.highlightFeature("f1");
    expect(state.highlightedFeatureId).toBe("f1");

    state.highlightFeature("f2");
    expect(state.highlightedFeatureId).toBe("f2");

    state.highlightFeature(null);
    expect(state.highlightedFeatureId).toBeNull();
  });

  test("memorial helper returns icon URLs for central/local feature types", () => {
    const centralProps = { feature_type: "central" };
    const localProps = { feature_type: "local" };
    const otherProps = { feature_type: "something_else" };

    const centralIcon = getMemorialIconForFeature(centralProps);
    const localIcon = getMemorialIconForFeature(localProps);
    const otherIcon = getMemorialIconForFeature(otherProps);

    expect(centralIcon).toBe(MEMORIAL_ICON_URLS.central);
    expect(localIcon).toBe(MEMORIAL_ICON_URLS.local);
    expect(otherIcon).toBeNull();
  });
});


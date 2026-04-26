import { describe, expect, it, vi } from "vitest";
import MapProjectionConfig from "../../frontend/src/shared/map-projection-config.js";

/**
 * Same predicate as `shouldSkipLiveProjectionRefresh` in projection-main.js (entry not imported in tests).
 * Drives: layerGroups subscription, curated `otef-curated-geojson-refresh` — both skip `applyProjectionRefresh` while true.
 */
function shouldSkipLiveProjectionRefresh(slideshowActive, slideshowConfig) {
  return !!(slideshowActive && slideshowConfig?.ignoreLiveLayerUpdatesWhileActive);
}

describe("projection slideshow live-update guards (mirrors projection-main)", () => {
  const cfg = MapProjectionConfig.PROJECTION_SLIDESHOW;

  it("skips live refresh when slideshow active and ignoreLiveLayerUpdatesWhileActive", () => {
    const run = vi.fn();
    if (!shouldSkipLiveProjectionRefresh(true, cfg)) {
      run();
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("does not skip when slideshow is inactive (layerGroups / supabase path may run)", () => {
    const run = vi.fn();
    if (!shouldSkipLiveProjectionRefresh(false, cfg)) {
      run();
    }
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not skip when config disables ignore flag even if 'active'", () => {
    const run = vi.fn();
    if (!shouldSkipLiveProjectionRefresh(true, { ...cfg, ignoreLiveLayerUpdatesWhileActive: false })) {
      run();
    }
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("after stop: inactive refresh runs — documents resync after slideshowRuntime.stop()", () => {
    const run = vi.fn();
    let slideshowActive = true;

    const applyProjectionRefresh = () => {
      if (shouldSkipLiveProjectionRefresh(slideshowActive, cfg)) {
        return Promise.resolve();
      }
      run();
      return Promise.resolve();
    };

    void applyProjectionRefresh();
    expect(run).not.toHaveBeenCalled();

    slideshowActive = false;
    void applyProjectionRefresh();
    expect(run).toHaveBeenCalledTimes(1);
  });

  // Same promise chain as projection-main stop handler (then callback runs after stop() settles).
  it("after slideshowRuntime.stop() resolves, applyProjectionRefresh runs once (resync path)", async () => {
    const syncProjectionLayers = vi.fn();
    const applyProjectionRefresh = vi.fn(() => {
      syncProjectionLayers("map", []);
      return Promise.resolve();
    });
    const slideshowRuntime = { stop: vi.fn(() => Promise.resolve()) };

    await slideshowRuntime.stop().then(() => applyProjectionRefresh());

    expect(applyProjectionRefresh).toHaveBeenCalledTimes(1);
    expect(syncProjectionLayers).toHaveBeenCalledTimes(1);
  });
});

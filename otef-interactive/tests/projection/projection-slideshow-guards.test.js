import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import MapProjectionConfig from "../../frontend/src/shared/map-projection-config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

describe("projection-main slideshow overlay wiring", () => {
  it("uses presentation overlay helpers instead of raw live groups for investigation visibility", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../frontend/src/entries/projection-main.js"),
      "utf8",
    );
    expect(src).toContain("resolvePresentationOverlayVisibility");
    expect(src).toContain("suppressInvestigationPlayback");
    expect(src).toContain("idleNliClock");
    expect(src).toContain("getInvestigationClock");
    expect(src).toContain('subscribe("investigationClock"');
    expect(src).toContain("getLastIncomingGroups");
    expect(src).toContain("syncPresentationOverlays");
    expect(src).toMatch(/visibilityLayerGroups:\s*overlayGroups/);
  });

  it("injects nli explainer captionEl and does not use map.getContainer for it", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../frontend/src/entries/projection-main.js"),
      "utf8",
    );
    expect(src).toMatch(/ensureNliExplainerHost\(displayContainer\)/);
    expect(src).toMatch(/captionEl:\s*nliExplainerCaptionEl/);
    expect(src).toMatch(/allowMapCaption:\s*false/);
    expect(src).toMatch(/shouldIgnoreExplainerLayoutStore/);
    expect(src).toMatch(/nli-explainer-overlay/);
    expect(src).toMatch(/NLI_EXPLAINER_LAYOUT_STORAGE_KEY/);
    expect(src).toMatch(/readNliExplainerLayoutStore/);
    const loadIdx = src.indexOf('map.on("load"');
    expect(loadIdx).toBeGreaterThan(-1);
    const afterLoad = src.slice(loadIdx);
    const hostIdx = afterLoad.indexOf("ensureNliExplainerHost");
    const syncIdx = afterLoad.indexOf("syncInvestigationTimelineToMap");
    expect(hostIdx).toBeGreaterThan(-1);
    expect(syncIdx).toBeGreaterThan(hostIdx);
  });

  it("wires clock-only captions without changing Presentation suppression", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../frontend/src/entries/projection-main.js"),
      "utf8",
    );
    expect(src.match(/nliCaptionMode/g)).toHaveLength(1);
    expect(src).toMatch(
      /displayProfile:\s*"projection",\s*nliCaptionMode:\s*"clock-only",\s*motionMode:/,
    );
    expect(src).toMatch(/const overlayClock = presentationActive \? idleNliClock\(clock\) : clock;/);
    expect(src).toContain("shouldSuppressProjectionHighlight");
    expect(src).toContain("syncPresentationOverlays: syncContextFlowAnimations");
  });

  it("GIS map-main does not inject projection caption flags", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../frontend/src/entries/map-main.js"),
      "utf8",
    );
    expect(src).not.toMatch(/nliExplainerCaptionEl/);
    expect(src).not.toMatch(/allowMapCaption:\s*false/);
    expect(src).not.toMatch(/ensureNliExplainerHost/);
  });
});

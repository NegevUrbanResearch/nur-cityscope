import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import MapProjectionConfig from "../../frontend/src/shared/map-projection-config.js";
import { createSlideshowPackRuntime } from "../../frontend/src/shared/slideshow-pack-runtime.js";

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

  it("does not duplicate runtime-owned live restoration after Stop", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../frontend/src/entries/projection-main.js"),
      "utf8",
    );
    expect(src).toContain("syncSlideshowPresentationPoll");
    expect(src).not.toMatch(/\.then\(\(\)\s*=>\s*applyProjectionRefresh\(\)\)/);
  });

  it("keeps projection state synchronized when runtime Stop rejects", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../frontend/src/entries/projection-main.js"),
      "utf8",
    );
    const helperStart = src.indexOf("const syncAfterStop");
    expect(helperStart).toBeGreaterThanOrEqual(0);
    const stopStart = src.indexOf('if (msg.type === "stop")', helperStart);
    expect(stopStart).toBeGreaterThanOrEqual(0);
    const stopBlock = src.slice(helperStart, src.indexOf("registerDisposer", stopStart));
    const catchStart = stopBlock.indexOf(".catch");
    expect(catchStart).toBeGreaterThanOrEqual(0);
    const stopCatch = stopBlock.slice(catchStart);
    expect(stopBlock).toContain("const syncAfterStopFailure = () =>");
    expect(src).toContain("syncPresentationFlag();");
    expect(src).toContain("syncSlideshowPresentationPoll");
    expect(src).toContain("syncProjectionHighlight(lastViewport);");
    expect(stopCatch).toContain("syncAfterStopFailure");
    expect(stopCatch).not.toContain("syncAfterStop();");
  });

  it("continues lifecycle cleanup after a rejected runtime Stop without resyncing overlays", async () => {
    vi.useFakeTimers();
    const overlays = [];
    const restoreFailure = new Error("live restoration failed");
    const runtime = createSlideshowPackRuntime({
      config: { intervalMs: 100, packOrder: ["nli"] },
      getEffectiveLayerGroups: () => [
        { id: "nli", layers: [{ id: "lines", enabled: true }] },
      ],
      syncProjectionLayers: vi.fn(),
      applyProjectionRefresh: vi.fn((options) => {
        if (options && Object.prototype.hasOwnProperty.call(options, "groupsOverride")) {
          return Promise.resolve();
        }
        return Promise.reject(restoreFailure);
      }),
      syncPresentationOverlays: (groups) => overlays.push(groups),
      map: null,
    });
    const syncPresentationFlag = vi.fn();
    const syncSlideshowPoll = vi.fn();
    const syncProjectionHighlight = vi.fn();
    const syncContextFlowAnimations = vi.fn();
    const syncAfterStopFailure = () => {
      syncPresentationFlag();
      syncSlideshowPoll();
      syncProjectionHighlight();
    };

    runtime.start();
    await Promise.resolve(runtime.start());
    const committed = runtime.getCommittedGroups();
    expect(committed).not.toBeNull();
    const stopPromise = runtime.stop();
    await expect(stopPromise).rejects.toBe(restoreFailure);
    syncAfterStopFailure();

    expect(runtime.getCommittedGroups()).toBe(committed);
    expect(overlays).toEqual([committed]);
    expect(syncPresentationFlag).toHaveBeenCalledTimes(1);
    expect(syncSlideshowPoll).toHaveBeenCalledTimes(1);
    expect(syncProjectionHighlight).toHaveBeenCalledTimes(1);
    expect(syncContextFlowAnimations).not.toHaveBeenCalled();
  });

  it.each([
    ["rejected effective-group resolution", () => Promise.reject(new Error("groups unavailable"))],
    [
      "zero eligible packs",
      () => [{ id: "pack_a", layers: [{ id: "a", enabled: true }] }],
      ["pack_b"],
      ["pack_a"],
    ],
  ])("resynchronizes projection state when Start ends without activation (%s)", async (_label, getEffectiveLayerGroups, packOrder = ["pack_b"], excludedPresentationPackIds = []) => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../frontend/src/entries/projection-main.js"),
      "utf8",
    );
    const startBlockStart = src.indexOf('if (msg.type === "start")');
    const startBlockEnd = src.indexOf('if (msg.type === "stop")', startBlockStart);
    const startBlock = src.slice(startBlockStart, startBlockEnd);
    expect(startBlock).toContain("const startPromise = slideshowRuntime.start");
    expect(startBlock).toContain("syncAfterStart");
    expect(startBlock).toContain("Promise.resolve(startPromise).then(syncAfterStart, syncAfterStart)");
    expect(src).toContain("const syncAfterStart = () =>");
    expect(src).toContain("syncContextFlowAnimations();");
    expect(src).toContain("syncProjectionHighlight(lastViewport);");

    const runtime = createSlideshowPackRuntime({
      config: { packOrder, excludedPresentationPackIds },
      getEffectiveLayerGroups,
      syncProjectionLayers: vi.fn(),
      map: null,
    });
    const syncProjectionHighlight = vi.fn();
    const syncContextFlowAnimations = vi.fn();
    const syncAfterStart = () => {
      syncContextFlowAnimations();
      syncProjectionHighlight();
    };
    const startPromise = runtime.start();
    syncAfterStart();
    await Promise.resolve(startPromise).then(syncAfterStart, syncAfterStart);
    expect(runtime.shouldSuppressProjectionHighlight()).toBe(false);
    expect(syncProjectionHighlight).toHaveBeenCalledTimes(2);
    expect(syncContextFlowAnimations).toHaveBeenCalledTimes(2);
    warn.mockRestore();
    vi.useRealTimers();
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
    expect(src).toContain("getCommittedGroups");
    expect(src).not.toContain("getLastIncomingGroups");
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
    expect(src).toMatch(/getNliClockLayout/);
    expect(src).toMatch(/setNliClockLayout/);
    expect(src).toMatch(/nliClockLayout/);
    expect(src).toMatch(/nli-explainer-overlay/);
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

  it("GIS map-main injects clock-only caption on nliGisClockHost, not projection explainer", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../frontend/src/entries/map-main.js"),
      "utf8",
    );
    expect(src).not.toMatch(/nliExplainerCaptionEl/);
    expect(src).not.toMatch(/NLI_EXPLAINER_LAYOUT_STORAGE_KEY/);
    expect(src).toMatch(/nliGisClockHost/);
    expect(src).toMatch(/raiseGisClockHost/);
    expect(src).toMatch(/allowMapCaption:\s*false/);
    expect(src).toMatch(/ensureNliExplainerHost/);
    expect(src).toMatch(/nliCaptionMode:\s*"clock-only"/);
    expect(src).toMatch(/NLI_GIS_CLOCK_LAYOUT_STORAGE_KEY/);
  });
});

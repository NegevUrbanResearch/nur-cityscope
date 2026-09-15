import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import { createProjectionNarrativeController } from "../../frontend/src/projection/projection-narrative-controller.js";
import {
  localWidthPtAt,
  tessellateRibbon,
} from "../../frontend/src/shared/maplibre-acrossline-ribbon.js";
import { idleNliClock, playNliClock } from "../../frontend/src/shared/nli-investigation-clock.js";
import { INVESTIGATION_LINES_FULL_ID } from "../../frontend/src/shared/nli-investigation-beats.js";
import {
  disposeInvestigationTimelineForMap,
  syncInvestigationTimelineToMap,
} from "../../frontend/src/shared/maplibre-investigation-timeline.js";
import { DEFAULT_INVESTIGATION_SETTLEMENTS_URL } from "../../frontend/src/shared/nli-investigation-timeline-data.js";
import { createNovaEscapeCoordinator } from "../../frontend/src/shared/nli-nova-escape-coordinator.js";
import * as novaEscapeImpact from "../../frontend/src/shared/nli-nova-escape-impact.js";
import { NOVA_ESCAPE_IMPACT_LAYER_ID } from "../../frontend/src/shared/nli-nova-escape-impact.js";

const INDIVIDUAL_URL = "/otef-interactive/public/processed/layers/nli/fleeing_route.geojson";
const OVERLAP_URL = "/otef-interactive/public/processed/layers/nli/fleeing_route_overlapp.geojson";

const individualCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { OBJECTID: 1 },
      geometry: { type: "LineString", coordinates: [[34.46975, 31.39851], [34.48, 31.41]] },
    },
  ],
};

const overlapCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { OBJECTID: 10, COUNT_: 235 },
      geometry: { type: "LineString", coordinates: [[0, 0], [1, 0]] },
    },
    {
      type: "Feature",
      properties: { OBJECTID: 11, COUNT_: 1 },
      geometry: { type: "LineString", coordinates: [[0, 0], [1, 0]] },
    },
  ],
};

function jsonResponse(data) {
  return {
    ok: true,
    json: async () => data,
  };
}

function createFakeDataContext(initial = {}) {
  let narrative = initial.narrative ?? { id: null };
  let overlay = initial.overlay ?? { individual: false, overlap: false };
  const listeners = {
    narrativeState: new Set(),
    escapeOverlay: new Set(),
  };
  return {
    getNarrativeState: () => narrative,
    getEscapeOverlay: () => overlay,
    setNarrative(next) {
      narrative = next;
      for (const listener of listeners.narrativeState) listener(next);
    },
    setOverlay(next) {
      overlay = next;
      for (const listener of listeners.escapeOverlay) listener(next);
    },
    subscribe(topic, listener) {
      listeners[topic]?.add(listener);
      return () => listeners[topic]?.delete(listener);
    },
  };
}

function setupCoordinator(options = {}) {
  const map = createFakeMapLibreMap();
  map.flushAnimationFrames = (timestamp = Date.now()) => {
    let guard = 0;
    while (map.pendingAnimationFrameCount() && guard < 50) {
      map.driveAnimationFrame(timestamp);
      guard += 1;
    }
  };
  const dataContext = options.dataContext ?? createFakeDataContext();
  const coordinator = createNovaEscapeCoordinator({
    map,
    dataContext,
    profile: options.profile ?? "gis",
    surface: options.surface,
    onParallelImpactIdsChanged: options.onParallelImpactIdsChanged,
  });
  return { map, dataContext, coordinator };
}

function setupProjection() {
  const map = createFakeMapLibreMap();
  map.flyTo = vi.fn();
  map.jumpTo = vi.fn();
  map.easeTo = vi.fn();
  map.setZoom = vi.fn();
  map.setCenter = vi.fn();
  map.setPitch = vi.fn();
  map.setBearing = vi.fn();
  map.fitBounds = vi.fn();
  const controller = createProjectionNarrativeController({ map, syncTimeline: vi.fn() });
  return { map, controller };
}

describe("Nova escape overlay coordinator", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const href = String(url);
      if (href === OVERLAP_URL) return jsonResponse(overlapCollection);
      if (href === INDIVIDUAL_URL) return jsonResponse(individualCollection);
      return jsonResponse({ type: "FeatureCollection", features: [] });
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("adds custom layers only while nova individual is on", async () => {
    const { map, coordinator } = setupCoordinator({
      profile: "projection",
      surface: "projection",
    });
    await coordinator.sync({ id: "nova" }, { individual: true, overlap: false });
    expect(map.getLayer("nli-nova-escape-individual")?.type).toBe("custom");
    expect(map.getLayer("nli-nova-escape-overlap")).toBeFalsy();
  });

  test("GIS surface never mounts fleeing or site-outline layers while nova individual is on", async () => {
    const { coordinator, map } = await setupCoordinator({ profile: "gis", surface: "gis" });
    await coordinator.sync({ id: "nova" }, { individual: true, overlap: true });
    expect(map.getLayer("nli-nova-escape-individual")).toBeFalsy();
    expect(map.getLayer("nli-nova-escape-overlap")).toBeFalsy();
    expect(map.getLayer("nli-nova-escape-impact-outline")).toBeFalsy();
    expect(map.getLayer("nli-nova-site-outline")).toBeFalsy();
    coordinator.dispose();
  });

  test("projection surface remounts ribbons when individual turns on", async () => {
    const { coordinator, map } = await setupCoordinator({
      profile: "projection",
      surface: "projection",
    });
    await coordinator.sync({ id: "nova" }, { individual: true, overlap: false });
    expect(map.getLayer("nli-nova-escape-individual")?.type).toBe("custom");
    expect(map.getLayer("nli-nova-site-outline")).toBeFalsy();
    coordinator.dispose();
  });

  test("fetches exhibit processed URLs, not a Vite-only /processed prefix", async () => {
    const { coordinator } = setupCoordinator({ surface: "projection" });
    await coordinator.sync({ id: "nova" }, { individual: true, overlap: true });
    const urls = fetch.mock.calls.map((call) => String(call[0]));
    expect(urls).toContain("/otef-interactive/public/processed/layers/nli/fleeing_route.geojson");
    expect(urls).toContain("/otef-interactive/public/processed/layers/nli/fleeing_route_overlapp.geojson");
    expect(urls).not.toContain("/processed/layers/nli/fleeing_route.geojson");
    expect(urls).not.toContain("/processed/layers/nli/fleeing_route_overlapp.geojson");
  });

  test("style.load remounts custom layers", async () => {
    const { map, coordinator } = setupCoordinator({ surface: "projection" });
    await coordinator.sync({ id: "nova" }, { individual: true, overlap: true });
    map.wipeStyle();
    await coordinator.onStyleLoad();
    expect(map.getLayer("nli-nova-escape-individual")?.type).toBe("custom");
    expect(map.getLayer("nli-nova-escape-overlap")?.type).toBe("custom");
  });

  test("style wipe remount preserves stagger origin and progress", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { map, coordinator } = await setupCoordinator({
      profile: "projection",
      surface: "projection",
    });
    await coordinator.sync({ id: "nova" }, { individual: true, overlap: false });
    coordinator.debugNoteRibbonDrawable();
    const feature = individualCollection.features[0];
    now += 1500;
    const mid = coordinator.debugFeatureProgress(feature);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    map.wipeStyle();
    await coordinator.onStyleLoad({ styleLoss: true });
    expect(coordinator.debugFeatureProgress(feature)).toBeCloseTo(mid);
    coordinator.dispose();
  });

  test("onStyleLoad without styleLoss does not restart stagger after it has completed", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { coordinator } = setupCoordinator({ surface: "projection" });
    await coordinator.sync({ id: "nova" }, { individual: true, overlap: false });
    coordinator.debugNoteRibbonDrawable();
    now += 8000;
    expect(coordinator.debugFeatureProgress(individualCollection.features[0])).toBe(1);
    await coordinator.onStyleLoad();
    expect(coordinator.debugFeatureProgress(individualCollection.features[0])).toBe(1);
  });

  test("onStyleLoad with styleLoss preserves completed stagger", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { coordinator } = await setupCoordinator({
      profile: "projection",
      surface: "projection",
    });
    await coordinator.sync({ id: "nova" }, { individual: true, overlap: false });
    coordinator.debugNoteRibbonDrawable();
    now += 8000;
    expect(coordinator.debugFeatureProgress(individualCollection.features[0])).toBe(1);
    await coordinator.onStyleLoad({ styleLoss: true });
    expect(coordinator.debugFeatureProgress(individualCollection.features[0])).toBe(1);
    coordinator.dispose();
  });

  test("styleLoss remount initializes stagger when the first individual fetch is still hanging", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const href = String(url);
      await gate;
      if (href === INDIVIDUAL_URL) return jsonResponse(individualCollection);
      return jsonResponse({ type: "FeatureCollection", features: [] });
    }));
    const dataContext = createFakeDataContext({
      narrative: { id: "nova" },
      overlay: { individual: true, overlap: false },
    });
    const { coordinator } = setupCoordinator({
      profile: "projection",
      surface: "projection",
      dataContext,
    });
    await vi.waitFor(() => {
      expect(fetch.mock.calls.length).toBeGreaterThan(0);
    });
    const styleLossPending = coordinator.onStyleLoad({ styleLoss: true });
    release();
    await styleLossPending;
    coordinator.debugNoteRibbonDrawable();
    now += 1500;
    expect(coordinator.debugFeatureProgress(individualCollection.features[0])).toBeGreaterThan(0);
    coordinator.dispose();
  });

  test("after a hanging individual fetch resolves, first reveal progress is ~0 not already 1", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    let individualAttempts = 0;
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const href = String(url);
      if (href === INDIVIDUAL_URL) {
        individualAttempts += 1;
        if (individualAttempts === 1) {
          return { ok: false, status: 503, json: async () => ({}) };
        }
        await gate;
        return jsonResponse(individualCollection);
      }
      return jsonResponse({ type: "FeatureCollection", features: [] });
    }));
    const { coordinator } = setupCoordinator({
      profile: "projection",
      surface: "projection",
    });
    await coordinator.sync({ id: "nova" }, { individual: true, overlap: false });
    now += 20_000;
    const pending = coordinator.sync({ id: "nova" }, { individual: true, overlap: false });
    release();
    await pending;
    expect(coordinator.debugFeatureProgress(individualCollection.features[0])).toBeCloseTo(0);
    coordinator.dispose();
  });

  test("first drawable frame resets reveal origin after tessellation delay", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { coordinator } = setupCoordinator({ surface: "projection" });
    await coordinator.sync({ id: "nova" }, { individual: true, overlap: false });
    now += 3000;
    expect(coordinator.debugFeatureProgress(individualCollection.features[0])).toBeCloseTo(0);
    coordinator.debugNoteRibbonDrawable();
    expect(coordinator.debugFeatureProgress(individualCollection.features[0])).toBeCloseTo(0);
    now += 1500;
    expect(coordinator.debugFeatureProgress(individualCollection.features[0])).toBeGreaterThan(0);
    coordinator.dispose();
  });

  test("prefetches fleeing GeoJSON while Nova is active even if individual is off", async () => {
    const { coordinator } = setupCoordinator({ surface: "projection" });
    await coordinator.sync({ id: "nova" }, { individual: false, overlap: false });
    const urls = fetch.mock.calls.map((call) => String(call[0]));
    expect(urls).toContain(INDIVIDUAL_URL);
    expect(urls).toContain(OVERLAP_URL);
    coordinator.dispose();
  });

  test("individual off then on starts a new reveal", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { coordinator } = await setupCoordinator({
      profile: "projection",
      surface: "projection",
    });
    await coordinator.sync({ id: "nova" }, { individual: true, overlap: false });
    coordinator.debugNoteRibbonDrawable();
    now += 8000;
    expect(coordinator.debugFeatureProgress(individualCollection.features[0])).toBe(1);
    await coordinator.sync({ id: "nova" }, { individual: false, overlap: false });
    await coordinator.sync({ id: "nova" }, { individual: true, overlap: false });
    expect(coordinator.debugFeatureProgress(individualCollection.features[0])).toBeLessThan(1);
    coordinator.dispose();
  });

  test("overlay remount while individual is already playing preserves stagger origin", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { coordinator } = setupCoordinator({ surface: "projection" });
    await coordinator.sync({ id: "nova" }, { individual: true, overlap: false });
    coordinator.debugNoteRibbonDrawable();
    now += 1500;
    const mid = coordinator.debugFeatureProgress(individualCollection.features[0]);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    await coordinator.sync({ id: "nova" }, { individual: true, overlap: true });
    expect(coordinator.debugFeatureProgress(individualCollection.features[0])).toBeCloseTo(mid);
  });

  test("narrative and overlay notifies in the same turn remount once", async () => {
    const dataContext = createFakeDataContext();
    const { map } = setupCoordinator({ dataContext, surface: "projection" });
    const addLayer = vi.spyOn(map, "addLayer");
    dataContext.setNarrative({ id: "nova" });
    dataContext.setOverlay({ individual: true, overlap: false });
    await vi.waitFor(() => {
      expect(map.getLayer("nli-nova-escape-individual")?.type).toBe("custom");
    });
    const siteAdds = addLayer.mock.calls.filter(([layer]) => layer?.id === "nli-nova-site-outline").length;
    expect(siteAdds).toBe(0);
  });

  test("advancing stagger time increases impact features instead of lighting all at once", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const rafQueue = [];
    vi.stubGlobal("requestAnimationFrame", (callback) => {
      rafQueue.push(callback);
      return rafQueue.length;
    });
    vi.stubGlobal("cancelAnimationFrame", (id) => {
      rafQueue[id - 1] = null;
    });
    const path = {
      type: "Feature",
      properties: { OBJECTID: 1 },
      geometry: { type: "LineString", coordinates: [[0, 0], [10, 0]] },
    };
    const square = (minX, maxX, minY = -1, maxY = 1) => ({
      type: "Polygon",
      coordinates: [[[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]]],
    });
    const yeshuv = (id, geometry) => ({
      type: "Feature",
      properties: { OBJECTID: id, outlineObjectId: id },
      geometry,
    });
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const href = String(url);
      if (href === INDIVIDUAL_URL) return jsonResponse({ type: "FeatureCollection", features: [path] });
      if (href === DEFAULT_INVESTIGATION_SETTLEMENTS_URL) {
        return jsonResponse({
          type: "FeatureCollection",
          features: [
            yeshuv(18, square(0.5, 1.5)),
            yeshuv(19, square(8, 10)),
          ],
        });
      }
      return jsonResponse({ type: "FeatureCollection", features: [] });
    }));

    const { map, coordinator } = setupCoordinator({ surface: "projection" });
    await coordinator.sync({ id: "nova" }, { individual: true, overlap: false });
    coordinator.debugNoteRibbonDrawable();
    const impactCount = () => (
      map.getSource(NOVA_ESCAPE_IMPACT_LAYER_ID)?.data?.features?.length ?? 0
    );
    const impactSetDataCalls = () => map.calls.filter((call) => (
      call.method === "setData" && call.id === NOVA_ESCAPE_IMPACT_LAYER_ID
    ));
    expect(impactSetDataCalls()).toHaveLength(0);
    expect(impactCount()).toBe(0);

    const flushRaf = () => {
      const queued = rafQueue.splice(0);
      for (const callback of queued) callback?.(now);
      map.flushAnimationFrames?.(now);
    };
    flushRaf();
    const early = impactCount();
    now += 1500;
    flushRaf();
    const mid = impactCount();
    now += 20_000;
    flushRaf();
    const done = impactCount();

    expect(mid).toBeGreaterThan(early);
    expect(done).toBeGreaterThan(mid);
    expect(done).toBeGreaterThanOrEqual(2);
    coordinator.dispose();
  });

  test("schedules pending impact ticks on global rAF when the map has no requestAnimationFrame", async () => {
    const map = createFakeMapLibreMap();
    map.requestAnimationFrame = undefined;
    map.cancelAnimationFrame = undefined;
    const rafSpy = vi.fn(function requestAnimationFrame(callback) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return 1;
    });
    const cafSpy = vi.fn(function cancelAnimationFrame() {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
    });
    vi.stubGlobal("requestAnimationFrame", rafSpy);
    vi.stubGlobal("cancelAnimationFrame", cafSpy);
    const coordinator = createNovaEscapeCoordinator({
      map,
      dataContext: createFakeDataContext(),
      profile: "gis",
      surface: "projection",
    });
    await expect(coordinator.sync({ id: "nova" }, { individual: true, overlap: false }))
      .resolves.toBeUndefined();
    expect(rafSpy).toHaveBeenCalled();
    await expect(coordinator.onStyleLoad()).resolves.toBeUndefined();
    expect(rafSpy).toHaveBeenCalled();
    coordinator.dispose();
  });

  test("does not use line-gradient paint at rest or mid-reveal", async () => {
    const { map, coordinator } = setupCoordinator({ surface: "projection" });
    await coordinator.sync({ id: "nova" }, { individual: true, overlap: false });
    coordinator.setRevealProgress(0.3);
    expect(JSON.stringify(map.getStyle?.() || map.style)).not.toMatch(/line-gradient|line-progress/);
    expect(map.getLayer("nli-nova-escape-individual")?.type).toBe("custom");
    for (const layer of map.getStyle?.()?.layers || []) {
      if (layer.id === "nli-nova-escape-individual" || layer.id === "nli-nova-escape-overlap") {
        expect(layer.type).toBe("custom");
      }
    }
  });

  test("overlap layer is above individual when both are on", async () => {
    const { map, coordinator } = setupCoordinator({ surface: "projection" });
    await coordinator.sync({ id: "nova" }, { individual: true, overlap: true });
    const ids = map.getStyle().layers.map((layer) => layer.id);
    expect(ids.indexOf("nli-nova-escape-individual"))
      .toBeLessThan(ids.indexOf("nli-nova-escape-overlap"));
  });

  test("overlap COUNT_ 235 tessellates to 4pt at Nova, COUNT_ 1 to 0.5pt", async () => {
    const { coordinator } = setupCoordinator({ surface: "projection" });
    await coordinator.sync({ id: "nova" }, { individual: false, overlap: true });
    const feat235 = coordinator.debugOverlapFeatures().find((f) => f.properties.COUNT_ === 235);
    const feat1 = coordinator.debugOverlapFeatures().find((f) => f.properties.COUNT_ === 1);
    expect(localWidthPtAt(tessellateRibbon(feat235, { count: feat235.properties.COUNT_ }), 0)).toBe(4);
    expect(localWidthPtAt(tessellateRibbon(feat1, { count: feat1.properties.COUNT_ }), 0)).toBe(0.5);
    expect(localWidthPtAt(tessellateRibbon(feat235, { count: feat235.properties.COUNT_ }), 1)).toBe(0);
  });

  test("coordinator source never imports route-progress overlay", () => {
    const src = fs.readFileSync(
      new URL("../../frontend/src/shared/nli-nova-escape-coordinator.js", import.meta.url),
      "utf8",
    );
    expect(src).not.toMatch(/maplibre-route-progress-overlay|line-gradient|line-progress/);
  });

  test("projection apply nova never moves the camera", () => {
    const { map, controller } = setupProjection();
    map.easeTo = vi.fn();
    map.setZoom = vi.fn();
    map.setCenter = vi.fn();
    map.setPitch = vi.fn();
    map.setBearing = vi.fn();
    map.fitBounds = vi.fn();
    controller.apply({ id: "nova", transition: "enter", revision: 1 });
    expect(map.flyTo).not.toHaveBeenCalled();
    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(map.jumpTo).not.toHaveBeenCalled();
    expect(map.easeTo).not.toHaveBeenCalled();
    expect(map.setZoom).not.toHaveBeenCalled();
    expect(map.setCenter).not.toHaveBeenCalled();
    expect(map.setPitch).not.toHaveBeenCalled();
    expect(map.setBearing).not.toHaveBeenCalled();
  });

  test("hydrates from dataContext on construct without waiting for a later notify", async () => {
    const dataContext = createFakeDataContext({
      narrative: { id: "nova" },
      overlay: { individual: true, overlap: false },
    });
    const { map } = setupCoordinator({ dataContext, surface: "projection" });
    await vi.waitFor(() => {
      expect(map.getLayer("nli-nova-escape-individual")?.type).toBe("custom");
    });
  });

  test("subscribe remounts overlays when GIS skip would skip camera travel", async () => {
    const dataContext = createFakeDataContext();
    const { map } = setupCoordinator({ dataContext, surface: "projection" });
    dataContext.setNarrative({ id: "nova" });
    dataContext.setOverlay({ individual: true, overlap: false });
    await vi.waitFor(() => {
      expect(map.getLayer("nli-nova-escape-individual")?.type).toBe("custom");
    });
  });

  test("removes custom layers when narrative is not nova", async () => {
    const { map, coordinator } = setupCoordinator({ surface: "projection" });
    await coordinator.sync({ id: "nova" }, { individual: true, overlap: true });
    await coordinator.sync({ id: "segev" }, { individual: true, overlap: true });
    expect(map.getLayer("nli-nova-escape-individual")).toBeFalsy();
    expect(map.getLayer("nli-nova-escape-overlap")).toBeFalsy();
  });

  test("retries a failed GeoJSON fetch on later remount instead of caching empty", async () => {
    let overlapAttempts = 0;
    const fetchMock = vi.fn(async (url) => {
      const href = String(url);
      if (href === OVERLAP_URL) {
        overlapAttempts += 1;
        if (overlapAttempts === 1) return { ok: false, status: 503, json: async () => ({}) };
        return jsonResponse(overlapCollection);
      }
      if (href === INDIVIDUAL_URL) return jsonResponse(individualCollection);
      return jsonResponse({ type: "FeatureCollection", features: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { map, coordinator } = setupCoordinator({ surface: "projection" });
    await coordinator.sync({ id: "nova" }, { individual: false, overlap: true });
    expect(coordinator.debugOverlapFeatures().find((f) => f.properties.COUNT_ === 235)).toBeFalsy();

    await coordinator.onStyleLoad();
    expect(fetchMock.mock.calls.filter((call) => String(call[0]) === OVERLAP_URL).length)
      .toBeGreaterThanOrEqual(2);
    expect(coordinator.debugOverlapFeatures().find((f) => f.properties.COUNT_ === 235)).toBeTruthy();
    expect(map.getLayer("nli-nova-escape-overlap")?.type).toBe("custom");
  });

  test("setEscapeImpactIds lights שמות and Locations_Lines for the yeshuv, not Reim or polygon 100", async () => {
    const settlementsUrl = DEFAULT_INVESTIGATION_SETTLEMENTS_URL;
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const href = String(url);
      if (href === INDIVIDUAL_URL) return jsonResponse(individualCollection);
      if (href === settlementsUrl) {
        return jsonResponse({
          type: "FeatureCollection",
          features: [
            { type: "Feature", properties: { outlineObjectId: 19, locations: ["בארי"] }, geometry: { type: "Polygon", coordinates: [] } },
            { type: "Feature", properties: { outlineObjectId: 18, locations: ["רעים"] }, geometry: { type: "Polygon", coordinates: [] } },
            { type: "Feature", properties: { outlineObjectId: 100, locations: ["נובה"] }, geometry: { type: "Polygon", coordinates: [] } },
          ],
        });
      }
      return jsonResponse({ type: "FeatureCollection", features: [] });
    }));
    const map = createFakeMapLibreMap({
      layers: [
        { id: "projector_base__שמות_יישובים__labels", type: "symbol", source: "projector_base.שמות_יישובים" },
        { id: "projector_base__Locations_Lines__line__0", type: "line", source: "projector_base.Locations_Lines" },
        { id: "projector_base__ישובים__fill__0", type: "fill", source: "projector_base.ישובים" },
      ],
      sources: {
        "projector_base.שמות_יישובים": {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [
              { type: "Feature", properties: { cityname: "בארי", OBJECTID: 77 }, geometry: { type: "Point", coordinates: [0, 0] } },
              { type: "Feature", properties: { cityname: "רעים", OBJECTID: 88 }, geometry: { type: "Point", coordinates: [1, 1] } },
            ],
          },
        },
      },
    });
    const coordinator = createNovaEscapeCoordinator({
      map,
      dataContext: createFakeDataContext(),
      profile: "gis",
      surface: "projection",
    });
    await coordinator.sync({ id: "nova" }, { individual: true, overlap: false });
    coordinator.setEscapeImpactIds(["19", "100"]);
    expect(map.getPaintProperty("projector_base__שמות_יישובים__labels", "text-opacity"))
      .toEqual(["case", ["in", ["get", "cityname"], ["literal", ["בארי"]]], 1, 0.35]);
    expect(map.getPaintProperty("projector_base__Locations_Lines__line__0", "line-opacity"))
      .toEqual(["case", ["in", ["get", "OBJECTID"], ["literal", [77]]], 1, 0.35]);
    expect(JSON.stringify(map.getPaintProperty("projector_base__שמות_יישובים__labels", "text-opacity")))
      .not.toMatch(/רעים/);
    expect(JSON.stringify(map.getPaintProperty("projector_base__Locations_Lines__line__0", "line-opacity")))
      .not.toMatch(/100|88/);
    coordinator.dispose();
  });

  test("concurrent remounts share one in-flight request per URL", async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn(async (url) => {
      const href = String(url);
      await gate;
      if (href === OVERLAP_URL) return jsonResponse(overlapCollection);
      if (href === INDIVIDUAL_URL) return jsonResponse(individualCollection);
      return jsonResponse({ type: "FeatureCollection", features: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { map, coordinator } = setupCoordinator({ surface: "projection" });
    const first = coordinator.sync({ id: "nova" }, { individual: true, overlap: false });
    const second = coordinator.onStyleLoad();
    const third = coordinator.sync({ id: "nova" }, { individual: true, overlap: false });
    expect(fetchMock.mock.calls.filter((call) => String(call[0]) === INDIVIDUAL_URL)).toHaveLength(1);
    release();
    await Promise.all([first, second, third]);
    expect(fetchMock.mock.calls.filter((call) => String(call[0]) === INDIVIDUAL_URL)).toHaveLength(1);
    expect(map.getLayer("nli-nova-escape-individual")?.type).toBe("custom");
  });

  test("RAF fleeing progress updates projection parallel-impact line ids without injecting ids", async () => {
    vi.useFakeTimers();
    try {
      const fleeing = {
        type: "Feature",
        properties: { OBJECTID: 1 },
        geometry: { type: "LineString", coordinates: [[0, 0], [10, 0]] },
      };
      const infiltration = {
        type: "Feature",
        properties: { OBJECTID: 232, timeline_minutes: 400 },
        geometry: { type: "LineString", coordinates: [[5, -1], [5, 1]] },
      };
      vi.stubGlobal("fetch", vi.fn(async (url) => {
        const href = String(url);
        if (href === INDIVIDUAL_URL) {
          return jsonResponse({ type: "FeatureCollection", features: [fleeing] });
        }
        if (href === "/otef-interactive/public/processed/layers/nli/lines.geojson") {
          return jsonResponse({ type: "FeatureCollection", features: [infiltration] });
        }
        return jsonResponse({ type: "FeatureCollection", features: [] });
      }));
      let parallelImpactIds = new Set();
      const onParallelImpactIdsChanged = vi.fn((ids) => {
        parallelImpactIds = ids instanceof Set ? ids : new Set(ids || []);
      });
      const { coordinator, map } = setupCoordinator({
        profile: "projection",
        surface: "projection",
        onParallelImpactIdsChanged,
      });
      await coordinator.sync({ id: "nova" }, { individual: true, overlap: false });
      coordinator.debugNoteRibbonDrawable();
      await vi.advanceTimersByTimeAsync(8000);
      map.flushAnimationFrames?.();
      expect(parallelImpactIds.has("line:232")).toBe(true);
      expect(parallelImpactIds.has("polygon:100")).toBe(false);
      const at400 = playNliClock(idleNliClock(), [INVESTIGATION_LINES_FULL_ID], [400], 0);
      await syncInvestigationTimelineToMap(map, { ...at400, phase: "paused", seekKind: "none" }, [{
        id: "nli",
        layers: [{ id: "lines", enabled: true }],
      }], {
        featuresById: { [INVESTIGATION_LINES_FULL_ID]: [infiltration] },
        narrativeFocus: { id: "nova" },
        displayProfile: "projection",
        parallelImpactIds,
        motionMode: "reduced",
        now: () => 0,
      });
      const paint = map.getPaintProperty(
        "nli-investigation-line-completed-carrier-line",
        "line-opacity",
      );
      expect(JSON.stringify(paint)).toContain("232");
      expect(JSON.stringify(paint)).toContain("0.28");
      disposeInvestigationTimelineForMap(map);
      coordinator.dispose();
      expect(onParallelImpactIdsChanged).toHaveBeenLastCalledWith([]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("shared OBJECTID lights only the crossed polygon kind, not the uncrossed line", async () => {
    const fleeing = {
      type: "Feature",
      properties: { OBJECTID: 24 },
      geometry: { type: "LineString", coordinates: [[0, 0], [10, 0]] },
    };
    const crossedPolygon = {
      type: "Feature",
      properties: { OBJECTID: 1, timeline_minutes: 500 },
      geometry: {
        type: "Polygon",
        coordinates: [[[8, -1], [10, -1], [10, 1], [8, 1], [8, -1]]],
      },
    };
    const uncrossedLine = {
      type: "Feature",
      properties: { OBJECTID: 1, timeline_minutes: 400 },
      geometry: { type: "LineString", coordinates: [[0, 5], [10, 5]] },
    };
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const href = String(url);
      if (href === INDIVIDUAL_URL) {
        return jsonResponse({ type: "FeatureCollection", features: [fleeing] });
      }
      if (href === "/otef-interactive/public/processed/layers/nli/investigation_polygons.geojson") {
        return jsonResponse({ type: "FeatureCollection", features: [crossedPolygon] });
      }
      if (href === "/otef-interactive/public/processed/layers/nli/lines.geojson") {
        return jsonResponse({ type: "FeatureCollection", features: [uncrossedLine] });
      }
      return jsonResponse({ type: "FeatureCollection", features: [] });
    }));
    let parallelImpactIds = new Set();
    const onParallelImpactIdsChanged = vi.fn((ids) => {
      parallelImpactIds = ids instanceof Set ? ids : new Set(ids || []);
    });
    const { coordinator } = setupCoordinator({
      profile: "projection",
      surface: "projection",
      onParallelImpactIdsChanged,
    });
    await coordinator.sync({ id: "nova" }, { individual: true, overlap: false });
    coordinator.setRevealProgress(1);
    expect(parallelImpactIds.has("polygon:1")).toBe(true);
    expect(parallelImpactIds.has("line:1")).toBe(false);
    expect(parallelImpactIds.has("1")).toBe(false);
    coordinator.dispose();
  });

  test("GIS coordinator never emits parallel-impact ids", async () => {
    const onParallelImpactIdsChanged = vi.fn();
    const { coordinator } = await setupCoordinator({
      profile: "gis",
      surface: "gis",
      onParallelImpactIdsChanged,
    });
    await coordinator.sync({ id: "nova" }, { individual: true, overlap: true });
    expect(onParallelImpactIdsChanged).not.toHaveBeenCalled();
    coordinator.dispose();
  });

  test("GIS map-main does not pass onParallelImpactIdsChanged", () => {
    const src = fs.readFileSync(
      new URL("../../frontend/src/entries/map-main.js", import.meta.url),
      "utf8",
    );
    expect(src).not.toMatch(/onParallelImpactIdsChanged/);
  });

  test("projection parallel-impact callback fires only when the id set changes", async () => {
    const fleeing = {
      type: "Feature",
      properties: { OBJECTID: 1 },
      geometry: { type: "LineString", coordinates: [[0, 0], [10, 0]] },
    };
    const infiltration = {
      type: "Feature",
      properties: { OBJECTID: 232, timeline_minutes: 400 },
      geometry: { type: "LineString", coordinates: [[5, -1], [5, 1]] },
    };
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const href = String(url);
      if (href === INDIVIDUAL_URL) {
        return jsonResponse({ type: "FeatureCollection", features: [fleeing] });
      }
      if (href === "/otef-interactive/public/processed/layers/nli/lines.geojson") {
        return jsonResponse({ type: "FeatureCollection", features: [infiltration] });
      }
      return jsonResponse({ type: "FeatureCollection", features: [] });
    }));
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const crossingSpy = vi.spyOn(novaEscapeImpact, "buildFleeingCrossingIndex");
    const onParallelImpactIdsChanged = vi.fn();
    const { coordinator, map } = setupCoordinator({
      profile: "projection",
      surface: "projection",
      onParallelImpactIdsChanged,
    });
    await coordinator.sync({ id: "nova" }, { individual: true, overlap: false });
    coordinator.debugNoteRibbonDrawable();
    const flush = () => map.flushAnimationFrames?.();
    now = 50;
    flush();
    expect(crossingSpy.mock.calls.length).toBeGreaterThan(0);
    now = 100;
    flush();
    const beforeCross = onParallelImpactIdsChanged.mock.calls.length;
    const afterFirstProgress = crossingSpy.mock.calls.length;
    now = 50_000;
    flush();
    expect(onParallelImpactIdsChanged.mock.calls.length).toBe(beforeCross + 1);
    const afterCross = onParallelImpactIdsChanged.mock.calls.length;
    now = 51_000;
    flush();
    now = 52_000;
    flush();
    expect(onParallelImpactIdsChanged.mock.calls.length).toBe(afterCross);
    expect(crossingSpy.mock.calls.length).toBe(afterFirstProgress);
    coordinator.dispose();
  });

  test("turning individual off clears parallel-impact ids before a hanging site-polygon fetch resolves", async () => {
    const fleeing = {
      type: "Feature",
      properties: { OBJECTID: 1 },
      geometry: { type: "LineString", coordinates: [[0, 0], [10, 0]] },
    };
    const infiltration = {
      type: "Feature",
      properties: { OBJECTID: 232, timeline_minutes: 400 },
      geometry: { type: "LineString", coordinates: [[5, -1], [5, 1]] },
    };
    let releaseHang;
    const hang = new Promise((resolve) => {
      releaseHang = resolve;
    });
    let hangResolved = false;
    let polygonAttempts = 0;
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const href = String(url);
      if (href === "/otef-interactive/public/processed/layers/nli/investigation_polygons.geojson") {
        polygonAttempts += 1;
        if (polygonAttempts === 1) return { ok: false, status: 503, json: async () => ({}) };
        await hang;
        hangResolved = true;
        return jsonResponse({ type: "FeatureCollection", features: [] });
      }
      if (href === INDIVIDUAL_URL) {
        return jsonResponse({ type: "FeatureCollection", features: [fleeing] });
      }
      if (href === "/otef-interactive/public/processed/layers/nli/lines.geojson") {
        return jsonResponse({ type: "FeatureCollection", features: [infiltration] });
      }
      return jsonResponse({ type: "FeatureCollection", features: [] });
    }));
    const onParallelImpactIdsChanged = vi.fn();
    const { coordinator } = setupCoordinator({
      profile: "projection",
      surface: "projection",
      onParallelImpactIdsChanged,
    });
    await coordinator.sync({ id: "nova" }, { individual: true, overlap: false });
    coordinator.setRevealProgress(1);
    const lit = onParallelImpactIdsChanged.mock.calls.at(-1)?.[0];
    expect(lit instanceof Set && lit.has("line:232")).toBe(true);

    const offPending = coordinator.sync({ id: "nova" }, { individual: false, overlap: false });
    const cleared = onParallelImpactIdsChanged.mock.calls.at(-1)?.[0];
    expect(hangResolved).toBe(false);
    expect(cleared instanceof Set ? [...cleared] : cleared).toEqual([]);

    releaseHang();
    await offPending;
    coordinator.dispose();
  });
});

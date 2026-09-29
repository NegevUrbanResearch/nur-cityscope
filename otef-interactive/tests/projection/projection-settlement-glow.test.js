import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, test, vi } from "vitest";
import { PEOPLE_HALO_LAYER_ID } from "../../frontend/src/map/maplibre-person-selection.js";
import { shouldIncludeNarrativeSettlementOutline } from "../../frontend/src/shared/nli-nova-escape-impact.js";
import { NLI_VISUAL_TOKENS } from "../../frontend/src/shared/nli-investigation-theme.js";
import {
  loadSettlementFeatures,
  mergeNovaYeshuvOutlineFeature,
} from "../../frontend/src/shared/nli-investigation-timeline-data.js";
import {
  PROJECTION_SETTLEMENT_GLOW_AURA_LAYER_ID,
  PROJECTION_SETTLEMENT_GLOW_CORE_LAYER_ID,
  PROJECTION_SETTLEMENT_GLOW_SOURCE_ID,
  createProjectionSettlementGlow,
  resolveSettlementGlowFeature,
  settlementAuraPoint,
  settlementGlowBreathScale,
  syncProjectionSettlementGlow,
} from "../../frontend/src/projection/projection-settlement-glow.js";

const poly = (id, locations, ring = [[[34, 31], [34.1, 31], [34.1, 31.1], [34, 31]]]) => ({
  type: "Feature",
  properties: { OBJECTID: id, outlineObjectId: id, locations },
  geometry: { type: "Polygon", coordinates: [ring] },
});
const settlements = {
  type: "FeatureCollection",
  features: [poly(19, ["בארי", "Be'eri"]), poly(43, ["נובה", "Nova"])],
};

const GLOW_IDS = [
  PROJECTION_SETTLEMENT_GLOW_SOURCE_ID,
  PROJECTION_SETTLEMENT_GLOW_AURA_LAYER_ID,
  PROJECTION_SETTLEMENT_GLOW_CORE_LAYER_ID,
];
const LEGACY_GLOW_LAYER_IDS = [
  "projection-settlement-glow-fill",
  "projection-settlement-glow-outer",
  "projection-settlement-glow-inner",
];

describe("resolveSettlementGlowFeature", () => {
  it("resolves outline id and location aliases and misses unknown places", () => {
    expect(resolveSettlementGlowFeature(settlements, { outlineObjectId: 19 }).properties.OBJECTID).toBe(19);
    expect(resolveSettlementGlowFeature(settlements, { locationName: "Nova" }).properties.OBJECTID).toBe(43);
    expect(resolveSettlementGlowFeature(settlements, { locationName: "nova" }).properties.OBJECTID).toBe(43);
    expect(resolveSettlementGlowFeature(settlements, { locationName: "Nowhere" })).toBeNull();
  });

  it("aliases Nova site outline 100 to yeshuv 43 even when 100 is indexed first", () => {
    const withSite = {
      type: "FeatureCollection",
      features: [
        poly(100, ["נובה", "Nova"]),
        poly(43, ["נובה", "Nova"]),
        poly(19, ["בארי", "Be'eri"]),
      ],
    };
    expect(resolveSettlementGlowFeature(withSite, { outlineObjectId: 100 }).properties.OBJECTID).toBe(43);
    expect(resolveSettlementGlowFeature(withSite, { locationName: "Nova" }).properties.OBJECTID).toBe(43);
    expect(resolveSettlementGlowFeature(withSite.features, { outlineObjectId: 100 }).properties.OBJECTID).toBe(43);
  });

  it("loads Nova 43 from sidecar+yeshuv merge, not site 100", async () => {
    const sidecar = { type: "FeatureCollection", features: [poly(100, ["נובה"])] };
    const yeshuv = { type: "Feature", properties: { OBJECTID: 43 }, geometry: poly(43).geometry };
    expect(resolveSettlementGlowFeature(sidecar.features, { outlineObjectId: 43 })).toBeNull();
    const merged = mergeNovaYeshuvOutlineFeature(sidecar.features, [yeshuv]);
    expect(resolveSettlementGlowFeature(merged, { outlineObjectId: 43 }).properties.OBJECTID).toBe(43);
    const loaded = await loadSettlementFeatures({
      investigationSettlementsUrl: "/sidecar.json",
      getLayerDataUrl: (id) => (id === "projector_base.ישובים" ? "/yeshuvim.json" : null),
      fetchJson: async (url) => {
        if (url === "/sidecar.json") return sidecar;
        if (url === "/yeshuvim.json") return { features: [yeshuv] };
        return null;
      },
    });
    expect(resolveSettlementGlowFeature(loaded, { outlineObjectId: 43 }).properties.OBJECTID).toBe(43);
    expect(resolveSettlementGlowFeature(loaded, { outlineObjectId: 43 }).properties.OBJECTID).not.toBe(100);
    const { createFakeMapLibreMap } = await import("../helpers/fake-maplibre-map.js");
    const map = createFakeMapLibreMap();
    const glow = createProjectionSettlementGlow({
      map,
      loadSettlements: async () => loaded,
      motionMode: "reduced",
    });
    await syncProjectionSettlementGlow(glow, { exhibitMode: true, narrativeId: "nova" });
    expect(map.getSource(PROJECTION_SETTLEMENT_GLOW_SOURCE_ID).data.features[0].properties.OBJECTID).toBe(43);
    glow.dispose();
  });
});

describe("settlementAuraPoint", () => {
  it("centers a Point on the polygon bbox with padded hypot radius", () => {
    const feature = poly(19, ["בארי"]);
    const aura = settlementAuraPoint(feature);
    expect(aura.geometry.type).toBe("Point");
    expect(aura.geometry.coordinates[0]).toBeCloseTo(34.05);
    expect(aura.geometry.coordinates[1]).toBeCloseTo(31.05);
    const lat = 31.05;
    const widthM = 0.1 * 111320 * Math.cos((lat * Math.PI) / 180);
    const heightM = 0.1 * 110540;
    const hypot = 0.5 * Math.hypot(widthM, heightM);
    expect(aura.properties.radiusMeters).toBeCloseTo(hypot * NLI_VISUAL_TOKENS.settlementGlowAuraPad);
    expect(aura.properties.coreRadiusMeters).toBeCloseTo(hypot * NLI_VISUAL_TOKENS.settlementGlowCorePad);
    expect(aura.properties.coreRadiusMeters).toBeLessThan(aura.properties.radiusMeters);
    expect(aura.properties.OBJECTID).toBe(19);
  });
});

describe("createProjectionSettlementGlow", () => {
  it("paints a Point circle aura, not the polygon outline", async () => {
    const { createFakeMapLibreMap } = await import("../helpers/fake-maplibre-map.js");
    const map = createFakeMapLibreMap();
    const glow = createProjectionSettlementGlow({
      map,
      loadSettlements: async () => settlements,
      motionMode: "reduced",
    });
    await glow.setFocus({ outlineObjectId: 19 });
    const focused = map.getSource(PROJECTION_SETTLEMENT_GLOW_SOURCE_ID).data.features[0];
    expect(focused.geometry.type).toBe("Point");
    expect(map.getLayer(PROJECTION_SETTLEMENT_GLOW_AURA_LAYER_ID).type).toBe("circle");
    expect(map.getLayer(PROJECTION_SETTLEMENT_GLOW_CORE_LAYER_ID).type).toBe("circle");
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_AURA_LAYER_ID, "circle-blur"))
      .toBe(NLI_VISUAL_TOKENS.settlementGlowAuraBlur);
    expect(NLI_VISUAL_TOKENS.settlementGlowAuraBlur).toBe(1.65);
    expect(NLI_VISUAL_TOKENS.settlementGlowCoreBlur).toBe(1.15);
    expect(NLI_VISUAL_TOKENS.settlementGlowCorePad).toBeLessThan(NLI_VISUAL_TOKENS.settlementGlowAuraPad);
    for (const id of LEGACY_GLOW_LAYER_IDS) {
      expect(map.getLayer(id)).toBeNull();
    }
    glow.dispose();
  });

  it("dissolves one outline in and keeps geometry on clear", async () => {
    const { createFakeMapLibreMap } = await import("../helpers/fake-maplibre-map.js");
    const map = createFakeMapLibreMap();
    const glow = createProjectionSettlementGlow({
      map,
      loadSettlements: async () => settlements,
      motionMode: "reduced",
    });
    await glow.setFocus({ outlineObjectId: 19 });
    expect(map.getSource(PROJECTION_SETTLEMENT_GLOW_SOURCE_ID).data.features[0].properties.OBJECTID).toBe(19);
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_AURA_LAYER_ID, "circle-opacity"))
      .toBe(NLI_VISUAL_TOKENS.settlementGlowAuraOpacity);
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_CORE_LAYER_ID, "circle-opacity"))
      .toBe(NLI_VISUAL_TOKENS.settlementGlowCoreOpacity);
    await glow.setFocus({});
    expect(map.getSource(PROJECTION_SETTLEMENT_GLOW_SOURCE_ID).data.features).toHaveLength(1);
    expect(map.getSource(PROJECTION_SETTLEMENT_GLOW_SOURCE_ID).data.features[0].geometry.type).toBe("Point");
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_AURA_LAYER_ID, "circle-opacity")).toBe(0);
    await glow.setFocus({ outlineObjectId: 19, suppressed: true });
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_AURA_LAYER_ID, "circle-opacity")).toBe(0);
    glow.dispose();
  });

  it("does not put highlight in glow ids", () => {
    for (const id of GLOW_IDS) {
      expect(id).not.toMatch(/highlight/i);
    }
    expect(PROJECTION_SETTLEMENT_GLOW_SOURCE_ID).toBe("projection-settlement-glow-source");
    expect(PROJECTION_SETTLEMENT_GLOW_AURA_LAYER_ID).toBe("projection-settlement-glow-aura");
    expect(PROJECTION_SETTLEMENT_GLOW_CORE_LAYER_ID).toBe("projection-settlement-glow-core");
  });

  it("paints a white circle aura and core from glow tokens", async () => {
    const { createFakeMapLibreMap } = await import("../helpers/fake-maplibre-map.js");
    const map = createFakeMapLibreMap();
    const glow = createProjectionSettlementGlow({
      map,
      loadSettlements: async () => settlements,
      motionMode: "reduced",
    });
    glow.ensureLayers(map);
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_AURA_LAYER_ID, "circle-color")).toBe("#ffffff");
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_AURA_LAYER_ID, "circle-opacity")).toBe(0);
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_AURA_LAYER_ID, "circle-blur"))
      .toBe(NLI_VISUAL_TOKENS.settlementGlowAuraBlur);
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_CORE_LAYER_ID, "circle-blur"))
      .toBe(NLI_VISUAL_TOKENS.settlementGlowCoreBlur);
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_AURA_LAYER_ID, "circle-pitch-alignment")).toBe("map");
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_CORE_LAYER_ID, "circle-pitch-alignment")).toBe("map");
    const radius = map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_AURA_LAYER_ID, "circle-radius");
    expect(radius[0]).toBe("interpolate");
    expect(radius[1]).toEqual(["exponential", 2]);
    expect(radius[2]).toEqual(["zoom"]);
    expect(JSON.stringify(radius)).toContain("radiusMeters");
    const coreRadius = map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_CORE_LAYER_ID, "circle-radius");
    expect(JSON.stringify(coreRadius)).toContain("coreRadiusMeters");
    glow.dispose();
  });

  it("raises glow layers below the person selection halo", async () => {
    const { createFakeMapLibreMap } = await import("../helpers/fake-maplibre-map.js");
    const map = createFakeMapLibreMap();
    map.addSource("otef-person-selection", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: PEOPLE_HALO_LAYER_ID, type: "circle", source: "otef-person-selection" });
    const glow = createProjectionSettlementGlow({
      map,
      loadSettlements: async () => settlements,
      motionMode: "reduced",
    });
    glow.ensureLayers(map);
    glow.raise(map);
    const ids = map.getStyle().layers.map((layer) => layer.id);
    const haloIndex = ids.indexOf(PEOPLE_HALO_LAYER_ID);
    expect(ids.indexOf(PROJECTION_SETTLEMENT_GLOW_AURA_LAYER_ID)).toBeLessThan(haloIndex);
    expect(ids.indexOf(PROJECTION_SETTLEMENT_GLOW_CORE_LAYER_ID)).toBe(haloIndex - 1);
    glow.dispose();
  });

  it("snaps opacity to 0 then swaps geometry before fading in on outline change", async () => {
    const { createFakeMapLibreMap } = await import("../helpers/fake-maplibre-map.js");
    const map = createFakeMapLibreMap();
    const glow = createProjectionSettlementGlow({
      map,
      loadSettlements: async () => settlements,
      motionMode: "full",
    });
    await glow.setFocus({ outlineObjectId: 19 });
    map.calls.length = 0;
    await glow.setFocus({ outlineObjectId: 43 });
    const relevant = map.calls.filter((call) => (
      call.method === "setData"
      || (call.method === "setPaintProperty"
        && String(call.key).endsWith("opacity")
        && !String(call.key).includes("transition"))
    ));
    const firstOpacity = relevant.find((call) => call.method === "setPaintProperty");
    const setData = relevant.find((call) => call.method === "setData");
    const fadeIn = [...relevant].reverse().find((call) => (
      call.method === "setPaintProperty" && call.value !== 0
    ));
    expect(firstOpacity.value).toBe(0);
    expect(setData.data.features[0].properties.OBJECTID).toBe(43);
    expect(setData.data.features[0].geometry.type).toBe("Point");
    expect(relevant.indexOf(firstOpacity)).toBeLessThan(relevant.indexOf(setData));
    expect(relevant.indexOf(setData)).toBeLessThan(relevant.indexOf(fadeIn));
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_AURA_LAYER_ID, "circle-opacity-transition"))
      .toEqual({ duration: NLI_VISUAL_TOKENS.highlightOpacityTransitionMs, delay: 0 });
    glow.dispose();
  });

  it("does not restart the fade for the same OBJECTID", async () => {
    const { createFakeMapLibreMap } = await import("../helpers/fake-maplibre-map.js");
    const map = createFakeMapLibreMap();
    const glow = createProjectionSettlementGlow({
      map,
      loadSettlements: async () => settlements,
      motionMode: "full",
    });
    await glow.setFocus({ outlineObjectId: 19 });
    const setDataCount = map.calls.filter((call) => call.method === "setData").length;
    await glow.setFocus({ outlineObjectId: 19 });
    expect(map.calls.filter((call) => call.method === "setData")).toHaveLength(setDataCount);
    glow.dispose();
  });

  it("repaints the same OBJECTID after ensureLayers recreates missing glow layers", async () => {
    const { createFakeMapLibreMap } = await import("../helpers/fake-maplibre-map.js");
    const map = createFakeMapLibreMap();
    const glow = createProjectionSettlementGlow({
      map,
      loadSettlements: async () => settlements,
      motionMode: "reduced",
    });
    await glow.setFocus({ outlineObjectId: 19 });
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_AURA_LAYER_ID, "circle-opacity"))
      .toBe(NLI_VISUAL_TOKENS.settlementGlowAuraOpacity);
    for (const id of [
      PROJECTION_SETTLEMENT_GLOW_AURA_LAYER_ID,
      PROJECTION_SETTLEMENT_GLOW_CORE_LAYER_ID,
    ]) {
      map.removeLayer(id);
    }
    glow.ensureLayers(map);
    await glow.setFocus({ outlineObjectId: 19 });
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_AURA_LAYER_ID, "circle-opacity"))
      .toBe(NLI_VISUAL_TOKENS.settlementGlowAuraOpacity);
    glow.dispose();
  });

  it("raises remounted glow layers under the person halo", async () => {
    const { createFakeMapLibreMap } = await import("../helpers/fake-maplibre-map.js");
    const map = createFakeMapLibreMap();
    map.addSource("otef-person-selection", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: PEOPLE_HALO_LAYER_ID, type: "circle", source: "otef-person-selection" });
    const glow = createProjectionSettlementGlow({
      map,
      loadSettlements: async () => settlements,
      motionMode: "reduced",
    });
    await glow.setFocus({ outlineObjectId: 19 });
    for (const id of [
      PROJECTION_SETTLEMENT_GLOW_AURA_LAYER_ID,
      PROJECTION_SETTLEMENT_GLOW_CORE_LAYER_ID,
    ]) {
      map.removeLayer(id);
    }
    map.calls.length = 0;
    await glow.setFocus({ outlineObjectId: 19 });
    expect(map.getLayer(PROJECTION_SETTLEMENT_GLOW_AURA_LAYER_ID)).toBeTruthy();
    expect(map.getLayer(PROJECTION_SETTLEMENT_GLOW_CORE_LAYER_ID)).toBeTruthy();
    const moveCalls = map.calls.filter((call) => call.method === "moveLayer");
    expect(moveCalls).toEqual([
      { method: "moveLayer", id: PROJECTION_SETTLEMENT_GLOW_AURA_LAYER_ID, beforeId: PEOPLE_HALO_LAYER_ID },
      { method: "moveLayer", id: PROJECTION_SETTLEMENT_GLOW_CORE_LAYER_ID, beforeId: PEOPLE_HALO_LAYER_ID },
    ]);
    glow.dispose();
  });

  it("removes leftover fill and line glow layers on mount and dispose", async () => {
    const { createFakeMapLibreMap } = await import("../helpers/fake-maplibre-map.js");
    const map = createFakeMapLibreMap();
    map.addSource(PROJECTION_SETTLEMENT_GLOW_SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    for (const id of LEGACY_GLOW_LAYER_IDS) {
      map.addLayer({
        id,
        type: id.endsWith("fill") ? "fill" : "line",
        source: PROJECTION_SETTLEMENT_GLOW_SOURCE_ID,
      });
    }
    const glow = createProjectionSettlementGlow({
      map,
      loadSettlements: async () => settlements,
      motionMode: "reduced",
    });
    glow.ensureLayers(map);
    for (const id of LEGACY_GLOW_LAYER_IDS) {
      expect(map.getLayer(id)).toBeNull();
    }
    expect(map.getLayer(PROJECTION_SETTLEMENT_GLOW_AURA_LAYER_ID)).toBeTruthy();
    glow.dispose();
    for (const id of [...LEGACY_GLOW_LAYER_IDS, PROJECTION_SETTLEMENT_GLOW_AURA_LAYER_ID, PROJECTION_SETTLEMENT_GLOW_CORE_LAYER_ID]) {
      expect(map.getLayer(id)).toBeNull();
    }
    expect(map.getSource(PROJECTION_SETTLEMENT_GLOW_SOURCE_ID)).toBeNull();
  });
});

test("narrative settlement outline is never force-included for a white stroke", () => {
  expect(shouldIncludeNarrativeSettlementOutline({ id: "segev" })).toBe(false);
  expect(shouldIncludeNarrativeSettlementOutline({ id: "nova" })).toBe(false);
  expect(shouldIncludeNarrativeSettlementOutline({ id: "sderot" })).toBe(false);
});

test("glow sync prefers narrative outline, then person, and suppresses off-exhibit or wall", async () => {
  const calls = [];
  const glow = { setFocus: async (next) => { calls.push(next); } };
  await syncProjectionSettlementGlow(glow, {
    exhibitMode: true, narrativeId: "segev", personLocation: "Alumim", placeName: "נובה", wallEnabled: false,
  });
  expect(calls.at(-1)).toEqual({ outlineObjectId: 19 });
  await syncProjectionSettlementGlow(glow, {
    exhibitMode: true, narrativeId: null, personLocation: "Alumim", placeName: "נובה", wallEnabled: false,
  });
  expect(calls.at(-1)).toEqual({ locationName: "Alumim" });
  await syncProjectionSettlementGlow(glow, {
    exhibitMode: true, narrativeId: null, personLocation: null, placeName: "נובה", wallEnabled: false,
  });
  expect(calls.at(-1)).toEqual({ locationName: "נובה" });
  await syncProjectionSettlementGlow(glow, {
    exhibitMode: true, narrativeId: null, personLocation: null, placeName: "נובה", wallEnabled: true,
  });
  expect(calls.at(-1)).toEqual({ suppressed: true });
  await syncProjectionSettlementGlow(glow, {
    exhibitMode: false, narrativeId: "segev", personLocation: "Alumim", wallEnabled: false,
  });
  expect(calls.at(-1)).toEqual({ suppressed: true });
  await syncProjectionSettlementGlow(glow, {
    exhibitMode: true, narrativeId: "nova", personLocation: null, placeName: null, wallEnabled: false,
  });
  expect(calls.at(-1)).toEqual({ outlineObjectId: 43 });
});

test("projection glow seeds lastPlaceId from the name-field pending place", () => {
  const src = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/src/entries/projection-main.js"),
    "utf8",
  );
  expect(src).toMatch(/lastPlaceId\s*=\s*nameFieldController\.getPendingPlaceId\?\.\(\)/);
  expect(src).toMatch(/nameFieldController\.sync\(groups\);\s*void syncSettlementGlow\(\)/);
});

test("projection glow loadSettlements uses the GIS yeshuv merge", () => {
  const src = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/src/entries/projection-main.js"),
    "utf8",
  );
  expect(src).toMatch(/loadSettlements:\s*\(\)\s*=>\s*loadSettlementFeatures\(\{\}\)/);
  expect(src).not.toMatch(/shouldIncludeNarrativeSettlementOutline/);
});

describe("settlementGlowBreathScale", () => {
  it("oscillates around rest and never reaches a flashlight peak", () => {
    const { settlementGlowBreathMs, settlementGlowBreathMin, settlementGlowBreathMax } = NLI_VISUAL_TOKENS;
    expect(settlementGlowBreathScale(0)).toBeCloseTo(
      (settlementGlowBreathMin + settlementGlowBreathMax) / 2,
    );
    expect(settlementGlowBreathScale(settlementGlowBreathMs / 4)).toBeCloseTo(settlementGlowBreathMax);
    expect(settlementGlowBreathScale((settlementGlowBreathMs * 3) / 4)).toBeCloseTo(settlementGlowBreathMin);
    expect(NLI_VISUAL_TOKENS.settlementGlowAuraOpacity * settlementGlowBreathMax).toBeLessThan(0.22);
    expect(NLI_VISUAL_TOKENS.settlementGlowCoreOpacity * settlementGlowBreathMax).toBeLessThan(0.18);
  });
});

describe("settlement glow breath", () => {
  it("fades in on show and starts breathing only after the intro", async () => {
    vi.useFakeTimers();
    const { createFakeMapLibreMap } = await import("../helpers/fake-maplibre-map.js");
    const map = createFakeMapLibreMap();
    const glow = createProjectionSettlementGlow({
      map,
      loadSettlements: async () => settlements,
      motionMode: "full",
    });
    await glow.setFocus({ outlineObjectId: 19 });
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_AURA_LAYER_ID, "circle-opacity"))
      .toBe(NLI_VISUAL_TOKENS.settlementGlowAuraOpacity);
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_AURA_LAYER_ID, "circle-opacity-transition"))
      .toEqual({ duration: NLI_VISUAL_TOKENS.highlightOpacityTransitionMs, delay: 0 });
    expect(map.pendingAnimationFrameCount()).toBe(0);
    map.driveAnimationFrame(0);
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_AURA_LAYER_ID, "circle-opacity-transition"))
      .toEqual({ duration: NLI_VISUAL_TOKENS.highlightOpacityTransitionMs, delay: 0 });
    await vi.advanceTimersByTimeAsync(NLI_VISUAL_TOKENS.highlightOpacityTransitionMs);
    expect(map.pendingAnimationFrameCount()).toBe(1);
    glow.dispose();
    expect(map.pendingAnimationFrameCount()).toBe(0);
    vi.useRealTimers();
  });

  it("pulses opacity on full motion without tightening blur", async () => {
    vi.useFakeTimers();
    const { createFakeMapLibreMap } = await import("../helpers/fake-maplibre-map.js");
    const map = createFakeMapLibreMap();
    const glow = createProjectionSettlementGlow({
      map,
      loadSettlements: async () => settlements,
      motionMode: "full",
    });
    await glow.setFocus({ outlineObjectId: 19 });
    await vi.advanceTimersByTimeAsync(NLI_VISUAL_TOKENS.highlightOpacityTransitionMs);
    expect(map.pendingAnimationFrameCount()).toBe(1);
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_AURA_LAYER_ID, "circle-blur"))
      .toBe(NLI_VISUAL_TOKENS.settlementGlowAuraBlur);
    map.driveAnimationFrame(0);
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_AURA_LAYER_ID, "circle-opacity"))
      .toBeCloseTo(NLI_VISUAL_TOKENS.settlementGlowAuraOpacity);
    map.driveAnimationFrame(NLI_VISUAL_TOKENS.settlementGlowBreathMs / 4);
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_AURA_LAYER_ID, "circle-opacity"))
      .toBeCloseTo(
        NLI_VISUAL_TOKENS.settlementGlowAuraOpacity * NLI_VISUAL_TOKENS.settlementGlowBreathMax,
      );
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_CORE_LAYER_ID, "circle-opacity"))
      .toBeCloseTo(
        NLI_VISUAL_TOKENS.settlementGlowCoreOpacity * NLI_VISUAL_TOKENS.settlementGlowBreathMax,
      );
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_AURA_LAYER_ID, "circle-blur"))
      .toBe(NLI_VISUAL_TOKENS.settlementGlowAuraBlur);
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_CORE_LAYER_ID, "circle-blur"))
      .toBe(NLI_VISUAL_TOKENS.settlementGlowCoreBlur);
    glow.dispose();
    expect(map.pendingAnimationFrameCount()).toBe(0);
    vi.useRealTimers();
  });

  it("does not breathe when motion is reduced", async () => {
    const { createFakeMapLibreMap } = await import("../helpers/fake-maplibre-map.js");
    const map = createFakeMapLibreMap();
    const glow = createProjectionSettlementGlow({
      map,
      loadSettlements: async () => settlements,
      motionMode: "reduced",
    });
    await glow.setFocus({ outlineObjectId: 19 });
    expect(map.pendingAnimationFrameCount()).toBe(0);
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_AURA_LAYER_ID, "circle-opacity"))
      .toBe(NLI_VISUAL_TOKENS.settlementGlowAuraOpacity);
    glow.dispose();
  });
});

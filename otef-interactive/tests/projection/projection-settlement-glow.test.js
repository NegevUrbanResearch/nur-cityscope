import { describe, expect, it, test } from "vitest";
import { PEOPLE_HALO_LAYER_ID } from "../../frontend/src/map/maplibre-person-selection.js";
import { shouldIncludeNarrativeSettlementOutline } from "../../frontend/src/shared/nli-nova-escape-impact.js";
import { NLI_VISUAL_TOKENS } from "../../frontend/src/shared/nli-investigation-theme.js";
import {
  PROJECTION_SETTLEMENT_GLOW_FILL_LAYER_ID,
  PROJECTION_SETTLEMENT_GLOW_INNER_LAYER_ID,
  PROJECTION_SETTLEMENT_GLOW_OUTER_LAYER_ID,
  PROJECTION_SETTLEMENT_GLOW_SOURCE_ID,
  createProjectionSettlementGlow,
  resolveSettlementGlowFeature,
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
  PROJECTION_SETTLEMENT_GLOW_FILL_LAYER_ID,
  PROJECTION_SETTLEMENT_GLOW_OUTER_LAYER_ID,
  PROJECTION_SETTLEMENT_GLOW_INNER_LAYER_ID,
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
});

describe("createProjectionSettlementGlow", () => {
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
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_OUTER_LAYER_ID, "line-opacity"))
      .toBe(NLI_VISUAL_TOKENS.settlementGlowOuterOpacity);
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_INNER_LAYER_ID, "line-opacity"))
      .toBe(NLI_VISUAL_TOKENS.settlementGlowInnerOpacity);
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_FILL_LAYER_ID, "fill-opacity"))
      .toBe(NLI_VISUAL_TOKENS.settlementGlowFillOpacity);
    await glow.setFocus({});
    expect(map.getSource(PROJECTION_SETTLEMENT_GLOW_SOURCE_ID).data.features).toHaveLength(1);
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_OUTER_LAYER_ID, "line-opacity")).toBe(0);
    await glow.setFocus({ outlineObjectId: 19, suppressed: true });
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_OUTER_LAYER_ID, "line-opacity")).toBe(0);
    glow.dispose();
  });

  it("does not put highlight in glow ids", () => {
    for (const id of GLOW_IDS) {
      expect(id).not.toMatch(/highlight/i);
    }
    expect(PROJECTION_SETTLEMENT_GLOW_SOURCE_ID).toBe("projection-settlement-glow-source");
    expect(PROJECTION_SETTLEMENT_GLOW_FILL_LAYER_ID).toBe("projection-settlement-glow-fill");
    expect(PROJECTION_SETTLEMENT_GLOW_OUTER_LAYER_ID).toBe("projection-settlement-glow-outer");
    expect(PROJECTION_SETTLEMENT_GLOW_INNER_LAYER_ID).toBe("projection-settlement-glow-inner");
  });

  it("paints a white fill and blurred line stack from glow tokens", async () => {
    const { createFakeMapLibreMap } = await import("../helpers/fake-maplibre-map.js");
    const map = createFakeMapLibreMap();
    const glow = createProjectionSettlementGlow({
      map,
      loadSettlements: async () => settlements,
      motionMode: "reduced",
    });
    glow.ensureLayers(map);
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_FILL_LAYER_ID, "fill-color")).toBe("#ffffff");
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_FILL_LAYER_ID, "fill-opacity")).toBe(0);
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_OUTER_LAYER_ID, "line-color")).toBe("#ffffff");
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_OUTER_LAYER_ID, "line-width"))
      .toBe(NLI_VISUAL_TOKENS.settlementGlowOuterWidth);
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_OUTER_LAYER_ID, "line-blur"))
      .toBe(NLI_VISUAL_TOKENS.settlementGlowOuterBlur);
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_INNER_LAYER_ID, "line-width"))
      .toBe(NLI_VISUAL_TOKENS.settlementGlowInnerWidth);
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_INNER_LAYER_ID, "line-blur"))
      .toBe(NLI_VISUAL_TOKENS.settlementGlowInnerBlur);
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
    expect(ids.indexOf(PROJECTION_SETTLEMENT_GLOW_FILL_LAYER_ID)).toBeLessThan(haloIndex);
    expect(ids.indexOf(PROJECTION_SETTLEMENT_GLOW_OUTER_LAYER_ID)).toBeLessThan(haloIndex);
    expect(ids.indexOf(PROJECTION_SETTLEMENT_GLOW_INNER_LAYER_ID)).toBe(haloIndex - 1);
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
    expect(relevant.indexOf(firstOpacity)).toBeLessThan(relevant.indexOf(setData));
    expect(relevant.indexOf(setData)).toBeLessThan(relevant.indexOf(fadeIn));
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_OUTER_LAYER_ID, "line-opacity-transition"))
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
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_OUTER_LAYER_ID, "line-opacity"))
      .toBe(NLI_VISUAL_TOKENS.settlementGlowOuterOpacity);
    for (const id of [
      PROJECTION_SETTLEMENT_GLOW_FILL_LAYER_ID,
      PROJECTION_SETTLEMENT_GLOW_OUTER_LAYER_ID,
      PROJECTION_SETTLEMENT_GLOW_INNER_LAYER_ID,
    ]) {
      map.removeLayer(id);
    }
    glow.ensureLayers(map);
    await glow.setFocus({ outlineObjectId: 19 });
    expect(map.getPaintProperty(PROJECTION_SETTLEMENT_GLOW_OUTER_LAYER_ID, "line-opacity"))
      .toBe(NLI_VISUAL_TOKENS.settlementGlowOuterOpacity);
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
      PROJECTION_SETTLEMENT_GLOW_FILL_LAYER_ID,
      PROJECTION_SETTLEMENT_GLOW_OUTER_LAYER_ID,
      PROJECTION_SETTLEMENT_GLOW_INNER_LAYER_ID,
    ]) {
      map.removeLayer(id);
    }
    map.calls.length = 0;
    await glow.setFocus({ outlineObjectId: 19 });
    expect(map.getLayer(PROJECTION_SETTLEMENT_GLOW_FILL_LAYER_ID)).toBeTruthy();
    expect(map.getLayer(PROJECTION_SETTLEMENT_GLOW_OUTER_LAYER_ID)).toBeTruthy();
    expect(map.getLayer(PROJECTION_SETTLEMENT_GLOW_INNER_LAYER_ID)).toBeTruthy();
    const moveCalls = map.calls.filter((call) => call.method === "moveLayer");
    expect(moveCalls).toEqual([
      { method: "moveLayer", id: PROJECTION_SETTLEMENT_GLOW_FILL_LAYER_ID, beforeId: PEOPLE_HALO_LAYER_ID },
      { method: "moveLayer", id: PROJECTION_SETTLEMENT_GLOW_OUTER_LAYER_ID, beforeId: PEOPLE_HALO_LAYER_ID },
      { method: "moveLayer", id: PROJECTION_SETTLEMENT_GLOW_INNER_LAYER_ID, beforeId: PEOPLE_HALO_LAYER_ID },
    ]);
    glow.dispose();
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
});

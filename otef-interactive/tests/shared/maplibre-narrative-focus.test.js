import { describe, expect, it } from "vitest";
import { createNarrativeFocusRenderer, NARRATIVE_FOCUS_RENDERER_IDS } from "../../frontend/src/shared/maplibre-narrative-focus.js";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";

const segev = Object.freeze({
  id: "segev",
  label: "בית משפחת שגב",
  center: [34.48647925700004, 31.422958191000077],
});

const segevHouse = Object.freeze({
  type: "Feature",
  properties: { note: "בית משפחת שגב" },
  geometry: {
    type: "Polygon",
    coordinates: [[
      [34.4863, 31.4229],
      [34.4867, 31.4229],
      [34.4867, 31.4231],
      [34.4863, 31.4231],
      [34.4863, 31.4229],
    ]],
  },
});

const periHouse = Object.freeze({
  type: "Feature",
  properties: { note: "בית משפחת פרי" },
  geometry: {
    type: "Polygon",
    coordinates: [[
      [34.4001, 31.3111],
      [34.4004, 31.3111],
      [34.4004, 31.3113],
      [34.4001, 31.3113],
      [34.4001, 31.3111],
    ]],
  },
});

const sderotHouse = Object.freeze({
  type: "Feature",
  properties: { note: "תחנת משטרה שדרות" },
  geometry: {
    type: "Polygon",
    coordinates: [[
      [34.5919, 31.5227],
      [34.5923, 31.5227],
      [34.5923, 31.5229],
      [34.5919, 31.5229],
      [34.5919, 31.5227],
    ]],
  },
});

const HOUSE_SOURCE_ID = "nli.narrative_polygon";

function houseCollection(features) {
  return { type: "geojson", data: { type: "FeatureCollection", features } };
}

function withHouses(features) {
  return createFakeMapLibreMap({
    sources: { [HOUSE_SOURCE_ID]: houseCollection(features) },
  });
}

function renderedFocus(map) {
  return map.getSource(NARRATIVE_FOCUS_RENDERER_IDS.source)?.data?.features?.[0];
}

describe("MapLibre narrative focus renderer", () => {
  it.each([
    ["gis", 16, 1.5],
    ["projection", 11, 1.1],
  ])("renders the Segev label with %s display tokens and no marker", (profile, textSize, textHaloWidth) => {
    const map = createFakeMapLibreMap();
    const renderer = createNarrativeFocusRenderer(map, { profile });

    renderer.show(segev);

    expect(NARRATIVE_FOCUS_RENDERER_IDS).toEqual({
      source: "nli-narrative-focus",
      halo: "nli-narrative-focus-halo",
      label: "nli-narrative-focus-label",
    });
    expect(renderedFocus(map)).toEqual({
      type: "Feature",
      properties: { label: "בית משפחת שגב" },
      geometry: { type: "Point", coordinates: [34.48647925700004, 31.422958191000077] },
    });
    expect(map.getLayer(NARRATIVE_FOCUS_RENDERER_IDS.halo)).toBeFalsy();
    expect(map.getLayer(NARRATIVE_FOCUS_RENDERER_IDS.label).layout["text-size"]).toBe(textSize);
    expect(map.getLayer(NARRATIVE_FOCUS_RENDERER_IDS.label).layout["text-anchor"]).toBe("bottom");
    expect(map.getLayer(NARRATIVE_FOCUS_RENDERER_IDS.label).paint["text-halo-color"]).toBe("#c31f4f");
    expect(map.getLayer(NARRATIVE_FOCUS_RENDERER_IDS.label).paint["text-halo-width"]).toBe(textHaloWidth);
    expect(map.getLayer(NARRATIVE_FOCUS_RENDERER_IDS.label).layout["text-allow-overlap"]).toBe(true);
  });

  it("places the label above the matching house polygon instead of the coded point", () => {
    const map = withHouses([segevHouse, periHouse, sderotHouse]);
    const renderer = createNarrativeFocusRenderer(map, { profile: "gis" });

    renderer.show(segev);

    expect(renderedFocus(map)).toEqual({
      type: "Feature",
      properties: { label: "בית משפחת שגב" },
      geometry: { type: "Point", coordinates: [34.4865, 31.4231] },
    });
    expect(map.getLayer(NARRATIVE_FOCUS_RENDERER_IDS.halo)).toBeFalsy();
    expect(map.getLayer(NARRATIVE_FOCUS_RENDERER_IDS.label).layout["text-anchor"]).toBe("bottom");
  });

  it("matches the Sderot police-station polygon even when the pack note is longer", () => {
    const map = withHouses([segevHouse, periHouse, sderotHouse]);
    const renderer = createNarrativeFocusRenderer(map, { profile: "gis" });

    renderer.show({
      id: "sderot",
      label: "תחנת המשטרה",
      center: [34.59744, 31.529518],
      marker: [34.59205662207849, 31.52320675782405],
    });

    expect(renderedFocus(map)?.geometry?.coordinates).toEqual([34.5921, 31.5229]);
  });

  it("keeps Nova at the site when no house polygon matches", () => {
    const map = withHouses([segevHouse, periHouse, sderotHouse]);
    const renderer = createNarrativeFocusRenderer(map, { profile: "gis" });

    renderer.show({
      id: "nova",
      label: "נובה",
      center: [34.46975, 31.39851],
    });

    expect(renderedFocus(map)?.geometry?.coordinates).toEqual([34.46975, 31.39851]);
    expect(map.getLayer(NARRATIVE_FOCUS_RENDERER_IDS.halo)).toBeFalsy();
  });

  it("repositions onto the house polygon once the overlay source loads", () => {
    const map = createFakeMapLibreMap();
    const renderer = createNarrativeFocusRenderer(map, { profile: "gis" });
    renderer.show(segev);
    expect(renderedFocus(map)?.geometry?.coordinates).toEqual(segev.center);

    map.addSource(HOUSE_SOURCE_ID, houseCollection([segevHouse]));
    map.emit("sourcedata", { sourceId: HOUSE_SOURCE_ID, isSourceLoaded: true });

    expect(renderedFocus(map)?.geometry?.coordinates).toEqual([34.4865, 31.4231]);
  });

  it("is idempotent, reconstructs after a style reload, and never attaches person interaction", () => {
    const map = createFakeMapLibreMap();
    const renderer = createNarrativeFocusRenderer(map, { profile: "gis" });

    renderer.show(segev);
    renderer.show(segev);
    expect(map.calls.filter((call) => call.method === "addSource")).toHaveLength(1);
    expect(map.calls.filter((call) => call.method === "addLayer")).toHaveLength(1);
    expect(map.listenerCount("click")).toBe(0);

    map.wipeStyle();
    renderer.onStyleLoad();
    expect(renderedFocus(map)?.properties.label).toBe("בית משפחת שגב");
    expect(map.getLayer(NARRATIVE_FOCUS_RENDERER_IDS.halo)).toBeFalsy();
    expect(map.getLayer(NARRATIVE_FOCUS_RENDERER_IDS.label)).toBeTruthy();
    expect(map.calls.some((call) => String(call.id || "").includes("otef-person-selection"))).toBe(false);
  });

  it.each(["gis", "projection"])("brings the topmost label forward after later curated layers mount (%s)", (profile) => {
    const map = createFakeMapLibreMap();
    const renderer = createNarrativeFocusRenderer(map, { profile });
    renderer.show(segev);
    map.addLayer({ id: "curated-after-narrative", type: "fill", source: "unrelated" });
    const moveCountBeforeRebuild = map.calls.filter((call) => call.method === "moveLayer").length;

    renderer.onStyleLoad();

    expect(map.calls.filter((call) => call.method === "moveLayer").slice(moveCountBeforeRebuild)).toEqual([
      { method: "moveLayer", id: NARRATIVE_FOCUS_RENDERER_IDS.label, beforeId: undefined },
    ]);
    expect(map.getStyle().layers.at(-1).id).toBe(NARRATIVE_FOCUS_RENDERER_IDS.label);
  });

  it("clears owned layers and source, and dispose remains safe after cleanup", () => {
    const map = createFakeMapLibreMap();
    const renderer = createNarrativeFocusRenderer(map, { profile: "gis" });
    renderer.show(segev);

    renderer.clear();
    expect(map.getLayer(NARRATIVE_FOCUS_RENDERER_IDS.halo)).toBeNull();
    expect(map.getLayer(NARRATIVE_FOCUS_RENDERER_IDS.label)).toBeNull();
    expect(map.getSource(NARRATIVE_FOCUS_RENDERER_IDS.source)).toBeNull();
    renderer.dispose();
    renderer.dispose();
    expect(map.listenerCount("click")).toBe(0);
    expect(map.listenerCount("sourcedata")).toBe(0);
  });

  it("does not reference Popups, person ids, or person-selection identifiers", async () => {
    const source = await import("node:fs/promises").then((fs) => fs.readFile(
      new URL("../../frontend/src/shared/maplibre-narrative-focus.js", import.meta.url),
      "utf8",
    ));
    expect(source).not.toContain("Popup");
    expect(source).not.toContain("personId");
    expect(source).not.toContain("otef-person-selection");
  });

  it("places the label on marker when center is the settlement and no house polygon is loaded", () => {
    const map = createFakeMapLibreMap();
    const renderer = createNarrativeFocusRenderer(map, { profile: "gis" });
    renderer.show({
      label: "בית משפחת פרי",
      center: [34.40244, 31.312639],
      marker: [34.41, 31.32],
    });
    expect(renderedFocus(map)).toEqual({
      type: "Feature",
      properties: { label: "בית משפחת פרי" },
      geometry: { type: "Point", coordinates: [34.41, 31.32] },
    });
    expect(map.getLayer(NARRATIVE_FOCUS_RENDERER_IDS.halo)).toBeFalsy();
  });

  it("does not fall back to center when a present marker is invalid", () => {
    const map = createFakeMapLibreMap();
    const renderer = createNarrativeFocusRenderer(map, { profile: "gis" });
    renderer.show({
      label: "תחנת המשטרה",
      center: [34.59744, 31.529518],
      marker: [NaN, 31.52],
    });
    expect(renderedFocus(map)).toBeUndefined();
    expect(map.getLayer("nli-narrative-focus-halo")).toBeFalsy();
    expect(map.getLayer("nli-narrative-focus-label")).toBeFalsy();
  });

  it("clears a previous label when a replacement marker is present and invalid", () => {
    const map = createFakeMapLibreMap();
    const renderer = createNarrativeFocusRenderer(map, { profile: "gis" });
    renderer.show(segev);
    expect(renderedFocus(map)).toBeTruthy();
    expect(map.getLayer(NARRATIVE_FOCUS_RENDERER_IDS.label)).toBeTruthy();

    renderer.show({
      label: "תחנת המשטרה",
      center: [34.59744, 31.529518],
      marker: [NaN, 31.52],
    });
    expect(renderedFocus(map)).toBeUndefined();
    expect(map.getLayer(NARRATIVE_FOCUS_RENDERER_IDS.label)).toBeFalsy();
    expect(map.getLayer(NARRATIVE_FOCUS_RENDERER_IDS.halo)).toBeFalsy();
  });
});

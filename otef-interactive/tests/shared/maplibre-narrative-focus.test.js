import { describe, expect, it } from "vitest";
import { createNarrativeFocusRenderer, NARRATIVE_FOCUS_RENDERER_IDS } from "../../frontend/src/shared/maplibre-narrative-focus.js";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";

const segev = Object.freeze({
  label: "משפחת שגב",
  center: [34.48647925700004, 31.422958191000077],
});

function renderedFocus(map) {
  return map.getSource(NARRATIVE_FOCUS_RENDERER_IDS.source)?.data?.features?.[0];
}

describe("MapLibre narrative focus renderer", () => {
  it.each([
    ["gis", 9, 2, 16, 1.5],
    ["projection", 6, 1.5, 11, 1.1],
  ])("renders the exact Segev point and label with %s display tokens", (profile, haloRadius, haloStrokeWidth, textSize, textHaloWidth) => {
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
      properties: { label: "משפחת שגב" },
      geometry: { type: "Point", coordinates: [34.48647925700004, 31.422958191000077] },
    });
    expect(map.getLayer(NARRATIVE_FOCUS_RENDERER_IDS.halo).paint["circle-radius"]).toBe(haloRadius);
    expect(map.getLayer(NARRATIVE_FOCUS_RENDERER_IDS.halo).paint["circle-stroke-width"]).toBe(haloStrokeWidth);
    expect(map.getLayer(NARRATIVE_FOCUS_RENDERER_IDS.label).layout["text-size"]).toBe(textSize);
    expect(map.getLayer(NARRATIVE_FOCUS_RENDERER_IDS.label).paint["text-halo-color"]).toBe("#000000");
    expect(map.getLayer(NARRATIVE_FOCUS_RENDERER_IDS.label).paint["text-halo-width"]).toBe(textHaloWidth);
    expect(map.getLayer(NARRATIVE_FOCUS_RENDERER_IDS.label).layout["text-allow-overlap"]).toBe(true);
  });

  it("is idempotent, reconstructs after a style reload, and never attaches person interaction", () => {
    const map = createFakeMapLibreMap();
    const renderer = createNarrativeFocusRenderer(map, { profile: "gis" });

    renderer.show(segev);
    renderer.show(segev);
    expect(map.calls.filter((call) => call.method === "addSource")).toHaveLength(1);
    expect(map.calls.filter((call) => call.method === "addLayer")).toHaveLength(2);
    expect(map.listenerCount("click")).toBe(0);

    map.wipeStyle();
    renderer.onStyleLoad();
    expect(renderedFocus(map)?.properties.label).toBe("משפחת שגב");
    expect(map.getLayer(NARRATIVE_FOCUS_RENDERER_IDS.halo)).toBeTruthy();
    expect(map.calls.some((call) => String(call.id || "").includes("otef-person-selection"))).toBe(false);
  });

  it.each(["gis", "projection"])("brings the halo and topmost label forward after later curated layers mount (%s)", (profile) => {
    const map = createFakeMapLibreMap();
    const renderer = createNarrativeFocusRenderer(map, { profile });
    renderer.show(segev);
    map.addLayer({ id: "curated-after-narrative", type: "fill", source: "unrelated" });
    const moveCountBeforeRebuild = map.calls.filter((call) => call.method === "moveLayer").length;

    renderer.onStyleLoad();

    expect(map.calls.filter((call) => call.method === "moveLayer").slice(moveCountBeforeRebuild)).toEqual([
      { method: "moveLayer", id: NARRATIVE_FOCUS_RENDERER_IDS.halo, beforeId: undefined },
      { method: "moveLayer", id: NARRATIVE_FOCUS_RENDERER_IDS.label, beforeId: undefined },
    ]);
    expect(map.getStyle().layers.slice(-2).map((layer) => layer.id)).toEqual([
      NARRATIVE_FOCUS_RENDERER_IDS.halo,
      NARRATIVE_FOCUS_RENDERER_IDS.label,
    ]);
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

  it("places the halo on marker when center is the settlement", () => {
    const map = createFakeMapLibreMap();
    const renderer = createNarrativeFocusRenderer(map, { profile: "gis" });
    renderer.show({
      label: "משפחת פרי",
      center: [34.40244, 31.312639],
      marker: [34.41, 31.32],
    });
    expect(renderedFocus(map)).toEqual({
      type: "Feature",
      properties: { label: "משפחת פרי" },
      geometry: { type: "Point", coordinates: [34.41, 31.32] },
    });
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
  });

  it("clears a previous halo when a replacement marker is present and invalid", () => {
    const map = createFakeMapLibreMap();
    const renderer = createNarrativeFocusRenderer(map, { profile: "gis" });
    renderer.show(segev);
    expect(renderedFocus(map)).toBeTruthy();
    expect(map.getLayer(NARRATIVE_FOCUS_RENDERER_IDS.halo)).toBeTruthy();

    renderer.show({
      label: "תחנת המשטרה",
      center: [34.59744, 31.529518],
      marker: [NaN, 31.52],
    });
    expect(renderedFocus(map)).toBeUndefined();
    expect(map.getLayer(NARRATIVE_FOCUS_RENDERER_IDS.halo)).toBeFalsy();
  });
});

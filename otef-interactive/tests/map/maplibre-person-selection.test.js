import { describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import {
  PEOPLE_HALO_LAYER_ID,
  PEOPLE_INDEX_URL,
  PEOPLE_RELEASE_METADATA_URL,
  PEOPLE_RUNTIME_URL,
  PEOPLE_SOURCE_ID,
  clearPersonHalo,
  createGisPersonSelection,
  mountPersonHalo,
  normalizePeopleRuntime,
  syncPersonHaloPaint,
} from "../../frontend/src/map/maplibre-person-selection.js";
import { NLI_VISUAL_TOKENS } from "../../frontend/src/shared/nli-investigation-theme.js";

const geojson = (coordinates = [30, 20]) => ({
  type: "FeatureCollection",
  datasetVersion: "v1",
  features: [{ type: "Feature", properties: { pid: 11 }, geometry: { type: "Point", coordinates } }],
});
const index = (datasetVersion = "v1") => ({
  datasetVersion,
  people: [{ pid: "11", nameForms: ["לא ידוע", "<Ada>"], location: "Alumim" }],
});
const metadata = (datasetVersion = "v1") => ({
  datasetVersion,
  runtimeArtifactHashes: { "people.geojson": "geo-hash-v1" },
  artifacts: {
    "people.geojson": { datasetVersion },
    "people-search-index.json": { datasetVersion },
  },
});
const fetched = (data, bytes = new TextEncoder().encode("geo-hash-v1")) => ({ data, bytes });

test("selected person uses the recorded location rather than the display jitter", () => {
  const data = geojson([34.501,31.401]);
  Object.assign(data.features[0].properties, {source_lon:34.5,source_lat:31.4});
  const runtime = normalizePeopleRuntime(data,index(),metadata());
  expect(runtime.resolve("11","v1").coordinates).toEqual([34.5,31.4]);
  expect(data.features[0].geometry.coordinates).toEqual([34.501,31.401]);
});
const popup = () => ({
  setLngLat: vi.fn().mockReturnThis(), setHTML: vi.fn().mockReturnThis(),
  addTo: vi.fn().mockReturnThis(), remove: vi.fn(),
});
function setup(
  fetchJson = vi.fn(async (url) => url.includes("index") ? fetched(index()) : url.includes("metadata") ? fetched(metadata()) : fetched(geojson())),
  hashBytes = vi.fn(async () => "geo-hash-v1"),
  extra = {},
) {
  const map = createFakeMapLibreMap();
  Object.assign(map, {
    getCanvas: () => ({ clientWidth: 400, clientHeight: 300 }),
    project: vi.fn(([lng, lat]) => ({ x: lng * 10, y: lat * 10 })),
    flyTo: vi.fn(),
  });
  const bubble = popup();
  const Popup = vi.fn(function Popup() { return bubble; });
  const visual = createGisPersonSelection({
    map,
    maplibregl: { Popup },
    fetchJson,
    hashBytes,
    language: 'en',
    ...extra,
  });
  return { map, bubble, visual, fetchJson, hashBytes, Popup };
}

describe("GIS person selection visual", () => {
  test("loads promoted people artifacts from the nginx-mounted OTEF public path", () => {
    const base = "/otef-interactive/public/processed/layers/nli/";
    expect(PEOPLE_RUNTIME_URL).toBe(`${base}people.geojson`);
    expect(PEOPLE_INDEX_URL).toBe(`${base}people-search-index.json`);
    expect(PEOPLE_RELEASE_METADATA_URL).toBe(`${base}release-metadata.json`);
  });

  test("styles the name plaque as a slide citation, not a white UI card", () => {
    const css = readFileSync(new URL("../../frontend/css/styles.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.gis-person-bubble-popup\s*\{[^}]*--gis-person-selection-paper:\s*#fffbf8/);
    expect(css).toMatch(/\.gis-person-bubble-popup\s*\{[^}]*--gis-person-selection-band:\s*#e6ddd2/);
    expect(css).toMatch(/\.gis-person-bubble-popup\s*\{[^}]*--gis-person-selection-hairline:\s*#c9bfb2/);
    expect(css).toMatch(/\.gis-person-bubble-popup\s*\{[^}]*--gis-person-selection-text-size:\s*24px/);
    expect(css).toMatch(/\.gis-person-bubble-popup\s+\.maplibregl-popup-content\s*\{[^}]*background:\s*var\(--gis-person-selection-paper\)/);
    expect(css).toMatch(/\.gis-person-bubble-popup\s+\.maplibregl-popup-content\s*\{[^}]*min-width:\s*0/);
    expect(css).toMatch(/\.gis-person-bubble-popup\s+\.maplibregl-popup-content\s*\{[^}]*border-radius:\s*0/);
    expect(css).toMatch(/\.gis-person-bubble-popup\s+\.maplibregl-popup-content\s*\{[^}]*box-shadow:\s*none/);
    expect(css).toMatch(/\.gis-person-bubble-popup\s+\.maplibregl-popup-content\s*\{[^}]*padding:\s*0/);
    expect(css).toMatch(/\.gis-person-bubble-popup\.maplibregl-popup-anchor-bottom[\s\S]{0,220}?\{[^}]*border-top-color:\s*var\(--gis-person-selection-paper\)/);
    expect(css).toMatch(/\.gis-person-bubble::before\s*\{[^}]*background:\s*var\(--gis-person-selection-band\)/);
    expect(css).toMatch(/\.gis-person-bubble__name\s*\{[^}]*font-family:\s*"Hadassah Friedlaender"/);
    expect(css).toMatch(/\.gis-person-bubble__name\s*\{[^}]*font-weight:\s*400/);
    expect(css).toMatch(/\.gis-person-bubble__name\s*\{[^}]*font-synthesis:\s*none/);
    expect(css).toMatch(/\.gis-person-bubble__name\s*\{[^}]*-webkit-line-clamp:\s*2/);
    expect(css).not.toMatch(/\.gis-person-bubble-popup--link\s+\.gis-person-bubble__name\s*\{[^}]*text-decoration:\s*underline/);
    expect(css).not.toMatch(/\.gis-person-bubble__location/);
    expect(css).not.toMatch(/\.gis-person-bubble__name\s*\{[^}]*font-weight:\s*700/);
  });

  test("builds a close-button-free popup that can shrink around a short name", () => {
    const d = setup();
    expect(d.Popup).toHaveBeenCalledWith(expect.objectContaining({
      className: "gis-person-bubble-popup",
      closeButton: false,
      closeOnClick: false,
      maxWidth: "280px",
    }));
  });

  test("normalizes exact PIDs and versions, and rejects malformed or duplicate runtime data", () => {
    expect(normalizePeopleRuntime(geojson(), index(), metadata()).resolve("11", "v1", 'en')).toMatchObject({
      pid: "11", coordinates: [30, 20], name: "<Ada>", location: "Alumim",
    });
    expect(() => normalizePeopleRuntime({ type: "FeatureCollection", datasetVersion: "v1", features: [{}] }, index(), metadata())).toThrow(/geometry/i);
    expect(() => normalizePeopleRuntime(geojson(), { ...index(), people: [index().people[0], index().people[0]] }, metadata())).toThrow(/duplicate/i);
    expect(normalizePeopleRuntime(geojson(), index(), metadata()).resolve("11", "old")).toBeNull();
  });

  test("rejects a release whose metadata, geometry, and index versions disagree", () => {
    expect(() => normalizePeopleRuntime(geojson(), index("v1"), metadata("v2"))).toThrow(/version/i);
    expect(() => normalizePeopleRuntime({ ...geojson(), datasetVersion: "v0" }, index("v1"), metadata("v1"))).toThrow(/version/i);
    expect(() => normalizePeopleRuntime({ ...geojson(), datasetVersion: undefined }, index(), metadata())).toThrow(/version/i);
  });

  test("copies only display fallback fields from feature properties", () => {
    const source = geojson();
    source.features[0].properties.name = "Feature Name";
    const runtime = normalizePeopleRuntime(source, { ...index(), people: [{ pid: "11", nameForms: [] }] }, metadata());
    source.features[0].properties.name = "SECRET BIOGRAPHY";
    expect(runtime.resolve("11", "v1", 'en').name).toBe("Feature Name");
    expect(JSON.stringify(runtime)).not.toContain("SECRET BIOGRAPHY");
  });

  test("loads runtime files once through the injected boundary", async () => {
    const d = setup();
    await Promise.all([d.visual.load(), d.visual.load()]);
    expect(d.fetchJson).toHaveBeenCalledTimes(3);
    expect(d.hashBytes).toHaveBeenCalledTimes(1);
  });

  test("fails closed when fetched GeoJSON bytes cannot be proven against runtime metadata", async () => {
    const d = setup(vi.fn(async (url) => url.includes("index") ? fetched(index()) : url.includes("metadata") ? fetched(metadata()) : { data: geojson() }));
    await expect(d.visual.load()).rejects.toThrow(/hash|bytes/i);
  });

  test("show dims other people without a halo overlay and escaped name-only popup", async () => {
    const d = setup();
    d.map.addLayer({ id: "nli__people__circle", type: "circle", source: "nli.people" });
    d.map.setPaintProperty("nli__people__circle", "circle-opacity", 1);
    const person = await d.visual.resolve("11", "v1");
    d.visual.show(person);
    expect(d.map.getLayer(PEOPLE_HALO_LAYER_ID)).toBeNull();
    expect(d.map.getSource(PEOPLE_SOURCE_ID)).toBeNull();
    expect(d.map.getPaintProperty("nli__people__circle", "circle-opacity")[0]).toBe("case");
    expect(d.bubble.setHTML.mock.calls[0][0]).toContain("&lt;Ada&gt;");
    expect(d.bubble.setHTML.mock.calls[0][0]).toContain('class="gis-person-bubble__name"');
    expect(d.bubble.setHTML.mock.calls[0][0]).not.toContain("Alumim");
    expect(d.bubble.setHTML.mock.calls[0][0]).not.toMatch(/gis-person-bubble__location/);
    expect(d.bubble.setHTML.mock.calls[0][0]).toContain('dir="ltr"');
    expect(d.bubble.setHTML.mock.calls[0][0]).not.toMatch(/nli_url|button|archive/i);
  });

  test("show dims other catalog people and hide restores them", async () => {
    const d = setup();
    const peopleLayer = { id: "nli__people__circle", type: "circle", source: "nli.people" };
    d.map.addLayer(peopleLayer);
    d.map.setPaintProperty("nli__people__circle", "circle-opacity", 1);
    const person = await d.visual.resolve("11", "v1");
    d.visual.show(person);
    expect(d.map.getPaintProperty("nli__people__circle", "circle-opacity")[0]).toBe("case");
    d.visual.hide();
    expect(d.map.getPaintProperty("nli__people__circle", "circle-opacity")).toBe(1);
  });

  test("show does not mount a plaque when the person has no usable name", () => {
    const d = setup();
    d.visual.show({ pid: "11", coordinates: [30, 20], name: "   ", nliUrl: "https://www.nli.org.il/he/authorities/11" });
    expect(d.bubble.setHTML).not.toHaveBeenCalled();
    expect(d.bubble.addTo).not.toHaveBeenCalled();
  });

  test("clicking the bubble hands the person with an archive record to onBubbleClick", async () => {
    const classes = new Set();
    const element = { onclick: null, classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)) } };
    const onBubbleClick = vi.fn();
    const d = setup(undefined, undefined, { onBubbleClick });
    d.bubble.getElement = () => element;
    d.visual.show({ pid: "11", coordinates: [30, 20], name: "Ada", nliUrl: "https://www.nli.org.il/he/authorities/11" });
    expect(classes.has("gis-person-bubble-popup--link")).toBe(true);
    element.onclick();
    expect(onBubbleClick).toHaveBeenCalledWith(expect.objectContaining({ pid: "11" }));

    d.visual.show({ pid: "12", coordinates: [30, 20], name: "Bo" });
    expect(classes.has("gis-person-bubble-popup--link")).toBe(false);
    expect(element.onclick).toBeNull();
  });

  test("focus uses camera and delays popup until idle, while hide permits remount", async () => {
    const beginCameraTravel = vi.fn();
    const d = setup(undefined, undefined, { beginCameraTravel });
    const person = await d.visual.resolve("11", "v1");
    d.visual.show(person, { focus: true });
    expect(beginCameraTravel).toHaveBeenCalled();
    expect(d.map.flyTo).toHaveBeenCalledWith(expect.objectContaining({
      center: [30, 20], zoom: 16, duration: 1600, essential: true,
    }));
    expect(d.bubble.addTo).not.toHaveBeenCalled();
    d.map.emit("moveend");
    expect(d.bubble.addTo).toHaveBeenCalledTimes(1);
    d.visual.hide();
    expect(d.map.getLayer(PEOPLE_HALO_LAYER_ID)).toBeNull();
    d.visual.show(person);
    expect(d.map.getLayer(PEOPLE_HALO_LAYER_ID)).toBeNull();
  });

  test("clearing a focused person flies back to the pre-focus camera", async () => {
    const beginCameraTravel = vi.fn();
    const d = setup(undefined, undefined, { beginCameraTravel });
    d.map.getCenter = vi.fn(() => ({ lng: 34.4, lat: 31.3 }));
    d.map.getZoom = vi.fn(() => 10);
    d.map.getBearing = vi.fn(() => 12);
    d.map.getPitch = vi.fn(() => 0);
    const person = await d.visual.resolve("11", "v1");
    d.visual.show(person, { focus: true });
    d.map.flyTo.mockClear();
    beginCameraTravel.mockClear();
    d.visual.hide({ restoreCamera: true });
    expect(beginCameraTravel).toHaveBeenCalled();
    expect(d.map.flyTo).toHaveBeenCalledWith(expect.objectContaining({
      center: { lng: 34.4, lat: 31.3 },
      zoom: 10,
      bearing: 12,
      pitch: 0,
      duration: 1600,
      essential: true,
    }));
  });

  test("a hide without restore discards the saved overview camera", async () => {
    const d = setup();
    d.map.getCenter = vi.fn(() => ({ lng: 34.4, lat: 31.3 }));
    d.map.getZoom = vi.fn(() => 10);
    const person = await d.visual.resolve("11", "v1");
    d.visual.show(person, { focus: true });
    d.map.flyTo.mockClear();
    d.visual.hide();
    d.visual.hide({ restoreCamera: true });
    expect(d.map.flyTo).not.toHaveBeenCalled();
  });

  test("viewport helper uses projected point and 32px padding", async () => {
    const d = setup();
    const person = await d.visual.resolve("11", "v1");
    d.map.project.mockReturnValue({ x: -31, y: 301 });
    expect(d.visual.isInsidePaddedViewport(person)).toBe(true);
    d.map.project.mockReturnValue({ x: -33, y: 301 });
    expect(d.visual.isInsidePaddedViewport(person)).toBe(false);
  });

  test("style reload remounts current visual, and dispose cancels late camera callbacks", async () => {
    const d = setup();
    const person = await d.visual.resolve("11", "v1");
    d.visual.show(person, { focus: true });
    d.visual.hide();
    d.map.emit("moveend");
    expect(d.bubble.addTo).not.toHaveBeenCalled();
    d.visual.show(person);
    d.map.wipeStyle();
    d.map.emit("style.load");
    expect(d.map.getLayer(PEOPLE_HALO_LAYER_ID)).toBeNull();
    d.visual.dispose();
    d.map.emit("style.load");
    expect(d.map.getLayer(PEOPLE_HALO_LAYER_ID)).toBeNull();
  });

  test("disposal makes a pending runtime resolution stale", async () => {
    const pending = [];
    const d = setup(() => new Promise((resolve) => pending.push(resolve)));
    const result = d.visual.resolve("11", "v1");
    d.visual.dispose();
    pending[0](fetched(geojson())); pending[1](fetched(index())); pending[2](fetched(metadata()));
    await expect(result).resolves.toBeNull();
  });

  test("hide and replacement make pending runtime resolutions stale", async () => {
    let releases = [];
    const d = setup(() => new Promise((resolve) => releases.push(resolve)));
    const pending = d.visual.resolve("11", "v1");
    d.visual.hide();
    releases[0](fetched(geojson())); releases[1](fetched(index())); releases[2](fetched(metadata()));
    await expect(pending).resolves.toBeNull();

    releases = [];
    const d2 = setup(() => new Promise((resolve) => releases.push(resolve)));
    const stale = d2.visual.resolve("11", "v1");
    d2.visual.show({ pid: "new", coordinates: [31, 21], name: "New", location: "Elsewhere" });
    releases[0](fetched(geojson())); releases[1](fetched(index())); releases[2](fetched(metadata()));
    await expect(stale).resolves.toBeNull();
  });

  test("reduced-motion focus shows the bubble synchronously after zero-duration camera", async () => {
    const d = setup();
    const person = await d.visual.resolve("11", "v1");
    d.visual.show(person, { focus: true, reducedMotion: true });
    expect(d.map.flyTo).toHaveBeenCalledWith(expect.objectContaining({
      center: [30, 20], zoom: 16, duration: 0, essential: true,
    }));
    expect(d.bubble.addTo).toHaveBeenCalledTimes(1);
    expect(d.map.listenerCount("moveend")).toBe(0);
  });

  test("halo helper does not start its own RAF or add a halo layer", () => {
    const map = createFakeMapLibreMap();
    const raf = vi.fn();
    vi.spyOn(map, "addLayer");
    vi.stubGlobal("requestAnimationFrame", raf);
    mountPersonHalo(map, { pid: "11", coordinates: [34.5, 31.4] }, { motionMode: "full" });
    syncPersonHaloPaint(map, { motionMode: "full", nowMs: 1000 });
    expect(raf).not.toHaveBeenCalled();
    expect(map.addLayer).not.toHaveBeenCalled();
    expect(map.getLayer(PEOPLE_HALO_LAYER_ID)).toBeNull();
  });

  test("mountPersonHalo removes a leftover halo overlay and dims others", () => {
    const map = createFakeMapLibreMap();
    map.addSource(PEOPLE_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: PEOPLE_HALO_LAYER_ID, type: "circle", source: PEOPLE_SOURCE_ID });
    map.addLayer({ id: "nli__people__circle", type: "circle", source: "nli.people" });
    map.setPaintProperty("nli__people__circle", "circle-opacity", 1);
    vi.spyOn(map, "addLayer");
    mountPersonHalo(map, { pid: "11", coordinates: [34.5, 31.4] });
    expect(map.addLayer.mock.calls.every(([layer]) => layer.id !== PEOPLE_HALO_LAYER_ID)).toBe(true);
    expect(map.getLayer(PEOPLE_HALO_LAYER_ID)).toBeNull();
    expect(map.getSource(PEOPLE_SOURCE_ID)).toBeNull();
    expect(map.getPaintProperty("nli__people__circle", "circle-opacity")[0]).toBe("case");
    clearPersonHalo(map);
    expect(map.getPaintProperty("nli__people__circle", "circle-opacity")).toBe(1);
  });

  test("syncPersonHaloPaint does not pulse leftover halo opacity", () => {
    const map = createFakeMapLibreMap();
    map.addSource(PEOPLE_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({
      id: PEOPLE_HALO_LAYER_ID,
      type: "circle",
      source: PEOPLE_SOURCE_ID,
      paint: { "circle-opacity": 0.25 },
    });
    vi.spyOn(map, "setPaintProperty");
    syncPersonHaloPaint(map, { motionMode: "full", nowMs: 1000 });
    expect(map.setPaintProperty).not.toHaveBeenCalled();
    expect(map.getPaintProperty(PEOPLE_HALO_LAYER_ID, "circle-opacity")).toBe(0.25);
  });

  test("moveend snapshot replacement keeps the current camera listener alive", async () => {
    const d = setup();
    const first = await d.visual.resolve("11", "v1");
    let replaced = false;
    const replacement = () => {
      d.map.off("moveend", replacement);
      if (!replaced) {
        replaced = true;
        d.visual.show({ pid: "12", coordinates: [31, 21], name: "Replacement", location: "Elsewhere" }, { focus: true });
      }
    };
    d.map.on("moveend", replacement);
    d.visual.show(first, { focus: true });
    d.map.emit("moveend");
    expect(d.map.listenerCount("moveend")).toBe(1);
    d.map.emit("moveend");
    expect(d.bubble.setHTML.mock.calls.at(-1)[0]).toContain("Replacement");
  });

});

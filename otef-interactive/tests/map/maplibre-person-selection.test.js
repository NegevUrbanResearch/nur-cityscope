import { describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import {
  PEOPLE_HALO_LAYER_ID,
  PEOPLE_INDEX_URL,
  PEOPLE_RELEASE_METADATA_URL,
  PEOPLE_RUNTIME_URL,
  PEOPLE_SOURCE_ID,
  createGisPersonSelection,
  normalizePeopleRuntime,
} from "../../frontend/src/map/maplibre-person-selection.js";

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
const popup = () => ({
  setLngLat: vi.fn().mockReturnThis(), setHTML: vi.fn().mockReturnThis(),
  addTo: vi.fn().mockReturnThis(), remove: vi.fn(),
});
function setup(fetchJson = vi.fn(async (url) => url.includes("index") ? fetched(index()) : url.includes("metadata") ? fetched(metadata()) : fetched(geojson())), hashBytes = vi.fn(async () => "geo-hash-v1")) {
  const map = createFakeMapLibreMap();
  Object.assign(map, {
    getCanvas: () => ({ clientWidth: 400, clientHeight: 300 }),
    project: vi.fn(([lng, lat]) => ({ x: lng * 10, y: lat * 10 })),
    flyTo: vi.fn(),
  });
  const bubble = popup();
  const visual = createGisPersonSelection({ map, maplibregl: { Popup: vi.fn(function Popup() { return bubble; }) }, fetchJson, hashBytes });
  return { map, bubble, visual, fetchJson, hashBytes };
}

describe("GIS person selection visual", () => {
  test("loads promoted people artifacts from the nginx-mounted OTEF public path", () => {
    const base = "/otef-interactive/public/processed/layers/nli/";
    expect(PEOPLE_RUNTIME_URL).toBe(`${base}people.geojson`);
    expect(PEOPLE_INDEX_URL).toBe(`${base}people-search-index.json`);
    expect(PEOPLE_RELEASE_METADATA_URL).toBe(`${base}release-metadata.json`);
  });

  test("applies the selection text-size token to each bounded bubble line", () => {
    const css = readFileSync(new URL("../../frontend/css/styles.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.gis-person-bubble__name,\s*\.gis-person-bubble__location\s*\{[\s\S]*font-size:\s*var\(--gis-person-selection-text-size\)/);
  });

  test("normalizes exact PIDs and versions, and rejects malformed or duplicate runtime data", () => {
    expect(normalizePeopleRuntime(geojson(), index(), metadata()).resolve("11", "v1")).toMatchObject({
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
    expect(runtime.resolve("11", "v1").name).toBe("Feature Name");
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

  test("show mounts one transparent-fill halo and escaped name/location popup", async () => {
    const d = setup();
    const person = await d.visual.resolve("11", "v1");
    d.visual.show(person);
    expect(d.map.getSource(PEOPLE_SOURCE_ID)).toBeTruthy();
    expect(d.map.getLayer(PEOPLE_HALO_LAYER_ID).paint["circle-opacity"]).toBe(0);
    expect(d.bubble.setHTML.mock.calls[0][0]).toContain("&lt;Ada&gt;");
    expect(d.bubble.setHTML.mock.calls[0][0]).toContain("Alumim");
    expect(d.bubble.setHTML.mock.calls[0][0].match(/dir="auto"/g)).toHaveLength(3);
    expect(d.bubble.setHTML.mock.calls[0][0]).not.toMatch(/nli_url|button|archive/i);
  });

  test("focus uses camera and delays popup until idle, while hide permits remount", async () => {
    const d = setup();
    const person = await d.visual.resolve("11", "v1");
    d.visual.show(person, { focus: true });
    expect(d.map.flyTo).toHaveBeenCalledWith(expect.objectContaining({
      center: [30, 20], zoom: 15, duration: 1600, essential: true,
    }));
    expect(d.bubble.addTo).not.toHaveBeenCalled();
    d.map.emit("moveend");
    expect(d.bubble.addTo).toHaveBeenCalledTimes(1);
    d.visual.hide();
    expect(d.map.getLayer(PEOPLE_HALO_LAYER_ID)).toBeNull();
    d.visual.show(person);
    expect(d.map.getLayer(PEOPLE_HALO_LAYER_ID)).toBeTruthy();
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
    expect(d.map.getLayer(PEOPLE_HALO_LAYER_ID)).toBeTruthy();
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
      center: [30, 20], zoom: 15, duration: 0, essential: true,
    }));
    expect(d.bubble.addTo).toHaveBeenCalledTimes(1);
    expect(d.map.listenerCount("moveend")).toBe(0);
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

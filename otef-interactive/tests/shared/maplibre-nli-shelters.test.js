import { describe, it, expect, vi } from "vitest";
import { GeoJSONVT } from "@maplibre/geojson-vt";
import { fromGeojsonVt } from "@maplibre/vt-pbf";
import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import { createExpression } from "@maplibre/maplibre-gl-style-spec";
import {
  createShelterRenderer,
  SHELTER_LAYER_ID,
  SHELTER_SOURCE_ID,
} from "../../frontend/src/shared/maplibre-nli-shelters.js";
import {
  shelterImageSpec,
  paintShelterSymbol,
} from "../../frontend/src/shared/nli-shelter-symbol.js";
function mapFake() {
  const layers = [
      { id: "areas", type: "fill" },
      { id: "nli__people-circle", type: "circle" },
    ],
    sources = new Map(),
    images = new Map();
  return {
    getStyle: () => ({ layers }),
    getLayer: (id) => layers.find((l) => l.id === id),
    getSource: (id) => sources.get(id),
    addSource: (id, s) =>
      sources.set(id, {
        ...s,
        setData: vi.fn((d) => (sources.get(id).data = d)),
      }),
    addLayer: (l) => layers.push(l),
    moveLayer: (id, before) => {
      const i = layers.findIndex((l) => l.id === id);
      const l = layers.splice(i, 1)[0];
      layers.splice(
        before ? layers.findIndex((l) => l.id === before) : layers.length,
        0,
        l,
      );
    },
    removeLayer: (id) =>
      layers.splice(
        layers.findIndex((l) => l.id === id),
        1,
      ),
    removeSource: (id) => sources.delete(id),
    hasImage: (id) => images.has(id),
    addImage: (id, img, opts) => images.set(id, { img, opts }),
    removeImage: (id) => images.delete(id),
    setLayoutProperty: (id, k, v) => {
      const l = layers.find((l) => l.id === id);
      l.layout = { ...l.layout, [k]: v };
    },
    getPaintProperty: (id, k) => layers.find((l) => l.id === id)?.paint?.[k],
    setPaintProperty: (id, k, v) => {
      const l = layers.find((l) => l.id === id);
      l.paint = { ...l.paint, [k]: v };
    },
    project: (xy) => ({ x: xy[0], y: xy[1] }),
    getZoom: () => 12,
    on: vi.fn(),
    off: vi.fn(),
    images,
  };
}
const shelters = [
  {
    id: "a",
    geometry: { type: "Point", coordinates: [300, 300] },
    properties: { nameHe: "name" },
  },
  {
    id: "b",
    geometry: { type: "Point", coordinates: [305, 300] },
    properties: {},
  },
];
const imageFactory = () => ({
  width: 56,
  height: 48,
  data: new Uint8Array(56 * 48 * 4),
});
describe("decorative shelter renderer", () => {
  it("keeps Aner Shapira's shelter visible after real GeoJSON tile encoding", () => {
    const m = mapFake();
    const cohort = [
      { id: "nli-shelter-reim-west", geometry: { type: "Point", coordinates: [34.457993, 31.389735] }, properties: { personPids: ["744"] } },
      { id: "nli-shelter-reim-east", geometry: { type: "Point", coordinates: [34.459024, 31.389705] }, properties: { personPids: ["692"] } },
    ];
    const renderer = createShelterRenderer(m, { displayProfile: "gis", imageFactory });
    renderer.render({ visible: true, shelters: cohort, focusPersonId: "744", impactedIds: new Set() });
    const tile = new GeoJSONVT(m.getSource(SHELTER_SOURCE_ID).data).getTile(0, 0, 0);
    const decoded = new VectorTile(new Pbf(fromGeojsonVt({ shelters: tile }))).layers.shelters;
    const expression = createExpression(m.getPaintProperty(SHELTER_LAYER_ID, "icon-opacity"));
    expect(expression.result).toBe("success");
    expect(Array.from({ length: decoded.length }, (_, i) =>
      expression.value.evaluate({ zoom: 0 }, decoded.feature(i)))).toEqual([1, 0]);
    renderer.dispose();
  });
  it.each(["gis", "projection"])("uses the mural only for Re'im west and draws it above neighbors on %s", (displayProfile) => {
    const m = mapFake();
    const factory = vi.fn(imageFactory);
    const cohort = [
      { ...shelters[0], id: "nli-shelter-reim-west" },
      { ...shelters[1], id: "nli-shelter-reim-east" },
    ];
    const renderer = createShelterRenderer(m, { displayProfile, imageFactory: factory,
      getProjectionPresentation: () => ({ inputCapture: true, sourceDimensions: { width: 960, height: 540 }, outputResolution: { width: 1920, height: 1080 } }),
    });
    renderer.render({ visible: true, shelters: cohort, impactedIds: new Set(cohort.map(s => s.id)) });
    const features = m.getSource(SHELTER_SOURCE_ID).data.features;
    expect(features.map(f => f.properties.iconImage)).toEqual(["nli-shelter-mural-red", "nli-shelter-concrete-red"]);
    expect(features.map(f => f.properties.shelterPriority)).toEqual([1, 0]);
    expect(m.getLayer(SHELTER_LAYER_ID).layout["symbol-sort-key"]).toEqual(["get", "shelterPriority"]);
    expect(m.getLayer(SHELTER_LAYER_ID).layout["symbol-z-order"]).toBe("source");
    expect(factory).toHaveBeenCalledWith("#c31f4f", "mural");
    renderer.render({ visible: true, shelters: cohort, impactedIds: new Set() });
    expect(m.getSource(SHELTER_SOURCE_ID).data.features.map(f => f.properties.iconImage)).toEqual(["nli-shelter-mural-neutral", "nli-shelter-concrete-neutral"]);
  });
  it("animates the mural and ordinary shelter independently using their own sprite pairs", () => {
    const m = mapFake();
    m.updateImage = vi.fn((id, img) => { m.images.get(id).img = img; });
    let time = 0, tick;
    const cohort = [{ ...shelters[0], id: "nli-shelter-reim-west" }, shelters[1]];
    const renderer = createShelterRenderer(m, {
      imageFactory: (color, variant) => ({ width: 1, height: 1, data: new Uint8Array([color === "#c31f4f" ? 200 : 100, variant === "mural" ? 80 : 0, 0, 255]) }),
      now: () => time,
      requestAnimationFrame: fn => { tick = fn; return 1; },
      cancelAnimationFrame: () => {},
    });
    renderer.render({ visible: true, shelters: cohort, impactedIds: new Set() });
    renderer.render({ visible: true, shelters: cohort, impactedIds: new Set(cohort.map(s => s.id)) });
    time = 150; tick(time);
    const features = m.getSource(SHELTER_SOURCE_ID).data.features;
    expect([...m.images.get(features[0].properties.iconImage).img.data]).toEqual([150, 80, 0, 255]);
    expect([...m.images.get(features[1].properties.iconImage).img.data]).toEqual([150, 0, 0, 255]);
  });
  it("rotates projection map icons 85 degrees while GIS uses the unrotated glyph", () => {
    const mesh = {
      width: 1920,
      height: 1080,
      vertices: [
        { u: 0, v: 0, x: 0, y: 0 },
        { u: 1, v: 0, x: 1, y: 0 },
        { u: 1, v: 1, x: 1, y: 1 },
        { u: 0, v: 1, x: 0, y: 1 },
      ],
      triangles: [0, 1, 2, 0, 2, 3],
    };
    for (const [displayProfile, rotation] of [
      ["gis", 0],
      ["projection", 85],
    ]) {
      const m = mapFake();
      const renderer = createShelterRenderer(m, {
        displayProfile,
        imageFactory,
        getProjectionPresentation: () => ({
          mesh,
          sourceDimensions: { width: 960, height: 540 },
          outputResolution: { width: 1920, height: 1080 },
        }),
      });
      renderer.render({ visible: true, shelters, impactedIds: new Set(["b"]) });
      expect(m.getLayer(SHELTER_LAYER_ID).layout["icon-rotate"]).toEqual([
        "get",
        "iconRotation",
      ]);
      expect(
        m
          .getSource(SHELTER_SOURCE_ID)
          .data.features.map((f) => f.properties.iconRotation),
      ).toEqual([rotation, rotation]);
    }
  });
  it("keeps neighbors visible and independent, below people, without labels", () => {
    const m = mapFake(),
      r = createShelterRenderer(m, { displayProfile: "gis", imageFactory });
    r.render({ visible: true, shelters, impactedIds: new Set(["b"]) });
    const layer = m.getLayer(SHELTER_LAYER_ID),
      data = m.getSource(SHELTER_SOURCE_ID).data;
    expect(layer.layout["icon-allow-overlap"]).toBe(true);
    expect(layer.layout["icon-ignore-placement"]).toBe(true);
    expect(layer.layout["text-field"]).toBeUndefined();
    expect(data.features.map((f) => f.properties.impacted)).toEqual([
      false,
      true,
    ]);
    expect(data.features.map((f) => f.geometry.coordinates)).toEqual([
      [300, 300],
      [305, 300],
    ]);
    expect(m.getStyle().layers.map((l) => l.id)).toEqual([
      "areas",
      SHELTER_LAYER_ID,
      "nli__people-circle",
    ]);
    expect(
      [...m.images.values()].every(
        (i) => i.opts.pixelRatio === 2 && i.opts.sdf === false,
      ),
    ).toBe(true);
  });
  it("does not republish an unchanged tick, hides immediately and disposes owned resources", () => {
    const m = mapFake(),
      r = createShelterRenderer(m, { imageFactory });
    const frame = { visible: true, shelters, impactedIds: new Set() };
    r.render(frame);
    const source = m.getSource(SHELTER_SOURCE_ID);
    source.setData.mockClear();
    r.render(frame);
    expect(source.setData).not.toHaveBeenCalled();
    r.render({ ...frame, visible: false });
    expect(m.getLayer(SHELTER_LAYER_ID).layout.visibility).toBe("none");
    r.dispose();
    expect(m.getLayer(SHELTER_LAYER_ID)).toBeUndefined();
    expect(m.images.size).toBe(0);
  });
  it.each(["normal", "mural"])("tints the whole %s shelter red while retaining its recessed entrance and geometry", (variant) => {
    vi.stubGlobal("Path2D", class { constructor(path) { this.path = path; } });
    const commands = (color) => {
      const rows = [];
      const ctx = new Proxy({
        fillStyle: "",
        fill(path) {
          rows.push([this.fillStyle, path?.path || "eye"]);
        },
      }, { get: (target, key) => key in target ? target[key] : () => {} });
      paintShelterSymbol(ctx, {
        cx: 12,
        cy: 12,
        bodyWidthPx: 12,
        bodyColor: color,
        variant,
        separatorPx: 0.5,
      });
      return rows;
    };
    const warm = commands("#fff7ed"),
      red = commands("#c31f4f");
    expect(warm.map((r) => r.slice(1))).toEqual(red.map((r) => r.slice(1)));
    expect(warm.some(r => r[0] === "#15282e")).toBe(true);
    expect(red.some(r => r[0] === "#380e1b")).toBe(true);
    expect(red.some(r => r[0] === "#f0aabb")).toBe(true);
    expect(red.some(r => ["#eeecdf", "#f4f2e5", "#aabcb7", "#526668", "#1584bb", "#b69976"].includes(r[0]))).toBe(false);
    expect(red.some(r => r[0] === "#c31f4f")).toBe(true);
    const one = shelterImageSpec(1),
      two = shelterImageSpec(2);
    expect(two.width).toBe(one.width * 2);
    expect(two.bodyBounds).toEqual(one.bodyBounds);
    vi.unstubAllGlobals();
  });
});

it("blends independently and reverses without republishing semantic frames", () => {
  const m = mapFake();
  m.updateImage = vi.fn((id, img) => { m.images.get(id).img = img; });
  let time = 0, callback;
  const cancel = vi.fn();
  const r = createShelterRenderer(m, {
    imageFactory: (color) => ({ width: 1, height: 1, data: new Uint8Array(color === "#c31f4f" ? [200, 0, 0, 255] : [100, 100, 100, 255]) }),
    now: () => time,
    requestAnimationFrame: (fn) => { callback = fn; return 1; },
    cancelAnimationFrame: cancel,
  });
  const frame = { visible: true, shelters, impactedIds: new Set() };
  r.render(frame);
  r.render({ ...frame, impactedIds: new Set(["a"]) });
  const source = m.getSource(SHELTER_SOURCE_ID);
  source.setData.mockClear();
  time = 150; callback(time);
  const id = source.data.features[0].properties.iconImage;
  expect(Array.from(m.images.get(id).img.data)).toEqual([150, 50, 50, 255]);
  r.render({ ...frame, impactedIds: new Set(["a"]) });
  expect(source.setData).not.toHaveBeenCalled();
  r.render(frame);
  time = 300; callback(time);
  expect(Array.from(m.images.get(id).img.data)).toEqual([125, 75, 75, 255]);
  r.render({ ...frame, visible: false });
  expect(cancel).toHaveBeenCalled();
  r.dispose();
  expect(m.images.size).toBe(0);
});

it("settles first entry and reduced motion immediately, restoring owned icons after style replacement", () => {
  const m = mapFake();
  m.updateImage = vi.fn((id, img) => { m.images.get(id).img = img; });
  const request = vi.fn();
  const r = createShelterRenderer(m, {
    imageFactory: (color) => ({ width: 1, height: 1, data: new Uint8Array(color === "#c31f4f" ? [200, 0, 0, 255] : [100, 100, 100, 255]) }),
    requestAnimationFrame: request,
    getMotionMode: () => "reduced",
  });
  const frame = { visible: true, shelters, impactedIds: new Set(["a"]) };
  r.render(frame);
  const image = m.getSource(SHELTER_SOURCE_ID).data.features[0].properties.iconImage;
  expect(Array.from(m.images.get(image).img.data)).toEqual([200, 0, 0, 255]);
  expect(request).not.toHaveBeenCalled();
  m.removeLayer(SHELTER_LAYER_ID);
  m.removeSource(SHELTER_SOURCE_ID);
  m.images.clear();
  r.render(frame);
  expect(m.hasImage(image)).toBe(true);
  r.render({ ...frame, impactedIds: new Set() });
  expect(Array.from(m.images.get(image).img.data)).toEqual([100, 100, 100, 255]);
  r.dispose();
  expect(m.images.size).toBe(0);
});

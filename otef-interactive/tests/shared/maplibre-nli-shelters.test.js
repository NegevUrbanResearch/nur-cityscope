import { describe, it, expect, vi } from "vitest";
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
  it("uses identical filled geometry and opaque black doorway for both states", () => {
    const commands = (color) => {
      const rows = [];
      const ctx = {
        fillStyle: "",
        fillRect(...xy) {
          rows.push([this.fillStyle, ...xy]);
        },
      };
      paintShelterSymbol(ctx, {
        cx: 12,
        cy: 12,
        bodyWidthPx: 12,
        bodyColor: color,
        separatorPx: 0.5,
      });
      return rows;
    };
    const warm = commands("#fff7ed"),
      red = commands("#c31f4f");
    expect(warm.map((r) => r.slice(1))).toEqual(red.map((r) => r.slice(1)));
    const door = warm.at(-1);
    expect(door[0]).toBe("#000000");
    expect(door[3]).toBeCloseTo(3.6);
    const one = shelterImageSpec(1),
      two = shelterImageSpec(2);
    expect(two.width).toBe(one.width * 2);
    expect(two.bodyBounds).toEqual(one.bodyBounds);
  });
});

import { describe, expect, test } from "vitest";
import {
  buildSettlementNameCatalog,
  loadSettlementNameCatalog,
} from "../../frontend/src/shared/settlement-name-catalog.js";

function collection(features) {
  return { type: "FeatureCollection", features };
}

function feature(citycode, text, lng, lat) {
  return {
    type: "Feature",
    properties: { citycode, cityname: text },
    geometry: { type: "Point", coordinates: [lng, lat] },
  };
}

describe("settlement name catalog", () => {
  test('joins names to outline geometry by reviewed citycode mapping', () => {
    const outline = { type: 'Feature', properties: { OBJECTID: 12 }, geometry: { type: 'Polygon', coordinates: [[[1,2],[2,2],[2,3],[1,2]]] } };
    const catalog = buildSettlementNameCatalog(collection([feature('1240', 'עין הבשור', 1.5, 2.5)]),
      { outlines: collection([outline]), outlineMap: { matches: [{ citycode: '1240', outlineObjectId: 12 }] } });
    expect(catalog.outlines.get('1240')).toEqual(outline.geometry.coordinates);
  });
  test('retains original text offsets separately from serialized catalog entries', () => {
    const source=feature('0067','label',34.4,31.3);
    source.properties.otef_map_text_offset_em=[-0.5,1.25];
    const catalog=buildSettlementNameCatalog(collection([source]));
    expect(catalog.referenceOffsets.get('0067')).toEqual([-0.5,1.25]);
    expect(Object.keys(catalog.entries[0])).toEqual(['citycode','text','lng','lat']);
  });
  test("keeps feature order, leading zeroes, and point coordinates", () => {
    const catalog = buildSettlementNameCatalog(collection([
      feature("0067", "נירים", 34.4, 31.3),
      feature("0424", "מחוץ", 34.2, 31.2),
    ]));
    expect(catalog.entries).toEqual([
      { citycode: "0067", text: "נירים", lng: 34.4, lat: 31.3 },
      { citycode: "0424", text: "מחוץ", lng: 34.2, lat: 31.2 },
    ]);
    expect(catalog.byCode.get("0067").text).toBe("נירים");
  });

  test("rejects duplicate and missing citycodes", () => {
    expect(() => buildSettlementNameCatalog(collection([
      feature("0067", "א", 1, 2),
      feature("0067", "ב", 3, 4),
    ]))).toThrow(/duplicate/i);
    expect(() => buildSettlementNameCatalog(collection([
      feature("", "א", 1, 2),
    ]))).toThrow(/citycode/i);
    expect(() => buildSettlementNameCatalog(collection([
      { type: "Feature", properties: { cityname: "א" }, geometry: { type: "Point", coordinates: [1, 2] } },
    ]))).toThrow(/citycode/i);
  });

  test("rejects non-point and nonfinite geometry", () => {
    expect(() => buildSettlementNameCatalog(collection([
      { type: "Feature", properties: { citycode: "0067", cityname: "א" }, geometry: { type: "LineString", coordinates: [[1, 2], [3, 4]] } },
    ]))).toThrow(/geometry/i);
    expect(() => buildSettlementNameCatalog(collection([
      feature("0067", "א", Number.NaN, 2),
    ]))).toThrow(/geometry/i);
  });

  test("loads the registry settlement source and honors abort", async () => {
    const calls = [];
    const registry = {
      getLayerDataUrl(id) {
        calls.push(id);
        return "/otef-interactive/public/processed/layers/projector_base/שמות_יישובים.geojson";
      },
    };
    const fetchImpl = async (url, options) => {
      calls.push(url);
      expect(options.signal.aborted).toBe(false);
      expect(options.cache).toBe('no-cache');
      return { ok: true, json: async () => collection([feature("0916", "עין", 34.5, 31.4)]) };
    };
    const catalog = await loadSettlementNameCatalog({ registry, fetchImpl, signal: new AbortController().signal });
    expect(catalog.entries[0].citycode).toBe("0916");
    expect(calls[0]).toBe("projector_base.שמות_יישובים");

    const controller = new AbortController();
    controller.abort();
    await expect(loadSettlementNameCatalog({
      registry,
      fetchImpl: async (_url, options) => {
        if (options.signal.aborted) throw new DOMException("aborted", "AbortError");
        return { ok: true, json: async () => collection([]) };
      },
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
  });
});

import { describe, expect, it } from "vitest";
import {
  DARK_BASEMAP_GUTTMAN_FONT_FACE_URL,
  DARK_BASEMAP_KNOWN_PLACE_TEXT_SIZE,
  DARK_BASEMAP_PLACE_TEXT_FONT,
  DARK_BASEMAP_TEXT_COLOR,
  DARK_BASEMAP_TEXT_FIELD,
  DARK_BASEMAP_UNKNOWN_PLACE_SIZE_SCALE,
  DARK_BASEMAP_UNKNOWN_PLACE_TEXT_OPACITY,
  applyDarkBasemapLabelPolicy,
  collectKnownBasemapPlaceNames,
  ensureGisNovaPlaceLabel,
  GIS_NOVA_PLACE_LABEL_LAYER_ID,
  raiseDarkBasemapPlaceLabels,
} from "../../frontend/src/map/dark-basemap-labels.js";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";

const BILINGUAL_NAME_FIELD = [
  "case",
  ["has", "name:nonlatin"],
  ["concat", ["get", "name:latin"], "\n", ["get", "name:nonlatin"]],
  ["coalesce", ["get", "name_en"], ["get", "name"]],
];

function layer(id, extras) {
  return {
    id,
    type: "symbol",
    source: "openmaptiles",
    ...extras,
  };
}

describe("applyDarkBasemapLabelPolicy", () => {
  it("shows Hebrew then English then local names on place layers, in white, without uppercase", () => {
    const style = {
      version: 8,
      layers: [
        layer("place_city", {
          "source-layer": "place",
          layout: {
            "text-field": BILINGUAL_NAME_FIELD,
            "text-transform": "uppercase",
          },
          paint: {
            "text-color": "rgb(101,101,101)",
            "text-halo-color": "rgba(0,0,0,0.7)",
          },
        }),
      ],
    };

    const next = applyDarkBasemapLabelPolicy(style);

    expect(next.layers[0].layout["text-field"]).toEqual(DARK_BASEMAP_TEXT_FIELD);
    expect(DARK_BASEMAP_TEXT_FIELD).toEqual([
      "coalesce",
      ["get", "name:he"],
      ["get", "name:en"],
      ["get", "name"],
    ]);
    expect(next.layers[0].paint["text-color"]).toBe(DARK_BASEMAP_TEXT_COLOR);
    expect(DARK_BASEMAP_TEXT_COLOR).toBe("#ffffff");
    expect(next.layers[0].layout["text-transform"]).toBeUndefined();
    expect(next.layers[0].paint["text-halo-color"]).toBe("rgba(0,0,0,0.7)");
    expect(style.layers[0].layout["text-field"]).toEqual(BILINGUAL_NAME_FIELD);
  });

  it("sets place labels to the projection settlement font stack and registers Guttman locally", () => {
    const style = {
      version: 8,
      glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
      layers: [
        layer("place_city", {
          "source-layer": "place",
          layout: { "text-field": BILINGUAL_NAME_FIELD, "text-font": ["Noto Sans Regular"], "text-size": 10 },
          paint: { "text-color": "rgb(101,101,101)" },
        }),
      ],
    };

    const next = applyDarkBasemapLabelPolicy(style, { knownPlaceNames: ["בארי"] });

    expect(DARK_BASEMAP_PLACE_TEXT_FONT).toEqual(["Guttman Hatzvi", "Noto Sans Regular"]);
    expect(next.layers[0].layout["text-font"]).toEqual(DARK_BASEMAP_PLACE_TEXT_FONT);
    expect(next["font-faces"]["Guttman Hatzvi"]).toEqual([
      { url: DARK_BASEMAP_GUTTMAN_FONT_FACE_URL },
    ]);
    expect(DARK_BASEMAP_GUTTMAN_FONT_FACE_URL).toBe("./fonts/Guttman-Hatzvi.ttf");
    expect(style["font-faces"]).toBeUndefined();
  });

  it("keeps road-name labels on Noto so OpenFreeMap glyphs still serve them", () => {
    const style = {
      version: 8,
      layers: [
        layer("highway_name_other", {
          "source-layer": "transportation_name",
          layout: {
            "text-field": BILINGUAL_NAME_FIELD,
            "text-font": ["Noto Sans Regular"],
            "text-size": 10,
          },
          paint: { "text-color": "rgba(80, 78, 78, 1)" },
        }),
      ],
    };

    const next = applyDarkBasemapLabelPolicy(style, { knownPlaceNames: ["בארי"] });

    expect(next.layers[0].layout["text-font"]).toEqual(["Noto Sans Regular"]);
    expect(next.layers[0].layout["text-size"]).toBe(10);
    expect(next.layers[0].paint["text-opacity"]).toBeUndefined();
  });

  it("makes known settlement names larger and other place names quieter", () => {
    const style = {
      version: 8,
      layers: [
        layer("place_village", {
          "source-layer": "place",
          layout: { "text-field": BILINGUAL_NAME_FIELD, "text-size": 10 },
          paint: { "text-color": "rgb(101,101,101)" },
        }),
      ],
    };

    const next = applyDarkBasemapLabelPolicy(style, { knownPlaceNames: ["בארי", "Be'eri"] });
    const knownMatch = ["in", DARK_BASEMAP_TEXT_FIELD, ["literal", ["בארי", "Be'eri"]]];

    expect(DARK_BASEMAP_KNOWN_PLACE_TEXT_SIZE).toBe(14);
    expect(next.layers[0].layout["text-size"]).toEqual([
      "case",
      knownMatch,
      DARK_BASEMAP_KNOWN_PLACE_TEXT_SIZE,
      10 * DARK_BASEMAP_UNKNOWN_PLACE_SIZE_SCALE,
    ]);
    expect(next.layers[0].paint["text-opacity"]).toEqual([
      "case",
      knownMatch,
      1,
      DARK_BASEMAP_UNKNOWN_PLACE_TEXT_OPACITY,
    ]);
    expect(DARK_BASEMAP_UNKNOWN_PLACE_TEXT_OPACITY).toBeGreaterThan(0.6);
    expect(DARK_BASEMAP_UNKNOWN_PLACE_TEXT_OPACITY).toBeLessThan(1);
    expect(DARK_BASEMAP_UNKNOWN_PLACE_SIZE_SCALE).toBeLessThan(1);
  });

  it("keeps zoom interpolations as the top-level text-size expression", () => {
    const interpolateSize = [
      "interpolate",
      ["linear"],
      ["zoom"],
      0,
      9,
      1,
      11,
    ];
    const style = {
      version: 8,
      layers: [
        layer("place_country_other", {
          "source-layer": "place",
          layout: { "text-field": BILINGUAL_NAME_FIELD, "text-size": interpolateSize },
          paint: { "text-color": "rgb(101,101,101)" },
        }),
      ],
    };

    const next = applyDarkBasemapLabelPolicy(style, { knownPlaceNames: ["בארי"] });
    const size = next.layers[0].layout["text-size"];
    const knownMatch = ["in", DARK_BASEMAP_TEXT_FIELD, ["literal", ["בארי"]]];

    expect(size[0]).toBe("interpolate");
    expect(size[2]).toEqual(["zoom"]);
    expect(size[4]).toEqual([
      "case",
      knownMatch,
      DARK_BASEMAP_KNOWN_PLACE_TEXT_SIZE,
      9 * DARK_BASEMAP_UNKNOWN_PLACE_SIZE_SCALE,
    ]);
    expect(size[6]).toEqual([
      "case",
      knownMatch,
      DARK_BASEMAP_KNOWN_PLACE_TEXT_SIZE,
      11 * DARK_BASEMAP_UNKNOWN_PLACE_SIZE_SCALE,
    ]);
  });

  it("collects selectable yeshuv and custom catalog names, including a קיבוץ prefix", () => {
    const names = collectKnownBasemapPlaceNames({
      entries: [
        {
          type: "yeshuv",
          selectable: true,
          name: { he: "בארי", en: "Be'eri" },
          aliases: { he: ["בארי"], en: ["Beeri"] },
        },
        {
          type: "custom",
          selectable: true,
          name: { he: "נובה", en: "Nova" },
          aliases: { he: ["נובה"] },
        },
        { type: "yeshuv", selectable: false, name: { he: "מוסתר" } },
        { type: "poi", selectable: true, name: { he: "צומת" } },
      ],
    });

    expect(names).toEqual(
      expect.arrayContaining(["בארי", "Be'eri", "Beeri", "קיבוץ בארי", "נובה", "Nova"]),
    );
    expect(names).not.toContain("מוסתר");
    expect(names).not.toContain("צומת");
  });

  it("treats Netivot, Ofakim, and Ashkelon as known GIS place names without a קיבוץ prefix", () => {
    const names = collectKnownBasemapPlaceNames({ entries: [] });

    expect(names).toEqual(
      expect.arrayContaining([
        "נתיבות",
        "Netivot",
        "אופקים",
        "Ofakim",
        "אשקלון",
        "Ashkelon",
      ]),
    );
    expect(names).not.toContain("קיבוץ נתיבות");
    expect(names).not.toContain("קיבוץ אופקים");
    expect(names).not.toContain("קיבוץ אשקלון");
  });

  it("applies the same name and color policy to named road labels", () => {
    const style = {
      version: 8,
      layers: [
        layer("highway_name_other", {
          "source-layer": "transportation_name",
          layout: {
            "text-field": BILINGUAL_NAME_FIELD,
            "text-transform": "uppercase",
          },
          paint: { "text-color": "rgba(80, 78, 78, 1)" },
        }),
      ],
    };

    const next = applyDarkBasemapLabelPolicy(style);

    expect(next.layers[0].layout["text-field"]).toEqual(DARK_BASEMAP_TEXT_FIELD);
    expect(next.layers[0].paint["text-color"]).toBe("#ffffff");
    expect(next.layers[0].layout["text-transform"]).toBeUndefined();
  });

  it("leaves motorway route numbers, water names, and non-symbol layers alone", () => {
    const motorway = layer("highway_name_motorway", {
      "source-layer": "transportation_name",
      layout: { "text-field": ["to-string", ["get", "ref"]] },
      paint: { "text-color": "hsl(0,0%,37%)" },
    });
    const water = layer("water_name", {
      "source-layer": "water_name",
      layout: { "text-field": BILINGUAL_NAME_FIELD },
      paint: { "text-color": "hsla(0,0%,0%,0.7)" },
    });
    const fill = {
      id: "building",
      type: "fill",
      source: "openmaptiles",
      paint: { "fill-color": "rgb(10,10,10)" },
    };
    const style = { version: 8, layers: [motorway, water, fill] };

    const next = applyDarkBasemapLabelPolicy(style);

    expect(next.layers[0]).toEqual(motorway);
    expect(next.layers[1]).toEqual(water);
    expect(next.layers[2]).toEqual(fill);
  });
});

describe("raiseDarkBasemapPlaceLabels", () => {
  it("moves basemap place labels above later fill overlays and keeps people names on top", () => {
    const map = createFakeMapLibreMap({
      layers: [
        { id: "place_village", type: "symbol", "source-layer": "place" },
        { id: "place_city", type: "symbol", "source-layer": "place" },
        { id: "highway_name_other", type: "symbol", "source-layer": "transportation_name" },
        { id: "projector_base__רקע_שחור__fill__0", type: "fill" },
        { id: "projector_base__ישובים__0", type: "line" },
        { id: "nli__people_names__labels", type: "symbol" },
        { id: "otef-person-selection-halo", type: "circle" },
      ],
    });

    raiseDarkBasemapPlaceLabels(map);

    expect(map.getStyle().layers.map((layer) => layer.id)).toEqual([
      "highway_name_other",
      "projector_base__רקע_שחור__fill__0",
      "projector_base__ישובים__0",
      "place_village",
      "place_city",
      GIS_NOVA_PLACE_LABEL_LAYER_ID,
      "nli__people_names__labels",
      "otef-person-selection-halo",
    ]);
  });
});

describe("ensureGisNovaPlaceLabel", () => {
  it("paints Nova on GIS like known settlement names, between Re'im and Be'eri", () => {
    const map = createFakeMapLibreMap();
    ensureGisNovaPlaceLabel(map);

    const layer = map.getLayer(GIS_NOVA_PLACE_LABEL_LAYER_ID);
    expect(layer?.type).toBe("symbol");
    expect(map.getLayoutProperty(GIS_NOVA_PLACE_LABEL_LAYER_ID, "text-field")).toBe("נובה");
    expect(map.getLayoutProperty(GIS_NOVA_PLACE_LABEL_LAYER_ID, "text-font")).toEqual(DARK_BASEMAP_PLACE_TEXT_FONT);
    expect(map.getLayoutProperty(GIS_NOVA_PLACE_LABEL_LAYER_ID, "text-size")).toBe(DARK_BASEMAP_KNOWN_PLACE_TEXT_SIZE);
    expect(map.getPaintProperty(GIS_NOVA_PLACE_LABEL_LAYER_ID, "text-color")).toBe(DARK_BASEMAP_TEXT_COLOR);

    const coords = map.getSource(GIS_NOVA_PLACE_LABEL_LAYER_ID)?.data?.features?.[0]?.geometry?.coordinates;
    expect(coords[0]).toBeCloseTo(34.46982, 4);
    expect(coords[1]).toBeCloseTo(31.39722, 4);
  });

  it("does not add a second Nova layer when GIS restacks", () => {
    const map = createFakeMapLibreMap();
    ensureGisNovaPlaceLabel(map);
    ensureGisNovaPlaceLabel(map);
    expect(map.getStyle().layers.filter((layer) => layer.id === GIS_NOVA_PLACE_LABEL_LAYER_ID)).toHaveLength(1);
  });
});

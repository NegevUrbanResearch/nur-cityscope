import { describe, expect, it } from "vitest";
import {
  DARK_BASEMAP_TEXT_COLOR,
  DARK_BASEMAP_TEXT_FIELD,
  applyDarkBasemapLabelPolicy,
} from "../../frontend/src/map/dark-basemap-labels.js";

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

import { describe, expect, test, vi } from "vitest";
import {
  GIS_POPUP_HIT_PADDING_PX,
  attachGisFeaturePopups,
  resolveGisPopupHit,
} from "../../frontend/src/map/maplibre-gis-popups.js";

const nliCatalogConfig = {
  id: "nli_catalog",
  name: "nli_catalog",
  ui: {
    legendLabel: "NLI catalog",
    popup: {
      titleField: "name_he",
      hideEmpty: true,
      fields: [{ label: "Hebrew name", key: "name_he" }],
    },
  },
};

const octoberConfig = {
  id: "אזור_הרס-נקודה",
  name: "אזור_הרס-נקודה",
  ui: {
    popup: {
      titleField: "Site_name",
      hideEmpty: true,
      fields: [{ label: "Site_name", key: "Site_name" }],
    },
  },
};

function getLayerConfig(fullId) {
  if (fullId === "nli.nli_catalog") return nliCatalogConfig;
  if (fullId === "october_7th.אזור_הרס-נקודה") return octoberConfig;
  return null;
}

describe("resolveGisPopupHit", () => {
  test("uses MapLibre source fullId (nli.stem), not style-layer id or stem", () => {
    const hit = resolveGisPopupHit(
      [
        {
          source: "nli.nli_catalog",
          layer: { id: "nli__nli_catalog" },
          properties: { name_he: "אלמוני" },
        },
      ],
      getLayerConfig,
    );
    expect(hit).not.toBeNull();
    expect(hit.fullId).toBe("nli.nli_catalog");
    expect(hit.popupConfig.fields[0].key).toBe("name_he");
    expect(hit.layerName).toBe("NLI catalog");
  });

  test("does not treat stem-only layer ids as a popup registry key", () => {
    const hit = resolveGisPopupHit(
      [
        {
          source: "nli_catalog",
          layer: { id: "nli_catalog" },
          properties: { name_he: "אלמוני" },
        },
      ],
      getLayerConfig,
    );
    expect(hit).toBeNull();
  });

  test("opens october_7th the same way: source is pack.layer fullId", () => {
    const hit = resolveGisPopupHit(
      [
        {
          source: "october_7th.אזור_הרס-נקודה",
          layer: { id: "october_7th__אזור_הרס-נקודה" },
          properties: { Site_name: "Nova" },
        },
      ],
      getLayerConfig,
    );
    expect(hit.fullId).toBe("october_7th.אזור_הרס-נקודה");
    expect(hit.popupConfig.titleField).toBe("Site_name");
  });

  test("skips curated sources and layers without ui.popup", () => {
    const hit = resolveGisPopupHit(
      [
        {
          source: "curated.42",
          properties: { name: "x" },
        },
        {
          source: "nli.investigation_polygons",
          properties: { Name: "poly" },
        },
      ],
      (id) =>
        id === "nli.investigation_polygons"
          ? { id: "investigation_polygons", name: "investigation_polygons" }
          : nliCatalogConfig,
    );
    expect(hit).toBeNull();
  });
});

describe("attachGisFeaturePopups", () => {
  test("queries a padded bbox so small circle-radius points can still hit", () => {
    const handlers = {};
    const popup = {
      setLngLat: vi.fn().mockReturnThis(),
      setHTML: vi.fn().mockReturnThis(),
      addTo: vi.fn().mockReturnThis(),
      remove: vi.fn(),
    };
    const map = {
      on: vi.fn((ev, fn) => {
        handlers[ev] = fn;
      }),
      off: vi.fn(),
      queryRenderedFeatures: vi.fn(() => [
        {
          source: "nli.nli_catalog",
          properties: { name_he: "אלמוני" },
        },
      ]),
    };
    const maplibregl = {
      Popup: vi.fn(function Popup() {
        return popup;
      }),
    };

    const dispose = attachGisFeaturePopups(map, maplibregl, { getLayerConfig });
    handlers.click({
      point: { x: 100, y: 80 },
      lngLat: { lng: 34.5, lat: 31.4 },
    });

    expect(GIS_POPUP_HIT_PADDING_PX).toBeGreaterThanOrEqual(6);
    const bbox = map.queryRenderedFeatures.mock.calls[0][0];
    expect(bbox[0][0]).toBe(100 - GIS_POPUP_HIT_PADDING_PX);
    expect(bbox[1][1]).toBe(80 + GIS_POPUP_HIT_PADDING_PX);
    expect(popup.setHTML).toHaveBeenCalled();
    expect(String(popup.setHTML.mock.calls[0][0])).toContain("אלמוני");

    dispose();
    expect(map.off).toHaveBeenCalledWith("click", handlers.click);
  });
});

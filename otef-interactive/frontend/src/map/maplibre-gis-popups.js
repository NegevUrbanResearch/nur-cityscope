/**
 * GIS feature popups for MapLibre (GeoJSON + PMTiles).
 *
 * Leaflet used per-feature bindPopup (GeoJSON) and a map-click query of
 * registered PMTiles layers. MapLibre equivalent: queryRenderedFeatures on
 * click, then look up ui.popup via the source id, which is the registry
 * fullId (`pack.stem`), not the style-layer id (`pack__stem`).
 */
import { renderPopupContent } from "../map-utils/popup-renderer.js";
import layerRegistry from "../shared/layer-registry.js";

/** Query box padding so 4px circle-radius points remain clickable. */
export const GIS_POPUP_HIT_PADDING_PX = 8;

/**
 * Pick the topmost queried feature that has a registry popup config.
 * MapLibre source ids are fullIds (`nli.nli_catalog`); style-layer ids are not.
 *
 * @param {Array<{ source?: string, properties?: object }>} renderedFeatures
 * @param {(fullId: string) => object|null} getLayerConfig
 * @returns {{ feature: object, fullId: string, popupConfig: object, layerName: string }|null}
 */
export function resolveGisPopupHit(renderedFeatures, getLayerConfig) {
  if (!Array.isArray(renderedFeatures) || typeof getLayerConfig !== "function") {
    return null;
  }
  for (const feature of renderedFeatures) {
    const fullId = feature && feature.source != null ? String(feature.source) : "";
    if (!fullId || fullId.startsWith("curated")) {
      continue;
    }
    const config = getLayerConfig(fullId);
    const popupConfig = config && config.ui && config.ui.popup;
    if (!popupConfig || !Array.isArray(popupConfig.fields)) {
      continue;
    }
    const layerName =
      (config.ui && config.ui.legendLabel) || config.name || fullId;
    return { feature, fullId, popupConfig, layerName };
  }
  return null;
}

function defaultGetLayerConfig(fullId) {
  return layerRegistry.getLayerConfig(fullId);
}

/**
 * Attach a map-click handler that opens a MapLibre popup for GIS pack layers.
 *
 * @param {object} map
 * @param {{ Popup: new (opts?: object) => object }} maplibregl
 * @param {{ getLayerConfig?: (fullId: string) => object|null, hitPadding?: number }} [options]
 * @returns {() => void} disposer
 */
export function attachGisFeaturePopups(map, maplibregl, options = {}) {
  if (!map || !maplibregl || typeof maplibregl.Popup !== "function") {
    return () => {};
  }
  const getLayerConfig =
    typeof options.getLayerConfig === "function"
      ? options.getLayerConfig
      : defaultGetLayerConfig;
  const pad =
    typeof options.hitPadding === "number" && Number.isFinite(options.hitPadding)
      ? Math.max(0, options.hitPadding)
      : GIS_POPUP_HIT_PADDING_PX;

  const popup = new maplibregl.Popup({
    className: "gis-feature-popup",
    maxWidth: "400px",
    closeButton: true,
    closeOnClick: false,
  });

  const onClick = (e) => {
    if (!e || !e.point) {
      popup.remove();
      return;
    }
    const bbox = [
      [e.point.x - pad, e.point.y - pad],
      [e.point.x + pad, e.point.y + pad],
    ];
    const features =
      typeof map.queryRenderedFeatures === "function"
        ? map.queryRenderedFeatures(bbox)
        : [];
    const hit = resolveGisPopupHit(features, getLayerConfig);
    if (!hit) {
      popup.remove();
      return;
    }
    const html = renderPopupContent(
      { properties: hit.feature.properties || {} },
      hit.popupConfig,
      hit.layerName,
    );
    popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
  };

  map.on("click", onClick);
  return () => {
    if (typeof map.off === "function") {
      map.off("click", onClick);
    }
    popup.remove();
  };
}

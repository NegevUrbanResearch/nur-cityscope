/**
 * Leaflet map: pink line base, feature preview, integrated route, node drag.
 */

import {
  fetchPinkLinePaths,
  getMemorialIconForFeature,
  resolvePinkLinePackStyleBundle,
} from "../shared/curated-layer-service.js";
import {
  parseDefaultLinePaths,
  buildIntegratedRoute,
} from "../map-utils/pink-line-route.js";

const LABEL_PROPERTY_KEYS = ["name", "reason", "description", "note"];
const META_SUBTITLE_KEYS = ["reason", "description", "note"];

/**
 * Above default overlay pane (400, pink base) but below current edits (450).
 * If z-index is below 400, the OSM overlay + pink reference line paint over history and it reads as “same as current”.
 */
const HISTORY_LINE_PANE = "curationHistoryLines";
/** Top: current route draws above history when geometry coincides. */
const CURRENT_LINE_PANE = "curationCurrentLines";

/**
 * Shared stroke specs for map polylines and the sidebar legend (keep in sync via initCurationMapRouteLegend).
 */
export const CURATION_ROUTE_LINE_STYLES = {
  current: {
    color: "#00d4ff",
    weight: 4,
    opacity: 1,
    dashArray: "18,10",
  },
  history: {
    color: "#00d4ff",
    weight: 3,
    opacity: 0.45,
    /** Shorter dashes + dot vs long-dash current (same cyan family). */
    dashArray: "6,10,2,10",
  },
};

/** Perpendicular offset (meters): separates shifted history from current when paths overlap. */
const HISTORY_LINE_OFFSET_METERS = 11;

/**
 * Applies {@link CURATION_ROUTE_LINE_STYLES} to legend SVG lines (ids in curation.html).
 */
export function initCurationMapRouteLegend() {
  if (typeof document === "undefined") return;
  const cur = document.getElementById("curationLegendCurrentLine");
  const hist = document.getElementById("curationLegendHistoryLine");
  const { current, history } = CURATION_ROUTE_LINE_STYLES;
  const apply = (el, spec) => {
    if (!el) return;
    el.setAttribute("stroke", spec.color);
    el.setAttribute("stroke-width", String(spec.weight));
    el.setAttribute("stroke-opacity", String(spec.opacity));
    el.setAttribute("stroke-dasharray", spec.dashArray.replace(/,/g, " "));
  };
  apply(cur, current);
  apply(hist, history);
}

/**
 * @param {import("leaflet").Map | null} mapInstance
 */
function ensureCurationLinePanes(mapInstance) {
  if (!mapInstance || mapInstance._curationLinePanesReady) return;
  mapInstance._curationLinePanesReady = true;
  mapInstance.createPane(HISTORY_LINE_PANE);
  const historyPane = mapInstance.getPane(HISTORY_LINE_PANE);
  historyPane.style.zIndex = "412";
  mapInstance.createPane(CURRENT_LINE_PANE);
  const currentPane = mapInstance.getPane(CURRENT_LINE_PANE);
  currentPane.style.zIndex = "450";
}

/**
 * @param {GeoJSON.Geometry} geometry
 * @returns {import("leaflet").LatLng[][]}
 */
function lineGeometryToLatLngRings(geometry) {
  if (!geometry || !geometry.type) return [];
  const t = geometry.type;
  if (t === "LineString") {
    const c = geometry.coordinates;
    if (!Array.isArray(c) || c.length < 2) return [];
    return [
      c.map(([lng, lat]) => {
        return L.latLng(lat, lng);
      }),
    ];
  }
  if (t === "MultiLineString") {
    const parts = geometry.coordinates;
    if (!Array.isArray(parts)) return [];
    return parts
      .filter((ring) => Array.isArray(ring) && ring.length >= 2)
      .map((ring) =>
        ring.map(([lng, lat]) => {
          return L.latLng(lat, lng);
        }),
      );
  }
  return [];
}

/**
 * Offset a line ring sideways by a small distance in meters.
 * Keeps current geometry untouched while making historical overlap readable.
 * @param {import("leaflet").LatLng[]} latlngs
 * @param {number} offsetMeters
 * @returns {import("leaflet").LatLng[]}
 */
function offsetLineRingLatLngs(latlngs, offsetMeters) {
  if (!Array.isArray(latlngs) || latlngs.length < 2 || !Number.isFinite(offsetMeters)) {
    return latlngs;
  }
  const out = [];
  for (let i = 0; i < latlngs.length; i += 1) {
    const cur = latlngs[i];
    const prev = latlngs[i - 1] || cur;
    const next = latlngs[i + 1] || cur;

    const cosLat = Math.max(0.2, Math.cos((cur.lat * Math.PI) / 180));
    const metersPerDegLng = 111320 * cosLat;
    const metersPerDegLat = 110540;

    const dxm = (next.lng - prev.lng) * metersPerDegLng;
    const dym = (next.lat - prev.lat) * metersPerDegLat;
    const len = Math.hypot(dxm, dym);
    if (!Number.isFinite(len) || len < 1e-6) {
      out.push(L.latLng(cur.lat, cur.lng));
      continue;
    }

    // Right-hand normal of direction vector.
    const nx = -dym / len;
    const ny = dxm / len;
    const dLat = (ny * offsetMeters) / metersPerDegLat;
    const dLng = (nx * offsetMeters) / metersPerDegLng;
    out.push(L.latLng(cur.lat + dLat, cur.lng + dLng));
  }
  return out;
}

/**
 * Whether this feature is a non-current revision (history). Accepts string "false" from some JSON edges.
 * @param {Record<string, unknown> | null | undefined} properties
 */
function featurePropertiesAreHistory(properties) {
  const p = properties || {};
  const v = p.is_current;
  if (v === false) return true;
  if (typeof v === "string" && v.toLowerCase() === "false") return true;
  return false;
}

/**
 * Computes dashed route segments via backend route compute when available.
 * Falls back to local route integration whenever backend output is missing/invalid.
 * @param {object} params
 * @param {Array} params.basePaths
 * @param {Array} params.currentUserPoints
 * @param {Array} params.historyUserPoints
 * @param {(payload: object) => Promise<{current_dashed: Array, history_dashed: Array}>} [params.computeRoute]
 * @param {(basePaths: Array, userPoints: Array) => {dashed?: Array}} [params.buildRoute]
 */
export async function computeDashedWithFallback({
  basePaths,
  currentUserPoints,
  historyUserPoints,
  computeRoute,
  buildRoute = buildIntegratedRoute,
}) {
  const isPointTuple = (point) =>
    Array.isArray(point) &&
    point.length === 2 &&
    Number.isFinite(point[0]) &&
    Number.isFinite(point[1]);

  const isDashedSegments = (dashed) =>
    Array.isArray(dashed) &&
    dashed.every(
      (segment) => Array.isArray(segment) && segment.every((point) => isPointTuple(point)),
    );

  if (typeof computeRoute === "function") {
    try {
      const computed = await computeRoute({
        base_paths: basePaths,
        current_points: currentUserPoints,
        history_points: historyUserPoints,
      });
      if (computed && isDashedSegments(computed.current_dashed) && isDashedSegments(computed.history_dashed)) {
        return {
          currentDashed: computed.current_dashed,
          historyDashed: computed.history_dashed,
        };
      }
    } catch (_) {
      // fall through to local fallback
    }
  }

  const localCurrent = buildRoute(basePaths, currentUserPoints);
  const localHistory = buildRoute(basePaths, historyUserPoints);
  return {
    currentDashed: Array.isArray(localCurrent?.dashed) ? localCurrent.dashed : [],
    historyDashed: Array.isArray(localHistory?.dashed) ? localHistory.dashed : [],
  };
}

/**
 * @param {GeoJSON.Feature} feature
 * @returns {import("leaflet").LayerGroup | null}
 */
function buildLinePreviewLayers(feature) {
  if (!feature || !feature.geometry || typeof L === "undefined") return null;
  const rings = lineGeometryToLatLngRings(feature.geometry);
  if (!rings.length) return null;

  const isHistory = featurePropertiesAreHistory(feature.properties);
  const group = L.layerGroup();

  if (isHistory) {
    const h = CURATION_ROUTE_LINE_STYLES.history;
    rings.forEach((latlngs) => {
      const shifted = offsetLineRingLatLngs(latlngs, HISTORY_LINE_OFFSET_METERS);
      group.addLayer(
        L.polyline(shifted, {
          pane: HISTORY_LINE_PANE,
          color: h.color,
          weight: h.weight,
          opacity: h.opacity,
          dashArray: h.dashArray,
          lineCap: "round",
          lineJoin: "round",
          interactive: false,
        }),
      );
    });
    return group;
  }

  const c = CURATION_ROUTE_LINE_STYLES.current;
  rings.forEach((latlngs) => {
    group.addLayer(
      L.polyline(latlngs, {
        pane: CURRENT_LINE_PANE,
        color: c.color,
        weight: c.weight,
        opacity: c.opacity,
        dashArray: c.dashArray,
        lineCap: "round",
        lineJoin: "round",
        interactive: false,
      }),
    );
  });
  return group;
}

/**
 * @param {object} deps
 * @param {ReturnType<import("./curation-state.js").createCurationPreviewState>} deps.previewState
 * @param {Map<string, object>} deps.pendingGeometryEdits
 * @param {Map<number, boolean>} deps.featureEnabled
 * @param {() => object[]} deps.getCurrentFeatures
 * @param {() => string | null} deps.getLastPublishedFullLayerId
 * @param {() => HTMLElement | null} deps.featuresContainer
 * @param {() => Promise<void>} deps.onAfterMarkerDrag
 */
export function createCurationMapPreview(deps) {
  const {
    previewState,
    pendingGeometryEdits,
    featureEnabled,
    getCurrentFeatures,
    getLastPublishedFullLayerId,
    featuresContainer,
    onAfterMarkerDrag,
    computeRoute,
  } = deps;

  let map = null;
  let baseRouteLayer = null;
  let integratedRouteLayer = null;
  let highlightMarker = null;
  let showPreviewSeq = 0;

  function getLabelFromProps(properties) {
    const p = properties || {};
    for (const key of LABEL_PROPERTY_KEYS) {
      const v = p[key];
      if (v != null && String(v).trim() !== "") return String(v).trim();
    }
    return null;
  }

  function initMap() {
    const container = document.getElementById("curationMap");
    if (!container || map) return map;
    map = L.map(container, { center: [32.08, 34.78], zoom: 12 });
    ensureCurationLinePanes(map);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
    }).addTo(map);
    return map;
  }

  function clearPreview() {
    if (baseRouteLayer && map) {
      map.removeLayer(baseRouteLayer);
      baseRouteLayer = null;
    }

    if (integratedRouteLayer && map) {
      map.removeLayer(integratedRouteLayer);
      integratedRouteLayer = null;
    }

    if (map && previewState && previewState.featureLayers) {
      for (const layers of previewState.featureLayers.values()) {
        (layers || []).forEach((layer) => {
          if (!layer) return;
          if (typeof map.hasLayer === "function" && map.hasLayer(layer)) {
            map.removeLayer(layer);
          } else if (typeof map.removeLayer === "function") {
            try {
              map.removeLayer(layer);
            } catch (_) {
              // ignore
            }
          }
        });
      }
    }

    previewState.clearPreview();

    if (highlightMarker && map && typeof map.removeLayer === "function") {
      try {
        map.removeLayer(highlightMarker);
      } catch (_) {
        // ignore
      }
    }
    highlightMarker = null;
  }

  async function loadPinkLineGeojson() {
    const { pinkGeojson } = await fetchPinkLinePaths();
    return pinkGeojson;
  }

  function getGeometryType(geometry) {
    if (!geometry || !geometry.type) return null;
    const t = geometry.type.toLowerCase();
    if (t === "point" || t === "multipoint") return "point";
    if (t === "linestring" || t === "multilinestring") return "line";
    return "polygon";
  }

  function createFeatureLayer(feature, featureIndex) {
    if (!feature || !feature.geometry || typeof L === "undefined") return null;
    const geomType = getGeometryType(feature.geometry);

    if (geomType === "point") {
      const layerColor = "#00d4ff";
      return L.geoJSON(
        { type: "FeatureCollection", features: [feature] },
        {
          pointToLayer: (f, latlng) => {
            const props = f.properties || {};
            const isHistory = featurePropertiesAreHistory(props);
            const memorialIconUrl = getMemorialIconForFeature(props);

            let marker;
            if (memorialIconUrl) {
              const icon = L.icon({
                iconUrl: memorialIconUrl,
                iconSize: [36, 36],
                iconAnchor: [18, 18],
                popupAnchor: [0, -18],
                className: "curation-memorial-marker-icon",
              });
              marker = L.marker(latlng, { icon, draggable: !isHistory, opacity: isHistory ? 0.55 : 1 });
            } else {
              marker = L.marker(latlng, {
                draggable: !isHistory,
                opacity: isHistory ? 0.55 : 1,
                icon: L.divIcon({
                  className: "pink-line-node-marker",
                  html:
                    '<div class="pink-line-node" style="background:' +
                    layerColor +
                    '"></div>',
                  iconSize: [14, 14],
                  iconAnchor: [7, 7],
                }),
              });
            }

            const label = getLabelFromProps(props);
            if (label) {
              marker.bindTooltip(label, {
                permanent: false,
                direction: "top",
                className: "curated-node-tooltip",
              });
            }

            marker.on("dragend", async (evt) => {
              if (isHistory) return;
              const ll = evt?.target?.getLatLng?.();
              if (!ll || !Number.isFinite(ll.lat) || !Number.isFinite(ll.lng)) return;
              const idx = Number(featureIndex);
              const currentFeatures = getCurrentFeatures();
              if (!Number.isInteger(idx) || !currentFeatures[idx]) return;

              const prevGeom = currentFeatures[idx].geometry || null;
              currentFeatures[idx].geometry = {
                type: "Point",
                coordinates: [ll.lng, ll.lat],
              };
              const propsNow = currentFeatures[idx].properties || {};
              const featureId = propsNow.id != null ? String(propsNow.id) : "";
              const featureProjectId =
                propsNow.project_id != null ? String(propsNow.project_id) : "";
              if (featureId) {
                const existing = pendingGeometryEdits.get(featureId);
                pendingGeometryEdits.set(featureId, {
                  featureId,
                  projectId: featureProjectId || existing?.projectId || "",
                  sourcePublishedLayerFullId:
                    existing?.sourcePublishedLayerFullId || getLastPublishedFullLayerId() || null,
                  beforeGeom: existing ? existing.beforeGeom : prevGeom,
                  afterGeom: currentFeatures[idx].geometry,
                });
              }
              await showPreview(
                { type: "FeatureCollection", features: currentFeatures },
                { preserveView: true },
              );
              await onAfterMarkerDrag();
            });

            return marker;
          },
        }
      );
    }

    if (geomType === "line") {
      if (!map) initMap();
      if (!map) return null;
      ensureCurationLinePanes(map);
      return buildLinePreviewLayers(feature);
    }

    const isHistory = featurePropertiesAreHistory(feature?.properties);
    const otherStyle = {
      color: "#00d4ff",
      weight: 2,
      fillOpacity: isHistory ? 0.12 : 0.3,
      opacity: isHistory ? 0.45 : 1,
    };
    return L.geoJSON(
      { type: "FeatureCollection", features: [feature] },
      { style: otherStyle }
    );
  }

  function setFeatureVisibleOnMap(featureIndex, isVisible) {
    previewState.setFeatureVisible(featureIndex, isVisible);
    if (!map) return;
    const key = String(featureIndex);
    const layers = previewState.featureLayers.get(key) || [];
    layers.forEach((layer) => {
      if (!layer) return;
      if (isVisible) {
        if (typeof layer.addTo === "function") {
          layer.addTo(map);
        } else if (typeof map.addLayer === "function") {
          map.addLayer(layer);
        }
      } else if (typeof map.removeLayer === "function") {
        try {
          map.removeLayer(layer);
        } catch (_) {
          // ignore
        }
      }
    });
  }

  function highlightFeatureOnMap(featureIndex, rowEl) {
    if (!map) initMap();
    if (!map) return;

    const key = String(featureIndex);
    const layers = previewState.featureLayers.get(key) || [];
    if (!layers.length) return;

    let targetLayer = null;
    for (const layer of layers) {
      if (!layer) continue;
      if (typeof layer.getBounds === "function") {
        const b = layer.getBounds();
        if (b && typeof b.getCenter === "function") {
          targetLayer = layer;
          break;
        }
      } else if (typeof layer.getLatLng === "function") {
        targetLayer = layer;
        break;
      }
    }
    if (!targetLayer) {
      targetLayer = layers[0];
    }

    let center = null;
    if (targetLayer && typeof targetLayer.getBounds === "function") {
      const b = targetLayer.getBounds();
      if (b && typeof b.getCenter === "function") {
        center = b.getCenter();
      }
    }
    if (!center && targetLayer && typeof targetLayer.getLatLng === "function") {
      center = targetLayer.getLatLng();
    }
    if (!center) return;

    if (highlightMarker && map && typeof map.removeLayer === "function") {
      try {
        map.removeLayer(highlightMarker);
      } catch (_) {
        // ignore
      }
    }

    highlightMarker = L.circleMarker(center, {
      radius: 10,
      pane: "markerPane",
      interactive: false,
      className: "curation-marker-highlight",
    }).addTo(map);

    if (typeof map.panTo === "function") {
      map.panTo(center);
    }

    const container = featuresContainer();
    if (container) {
      container
        .querySelectorAll(".curation-feature-row.highlighted")
        .forEach((elRow) => elRow.classList.remove("highlighted"));
    }
    if (rowEl) {
      rowEl.classList.add("highlighted");
    }

    previewState.highlightFeature(featureIndex);
  }

  async function showPreview(geojson, options = {}) {
    const mySeq = ++showPreviewSeq;
    const preserveView = options && options.preserveView === true;
    if (!map) initMap();
    clearPreview();
    const features = geojson?.features || [];
    const bounds = [];
    let basePaths = [];

    const [pinkGeojson, pinkStyleBundle] = await Promise.all([
      loadPinkLineGeojson(),
      resolvePinkLinePackStyleBundle(),
    ]);
    if (mySeq !== showPreviewSeq) return;

    if (pinkGeojson && pinkGeojson.features && pinkGeojson.features.length && map) {
      baseRouteLayer = L.geoJSON(pinkGeojson, {
        style: pinkStyleBundle.leafletPolylineOptions,
      }).addTo(map);
      baseRouteLayer.eachLayer((l) => {
        if (l.getBounds) bounds.push(l.getBounds());
      });

      try {
        basePaths = parseDefaultLinePaths(pinkGeojson) || [];
      } catch (_) {
        basePaths = [];
      }
    }

    if (!features.length) {
      if (!preserveView && bounds.length && typeof L !== "undefined") {
        if (mySeq !== showPreviewSeq) return;
        map.fitBounds(L.latLngBounds(bounds), { padding: [20, 20] });
      }
      return;
    }

    const currentUserPoints = [];
    const historyUserPoints = [];

    features.forEach((feature, index) => {
      const layer = createFeatureLayer(feature, index);
      if (!layer || !previewState) return;

      previewState.registerFeatureLayers(index, [layer]);

      const enabled = featureEnabled.get(index);
      const visible = enabled !== false;
      setFeatureVisibleOnMap(index, visible);

      if (layer.getBounds) {
        bounds.push(layer.getBounds());
      }

      const geom = feature.geometry;
      if (geom && geom.type === "Point" && Array.isArray(geom.coordinates)) {
        const [lng, lat] = geom.coordinates;
        if (
          typeof lat === "number" &&
          typeof lng === "number" &&
          Number.isFinite(lat) &&
          Number.isFinite(lng)
        ) {
          const pair = [lat, lng];
          if (featurePropertiesAreHistory(feature.properties)) {
            historyUserPoints.push(pair);
          } else {
            currentUserPoints.push(pair);
          }
        }
      }
    });

    if (mySeq !== showPreviewSeq) return;

    if (
      map &&
      Array.isArray(basePaths) &&
      basePaths.length > 0 &&
      (currentUserPoints.length > 0 || historyUserPoints.length > 0)
    ) {
      try {
        ensureCurationLinePanes(map);
        integratedRouteLayer = L.layerGroup();
        const { currentDashed, historyDashed } = await computeDashedWithFallback({
          basePaths,
          currentUserPoints,
          historyUserPoints,
          computeRoute,
        });
        if (mySeq !== showPreviewSeq) return;

        const addHistoryIntegrated = (dashed) => {
          if (!Array.isArray(dashed) || !dashed.length) return;
          const h = CURATION_ROUTE_LINE_STYLES.history;
          dashed.forEach((pts) => {
            const latlngs = pts.map((p) => L.latLng(p[0], p[1]));
            const shifted = offsetLineRingLatLngs(latlngs, HISTORY_LINE_OFFSET_METERS);
            integratedRouteLayer.addLayer(
              L.polyline(shifted, {
                pane: HISTORY_LINE_PANE,
                color: h.color,
                weight: h.weight,
                opacity: h.opacity,
                dashArray: h.dashArray,
                lineCap: "round",
                lineJoin: "round",
                interactive: false,
              }),
            );
          });
        };

        const addCurrentIntegrated = (dashed) => {
          if (!Array.isArray(dashed) || !dashed.length) return;
          const c = CURATION_ROUTE_LINE_STYLES.current;
          dashed.forEach((pts) => {
            integratedRouteLayer.addLayer(
              L.polyline(pts, {
                pane: CURRENT_LINE_PANE,
                color: c.color,
                weight: c.weight,
                opacity: c.opacity,
                dashArray: c.dashArray,
                lineCap: "round",
                lineJoin: "round",
                interactive: false,
              }),
            );
          });
        };

        addHistoryIntegrated(historyDashed);
        addCurrentIntegrated(currentDashed);

        if (integratedRouteLayer.getLayers().length > 0) {
          integratedRouteLayer.addTo(map);
        } else {
          integratedRouteLayer = null;
        }
      } catch (_) {
        integratedRouteLayer = null;
        // If integrated route fails, fall back to per-feature layers only.
      }
    }

    if (!preserveView && bounds.length && typeof L !== "undefined") {
      if (mySeq !== showPreviewSeq) return;
      const b = L.latLngBounds(bounds);
      map.fitBounds(b, { padding: [24, 24], maxZoom: 16 });
    }
  }

  return {
    initMap,
    clearPreview,
    showPreview,
    setFeatureVisibleOnMap,
    highlightFeatureOnMap,
    getLabelFromProps,
    getSubtitleFromProps(properties) {
      const p = properties || {};
      for (const key of META_SUBTITLE_KEYS) {
        const v = p[key];
        if (v != null && String(v).trim() !== "") return String(v).trim();
      }
      return null;
    },
  };
}

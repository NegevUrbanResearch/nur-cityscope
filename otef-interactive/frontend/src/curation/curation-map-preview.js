/**
 * Leaflet map: pink line base, feature preview, integrated route, node drag.
 */

import { getMemorialIconForFeature } from "../shared/curated-layer-service.js";
import {
  parseDefaultLinePaths,
  buildIntegratedRoute,
} from "../map-utils/pink-line-route.js";

const LABEL_PROPERTY_KEYS = ["name", "reason", "description", "note"];
const META_SUBTITLE_KEYS = ["reason", "description", "note"];

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
    try {
      const res = await fetch("/api/pink-line/");
      if (!res.ok) return null;
      return await res.json();
    } catch (_) {
      return null;
    }
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
            const isHistory = props.is_current === false;
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
      const isHistory = feature?.properties?.is_current === false;
      const lineStyle = {
        color: "#00d4ff",
        weight: isHistory ? 2 : 2.5,
        dashArray: isHistory ? "3,7" : "8,6",
        opacity: isHistory ? 0.45 : 0.95,
      };
      return L.geoJSON(
        { type: "FeatureCollection", features: [feature] },
        { style: lineStyle }
      );
    }

    const isHistory = feature?.properties?.is_current === false;
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

    const pinkGeojson = await loadPinkLineGeojson();
    if (mySeq !== showPreviewSeq) return;

    if (pinkGeojson && pinkGeojson.features && pinkGeojson.features.length && map) {
      baseRouteLayer = L.geoJSON(pinkGeojson, {
        style: {
          color: "#ff69b4",
          weight: 5,
          opacity: 1,
        },
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

    const userPoints = [];

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
          userPoints.push([lat, lng]);
        }
      }
    });

    if (mySeq !== showPreviewSeq) return;

    if (
      map &&
      Array.isArray(basePaths) &&
      basePaths.length > 0 &&
      Array.isArray(userPoints) &&
      userPoints.length > 0 &&
      typeof buildIntegratedRoute === "function"
    ) {
      try {
        const { dashed } = buildIntegratedRoute(basePaths, userPoints);
        if (dashed && dashed.length) {
          const layerColor = "#00d4ff";
          const dashedStyle = {
            color: layerColor,
            weight: 5,
            opacity: 0.9,
            dashArray: "10, 10",
          };
          integratedRouteLayer = L.layerGroup();
          dashed.forEach((pts) => {
            integratedRouteLayer.addLayer(L.polyline(pts, dashedStyle));
          });
          integratedRouteLayer.addTo(map);
        }
      } catch (_) {
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

import { loadNliNameField as defaultLoadNliNameField } from "./nli-name-field-data.js";
import { createNameGroupOverlay } from "./nli-name-field-group-overlay.js";
import { createNameFieldAnimation, withNameRevealDelays } from './nli-name-field-animation.js';
import { createNliNameFocusPresentation, getNameFocusOpacity, getRelevantPlaceGroup } from './nli-name-focus-presentation.js';
import { DEFAULT_PROJECTION_CONFIG, validateProjectionConfig } from "./projection-config-schema.js";
import { equalProjectionConfig } from "./projection-config-client.js";

const ORIGINAL_LABEL_ID = "nli__people_names__labels";
const SOURCE_ID = "nli-name-field";
const LABEL_ID = "nli-name-field-labels";
const SELECTED_LABEL_ID = "nli-name-field-selected";
const CONNECTOR_SOURCE_ID = "nli-name-field-connector";
const CONNECTOR_LAYER_ID = "nli-name-field-connector-line";
const DETAIL_ZOOM_DELTA = 0.5;
const overviewTextSize = (field) => {
  const base = field.fontSize;
  const referenceZoom = field.referenceZoom;
  return ["interpolate", ["exponential", 2], ["zoom"], 0,
    base / 2 ** referenceZoom, 24, base * 2 ** (24 - referenceZoom)];
};

const featureCollection = (features = []) => ({ type: "FeatureCollection", features });
const geojsonAt = (field, useSource) => {
  const features = field.geojson.features.map((feature) => {
    return {
      ...feature,
      ...(useSource ? { geometry: { type: "Point", coordinates: field.byPid.get(String(feature.properties.pid)).sourceCoordinates } } : {}),
    };
  });
  return withNameRevealDelays(useSource ? featureCollection(features) : field.geojson);
};
const hasPeopleNames = (groups) => (groups || []).some((group) => group?.id === "nli" &&
  (group.layers || []).some((layer) => layer?.id === "people_names" && layer.enabled === true));
// Cleanup may run after a style has already removed these resources.
const cleanup = (fn, ...args) => {
  try {
    fn(...args);
  } catch {
    // Already torn down.
  }
};

function textLayer(id, source, heading, textSize, filter) {
  return {
    id,
    type: "symbol",
    source,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Guttman Hatzvi", "Arial Unicode MS Regular", "sans-serif"],
      "text-size": textSize,
      "text-max-width": 1000,
      "text-anchor": "center",
      "text-offset": [0, 0],
      "text-rotate": heading,
      "text-rotation-alignment": "map",
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: {
      "text-color": "#ffffff",
      "text-halo-color": "#000000",
      "text-halo-width": 1.5,
      "text-opacity": 0,
      "text-opacity-transition": { duration: 0, delay: 0 },
    },
    ...(filter ? { filter } : {}),
  };
}

function hideLegacyLabels(map) {
  if (map.getLayer(ORIGINAL_LABEL_ID)) {
    map.setLayoutProperty(ORIGINAL_LABEL_ID, "visibility", "none");
  }
}

function validateCandidateField(candidate) {
  const features = candidate?.geojson?.features;
  if (!Array.isArray(features) || !features.length || !(candidate?.byPid instanceof Map)) {
    throw new Error("Invalid NLI name field data");
  }
  const total = candidate.diagnostics?.total;
  const placed = candidate.diagnostics?.placed;
  if (!Number.isFinite(total) || total !== features.length || !Number.isFinite(placed) || placed !== total || candidate.byPid.size !== features.length) {
    throw new Error("Invalid NLI name field data");
  }
  const unplaced = candidate.diagnostics?.unplaced;
  const unplacedCount = Array.isArray(unplaced) ? unplaced.length : unplaced;
  if (!Number.isFinite(unplacedCount) || unplacedCount < 0) {
    throw new Error("Invalid NLI name field data");
  }
  if (unplacedCount !== 0) {
    throw new Error("NLI name field capacity exhausted");
  }
  const pids = new Set();
  for (const feature of features) {
    const pid = typeof feature?.properties?.pid === "string"
      ? feature.properties.pid.trim()
      : "";
    if (!pid || pids.has(pid) || !candidate.byPid.has(pid)) {
      throw new Error("Invalid NLI name field data");
    }
    pids.add(pid);
    const owners = feature?.properties?.visible_spans;
    if (!Array.isArray(owners) || owners.length !== 1 || !["left", "right"].includes(owners[0])) {
      throw new Error("Invalid NLI name field ownership");
    }
  }
  return candidate;
}

export function createNliNameFieldController({
  map,
  context,
  displayProfile = "projection",
  projectionSpan,
  loadField = defaultLoadNliNameField,
  motionMode = "full",
} = {}) {
  let disposed = false;
  let enabled = false;
  let ready = false;
  let field = null;
  let selectedPid = null;
  let selectedGroup = null;
  let pendingPlaceId = null;
  let groupOverlay = null;
  let animation = null;
  let focusPresentation = null;
  let overviewCamera = null;
  let useSourceGeometry = false;
  let requestGeneration = 0;
  let installedGeneration = null;
  let requestedRevision = null;
  let installedRevision = null;
  let requestedConfig = displayProfile === "projection" ? null : DEFAULT_PROJECTION_CONFIG;
  let buildInFlight = false;
  let rebuildState = "idle";
  let rebuildError = null;
  let retryOnNextEnable = false;
  const projectionSpanFilter = () => displayProfile === "projection" && ["left", "right"].includes(projectionSpan)
    ? ["in", projectionSpan, ["get", "visible_spans"]] : null;
  const packedProjectionOwners = () => Object.fromEntries((field?.geojson?.features || [])
    .map((feature) => [String(feature.properties?.pid || ""), feature.properties?.visible_spans?.[0]])
    .filter(([pid, owner]) => pid && owner));
  const installedOwnerCount = () => Object.keys(packedProjectionOwners()).length;
  const withSpan = (filter) => {
    const activeSpanFilter = projectionSpanFilter();
    return activeSpanFilter ? (filter ? ["all", activeSpanFilter, filter] : activeSpanFilter) : filter;
  };
  const container = map.getContainer();
  const publishDiagnostics = () => {
    if (!container?.dataset) return;
    const hasProjectionLifecycle = displayProfile !== "projection" || requestedConfig || field;
    const hasInstalledField = ready && field;
    if (!enabled || (displayProfile === "gis" && !hasInstalledField) || !hasProjectionLifecycle) {
      delete container.dataset.nliNameField;
      return;
    }
    const diagnosticsField = ready && field ? field : null;
    const unplaced = diagnosticsField?.diagnostics?.unplaced;
    const owned = diagnosticsField ? installedOwnerCount() : 0;
    container.dataset.nliNameField = JSON.stringify({
      mode: diagnosticsField && useSourceGeometry ? "detail" : "display",
      placed: Number(diagnosticsField?.diagnostics?.placed || 0),
      total: Number(diagnosticsField?.diagnostics?.total || 0),
      groups: Number(diagnosticsField?.diagnostics?.groups || 0),
      unplaced: Array.isArray(unplaced) ? unplaced.length : Number(unplaced || 0),
      selectedPid,
      selectedGroup,
      projectionRevision: requestedRevision,
      projectionClipped: 0,
      projectionOwners: diagnosticsField ? owned : null,
      requestedRevision,
      installedRevision,
      rebuildState,
      rebuildError,
      owned,
      ...(rebuildState === "idle" ? { unowned: 0 } : {}),
      fontSize: diagnosticsField?.fontSize,
      referenceZoom: diagnosticsField?.referenceZoom,
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      heading: diagnosticsField?.heading,
    });
  };

  const disposeAnimation = () => {
    animation?.dispose();
    animation = null;
  };
  const removeOwned = () => {
    disposeAnimation();
    const previousPresentation = focusPresentation;
    focusPresentation = null;
    previousPresentation?.dispose();
    groupOverlay?.dispose();
    groupOverlay = null;
    for (const id of [CONNECTOR_LAYER_ID, SELECTED_LABEL_ID, LABEL_ID]) {
      if (map.getLayer(id)) cleanup(map.removeLayer.bind(map), id);
    }
    for (const id of [CONNECTOR_SOURCE_ID, SOURCE_ID]) {
      if (map.getSource(id)) cleanup(map.removeSource.bind(map), id);
    }
  };
  const hideProjectionField = () => {
    removeOwned();
    hideLegacyLabels(map);
    field = null;
    ready = false;
    useSourceGeometry = false;
  };
  const selectedFeature = () => field?.byPid?.get(String(selectedPid)) || null;
  const updateConnector = () => {
    const selected = selectedFeature();
    const source = map.getSource(CONNECTOR_SOURCE_ID);
    if (!source) return;
    const display = selected?.feature;
    const owner = selected?.feature?.properties?.visible_spans?.[0];
    const ownsSelection = displayProfile !== "projection" || owner === projectionSpan;
    const coordinates = ownsSelection && !useSourceGeometry && selected && display?.geometry?.coordinates
      && selected.sourceCoordinates
      ? [display.geometry.coordinates, selected.sourceCoordinates]
      : [];
    source.setData(featureCollection(coordinates.length ? [{
      type: "Feature",
      properties: { pid: String(selectedPid) },
      geometry: { type: "LineString", coordinates },
    }] : []));
  };
  const applySelection = (snapshot = context.getPersonSelection()) => {
    const pid = snapshot?.personId;
    const version = snapshot?.datasetVersion;
    const validVersion = field && (!field.datasetVersion || !version || field.datasetVersion === version);
    if (!pid || !validVersion || !field?.byPid?.has(String(pid))) {
      selectedPid = null;
    } else {
      selectedPid = String(pid);
      selectedGroup = null;
      pendingPlaceId = null;
    }
    const selected = selectedPid || "__none__";
    if (map.getLayer(LABEL_ID)) {
      map.setFilter(LABEL_ID, withSpan(selectedPid ? ["!=", ["get", "pid"], selectedPid] : null));
    }
    if (map.getLayer(SELECTED_LABEL_ID)) {
      map.setFilter(SELECTED_LABEL_ID, withSpan(["==", ["get", "pid"], selected]));
    }
    updateConnector();
    updateGroupHighlight();
    publishDiagnostics();
  };
  const updateGroupHighlight = () => {
    groupOverlay?.update(getRelevantPlaceGroup(field, selectedPid, selectedGroup));
    refreshBackground();
    animation?.setFocus(getNameFocusOpacity({ selectedPid, selectedGroup, field }));
  };
  const applyPlace = (placeId) => {
    pendingPlaceId = placeId || null;
    if (!groupOverlay) return;
    selectedGroup = pendingPlaceId ? groupOverlay.groupForPlace(pendingPlaceId) : null;
    updateGroupHighlight();
    publishDiagnostics();
  };
  const mountInstalledField = () => {
    if (disposed || !enabled || !ready || !field) return;
    removeOwned();
    try {
      useSourceGeometry = displayProfile === "gis" && map.getZoom() >= field.referenceZoom + DETAIL_ZOOM_DELTA;
      map.addSource(SOURCE_ID, { type: "geojson", data: geojsonAt(field, useSourceGeometry) });
      map.addSource(CONNECTOR_SOURCE_ID, { type: "geojson", data: featureCollection() });
      const textSize = useSourceGeometry ? 14 : overviewTextSize(field);
      const baseLayer = textLayer(LABEL_ID, SOURCE_ID, field.heading, textSize);
      baseLayer.layout["text-allow-overlap"] = !useSourceGeometry;
      baseLayer.layout["text-ignore-placement"] = !useSourceGeometry;
      map.addLayer(baseLayer);
      const selectedLayer = textLayer(
        SELECTED_LABEL_ID, SOURCE_ID, field.heading,
        useSourceGeometry ? 16 : overviewTextSize(field),
        ["==", ["get", "pid"], "__none__"],
      );
      selectedLayer.paint["text-halo-width"] = 2;
      map.addLayer(selectedLayer);
      map.addLayer({
        id: CONNECTOR_LAYER_ID,
        type: "line",
        source: CONNECTOR_SOURCE_ID,
        layout: { visibility: "visible" },
        paint: { "line-color": "#ffffff", "line-width": 1.5, "line-opacity": 0.8 },
      });
      groupOverlay = createNameGroupOverlay({ map, field, displayProfile, motionMode });
      focusPresentation = createNliNameFocusPresentation({ map, field });
      if (pendingPlaceId) selectedGroup = groupOverlay.groupForPlace(pendingPlaceId);
      if (map.getLayer(ORIGINAL_LABEL_ID)) map.setLayoutProperty(ORIGINAL_LABEL_ID, "visibility", "none");
      animation = createNameFieldAnimation({
        motionMode,
        apply: ({ baseOpacity, selectedOpacity, connectorOpacity }) => {
          if (map.getLayer(LABEL_ID)) map.setPaintProperty(LABEL_ID, "text-opacity", baseOpacity);
          if (map.getLayer(SELECTED_LABEL_ID)) map.setPaintProperty(SELECTED_LABEL_ID, "text-opacity", selectedOpacity);
          if (map.getLayer(CONNECTOR_LAYER_ID)) map.setPaintProperty(CONNECTOR_LAYER_ID, "line-opacity", connectorOpacity * 0.8);
        },
      });
      animation.show();
      applySelection();
      publishDiagnostics();
    } catch (error) {
      removeOwned();
      hideLegacyLabels(map);
      console.error("NLI name field mount failed", error);
    }
  };
  const startProjectionBuild = async () => {
    if (!enabled || !requestedConfig || buildInFlight || disposed) return;
    const generation = requestGeneration;
    const revision = requestedRevision;
    const projectionConfig = structuredClone(requestedConfig);
    buildInFlight = true;
    rebuildState = "building";
    rebuildError = null;
    publishDiagnostics();
    try {
      const candidate = validateCandidateField(await loadField({ projectionConfig }));
      if (disposed || !enabled || generation !== requestGeneration) return;
      field = candidate;
      ready = true;
      installedGeneration = generation;
      installedRevision = revision;
      rebuildState = "idle";
      retryOnNextEnable = false;
      mountInstalledField();
    } catch (error) {
      if (!disposed && generation === requestGeneration) {
        rebuildState = "error";
        rebuildError = error instanceof Error ? error.message : String(error);
        retryOnNextEnable = true;
        hideProjectionField();
        console.error("NLI name field unavailable", error);
      } else if (!disposed) {
        rebuildState = "pending";
      }
    } finally {
      buildInFlight = false;
      publishDiagnostics();
      if (!disposed && enabled && requestGeneration !== installedGeneration && rebuildState !== "error") {
        void startProjectionBuild();
      }
    }
  };
  const syncZoom = () => {
    if (disposed || !enabled || !ready || displayProfile !== "gis" || !field) return;
    const next = map.getZoom() >= field.referenceZoom + DETAIL_ZOOM_DELTA;
    if (next === useSourceGeometry) {
      publishDiagnostics();
      return;
    }
    useSourceGeometry = next;
    const source = map.getSource(SOURCE_ID);
    if (source) source.setData(geojsonAt(field, useSourceGeometry));
    const textSize = useSourceGeometry ? 14 : overviewTextSize(field);
    if (map.getLayer(LABEL_ID)) {
      map.setLayoutProperty(LABEL_ID, "text-size", textSize);
      map.setLayoutProperty(LABEL_ID, "text-allow-overlap", !useSourceGeometry);
      map.setLayoutProperty(LABEL_ID, "text-ignore-placement", !useSourceGeometry);
    }
    if (map.getLayer(SELECTED_LABEL_ID)) {
      map.setLayoutProperty(SELECTED_LABEL_ID, "text-size", useSourceGeometry ? 16 : overviewTextSize(field));
    }
    updateConnector();
    updateGroupHighlight();
    publishDiagnostics();
  };
  const rememberOverview = () => {
    if (displayProfile !== "gis" || selectedPid || selectedGroup || !field ||
      map.getZoom() >= field.referenceZoom + DETAIL_ZOOM_DELTA) return;
    const center = map.getCenter();
    if (center) {
      overviewCamera = {
        center,
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      };
    }
  };
  let updatingBackground = false;
  const refreshBackground = () => {
    if (disposed || !enabled || updatingBackground) return;
    updatingBackground = true;
    try {
      focusPresentation?.update({ selectedPid, selectedGroup });
    } finally {
      updatingBackground = false;
    }
  };
  const handleIdle = () => {
    if (disposed || !enabled) return;
    rememberOverview();
    refreshBackground();
  };
  const handleStyleLoad = () => {
    if (!disposed && enabled) hideLegacyLabels(map);
    if (!disposed && enabled && ready && rebuildState === "idle" && installedGeneration === requestGeneration) {
      mountInstalledField();
    }
  };
  const onSelection = (snapshot) => {
    if (disposed) return;
    selectedGroup = null;
    pendingPlaceId = null;
    applySelection(snapshot);
  };
  const onNavigation = (command) => {
    if (disposed) return;
    if (command?.cancelFocus) {
      selectedPid = null;
      selectedGroup = null;
      pendingPlaceId = null;
      applySelection({ personId: null });
      if (displayProfile === "gis") {
        map.stop();
        const duration = motionMode === "reduced" ? 0 : 500;
        if (overviewCamera) {
          map.easeTo({ ...overviewCamera, duration });
        } else if (field?.overviewBounds) {
          map.fitBounds(field.overviewBounds, { padding: 40, bearing: 0, duration });
        }
      }
    } else if (command?.placeId) {
      rememberOverview();
      applyPlace(command.placeId);
    }
  };
  map.on("style.load", handleStyleLoad);
  map.on("zoom", syncZoom);
  map.on("idle", handleIdle);
  map.on("styledata", refreshBackground);
  const unsubscribe = context.subscribe("personSelection", onSelection);
  const unsubscribeNavigation = context.subscribe("navigationCommand", onNavigation);

  const api = {
    // Used by the projection runtime after the camera rolls back a failed
    // render. This is deliberately separate from the public revision gate:
    // the camera keeps the failed revision while names rebuild from its
    // restored config.
    _rollbackProjectionConfig(config, revision) {
      if (Object.keys(validateProjectionConfig(config)).length || !Number.isSafeInteger(revision) || revision < 0) return false;
      requestedConfig = structuredClone(config);
      requestedRevision = revision;
      requestGeneration += 1;
      installedGeneration = null;
      installedRevision = null;
      rebuildState = "pending";
      rebuildError = null;
      retryOnNextEnable = false;
      hideProjectionField();
      publishDiagnostics();
      void startProjectionBuild();
      return true;
    },
    setProjectionConfig(config, revision) {
      if (map?._otefProjectionConfigRollback === true) return api._rollbackProjectionConfig(config, revision);
      if (Object.keys(validateProjectionConfig(config)).length) return false;
      const revisionless = revision === undefined || revision === null;
      const nextRevision = revisionless ? null : revision;
      if (!revisionless && (!Number.isSafeInteger(nextRevision) || nextRevision < 0)) return false;
      if (!revisionless && Number.isFinite(requestedRevision)) {
        if (nextRevision < requestedRevision) return false;
        if (nextRevision === requestedRevision) {
          return equalProjectionConfig(config, requestedConfig);
        }
      }
      requestedConfig = structuredClone(config);
      requestedRevision = nextRevision;
      requestGeneration += 1;
      installedGeneration = null;
      installedRevision = null;
      rebuildState = "pending";
      rebuildError = null;
      retryOnNextEnable = false;
      hideProjectionField();
      publishDiagnostics();
      void startProjectionBuild();
      return true;
    },
    getProjectionNameDiagnostics() {
      return {
        revision: requestedRevision,
        requestedRevision,
        installedRevision,
        clippedCount: 0,
        owners: packedProjectionOwners(),
        state: rebuildState,
        error: rebuildError,
      };
    },
    sync(groups) {
      if (disposed) return;
      const nextEnabled = hasPeopleNames(groups);
      if (nextEnabled === enabled) {
        if (nextEnabled) {
          if (ready && field && rebuildState === "idle" && installedGeneration === requestGeneration &&
            (!map.getSource(SOURCE_ID) || !map.getLayer(LABEL_ID))) {
            mountInstalledField();
          } else if (rebuildState !== "error" &&
            !(ready && field && rebuildState === "idle" && installedGeneration === requestGeneration)) {
            void startProjectionBuild();
          }
          hideLegacyLabels(map);
        }
        return;
      }
      enabled = nextEnabled;
      if (!enabled) {
        selectedGroup = null;
        pendingPlaceId = null;
        if (animation) {
          animation.hide(() => {
            if (!enabled) removeOwned();
          });
        } else {
          removeOwned();
        }
        publishDiagnostics();
        return;
      }
      hideLegacyLabels(map);
      const shouldRetry = retryOnNextEnable;
      retryOnNextEnable = false;
      if (ready && field && rebuildState === "idle" && installedGeneration === requestGeneration && animation && map.getLayer(LABEL_ID)) {
        animation.show({ restart: false });
        applySelection();
      } else if (ready && field && rebuildState === "idle" && installedGeneration === requestGeneration) {
        mountInstalledField();
      } else if (shouldRetry || requestedConfig) {
        void startProjectionBuild();
      }
    },
    reload() {
      if (disposed) return;
      requestGeneration += 1;
      removeOwned();
      hideLegacyLabels(map);
      field = null;
      ready = false;
      installedGeneration = null;
      installedRevision = null;
      rebuildState = requestedConfig ? "pending" : "idle";
      rebuildError = null;
      retryOnNextEnable = false;
      publishDiagnostics();
      if (enabled) void startProjectionBuild();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      requestGeneration += 1;
      enabled = false;
      unsubscribe();
      unsubscribeNavigation();
      map.off("style.load", handleStyleLoad);
      map.off("zoom", syncZoom);
      map.off("idle", handleIdle);
      map.off("styledata", refreshBackground);
      removeOwned();
      hideLegacyLabels(map);
      if (map._otefNliNameFieldController === api) delete map._otefNliNameFieldController;
      publishDiagnostics();
    },
  };
  if (map) map._otefNliNameFieldController = api;

  return api;
}

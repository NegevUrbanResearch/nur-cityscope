import { loadNliNameField as defaultLoadNliNameField } from "./nli-name-field-data.js";
import { createNameGroupOverlay } from "./nli-name-field-group-overlay.js";
import { createNameFieldAnimation, withNameRevealDelays, NAME_FIELD_MOTION, NAME_FIELD_REVEAL_DURATION_MS } from './nli-name-field-animation.js';
import { createNliNameFocusPresentation, getNameFocusOpacity, getNameFocusAlpha, getRelevantPlaceGroup } from './nli-name-focus-presentation.js';
import { DEFAULT_PROJECTION_CONFIG, validateProjectionConfig } from "./projection-config-schema.js";
import { equalProjectionConfig } from "./projection-config-client.js";
import { migrateNamesWallToV5 } from './nli-name-wall-config.js';

const ORIGINAL_LABEL_ID = "nli__people_names__labels";
const SOURCE_ID = "nli-name-field";
const LABEL_ID = "nli-name-field-labels";
const SELECTED_LABEL_ID = "nli-name-field-selected";
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
  let focusVisible = false;
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
  let canvasAdapter = null;
  let preparedCanvas = null;
  let previousCanvas = null;
  let canvasRequestToken = 0;
  let observedDatasetVersion = context.getPersonSelection?.()?.datasetVersion || null;
  let fadeFrame = null, fadeStart = 0, fadeFrom = 0, fadeTarget = 0, fadeOpacity = 0;
  let revealFrame = null, revealStart = 0, revealElapsedMs = 0, revealRunning = false;
  const frame = globalThis.requestAnimationFrame?.bind(globalThis) || ((fn) => setTimeout(() => fn(Date.now()), 16));
  const cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis) || clearTimeout;
  const revealDurationMs = NAME_FIELD_REVEAL_DURATION_MS;
  const publishReveal = () => {
    canvasAdapter?.setRevealSeconds?.(revealElapsedMs / 1000);
    map.triggerRepaint?.();
  };
  const freezeReveal = () => {
    if (revealRunning) revealElapsedMs = Math.min(revealDurationMs, Math.max(0, Date.now() - revealStart));
    revealRunning = false;
    if (revealFrame != null) { cancelFrame(revealFrame); revealFrame = null; }
    publishReveal();
  };
  const clearReveal = () => { freezeReveal(); revealElapsedMs = 0; publishReveal(); };
  const startReveal = ({ restart = false } = {}) => {
    if (!canvasAdapter || !ready) return;
    if (revealRunning && !restart) revealElapsedMs = Math.min(revealDurationMs, Math.max(0, Date.now() - revealStart));
    if (revealFrame != null) { cancelFrame(revealFrame); revealFrame = null; }
    if (motionMode === 'reduced') {
      revealRunning = false;
      revealElapsedMs = revealDurationMs;
      publishReveal();
      return;
    }
    if (restart) revealElapsedMs = 0;
    revealStart = Date.now() - revealElapsedMs;
    revealRunning = true;
    const tick = () => {
      if (!revealRunning || disposed) return;
      revealElapsedMs = Math.min(revealDurationMs, Math.max(0, Date.now() - revealStart));
      publishReveal();
      if (revealElapsedMs < revealDurationMs) revealFrame = frame(tick);
      else { revealFrame = null; revealRunning = false; publishDiagnostics(); }
    };
    tick();
  };
  const setCanvasOpacity = (value) => {
    fadeOpacity = value;
    canvasAdapter?.setOpacity(value);
    groupOverlay?.setOpacity?.(value);
    if (focusPresentation) {
      if (value <= 0 && focusVisible) { focusPresentation.dispose(); focusVisible = false; }
      else if (value > 0) {
        focusVisible = true;
        focusPresentation.update({ selectedPid, selectedGroup, opacity: value });
      }
    }
    map.triggerRepaint?.();
  };
  const fadeTo = (target) => {
    if (!canvasAdapter) return;
    if (fadeFrame != null) {
      setCanvasOpacity(fadeFrom + (fadeTarget - fadeFrom) * Math.min(1, (Date.now() - fadeStart) / NAME_FIELD_MOTION.hideMs));
      cancelFrame(fadeFrame); fadeFrame = null;
    }
    if (motionMode === 'reduced' || !ready) { setCanvasOpacity(ready ? target : 0); return; }
    fadeFrom = fadeOpacity; fadeTarget = target; fadeStart = Date.now();
    if (fadeFrom === target) return;
    const tick = () => {
      const fraction = Math.min(1, (Date.now() - fadeStart) / NAME_FIELD_MOTION.hideMs);
      setCanvasOpacity(fadeFrom + (fadeTarget - fadeFrom) * fraction);
      fadeFrame = fraction < 1 ? frame(tick) : null;
      if (fadeFrame === null) publishDiagnostics();
    };
    fadeFrame = frame(tick);
  };
  const showCanvas = ({ restart = false } = {}) => {
    if (!ready || !canvasAdapter) return;
    const fresh = restart || (fadeOpacity <= 0 && fadeFrame === null);
    startReveal({ restart: fresh });
    if (fresh || motionMode === 'reduced') {
      if (fadeFrame != null) { cancelFrame(fadeFrame); fadeFrame = null; }
      setCanvasOpacity(1);
    } else fadeTo(1);
  };
  const hideCanvas = () => { freezeReveal(); fadeTo(0); };
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
  const suppressCanvasSymbols = () => {
    if (!canvasAdapter) return;
    for (const id of [ORIGINAL_LABEL_ID, LABEL_ID, SELECTED_LABEL_ID]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
    }
  };
  const publishDiagnostics = () => {
    if (!container?.dataset) return;
    const hasProjectionLifecycle = displayProfile !== "projection" || requestedConfig || field;
    const hasInstalledField = ready && field;
    if ((!enabled && !canvasAdapter) || (displayProfile === "gis" && !hasInstalledField) || !hasProjectionLifecycle) {
      delete container.dataset.nliNameField;
      return;
    }
    const diagnosticsField = ready && field ? field : null;
    const unplaced = diagnosticsField?.diagnostics?.unplaced;
    const owned = diagnosticsField ? installedOwnerCount() : 0;
    container.dataset.nliNameField = JSON.stringify({
      mode: diagnosticsField && useSourceGeometry ? "detail" : "display",
      placed: Number(diagnosticsField?.diagnostics?.placed || 0),
      total: Number(diagnosticsField?.diagnostics?.total ?? diagnosticsField?.diagnostics?.expected ?? 0),
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
      ...(canvasAdapter ? { canvasEnabled: enabled, canvasOpacity: fadeOpacity,
        canvasFadePending: fadeFrame !== null, canvasRevealSeconds: revealElapsedMs / 1000,
        canvasRevealPending: revealFrame !== null } : {}),
      owned,
      ...(rebuildState === "idle" ? { unowned: 0 } : {}),
      fontSize: diagnosticsField?.fontSize,
      referenceZoom: diagnosticsField?.referenceZoom,
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      heading: diagnosticsField?.heading,
    });
  };

  const disposeAnimation = ({ preserveFade = false } = {}) => {
    if (!preserveFade && fadeFrame != null) { cancelFrame(fadeFrame); fadeFrame = null; }
    animation?.dispose();
    animation = null;
  };
  const removeOwned = ({ preserveFade = false } = {}) => {
    disposeAnimation({ preserveFade });
    const previousPresentation = focusPresentation;
    focusPresentation = null;
    previousPresentation?.dispose();
    focusVisible = false;
    groupOverlay?.dispose();
    groupOverlay = null;
    for (const id of [SELECTED_LABEL_ID, LABEL_ID]) {
      if (map.getLayer(id)) cleanup(map.removeLayer.bind(map), id);
    }
    if (map.getSource(SOURCE_ID)) cleanup(map.removeSource.bind(map), SOURCE_ID);
  };
  const hideProjectionField = () => {
    removeOwned();
    hideLegacyLabels(map);
    field = null;
    ready = false;
    useSourceGeometry = false;
  };
  const applySelection = (snapshot = context.getPersonSelection(), { repaintCanvas = true } = {}) => {
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
    updateGroupHighlight({ repaintCanvas });
    publishDiagnostics();
  };
  const updateGroupHighlight = ({ repaintCanvas = true } = {}) => {
    groupOverlay?.update(getRelevantPlaceGroup(field, selectedPid, selectedGroup));
    refreshBackground();
    const focus = { selectedPid, selectedGroup, field };
    animation?.setFocus(getNameFocusOpacity(focus), (pid) => getNameFocusAlpha(focus, pid));
    if (canvasAdapter && ready && repaintCanvas) {
      canvasAdapter.setPresentation({ alphaFor: (pid) => getNameFocusAlpha(focus, pid) });
      map.triggerRepaint?.();
    }
    canvasAdapter?.setSelectedPid?.(selectedPid);
  };
  const applyPlace = (placeId) => {
    pendingPlaceId = placeId || null;
    if (!groupOverlay) return;
    selectedGroup = pendingPlaceId ? groupOverlay.groupForPlace(pendingPlaceId) : null;
    updateGroupHighlight();
    publishDiagnostics();
  };
  const groupIdForPlace = (placeId) => {
    if (!placeId) return null;
    if (groupOverlay) return groupOverlay.groupForPlace(placeId);
    const features = field?.groupGeojson?.features || [];
    return features.find((feature) => feature.properties?.place_ids?.includes(placeId))
      ?.properties?.group_id || null;
  };
  const placeNameForPlace = (placeId) => {
    const groupId = groupIdForPlace(placeId);
    if (!groupId) return null;
    const features = field?.groupGeojson?.features || [];
    const name = features.find((feature) => feature.properties?.group_id === groupId)
      ?.properties?.name;
    if (typeof name !== "string") return null;
    const trimmed = name.trim();
    return trimmed || null;
  };
  const mountInstalledField = ({ repaintCanvas = true } = {}) => {
    if (disposed || (!enabled && !canvasAdapter) || !ready || !field) return;
    removeOwned({ preserveFade: Boolean(canvasAdapter) });
    try {
      useSourceGeometry = displayProfile === "gis" && map.getZoom() >= field.referenceZoom + DETAIL_ZOOM_DELTA;
      map.addSource(SOURCE_ID, { type: "geojson", data: geojsonAt(field, useSourceGeometry) });
      const textSize = useSourceGeometry ? 14 : overviewTextSize(field);
      if (!canvasAdapter) {
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
      }
      groupOverlay = createNameGroupOverlay({ map, field, displayProfile, motionMode });
      focusPresentation = createNliNameFocusPresentation({ map, field });
      if (canvasAdapter) setCanvasOpacity(fadeOpacity);
      if (pendingPlaceId) selectedGroup = groupOverlay.groupForPlace(pendingPlaceId);
      if (map.getLayer(ORIGINAL_LABEL_ID)) map.setLayoutProperty(ORIGINAL_LABEL_ID, "visibility", "none");
      if (!canvasAdapter) animation = createNameFieldAnimation({
        motionMode,
        apply: ({ baseOpacity, selectedOpacity }) => {
          if (map.getLayer(LABEL_ID)) map.setPaintProperty(LABEL_ID, "text-opacity", baseOpacity);
          if (map.getLayer(SELECTED_LABEL_ID)) map.setPaintProperty(SELECTED_LABEL_ID, "text-opacity", selectedOpacity);
        },
      });
      animation?.show();
      applySelection(undefined, { repaintCanvas });
      publishDiagnostics();
    } catch (error) {
      removeOwned();
      hideLegacyLabels(map);
      console.error("NLI name field mount failed", error);
      if (canvasAdapter) throw error;
    }
  };
  const startProjectionBuild = async () => {
    if (!enabled || !requestedConfig || buildInFlight || disposed || canvasAdapter) return;
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
    if (disposed || !enabled || updatingBackground || (canvasAdapter && fadeOpacity <= 0)) return;
    updatingBackground = true;
    try {
      focusPresentation?.update({ selectedPid, selectedGroup, opacity: canvasAdapter ? fadeOpacity : 1 });
      if (focusPresentation) focusVisible = true;
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
    if (!disposed && (enabled || canvasAdapter)) hideLegacyLabels(map);
    if (!disposed && (enabled || canvasAdapter)) suppressCanvasSymbols();
    if (!disposed && (enabled || canvasAdapter) && ready && rebuildState === "idle" && installedGeneration === requestGeneration) {
      mountInstalledField({ repaintCanvas: !canvasAdapter });
    }
  };
  const onSelection = (snapshot) => {
    if (disposed) return;
    const nextVersion = snapshot?.datasetVersion || null;
    const catalogSwap = Boolean(observedDatasetVersion && nextVersion && nextVersion !== observedDatasetVersion);
    if (canvasAdapter && catalogSwap) {
      canvasRequestToken++;
      if (preparedCanvas || previousCanvas) canvasAdapter.rollback?.();
      preparedCanvas = null;
      previousCanvas = null;
      requestGeneration++;
      installedGeneration = null;
      installedRevision = null;
      rebuildState = 'pending';
      hideProjectionField();
      clearReveal();
      setCanvasOpacity(0);
    }
    if (nextVersion) observedDatasetVersion = nextVersion;
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
    placeNameForPlace,
    getPendingPlaceId() {
      return pendingPlaceId;
    },
    isCanvasWallEnabled() { return Boolean(canvasAdapter && enabled); },
    installProjectionCanvas(adapter) {
      if (displayProfile !== 'projection' || !adapter?.prepare || !adapter?.commit || !adapter?.setOpacity) throw new Error('invalid projection Canvas adapter');
      canvasAdapter = adapter;
      canvasRequestToken++;
      requestGeneration++;
      hideProjectionField();
      rebuildState = 'pending';
      publishDiagnostics();
    },
    async prepareProjectionCandidate({ generation, identity, config, field: candidate, revision = null, signal } = {}) {
      if (!canvasAdapter || disposed) throw new Error('projection Canvas adapter unavailable');
      if (Object.keys(validateProjectionConfig(config)).length || !candidate) throw new Error('invalid projection Canvas candidate');
      if (signal?.aborted) throw Object.assign(new Error('projection preparation cancelled'), { name: 'AbortError' });
      const wallConfig = migrateNamesWallToV5(config);
      const token = ++canvasRequestToken;
      rebuildState = 'building';
      publishDiagnostics();
      try {
        if (disposed || token !== canvasRequestToken || signal?.aborted) throw new Error('stale projection Canvas candidate');
        const diagnostics = candidate?.diagnostics;
        if (diagnostics?.state !== 'valid' || diagnostics.expected !== diagnostics.placed || diagnostics.missing || diagnostics.extra || diagnostics.duplicate ||
          !candidate.digest || !Array.isArray(candidate.placements) || !candidate.logicalPlane ||
          candidate.placements.length !== diagnostics.expected || candidate.byPid?.size !== diagnostics.expected) {
          throw new Error(diagnostics?.reason || 'incomplete projection Canvas name wall');
        }
        canvasAdapter.prepare({ config: wallConfig, placements: candidate.placements,
          fontPx: candidate.fontSize, logicalPlane: candidate.logicalPlane });
        preparedCanvas = { generation, identity, config: wallConfig, revision, field: candidate };
        rebuildState = 'pending';
        rebuildError = null;
        publishDiagnostics();
        return { digest: candidate.digest, datasetVersion: candidate.datasetVersion, diagnostics };
      } catch (error) {
        if (!disposed && token === canvasRequestToken && !signal?.aborted) {
          rebuildState = 'error';
          rebuildError = String(error?.message || error);
          publishDiagnostics();
        }
        throw error;
      }
    },
    commitProjectionCandidate(generation) {
      if (!preparedCanvas || preparedCanvas.generation !== generation || disposed) throw new Error('stale projection Canvas commit');
      previousCanvas = { generation, field, ready, installedRevision, installedGeneration, requestedConfig, requestedRevision,
        revealElapsedMs };
      const next = preparedCanvas;
      canvasAdapter.commit();
      field = next.field;
      ready = true;
      requestedConfig = next.config;
      requestedRevision = next.revision;
      installedRevision = next.revision;
      installedGeneration = requestGeneration;
      rebuildState = 'idle';
      preparedCanvas = null;
      try {
        mountInstalledField();
        if (enabled) showCanvas({ restart: !previousCanvas.ready ||
          previousCanvas.field?.datasetVersion !== next.field?.datasetVersion });
        else if (!previousCanvas.ready || previousCanvas.field?.datasetVersion !== next.field?.datasetVersion) {
          clearReveal(); setCanvasOpacity(0);
        } else hideCanvas();
      } catch (error) {
        api.rollbackProjectionCandidate(generation);
        throw error;
      }
      publishDiagnostics();
      return true;
    },
    rollbackProjectionCandidate(generation) {
      if (preparedCanvas?.generation !== generation && previousCanvas?.generation !== generation) return false;
      if (preparedCanvas?.generation === generation) preparedCanvas = null;
      canvasAdapter?.rollback?.();
      if (previousCanvas) {
        const old = previousCanvas;
        const sameDataset = old.field?.datasetVersion === field?.datasetVersion;
        freezeReveal();
        ({ field, ready, installedRevision, installedGeneration, requestedConfig, requestedRevision } = old);
        previousCanvas = null;
        if (ready && field) mountInstalledField();
        else removeOwned();
        if (!sameDataset) revealElapsedMs = old.revealElapsedMs;
        publishReveal();
        if (!ready) { clearReveal(); setCanvasOpacity(0); }
        else if (enabled) startReveal();
      }
      publishDiagnostics();
      return true;
    },
    finalizeProjectionCandidate(generation) {
      if (previousCanvas?.generation !== generation) return false;
      previousCanvas = null;
      canvasAdapter?.finalize?.();
      return true;
    },
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
      if (!canvasAdapter) {
        hideProjectionField();
        publishDiagnostics();
        void startProjectionBuild();
      } else publishDiagnostics();
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
      if (canvasAdapter) {
        publishDiagnostics();
        return true;
      }
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
        ...(canvasAdapter ? { canvasOpacity: fadeOpacity, canvasRevealSeconds: revealElapsedMs / 1000,
          canvasRevealPending: revealFrame !== null } : {}),
      };
    },
    sync(groups) {
      if (disposed) return;
      const nextEnabled = hasPeopleNames(groups);
      if (canvasAdapter) {
        if (nextEnabled === enabled) return;
        enabled = nextEnabled;
        hideLegacyLabels(map);
        suppressCanvasSymbols();
        if (enabled) showCanvas();
        else hideCanvas();
        publishDiagnostics();
        return;
      }
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
      if (canvasAdapter) canvasRequestToken++;
      requestGeneration += 1;
      removeOwned();
      if (canvasAdapter) { clearReveal(); setCanvasOpacity(0); }
      hideLegacyLabels(map);
      field = null;
      ready = false;
      installedGeneration = null;
      installedRevision = null;
      rebuildState = requestedConfig ? "pending" : "idle";
      rebuildError = null;
      retryOnNextEnable = false;
      publishDiagnostics();
      if (enabled && !canvasAdapter) void startProjectionBuild();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (fadeFrame != null) { cancelFrame(fadeFrame); fadeFrame = null; }
      freezeReveal();
      requestGeneration += 1;
      enabled = false;
      unsubscribe();
      unsubscribeNavigation();
      map.off("style.load", handleStyleLoad);
      map.off("zoom", syncZoom);
      map.off("idle", handleIdle);
      map.off("styledata", refreshBackground);
      removeOwned();
      canvasAdapter?.dispose?.();
      hideLegacyLabels(map);
      if (map._otefNliNameFieldController === api) delete map._otefNliNameFieldController;
      publishDiagnostics();
    },
  };
  if (map) map._otefNliNameFieldController = api;

  return api;
}

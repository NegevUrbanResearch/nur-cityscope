/**
 * Viewport sync for the Leaflet GIS map: apply remote viewports, send local
 * moveend/zoomend to OTEFDataContext, and avoid echoing remote `setView` back.
 * Relies on globals: `map`, `proj4`, `OTEFDataContext`, and `window.isApplyingRemoteState`.
 */
import { createViewportApplyScheduler } from "./viewport-sync-scheduler.js";
import { getRemoteViewportSetViewOptions } from "./viewport-apply-policy.js";

/** Snapshot of OTEFDataContext._viewportSeq at the start of a remote setView. */
let lastAppliedViewportSeq = 0;
let lastAppliedViewportSourceId = null;

const createViewportApplySchedulerRef = createViewportApplyScheduler;
const getRemoteViewportSetViewOptionsRef = getRemoteViewportSetViewOptions;

function getGisPerfConfig() {
  return (
    (typeof MapProjectionConfig !== "undefined" && MapProjectionConfig.GIS_PERF) ||
    {}
  );
}

function getMapRef() {
  if (typeof window !== "undefined" && window.map && typeof window.map.on === "function") {
    return window.map;
  }
  if (typeof map !== "undefined" && map && typeof map.on === "function") {
    return map;
  }
  return null;
}

function applyViewportNow(viewport) {
  const telemetryStart = Date.now();
  if (!viewport || !viewport.bbox) return;

  const bbox = viewport.bbox;
  const zoom = viewport.zoom;

  // Convert ITM bbox to WGS84 for Leaflet
  const [swLng, swLat] = proj4("EPSG:2039", "EPSG:4326", [bbox[0], bbox[1]]);
  const [neLng, neLat] = proj4("EPSG:2039", "EPSG:4326", [bbox[2], bbox[3]]);

  // Calculate center
  const centerLat = (swLat + neLat) / 2;
  const centerLng = (swLng + neLng) / 2;

  // Check if we need to update (avoid loops from our own updates)
  const mapRef = getMapRef();
  if (!mapRef) return;
  const currentCenter = mapRef.getCenter();
  const currentZoom = mapRef.getZoom();

  const centerDiff =
    Math.abs(currentCenter.lat - centerLat) +
    Math.abs(currentCenter.lng - centerLng);
  const zoomDiff = Math.abs(currentZoom - zoom);

  const centerDiffThreshold =
    currentZoom >= 17 ? 0.00003 : currentZoom >= 15 ? 0.00008 : 0.0002;
  if (centerDiff <= centerDiffThreshold && zoomDiff <= 0.05) return;

  const incomingSeq = Number.isFinite(viewport?.seq) ? viewport.seq : null;
  const incomingSourceId = viewport && viewport.sourceId != null ? String(viewport.sourceId) : null;

  const canUseSameSourceSeqDedupe =
    incomingSourceId !== null &&
    lastAppliedViewportSourceId !== null &&
    incomingSourceId === lastAppliedViewportSourceId;
  if (canUseSameSourceSeqDedupe && incomingSeq !== null && incomingSeq < lastAppliedViewportSeq) {
    return;
  }

  const perf = getGisPerfConfig();
  const setViewOptions =
    typeof getRemoteViewportSetViewOptionsRef === "function"
      ? getRemoteViewportSetViewOptionsRef(perf, { zoomDiff, centerDiff })
      : {
          animate: !!perf.ANIMATE_REMOTE_VIEWPORT,
          duration:
            typeof perf.REMOTE_ANIMATION_DURATION_S === "number"
              ? perf.REMOTE_ANIMATION_DURATION_S
              : 0.12,
        };

  if (incomingSeq !== null) {
    lastAppliedViewportSeq = incomingSeq;
  }
  if (incomingSourceId !== null) {
    lastAppliedViewportSourceId = incomingSourceId;
  }

  // Set flag to prevent feedback loop (don't broadcast this change back)
  window.isApplyingRemoteState = true;
  mapRef.setView([centerLat, centerLng], zoom, setViewOptions);

  // Mark synchronization as active to ignore ensuing moveend events
  if (window.syncLockTimer) clearTimeout(window.syncLockTimer);
  window.syncLockTimer = setTimeout(() => {
    window.isApplyingRemoteState = false;
  }, 150);

  if (
    typeof window !== "undefined" &&
    window.MapPerfTelemetry &&
    typeof window.MapPerfTelemetry.record === "function"
  ) {
    const elapsed = Date.now() - telemetryStart;
    window.MapPerfTelemetry.record("applyViewportMs", elapsed);
    if (Math.abs(zoomDiff) > 0.01) {
      window.MapPerfTelemetry.record("zoomApplyMs", elapsed);
    } else {
      window.MapPerfTelemetry.record("panApplyMs", elapsed);
    }
  }
}

let remoteViewportScheduler = null;
if (typeof createViewportApplySchedulerRef === "function") {
  const perf = getGisPerfConfig();
  const minApplyIntervalMs =
    typeof perf.MIN_APPLY_INTERVAL_MS === "number" ? perf.MIN_APPLY_INTERVAL_MS : 33;
  remoteViewportScheduler = createViewportApplySchedulerRef({
    applyViewport: applyViewportNow,
    minIntervalMs: minApplyIntervalMs,
  });
}

/**
 * Apply viewport state from API (pan map to match server state)
 */
function applyViewportFromAPI(viewport) {
  if (!viewport || !viewport.bbox) return;
  const perf = getGisPerfConfig();
  const useScheduler =
    perf.ENABLE_RAF_VIEWPORT_APPLY !== false && remoteViewportScheduler;
  if (useScheduler) {
    remoteViewportScheduler.schedule(viewport);
    return;
  }
  applyViewportNow(viewport);
}

/**
 * Send viewport update via OTEFDataContext (GIS -> Write: viewport)
 * Applies hard-wall bounds and debounces API writes inside DataContext/API client.
 */
function sendViewportUpdate() {
  if (window.isApplyingRemoteState) return;
  const mapRef = getMapRef();
  if (!mapRef || typeof OTEFDataContext === "undefined") return;
  if (
    OTEFDataContext._viewportSeq > 0 &&
    OTEFDataContext._viewportSeq === lastAppliedViewportSeq
  ) {
    const zoom = mapRef.getZoom();
    const bounds = mapRef.getBounds();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    if (typeof proj4 === "undefined") return;
    const [swX, swY] = proj4("EPSG:4326", "EPSG:2039", [sw.lng, sw.lat]);
    const [neX, neY] = proj4("EPSG:4326", "EPSG:2039", [ne.lng, ne.lat]);
    const ctxViewport =
      typeof OTEFDataContext.getViewport === "function"
        ? OTEFDataContext.getViewport()
        : null;
    const ctxBbox = ctxViewport && Array.isArray(ctxViewport.bbox) ? ctxViewport.bbox : null;
    const matchesContext =
      ctxBbox &&
      ctxBbox.length === 4 &&
      Math.abs((ctxViewport.zoom ?? zoom) - zoom) <= 0.001 &&
      Math.abs(ctxBbox[0] - swX) <= 0.01 &&
      Math.abs(ctxBbox[1] - swY) <= 0.01 &&
      Math.abs(ctxBbox[2] - neX) <= 0.01 &&
      Math.abs(ctxBbox[3] - neY) <= 0.01;
    if (matchesContext) return;
  }

  const zoom = mapRef.getZoom();
  const bounds = mapRef.getBounds();

  // Convert to ITM for storage (API expects ITM)
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();

  // Project from WGS84 (Leaflet) to ITM (EPSG:2039)
  if (typeof proj4 === "undefined") return;

  const [swX, swY] = proj4("EPSG:4326", "EPSG:2039", [sw.lng, sw.lat]);
  const [neX, neY] = proj4("EPSG:4326", "EPSG:2039", [ne.lng, ne.lat]);

  const viewportState = {
    bbox: [swX, swY, neX, neY],
    zoom: zoom,
    corners: {
      sw: { x: swX, y: swY },
      se: { x: neX, y: swY },
      nw: { x: swX, y: neY },
      ne: { x: neX, y: neY },
    },
  };

  // Delegate to DataContext for bounds enforcement + debounced write
  // Pass clientId as sourceId to allow other clients to ignore this echo
  const result = OTEFDataContext.updateViewportFromUI(viewportState, "gis");

  // If the update was rejected by bounds, snap back to the last accepted viewport
  // so the GIS map cannot visually move/zoom beyond the hard-wall polygon.
  // We ignore 'interaction_guard' rejections to prevent infinite snapback loops
  // during active remote movement.
  if (result && result.accepted === false && result.reason === "bounds") {
    const latestViewport = OTEFDataContext.getViewport();
    if (latestViewport) {
      applyViewportFromAPI(latestViewport);
    }
  }
}

let listenersAttached = false;
function attachViewportSyncListeners() {
  if (listenersAttached) return;
  const mapRef = getMapRef();
  if (!mapRef) return;
  mapRef.on("moveend", sendViewportUpdate);
  mapRef.on("zoomend", sendViewportUpdate);
  listenersAttached = true;
}

if (typeof window !== "undefined") {
  window.attachViewportSyncListeners = attachViewportSyncListeners;
  window.applyViewportFromAPI = applyViewportFromAPI;
  window.sendViewportUpdate = sendViewportUpdate;
}

attachViewportSyncListeners();

export { applyViewportFromAPI, sendViewportUpdate, attachViewportSyncListeners };

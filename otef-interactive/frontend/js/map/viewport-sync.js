/**
 * Viewport synchronization helpers for the Leaflet GIS map.
 * These functions rely on the global `map`, `proj4`, `isApplyingRemoteState`
 * and `OTEFDataContext` objects defined elsewhere.
 */

// Flag and timer to prevent feedback loops (declared in map-initialization.js)
// But we need to ensure they are accessible or use the ones from there.
// Since they are defined with 'let' in another file in the same scope, we don't redeclare here.

let createViewportApplySchedulerRef = null;
let getRemoteViewportSetViewOptionsRef = null;
try {
  // eslint-disable-next-line global-require
  createViewportApplySchedulerRef =
    require("./viewport-sync-scheduler").createViewportApplyScheduler;
  // eslint-disable-next-line global-require
  getRemoteViewportSetViewOptionsRef =
    require("./viewport-apply-policy").getRemoteViewportSetViewOptions;
} catch (_) {
  if (
    typeof window !== "undefined" &&
    window.ViewportSyncScheduler &&
    typeof window.ViewportSyncScheduler.createViewportApplyScheduler === "function"
  ) {
    createViewportApplySchedulerRef =
      window.ViewportSyncScheduler.createViewportApplyScheduler;
  }
  if (
    typeof window !== "undefined" &&
    window.ViewportApplyPolicy &&
    typeof window.ViewportApplyPolicy.getRemoteViewportSetViewOptions === "function"
  ) {
    getRemoteViewportSetViewOptionsRef =
      window.ViewportApplyPolicy.getRemoteViewportSetViewOptions;
  }
}

function getGisPerfConfig() {
  return (
    (typeof MapProjectionConfig !== "undefined" && MapProjectionConfig.GIS_PERF) ||
    {}
  );
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
  const currentCenter = map.getCenter();
  const currentZoom = map.getZoom();

  const centerDiff =
    Math.abs(currentCenter.lat - centerLat) +
    Math.abs(currentCenter.lng - centerLng);
  const zoomDiff = Math.abs(currentZoom - zoom);

  if (centerDiff <= 0.0005 && zoomDiff <= 0.5) return;

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

  // Set flag to prevent feedback loop (don't broadcast this change back)
  window.isApplyingRemoteState = true;
  map.setView([centerLat, centerLng], zoom, setViewOptions);

  // Mark synchronization as active to ignore ensuing moveend events
  if (window.syncLockTimer) clearTimeout(window.syncLockTimer);
  window.syncLockTimer = setTimeout(() => {
    window.isApplyingRemoteState = false;
  }, 800);

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
  if (!map || typeof OTEFDataContext === "undefined") return;

  const zoom = map.getZoom();
  const bounds = map.getBounds();

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

// Attach listeners to map movement and zoom
map.on("moveend", sendViewportUpdate);
map.on("zoomend", sendViewportUpdate); // Ensure zoom changes are synced

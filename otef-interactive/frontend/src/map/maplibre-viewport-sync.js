/**
 * Viewport synchronization for MapLibre GL JS.
 * Applies remote viewport state from OTEFDataContext to map and reports
 * local move/zoom updates back into OTEFDataContext.
 */

function itmBboxToWgs84(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4 || typeof proj4 === "undefined") {
    return null;
  }

  if (!bbox.every((coord) => Number.isFinite(coord))) {
    return null;
  }

  const sw = proj4("EPSG:2039", "EPSG:4326", [bbox[0], bbox[1]]);
  const ne = proj4("EPSG:2039", "EPSG:4326", [bbox[2], bbox[3]]);

  if (
    !Array.isArray(sw) ||
    sw.length !== 2 ||
    !Number.isFinite(sw[0]) ||
    !Number.isFinite(sw[1]) ||
    !Array.isArray(ne) ||
    ne.length !== 2 ||
    !Number.isFinite(ne[0]) ||
    !Number.isFinite(ne[1])
  ) {
    return null;
  }

  const [swLng, swLat] = sw;
  const [neLng, neLat] = ne;
  return [swLng, swLat, neLng, neLat];
}

/** If the remote sequence jumps backward by more than this, treat it as a reconnect/reset. */
const VIEWPORT_SEQ_RECONNECT_ROLLBACK_GAP = 10;

/** WGS84 corner tolerance (~1.1 cm at equator): ignore float/proj noise when comparing bounds. */
const VIEWPORT_BOUNDS_CORNER_EPSILON_DEG = 0.0001;

/** Minimum |Δzoom| to treat explicit remote zoom as a change (sub-step drift below this is ignored). */
const VIEWPORT_EXPLICIT_ZOOM_MIN_DELTA = 0.1;

function wgs84ToItm(lng, lat) {
  if (typeof proj4 === "undefined" || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const point = proj4("EPSG:4326", "EPSG:2039", [lng, lat]);
  if (
    !Array.isArray(point) ||
    point.length !== 2 ||
    !Number.isFinite(point[0]) ||
    !Number.isFinite(point[1])
  ) {
    return null;
  }
  return point;
}

function applyViewportToMap(map, viewport, startRemoteApplyLock) {
  if (!map || !viewport || !viewport.bbox) return false;
  const wgs84Bbox = itmBboxToWgs84(viewport.bbox);
  if (!wgs84Bbox) return false;

  const [west, south, east, north] = wgs84Bbox;
  const currentBounds = map.getBounds();
  const currentZoom = map.getZoom();
  const hasExplicitZoom = Number.isFinite(viewport.zoom);
  const targetZoom = hasExplicitZoom ? viewport.zoom : currentZoom;
  const boundsChanged = !(
    currentBounds &&
    Math.abs(currentBounds.getWest() - west) < VIEWPORT_BOUNDS_CORNER_EPSILON_DEG &&
    Math.abs(currentBounds.getSouth() - south) < VIEWPORT_BOUNDS_CORNER_EPSILON_DEG &&
    Math.abs(currentBounds.getEast() - east) < VIEWPORT_BOUNDS_CORNER_EPSILON_DEG &&
    Math.abs(currentBounds.getNorth() - north) < VIEWPORT_BOUNDS_CORNER_EPSILON_DEG
  );
  const zoomChanged = Math.abs(currentZoom - targetZoom) >= VIEWPORT_EXPLICIT_ZOOM_MIN_DELTA;

  if (!boundsChanged && !zoomChanged) {
    return true;
  }

  startRemoteApplyLock();
  if (boundsChanged) {
    map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      {
        animate: false,
        padding: 0,
      }
    );
  }

  // When remote zoom is explicit, enforce it after fitBounds as fitBounds can
  // pick a different zoom level than requested.
  if (hasExplicitZoom && (zoomChanged || boundsChanged) && typeof map.setZoom === "function") {
    map.setZoom(targetZoom, { animate: false });
  }
  return true;
}

export function setupViewportSync(map, dataContext) {
  if (!map || !dataContext || typeof dataContext.subscribe !== "function") {
    return () => {};
  }

  let isApplyingRemote = false;
  let remoteUnlockTimer = null;
  let pendingReportTimer = null;
  let remoteUnlockHandlers = [];
  let lastAppliedViewportSeq = -1;
  let gisReportBlockedPending = false;
  let deferredGuardFlushTimer = null;
  let syncActive = true;

  const clearRemoteUnlockTimer = () => {
    if (!remoteUnlockTimer) return;
    clearTimeout(remoteUnlockTimer);
    remoteUnlockTimer = null;
  };

  const clearRemoteUnlockHandlers = () => {
    if (!remoteUnlockHandlers.length) return;
    for (const [eventName, handler] of remoteUnlockHandlers) {
      map.off(eventName, handler);
    }
    remoteUnlockHandlers = [];
  };

  const clearDeferredGuardFlushTimer = () => {
    if (!deferredGuardFlushTimer) return;
    clearTimeout(deferredGuardFlushTimer);
    deferredGuardFlushTimer = null;
  };

  const clearRemoteApplyLockOnly = () => {
    clearRemoteUnlockTimer();
    clearRemoteUnlockHandlers();
    isApplyingRemote = false;
  };

  const reportToContext = (onInteractionGuard) => {
    if (!syncActive) return;
    if (!map || !dataContext || typeof dataContext.updateViewportFromUI !== "function") {
      return;
    }

    const bounds = map.getBounds();
    if (!bounds) return;

    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const swItm = wgs84ToItm(sw.lng, sw.lat);
    const neItm = wgs84ToItm(ne.lng, ne.lat);

    if (!swItm || !neItm) return;

    const bbox = [swItm[0], swItm[1], neItm[0], neItm[1]];
    const corners = {
      sw: { x: swItm[0], y: swItm[1] },
      se: { x: neItm[0], y: swItm[1] },
      nw: { x: swItm[0], y: neItm[1] },
      ne: { x: neItm[0], y: neItm[1] },
    };

    // Keep MapLibre fractional zoom in DataContext end-to-end; remote UI formats for display only.
    const result = dataContext.updateViewportFromUI(
      {
        bbox,
        zoom: map.getZoom(),
        corners,
      },
      "gis",
    );

    if (
      typeof onInteractionGuard === "function" &&
      result &&
      typeof result === "object" &&
      result.accepted === false &&
      result.reason === "interaction_guard"
    ) {
      onInteractionGuard();
    }
  };

  const flushGISReportRetry = () => {
    if (!syncActive) return;
    if (!gisReportBlockedPending) return;
    if (isApplyingRemote) return;
    gisReportBlockedPending = false;
    clearDeferredGuardFlushTimer();
    reportToContext(null);
  };

  const scheduleGISRetryFlush = () => {
    if (deferredGuardFlushTimer) return;
    deferredGuardFlushTimer = setTimeout(() => {
      deferredGuardFlushTimer = null;
      flushGISReportRetry();
    }, 0);
  };

  const onGISReportInteractionGuard = () => {
    if (gisReportBlockedPending) return;
    gisReportBlockedPending = true;
    if (!isApplyingRemote) {
      scheduleGISRetryFlush();
    }
  };

  const finishRemoteApplyUnlock = () => {
    clearRemoteApplyLockOnly();
    if (syncActive) {
      flushGISReportRetry();
    }
  };

  const startRemoteApplyLock = () => {
    clearRemoteApplyLockOnly();
    isApplyingRemote = true;

    const handleUnlockEvent = () => {
      finishRemoteApplyUnlock();
    };

    remoteUnlockHandlers = [["idle", handleUnlockEvent]];

    for (const [eventName, handler] of remoteUnlockHandlers) {
      map.once(eventName, handler);
    }

    remoteUnlockTimer = setTimeout(() => {
      finishRemoteApplyUnlock();
    }, 500);
  };

  const unsubscribeViewport = dataContext.subscribe("viewport", (viewport) => {
    const seq = viewport && viewport.seq;
    if (Number.isFinite(seq)) {
      if (
        lastAppliedViewportSeq >= 0 &&
        seq < lastAppliedViewportSeq &&
        lastAppliedViewportSeq - seq > VIEWPORT_SEQ_RECONNECT_ROLLBACK_GAP
      ) {
        lastAppliedViewportSeq = -1;
      }
      if (seq <= lastAppliedViewportSeq) {
        return;
      }
    }
    const handled = applyViewportToMap(map, viewport, startRemoteApplyLock);
    if (handled && Number.isFinite(seq)) {
      lastAppliedViewportSeq = seq;
    }
  });

  const handleMapChange = () => {
    if (pendingReportTimer) return;
    pendingReportTimer = setTimeout(() => {
      pendingReportTimer = null;
      if (!syncActive) return;
      if (isApplyingRemote) return;
      reportToContext(onGISReportInteractionGuard);
    }, 0);
  };

  map.on("moveend", handleMapChange);
  map.on("zoomend", handleMapChange);

  return () => {
    syncActive = false;
    if (typeof unsubscribeViewport === "function") unsubscribeViewport();
    map.off("moveend", handleMapChange);
    map.off("zoomend", handleMapChange);
    if (pendingReportTimer) {
      clearTimeout(pendingReportTimer);
      pendingReportTimer = null;
    }
    clearDeferredGuardFlushTimer();
    gisReportBlockedPending = false;
    clearRemoteApplyLockOnly();
  };
}

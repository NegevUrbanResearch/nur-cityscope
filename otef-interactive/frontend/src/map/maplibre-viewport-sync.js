/**
 * Viewport synchronization for MapLibre GL JS.
 * Applies remote viewport state from OTEFDataContext to map and reports
 * local move/zoom updates back into OTEFDataContext.
 */
import { itmBboxToWgs84SwNe } from "../map-utils/itm-bbox-to-wgs84-bounds.js";
import { itmAxisAlignedBboxFromLngLatBounds } from "../map-utils/map-bounds-to-itm-bbox.js";

/** If the remote sequence jumps backward by more than this, treat it as a reconnect/reset. */
const VIEWPORT_SEQ_RECONNECT_ROLLBACK_GAP = 10;

/** WGS84 corner tolerance (~1.1 cm at equator): ignore float/proj noise when comparing bounds. */
const VIEWPORT_BOUNDS_CORNER_EPSILON_DEG = 0.0001;

/** Minimum |Δzoom| to treat explicit remote zoom as a change (sub-step drift below this is ignored). */
const VIEWPORT_EXPLICIT_ZOOM_MIN_DELTA = 0.1;
/** Debounce window used to detect when resize churn has settled. */
const VIEWPORT_RESIZE_SETTLE_DEBOUNCE_MS = 200;

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
  const wgs84Bbox = itmBboxToWgs84SwNe(viewport.bbox);
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

  if (hasExplicitZoom && typeof map.setZoom === "function") {
    const zoomAfterBounds = map.getZoom();
    const explicitZoomDrift =
      Math.abs(zoomAfterBounds - targetZoom) >= VIEWPORT_EXPLICIT_ZOOM_MIN_DELTA;
    if (boundsChanged || explicitZoomDrift || zoomChanged) {
      map.setZoom(targetZoom, { animate: false });
    }
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
  let resizeSettleTimer = null;
  let isResizeActive = false;
  let resizeObserver = null;
  let queuedViewportDuringResize = null;
  let queuedViewportSeqDuringResize = null;
  let usingWindowResizeFallback = false;
  let handleWindowResize = null;
  let syncActive = true;
  /** Skips the next moveend/zoomend-driven report (used after a post-resize sync report). */
  let suppressNextGisMapChange = false;
  /** While true, `moveend`/`zoomend` reports are ignored until the post-resize `idle` callback runs. */
  let postResizeGisSyncPending = false;
  /** If resize settle wanted a context report but remote apply was active, flush on unlock. */
  let pendingPostResizeContextReport = false;
  let postResizeIdleHandler = null;

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

  const clearResizeSettleTimer = () => {
    if (!resizeSettleTimer) return;
    clearTimeout(resizeSettleTimer);
    resizeSettleTimer = null;
  };

  const resetResizeQueue = () => {
    queuedViewportDuringResize = null;
    queuedViewportSeqDuringResize = null;
  };

  const clearRemoteApplyLockOnly = () => {
    clearRemoteUnlockTimer();
    clearRemoteUnlockHandlers();
    isApplyingRemote = false;
  };

  const clearPostResizeIdleRegistration = () => {
    if (postResizeIdleHandler && typeof map.off === "function") {
      map.off("idle", postResizeIdleHandler);
    }
    postResizeIdleHandler = null;
  };

  const reportToContext = (onInteractionGuard) => {
    if (!syncActive) return;
    if (!map || !dataContext || typeof dataContext.updateViewportFromUI !== "function") {
      return;
    }

    const bounds = map.getBounds();
    if (!bounds) return;

    const itmCache = new Map();
    const toItm = (lng, lat) => {
      const key = `${lng},${lat}`;
      if (itmCache.has(key)) return itmCache.get(key);
      const point = wgs84ToItm(lng, lat);
      itmCache.set(key, point);
      return point;
    };

    const bbox = itmAxisAlignedBboxFromLngLatBounds(bounds, toItm);
    if (!bbox) return;

    const sw = bounds.getSouthWest();
    const se = bounds.getSouthEast();
    const nw = bounds.getNorthWest();
    const ne = bounds.getNorthEast();
    const swItm = toItm(sw.lng, sw.lat);
    const seItm = toItm(se.lng, se.lat);
    const nwItm = toItm(nw.lng, nw.lat);
    const neItm = toItm(ne.lng, ne.lat);
    if (!swItm || !seItm || !nwItm || !neItm) return;

    const corners = {
      sw: { x: swItm[0], y: swItm[1] },
      se: { x: seItm[0], y: seItm[1] },
      nw: { x: nwItm[0], y: nwItm[1] },
      ne: { x: neItm[0], y: neItm[1] },
    };

    // map.getZoom(): GIS map uses zoomSnap:1, so whole-level zoom is preferred, but the value is still a float
    // (e.g. mid-gesture, fitBounds, or animations). Pass it through; remote UI may round (e.g. normalizeZoomLevel).
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

  const runPostResizeContextReport = () => {
    if (!syncActive) return;
    if (isApplyingRemote) {
      pendingPostResizeContextReport = true;
      return;
    }
    suppressNextGisMapChange = true;
    reportToContext(null);
  };

  const finishRemoteApplyUnlock = () => {
    clearRemoteApplyLockOnly();
    if (syncActive) {
      flushGISReportRetry();
      if (pendingPostResizeContextReport) {
        pendingPostResizeContextReport = false;
        runPostResizeContextReport();
      }
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

  const applyAcceptedViewport = (viewport, options = {}) => {
    const seq = viewport && viewport.seq;
    const handled = applyViewportToMap(map, viewport, startRemoteApplyLock);
    if (handled && Number.isFinite(seq)) {
      lastAppliedViewportSeq = seq;
    }
  };

  const maybeApplyQueuedViewportAfterResize = () => {
    if (!queuedViewportDuringResize) return;
    const queuedViewport = queuedViewportDuringResize;
    resetResizeQueue();
    applyAcceptedViewport(queuedViewport, { deferredFromResizeSettle: true });
  };

  const schedulePostResizeGisContextSync = () => {
    clearPostResizeIdleRegistration();
    postResizeGisSyncPending = true;
    const onIdle = () => {
      postResizeIdleHandler = null;
      postResizeGisSyncPending = false;
      runPostResizeContextReport();
    };
    postResizeIdleHandler = onIdle;
    if (typeof map.once === "function") {
      map.once("idle", onIdle);
    } else {
      requestAnimationFrame(() => {
        postResizeIdleHandler = null;
        postResizeGisSyncPending = false;
        onIdle();
      });
    }
    if (typeof map.resize === "function") {
      map.resize();
    }
  };

  const markResizeActivity = (origin) => {
    void origin;
    if (!syncActive) return;
    if (!isResizeActive) {
      isResizeActive = true;
    }

    clearResizeSettleTimer();
    resizeSettleTimer = setTimeout(() => {
      resizeSettleTimer = null;
      if (!syncActive) return;
      isResizeActive = false;
      maybeApplyQueuedViewportAfterResize();
      schedulePostResizeGisContextSync();
    }, VIEWPORT_RESIZE_SETTLE_DEBOUNCE_MS);
  };

  const evaluateViewportSeqAcceptance = (viewport) => {
    const seq = viewport && viewport.seq;
    if (!Number.isFinite(seq)) return true;

    const seqCursor = Number.isFinite(queuedViewportSeqDuringResize)
      ? Math.max(lastAppliedViewportSeq, queuedViewportSeqDuringResize)
      : lastAppliedViewportSeq;

    if (
      seqCursor >= 0 &&
      seq < seqCursor &&
      seqCursor - seq > VIEWPORT_SEQ_RECONNECT_ROLLBACK_GAP
    ) {
      lastAppliedViewportSeq = -1;
      resetResizeQueue();
      return true;
    }

    if (seq <= seqCursor) {
      return false;
    }

    return true;
  };

  const queueViewportDuringResize = (viewport) => {
    queuedViewportDuringResize = viewport;
    queuedViewportSeqDuringResize =
      viewport && Number.isFinite(viewport.seq) ? viewport.seq : null;
  };

  const unsubscribeViewport = dataContext.subscribe("viewport", (viewport) => {
    if (!evaluateViewportSeqAcceptance(viewport)) {
      return;
    }

    if (isResizeActive) {
      queueViewportDuringResize(viewport);
      return;
    }

    applyAcceptedViewport(viewport);
  });

  const handleMapChange = () => {
    if (suppressNextGisMapChange) {
      suppressNextGisMapChange = false;
      return;
    }
    if (postResizeGisSyncPending) {
      return;
    }
    if (pendingReportTimer) return;
    pendingReportTimer = setTimeout(() => {
      pendingReportTimer = null;
      if (!syncActive) return;
      if (isApplyingRemote) return;
      if (isResizeActive) {
        return;
      }
      reportToContext(onGISReportInteractionGuard);
    }, 0);
  };

  const mapContainer = typeof map.getContainer === "function" ? map.getContainer() : null;
  if (typeof ResizeObserver !== "undefined" && mapContainer) {
    resizeObserver = new ResizeObserver(() => {
      markResizeActivity("resize_observer");
    });
    resizeObserver.observe(mapContainer);
  } else if (typeof window !== "undefined") {
    usingWindowResizeFallback = true;
    handleWindowResize = () => {
      markResizeActivity("window_resize");
    };
    window.addEventListener("resize", handleWindowResize);
  }

  map.on("moveend", handleMapChange);
  map.on("zoomend", handleMapChange);

  return () => {
    syncActive = false;
    clearPostResizeIdleRegistration();
    if (typeof unsubscribeViewport === "function") unsubscribeViewport();
    map.off("moveend", handleMapChange);
    map.off("zoomend", handleMapChange);
    if (pendingReportTimer) {
      clearTimeout(pendingReportTimer);
      pendingReportTimer = null;
    }
    clearDeferredGuardFlushTimer();
    clearResizeSettleTimer();
    resetResizeQueue();
    gisReportBlockedPending = false;
    pendingPostResizeContextReport = false;
    postResizeGisSyncPending = false;
    suppressNextGisMapChange = false;
    clearRemoteApplyLockOnly();
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (usingWindowResizeFallback && handleWindowResize && typeof window !== "undefined") {
      window.removeEventListener("resize", handleWindowResize);
      handleWindowResize = null;
    }
  };
}

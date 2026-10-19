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
/** During GIS place travel, publish actual viewport snapshots at this cadence. */
const PLACE_NAVIGATION_REPORT_INTERVAL_MS = 100;

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
  let lastNavigationCommandId = null;
  let activeNavigationTraceId = null;
  let navigationTravelActive = false;
  let navigationReportTimer = null;
  let navigationIdleHandler = null;
  /** Skips the next moveend/zoomend-driven report (used after a post-resize sync report). */
  let suppressNextGisMapChange = false;
  /** While true, `moveend`/`zoomend` reports are ignored until the post-resize `idle` callback runs. */
  let postResizeGisSyncPending = false;
  /** If resize settle wanted a context report but remote apply was active, flush on unlock. */
  let pendingPostResizeContextReport = false;
  let postResizeIdleHandler = null;
  let experienceState = dataContext.getExperienceState?.() || null;
  let transitionPending = !!experienceState?.pending_transition;
  let awaitingExperienceViewport = transitionPending;
  let experienceGeneration = 0;
  let navigationExperienceScope = null;
  let blockedReportScope = null;
  let pendingPostResizeScope = null;
  const captureScope = () => dataContext.captureExperienceScope?.();
  const reportingAllowed = (scope) => syncActive && !transitionPending &&
    !dataContext.getExperienceState?.()?.pending_transition && !awaitingExperienceViewport &&
    (!scope || dataContext.isExperienceScopeCurrent?.(scope) !== false);


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

  const clearNavigationReportTimer = () => {
    if (!navigationReportTimer) return;
    clearTimeout(navigationReportTimer);
    navigationReportTimer = null;
  };

  const clearNavigationIdleHandler = () => {
    if (!navigationIdleHandler || typeof map.off !== "function") return;
    map.off("moveend", navigationIdleHandler);
    navigationIdleHandler = null;
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

  const reportToContext = (onInteractionGuard, options = {}) => {
    const scope = options.experienceScope || captureScope();
    if (!reportingAllowed(scope)) return;
    if (!map || !dataContext || typeof dataContext.updateViewportFromUI !== "function") return;

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
    const viewportPayload = {
      bbox,
      zoom: map.getZoom(),
      corners,
    };
    const result =
      options &&
      (options.sharedUpdate === "immediate" || options.sharedUpdate === "transient" || scope)
        ? dataContext.updateViewportFromUI(viewportPayload, "gis", { ...options, ...(scope ? { experienceScope: scope } : {}) })
        : dataContext.updateViewportFromUI(viewportPayload, "gis");

    if (
      typeof onInteractionGuard === "function" &&
      result &&
      typeof result === "object" &&
      result.accepted === false &&
      result.reason === "interaction_guard"
    ) {
      onInteractionGuard(scope);
    }
  };

  const flushGISReportRetry = () => {
    if (!syncActive) return;
    if (!gisReportBlockedPending) return;
    if (isApplyingRemote) return;
    gisReportBlockedPending = false;
    clearDeferredGuardFlushTimer();
    const scope = blockedReportScope;
    blockedReportScope = null;
    reportToContext(null, {
      ...(navigationTravelActive ? { sharedUpdate: "transient", traceId: activeNavigationTraceId } : {}),
      ...(scope ? { experienceScope: scope } : {}),
    });
  };

  const scheduleGISRetryFlush = () => {
    if (deferredGuardFlushTimer) return;
    const generation = experienceGeneration;
    deferredGuardFlushTimer = setTimeout(() => {
      deferredGuardFlushTimer = null;
      if (generation !== experienceGeneration) return;
      flushGISReportRetry();
    }, 0);
  };

  const onGISReportInteractionGuard = (scope) => {
    if (gisReportBlockedPending) return;
    gisReportBlockedPending = true;
    blockedReportScope = scope;
    if (!isApplyingRemote) {
      scheduleGISRetryFlush();
    }
  };

  const runPostResizeContextReport = (scope) => {
    if (!reportingAllowed(scope)) return;
    if (isApplyingRemote) {
      pendingPostResizeContextReport = true;
      pendingPostResizeScope = scope;
      return;
    }
    suppressNextGisMapChange = true;
    reportToContext(null, scope ? { experienceScope: scope } : {});
  };

  const finishRemoteApplyUnlock = () => {
    clearRemoteApplyLockOnly();
    if (syncActive) {
      flushGISReportRetry();
      if (pendingPostResizeContextReport) {
        pendingPostResizeContextReport = false;
        const scope = pendingPostResizeScope;
        pendingPostResizeScope = null;
        runPostResizeContextReport(scope);
      }
    }
  };

  const startRemoteApplyLock = () => {
    clearRemoteApplyLockOnly();
    isApplyingRemote = true;

    const generation = experienceGeneration;
    const handleUnlockEvent = () => {
      if (generation === experienceGeneration) finishRemoteApplyUnlock();
    };

    remoteUnlockHandlers = [["idle", handleUnlockEvent]];

    for (const [eventName, handler] of remoteUnlockHandlers) {
      map.once(eventName, handler);
    }

    remoteUnlockTimer = setTimeout(() => {
      if (generation === experienceGeneration) finishRemoteApplyUnlock();
    }, 500);
  };

  const reportNavigationTravelViewport = () => {
    if (!navigationTravelActive || navigationReportTimer) return;
    const generation = experienceGeneration;
    const scope = navigationExperienceScope;
    navigationReportTimer = setTimeout(() => {
      navigationReportTimer = null;
      if (!navigationTravelActive || !syncActive || generation !== experienceGeneration) return;
      reportToContext(onGISReportInteractionGuard, {
        sharedUpdate: "transient",
        traceId: activeNavigationTraceId,
        ...(scope ? { experienceScope: scope } : {}),
      });
    }, PLACE_NAVIGATION_REPORT_INTERVAL_MS);
  };

  const finishNavigationTravel = (traceId) => {
    if (!navigationTravelActive) return;
    reportToContext(onGISReportInteractionGuard, {
      sharedUpdate: "immediate",
      traceId,
      ...(navigationExperienceScope ? { experienceScope: navigationExperienceScope } : {}),
    });
    navigationTravelActive = false;
    navigationExperienceScope = null;
    activeNavigationTraceId = null;
    clearNavigationReportTimer();
  };

  const armNavigationTravelEnd = (traceId) => {
    clearNavigationIdleHandler();
    if (!navigationTravelActive || !syncActive) return;
    const generation = experienceGeneration;
    const handler = () => {
      if (navigationIdleHandler !== handler || generation !== experienceGeneration) return;
      clearNavigationIdleHandler();
      finishNavigationTravel(traceId);
    };
    navigationIdleHandler = handler;
    if (typeof map.once === "function") {
      map.once("moveend", navigationIdleHandler);
    }
  };

  const startNavigationTravel = (traceId) => {
    activeNavigationTraceId = traceId || null;
    navigationExperienceScope = captureScope();
    navigationTravelActive = true;
    clearNavigationReportTimer();
    clearNavigationIdleHandler();
  };

  const applyNavigationCommand = (command) => {
    if (!syncActive || transitionPending || awaitingExperienceViewport) return;
    const traceId = command?.traceId || command?.id || null;
    if (!command || command.id === lastNavigationCommandId) {
      return;
    }
    const center = command.cameraHint?.center;
    const zoom = Number(command.cameraHint?.zoom);
    if (!center || !Number.isFinite(center.lng) || !Number.isFinite(center.lat)) {
      return;
    }

    lastNavigationCommandId = command.id;
    startNavigationTravel(traceId);
    const cameraOptions = {
      center,
      zoom: Number.isFinite(zoom) ? zoom : 15,
      animate: command.transition?.animate !== false,
      duration: Number.isFinite(command.transition?.durationMs)
        ? command.transition.durationMs
        : 1600,
    };
    if (typeof map.flyTo === "function") {
      map.flyTo(cameraOptions);
    } else {
      map.jumpTo?.({ center, zoom: cameraOptions.zoom });
    }
    armNavigationTravelEnd(traceId);
  };

  const applyAcceptedViewport = (viewport, options = {}) => {
    void options;
    const seq = viewport && viewport.seq;
    const handled = applyViewportToMap(map, viewport, startRemoteApplyLock);
    if (handled) awaitingExperienceViewport = false;
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
    const generation = experienceGeneration;
    const scope = captureScope();
    const onIdle = () => {
      if (generation !== experienceGeneration || postResizeIdleHandler !== onIdle) return;
      postResizeIdleHandler = null;
      postResizeGisSyncPending = false;
      runPostResizeContextReport(scope);
    };
    postResizeIdleHandler = onIdle;
    if (typeof map.once === "function") {
      map.once("idle", onIdle);
    } else {
      requestAnimationFrame(onIdle);
    }
    if (typeof map.resize === "function") {
      map.resize();
    }
  };

  const markResizeActivity = (origin) => {
    void origin;
    if (!syncActive || transitionPending || awaitingExperienceViewport) return;
    if (!isResizeActive) {
      isResizeActive = true;
    }

    clearResizeSettleTimer();
    const generation = experienceGeneration;
    resizeSettleTimer = setTimeout(() => {
      resizeSettleTimer = null;
      if (!syncActive || generation !== experienceGeneration) return;
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

  const cancelExperienceCameraWork = () => {
    experienceGeneration += 1;
    awaitingExperienceViewport = true;
    clearNavigationReportTimer();
    clearNavigationIdleHandler();
    clearResizeSettleTimer();
    clearPostResizeIdleRegistration();
    clearDeferredGuardFlushTimer();
    clearRemoteApplyLockOnly();
    if (pendingReportTimer) clearTimeout(pendingReportTimer);
    pendingReportTimer = null;
    navigationTravelActive = false;
    activeNavigationTraceId = null;
    navigationExperienceScope = null;
    lastNavigationCommandId = null;
    lastAppliedViewportSeq = -1;
    gisReportBlockedPending = false;
    blockedReportScope = null;
    pendingPostResizeContextReport = false;
    pendingPostResizeScope = null;
    postResizeGisSyncPending = false;
    suppressNextGisMapChange = false;
    isResizeActive = false;
    resetResizeQueue();
    // stop() emits moveend synchronously. Reporting is already suppressed above.
    map.stop?.();
  };
  const unsubscribeExperience = dataContext.subscribe("experienceState", (next) => {
    if (!next) return;
    const changedActivation = experienceState && (
      next.revision !== experienceState.revision || next.active_experience !== experienceState.active_experience
    );
    const preparing = next.pending_transition && !experienceState?.pending_transition;
    experienceState = next;
    transitionPending = !!next.pending_transition;
    if (changedActivation || preparing) cancelExperienceCameraWork();
    if (!transitionPending && awaitingExperienceViewport) {
      const generation = experienceGeneration;
      // An abort or same-camera activation may deduplicate the viewport topic.
      // Reconcile after the complete authoritative snapshot has been adopted.
      const reconcile = () => {
        if (!syncActive || generation !== experienceGeneration || transitionPending || !awaitingExperienceViewport) return;
        applyAcceptedViewport(dataContext.getViewport?.());
      };
      if (typeof queueMicrotask === "function") queueMicrotask(reconcile);
      else Promise.resolve().then(reconcile);
    }
  });

  const unsubscribeViewport = dataContext.subscribe("viewport", (viewport) => {
    if (!syncActive || transitionPending) return;
    if (navigationTravelActive) {
      const seq = viewport && viewport.seq;
      if (Number.isFinite(seq) && seq > lastAppliedViewportSeq) {
        lastAppliedViewportSeq = seq;
      }
      return;
    }

    if (!evaluateViewportSeqAcceptance(viewport)) {
      return;
    }

    if (isResizeActive) {
      queueViewportDuringResize(viewport);
      return;
    }

    applyAcceptedViewport(viewport);
  });
  const unsubscribeNavigationCommand = dataContext.subscribe(
    "navigationCommand",
    applyNavigationCommand,
  );

  const handleMapChange = () => {
    if (!reportingAllowed()) return;
    if (suppressNextGisMapChange) {
      suppressNextGisMapChange = false;
      return;
    }
    if (postResizeGisSyncPending) {
      return;
    }
    if (pendingReportTimer) return;
    const scope = captureScope();
    const generation = experienceGeneration;
    pendingReportTimer = setTimeout(() => {
      pendingReportTimer = null;
      if (!syncActive || generation !== experienceGeneration) return;
      if (isApplyingRemote) return;
      if (isResizeActive) {
        return;
      }
      reportToContext(onGISReportInteractionGuard, scope ? { experienceScope: scope } : {});
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
  map.on("move", reportNavigationTravelViewport);
  map.on("zoomend", handleMapChange);

  const dispose = () => {
    syncActive = false;
    clearPostResizeIdleRegistration();
    if (typeof unsubscribeExperience === "function") unsubscribeExperience();
    if (typeof unsubscribeViewport === "function") unsubscribeViewport();
    if (typeof unsubscribeNavigationCommand === "function") unsubscribeNavigationCommand();
    map.off("move", reportNavigationTravelViewport);
    map.off("moveend", handleMapChange);
    map.off("zoomend", handleMapChange);
    if (pendingReportTimer) {
      clearTimeout(pendingReportTimer);
      pendingReportTimer = null;
    }
    clearDeferredGuardFlushTimer();
    clearResizeSettleTimer();
    clearNavigationIdleHandler();
    clearNavigationReportTimer();
    resetResizeQueue();
    gisReportBlockedPending = false;
    navigationTravelActive = false;
    activeNavigationTraceId = null;
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
  dispose.beginCameraTravel = (traceId = "person-fly") => {
    if (!syncActive || transitionPending || awaitingExperienceViewport) return;
    startNavigationTravel(traceId);
    const generation = experienceGeneration;
    const scope = navigationExperienceScope;
    const arm = () => {
      if (!syncActive || !navigationTravelActive || generation !== experienceGeneration || scope !== navigationExperienceScope) return;
      armNavigationTravelEnd(traceId);
    };
    if (typeof queueMicrotask === "function") {
      queueMicrotask(arm);
    } else {
      arm();
    }
  };
  return dispose;
}

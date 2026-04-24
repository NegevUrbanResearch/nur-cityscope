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
  if (!map || !viewport || !viewport.bbox) return;
  const wgs84Bbox = itmBboxToWgs84(viewport.bbox);
  if (!wgs84Bbox) return;

  const [west, south, east, north] = wgs84Bbox;
  const currentBounds = map.getBounds();
  const currentZoom = map.getZoom();
  const hasExplicitZoom = Number.isFinite(viewport.zoom);
  const targetZoom = hasExplicitZoom ? viewport.zoom : currentZoom;
  const boundsChanged = !(
    currentBounds &&
    Math.abs(currentBounds.getWest() - west) < 0.0001 &&
    Math.abs(currentBounds.getSouth() - south) < 0.0001 &&
    Math.abs(currentBounds.getEast() - east) < 0.0001 &&
    Math.abs(currentBounds.getNorth() - north) < 0.0001
  );
  const zoomChanged = Math.abs(currentZoom - targetZoom) >= 0.1;

  if (!boundsChanged && !zoomChanged) {
    return;
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
}

function reportViewportToContext(map, dataContext) {
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

  dataContext.updateViewportFromUI(
    {
      bbox,
      zoom: map.getZoom(),
      corners,
    },
    "gis"
  );
}

export function setupViewportSync(map, dataContext) {
  if (!map || !dataContext || typeof dataContext.subscribe !== "function") {
    return () => {};
  }

  let isApplyingRemote = false;
  let remoteUnlockTimer = null;
  let pendingReportTimer = null;
  let remoteUnlockHandlers = [];

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

  const releaseRemoteApplyLock = () => {
    clearRemoteUnlockTimer();
    clearRemoteUnlockHandlers();
    isApplyingRemote = false;
  };

  const startRemoteApplyLock = () => {
    releaseRemoteApplyLock();
    isApplyingRemote = true;

    const handleUnlockEvent = () => {
      releaseRemoteApplyLock();
    };

    remoteUnlockHandlers = [["idle", handleUnlockEvent]];

    for (const [eventName, handler] of remoteUnlockHandlers) {
      map.once(eventName, handler);
    }

    remoteUnlockTimer = setTimeout(() => {
      releaseRemoteApplyLock();
    }, 500);
  };

  const unsubscribeViewport = dataContext.subscribe("viewport", (viewport) => {
    applyViewportToMap(map, viewport, startRemoteApplyLock);
  });

  const handleMapChange = () => {
    if (pendingReportTimer) return;
    pendingReportTimer = setTimeout(() => {
      pendingReportTimer = null;
      if (isApplyingRemote) return;
      reportViewportToContext(map, dataContext);
    }, 0);
  };

  map.on("moveend", handleMapChange);
  map.on("zoomend", handleMapChange);

  return () => {
    if (typeof unsubscribeViewport === "function") unsubscribeViewport();
    map.off("moveend", handleMapChange);
    map.off("zoomend", handleMapChange);
    if (pendingReportTimer) {
      clearTimeout(pendingReportTimer);
      pendingReportTimer = null;
    }
    releaseRemoteApplyLock();
  };
}

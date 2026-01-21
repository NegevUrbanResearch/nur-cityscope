/**
 * Viewport synchronization helpers for the Leaflet GIS map.
 * These functions rely on the global `map`, `proj4`, `isApplyingRemoteState`
 * and `OTEFDataContext` objects defined elsewhere.
 */

/**
 * Apply viewport state from API (pan map to match server state)
 */
function applyViewportFromAPI(viewport) {
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
    Math.abs(currentCenter.lat - centerLat) + Math.abs(currentCenter.lng - centerLng);
  const zoomDiff = Math.abs(currentZoom - zoom);

  // Only update if significantly different (threshold to avoid echo)
  // Increased thresholds to reduce unnecessary updates, but still animate for smoothness
  if (centerDiff > 0.0005 || zoomDiff > 0.5) {
    console.log(
      `[GIS Map] Applying viewport: center=${centerLat.toFixed(4)},${centerLng.toFixed(
        4
      )} zoom=${zoom}`
    );

    // Set flag to prevent feedback loop (don't broadcast this change back)
    isApplyingRemoteState = true;
    map.setView([centerLat, centerLng], zoom, { animate: true, duration: 0.25 });

    // Clear flag after animation completes (~250ms)
    setTimeout(() => {
      isApplyingRemoteState = false;
    }, 300);
  }
}

/**
 * Send viewport update via OTEFDataContext (GIS -> Write: viewport)
 * Applies hard-wall bounds and debounces API writes inside DataContext/API client.
 */
function sendViewportUpdate() {
  if (isApplyingRemoteState) return;
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
  const accepted = OTEFDataContext.updateViewportFromUI(viewportState, "gis");

  // If the update was rejected by bounds, snap back to the last accepted viewport
  // so the GIS map cannot visually move/zoom beyond the hard-wall polygon.
  if (accepted === false) {
    const latestViewport = OTEFDataContext.getViewport();
    if (latestViewport) {
      applyViewportFromAPI(latestViewport);
    }
  }
}

// Attach listeners to map movement and zoom
map.on("moveend", sendViewportUpdate);
map.on("zoomend", sendViewportUpdate); // Ensure zoom changes are synced


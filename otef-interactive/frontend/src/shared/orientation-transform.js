// Orientation transform helpers
// Maps viewer-frame vectors into ITM-frame vectors using a simple 2D rotation.

function rotateViewerVectorToItm(vec, angleDeg) {
  if (!vec || typeof vec.dx !== "number" || typeof vec.dy !== "number") {
    return { dx: 0, dy: 0 };
  }
  if (typeof angleDeg !== "number" || !Number.isFinite(angleDeg)) {
    return { dx: vec.dx, dy: vec.dy };
  }

  const theta = (angleDeg * Math.PI) / 180;
  const c = Math.cos(theta);
  const s = Math.sin(theta);

  return {
    dx: vec.dx * c - vec.dy * s,
    dy: vec.dx * s + vec.dy * c,
  };
}

if (typeof window !== "undefined") {
  window.OrientationTransform = { rotateViewerVectorToItm };
}

export { rotateViewerVectorToItm };


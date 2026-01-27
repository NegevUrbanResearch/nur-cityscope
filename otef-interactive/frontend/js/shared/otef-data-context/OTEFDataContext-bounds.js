// OTEFDataContext bounds helpers
// Bounds persistence and checks

(function () {
  const internals = window.OTEFDataContextInternals || {};
  const getLogger = internals.getLogger || function () {
    return {
      debug: () => {},
      info: () => {},
      warn: console.warn.bind(console),
      error: console.error.bind(console),
    };
  };

  async function saveBounds(ctx, polygon) {
    if (!Array.isArray(polygon) || polygon.length < 3) {
      getLogger().warn("[OTEFDataContext] saveBounds called with invalid polygon");
      return { ok: false, error: "Invalid polygon" };
    }

    const previous = ctx._bounds;
    ctx._setBounds(polygon);

    try {
      const result = await OTEF_API.saveBounds(ctx._tableName, polygon);
      // Backend is source of truth; if it returns a normalized polygon, adopt it
      if (result && (result.bounds_polygon || result.polygon)) {
        ctx._setBounds(result.bounds_polygon || result.polygon);
      }
      return { ok: true, result };
    } catch (err) {
      getLogger().error("[OTEFDataContext] Failed to save bounds:", err);
      // Revert on failure
      ctx._setBounds(previous || null);
      return { ok: false, error: err };
    }
  }

  /**
   * Check whether a viewport is inside the current bounds polygon.
   *
   * Updated semantics (UX-driven):
   * - We only require the viewport center to be inside the bounds polygon.
   * - The highlight edges are allowed to extend beyond the polygon.
   *
   * If no bounds are defined, always returns true.
   *
   * @param {Object} viewport - { bbox: [minX,minY,maxX,maxY], corners? }
   * @returns {boolean}
   */
  function isViewportInsideBounds(ctx, viewport) {
    const polygon = ctx._bounds;
    if (!Array.isArray(polygon) || polygon.length < 3) {
      // No bounds defined – allow all movement
      return true;
    }

    const bbox = viewport && viewport.bbox;
    if (!bbox || bbox.length !== 4) return true;

    const [minX, minY, maxX, maxY] = bbox;

    // Use viewport center as the "travel position" that must stay inside bounds
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    return pointInPolygon({ x: centerX, y: centerY }, polygon);
  }

  /**
   * Standard ray-casting point-in-polygon test.
   * Treats points on the edge as inside.
   *
   * @param {{x:number,y:number}} point
   * @param {Array<{x:number,y:number}>} polygon
   * @returns {boolean}
   */
  function pointInPolygon(point, polygon) {
    const { x, y } = point;
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x;
      const yi = polygon[i].y;
      const xj = polygon[j].x;
      const yj = polygon[j].y;

      // Check if point is exactly on an edge (within a tiny epsilon)
      const onEdge =
        ((yi > y) !== (yj > y)) === false &&
        Math.abs((xj - xi) * (y - yi) - (yj - yi) * (x - xi)) < 1e-9 &&
        x >= Math.min(xi, xj) &&
        x <= Math.max(xi, xj) &&
        y >= Math.min(yi, yj) &&
        y <= Math.max(yi, yj);

      if (onEdge) {
        return true;
      }

      const intersect =
        yi > y !== yj > y &&
        x <
          ((xj - xi) * (y - yi)) / (yj - yi + (yj === yi ? 1e-12 : 0)) +
            xi;

      if (intersect) {
        inside = !inside;
      }
    }

    return inside;
  }

  internals.bounds = {
    saveBounds,
    isViewportInsideBounds,
    pointInPolygon,
  };
})();

/**
 * Style Applicator
 *
 * Converts processed styles.json format to Leaflet/Canvas styles.
 * Handles both simple and uniqueValue renderers for attribute-based styling.
 *
 * Responsibilities:
 * - Convert styles.json format to Leaflet style functions
 * - Handle uniqueValue renderers (attribute-based styling)
 * - Support point markers (circle markers with fill/stroke)
 */

class StyleApplicator {
  // Conversion factor from Points (ArcGIS) to CSS Pixels (Web)
  // 1pt = 1/72 inch, 1px = 1/96 inch -> 96/72 = 1.333
  static PT_TO_PX = 96 / 72;

  /**
   * Get Leaflet style function for a layer.
   * @param {Object} layerConfig - Layer config from registry (includes style)
   * @returns {Function} Leaflet style function: (feature) => { fillColor, fillOpacity, color, weight, ... }
   */
  static getLeafletStyle(layerConfig) {
    if (!layerConfig || !layerConfig.style) {
      return this._defaultStyle;
    }

    const style = layerConfig.style;
    const renderer = style.renderer || "simple";

    if (renderer === "uniqueValue") {
      return this._getUniqueValueStyle(style, layerConfig);
    } else if (renderer === "landUse") {
      return this._getLandUseStyle(style);
    } else {
      return this._getSimpleStyle(style);
    }
  }

  /**
   * Get land-use based style function (config-based only).
   * Handles both GeoJSON features (properties) and PMTiles features (props).
   */
  static _getLandUseStyle(style) {
    const defaultStyle = style.defaultStyle || {};

    return () => ({
      fillColor: defaultStyle.fillColor || "#E0E0E0",
      fillOpacity:
        defaultStyle.fillOpacity !== undefined ? defaultStyle.fillOpacity : 0.7,
      color: defaultStyle.strokeColor || "#333333",
      weight: (defaultStyle.strokeWidth || 0.5) * this.PT_TO_PX,
      opacity:
        defaultStyle.strokeOpacity !== undefined
          ? defaultStyle.strokeOpacity
          : 1.0,
      dashArray: defaultStyle.dashArray || null,
      hatch: defaultStyle.hatch || null,
    });
  }

  /**
   * Get simple style function (single style for all features).
   */
  static _getSimpleStyle(style) {
    const defaultStyle = style.defaultStyle || {};

    return (feature) => {
      const result = {
        fillColor: defaultStyle.fillColor || "#808080",
        fillOpacity:
          defaultStyle.fillOpacity !== undefined
            ? defaultStyle.fillOpacity
            : 0.7,
        color: defaultStyle.strokeColor || "#000000",
        weight: (defaultStyle.strokeWidth || 1.0) * this.PT_TO_PX,
        opacity:
          defaultStyle.strokeOpacity !== undefined
            ? defaultStyle.strokeOpacity
            : 1.0,
        dashArray: defaultStyle.dashArray || null,
        hatch: defaultStyle.hatch || null,
      };

      return result;
    };
  }

  /**
   * Get unique value style function (attribute-based styling).
   */
  static _getUniqueValueStyle(style, layerConfig) {
    const uniqueValues = style.uniqueValues || {};
    const field = uniqueValues.field;
    const classes = uniqueValues.classes || [];
    const defaultStyle = style.defaultStyle || {};

    // Build lookup map for faster access
    const styleMap = new Map();
    for (const cls of classes) {
      styleMap.set(String(cls.value), cls.style);
    }

    // Helper: clamp marker radius for specific layers
    const clampRadiusIfNeeded = (radiusPx) => {
      if (!layerConfig || !layerConfig.id) return radiusPx;
      const id = layerConfig.id;
      const isHeritageLayer =
        id === "מורשת-קיים" ||
        id === "מורשת-מוצע" ||
        id === "מורשת_קיים" ||
        id === "מורשת_מוצע";
      if (!isHeritageLayer) return radiusPx;
      // Cap heritage markers to a modest on-screen size (in CSS pixels)
      const MAX_HERITAGE_RADIUS_PX = 6;
      return Math.min(radiusPx, MAX_HERITAGE_RADIUS_PX);
    };

    return (feature) => {
      // Get field value from feature properties
      // Handle both GeoJSON (properties) and PMTiles (props) features
      const props = feature.properties || feature.props || feature || {};

      // Try exact match first, then case-insensitive
      let val = props[field];
      if (val === undefined) {
        const lowerField = field.toLowerCase();
        const key = Object.keys(props).find(
          (k) => k.toLowerCase() === lowerField,
        );
        if (key) val = props[key];
      }

      const fieldValue = String(val !== undefined && val !== null ? val : "");

      // Look up style for this value
      const valueStyle = styleMap.get(fieldValue);

      if (valueStyle) {
        const weightPx =
          (valueStyle.strokeWidth !== undefined
            ? valueStyle.strokeWidth
            : defaultStyle.strokeWidth !== undefined
              ? defaultStyle.strokeWidth
              : 1.0) * this.PT_TO_PX;

        const rawRadiusPx =
          (valueStyle.radius || defaultStyle.radius || 5) * this.PT_TO_PX;
        const radiusPx = clampRadiusIfNeeded(rawRadiusPx);

        return {
          fillColor:
            valueStyle.fillColor || defaultStyle.fillColor || "#808080",
          fillOpacity:
            valueStyle.fillOpacity !== undefined
              ? valueStyle.fillOpacity
              : defaultStyle.fillOpacity !== undefined
                ? defaultStyle.fillOpacity
                : 0.7,
          color:
            valueStyle.strokeColor || defaultStyle.strokeColor || "#000000",
          weight: weightPx,
          opacity:
            valueStyle.strokeOpacity !== undefined
              ? valueStyle.strokeOpacity
              : defaultStyle.strokeOpacity !== undefined
                ? defaultStyle.strokeOpacity
                : 1.0,
          dashArray: valueStyle.dashArray || defaultStyle.dashArray || null,
          hatch: valueStyle.hatch || defaultStyle.hatch || null,
          radius: radiusPx,
        };
      }

      // Fallback to default style
      const fallbackRadiusPx = clampRadiusIfNeeded(
        (defaultStyle.radius || 5) * this.PT_TO_PX,
      );

      return {
        fillColor: defaultStyle.fillColor || "#808080",
        fillOpacity:
          defaultStyle.fillOpacity !== undefined
            ? defaultStyle.fillOpacity
            : 0.7,
        color: defaultStyle.strokeColor || "#000000",
        weight: (defaultStyle.strokeWidth || 1.0) * this.PT_TO_PX,
        opacity:
          defaultStyle.strokeOpacity !== undefined
            ? defaultStyle.strokeOpacity
            : 1.0,
        dashArray: defaultStyle.dashArray || null,
        hatch: defaultStyle.hatch || null,
        radius: fallbackRadiusPx,
      };
    };
  }

  /**
   * Get Canvas style for projection rendering.
   * Returns the same style object format as getLeafletStyle for consistency.
   * CanvasLayerRenderer expects: { fillColor, color, fillOpacity, opacity, weight }
   *
   * @param {Object} layerConfig - Layer config from registry
   * @returns {Function} Style function: (feature) => { fillColor, color, fillOpacity, opacity, weight }
   */
  static getCanvasStyle(layerConfig) {
    // Canvas renderer uses the same style object format as Leaflet
    // This ensures consistency and simplifies the codebase
    return this.getLeafletStyle(layerConfig);
  }

  /**
   * Get point marker options for Leaflet.
   * @param {Object} layerConfig - Layer config from registry
   * @returns {Object} Leaflet circle marker options
   */
  static getPointMarkerOptions(layerConfig) {
    if (!layerConfig || !layerConfig.style) {
      return {
        radius: 5,
        fillColor: "#808080",
        fillOpacity: 0.7,
        color: "#000000",
        weight: 1.0,
      };
    }

    const style = layerConfig.style;
    const defaultStyle = style.defaultStyle || {};

    return {
      radius: (defaultStyle.radius || 5) * this.PT_TO_PX,
      fillColor: defaultStyle.fillColor || "#808080",
      fillOpacity:
        defaultStyle.fillOpacity !== undefined ? defaultStyle.fillOpacity : 0.7,
      color: defaultStyle.strokeColor || "#000000",
      weight: (defaultStyle.strokeWidth || 1.0) * this.PT_TO_PX,
      opacity:
        defaultStyle.strokeOpacity !== undefined
          ? defaultStyle.strokeOpacity
          : 1.0,
    };
  }

  /**
   * Default style function.
   * Used by both Leaflet and Canvas renderers.
   */
  static _defaultStyle(feature) {
    return {
      fillColor: "#808080",
      fillOpacity: 0.7,
      color: "#000000",
      weight: 1.0,
      opacity: 1.0,
    };
  }
}

// Export for use in other modules
if (typeof module !== "undefined" && module.exports) {
  module.exports = StyleApplicator;
}

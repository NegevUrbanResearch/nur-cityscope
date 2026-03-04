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

  /** Convert symbol IR to Leaflet/canvas style bag (new contract). */
  static _symbolIRToStyleBag(symbol) {
    const result = {
      fillColor: "#808080",
      fillOpacity: 0.7,
      color: "#000000",
      weight: 1.0,
      opacity: 1.0,
      dashArray: null,
      hatch: null,
      radius: 5,
    };
    if (!symbol?.symbolLayers?.length) return result;
    const hasMarkerPoint = symbol.symbolLayers.some(
      (layer) => layer && layer.type === "markerPoint",
    );
    let markerHasVisibleFill = false;
    for (const layer of symbol.symbolLayers) {
      if (!layer?.type) continue;
      if (layer.type === "fill") {
        const nextColor = layer.color || result.fillColor;
        const nextOpacity =
          layer.opacity !== undefined ? layer.opacity : result.fillOpacity;
        if (hasMarkerPoint) {
          const isVisibleFill =
            typeof nextOpacity === "number" ? nextOpacity > 0 : true;
          if (isVisibleFill) {
            result.fillColor = nextColor;
            result.fillOpacity = nextOpacity;
            markerHasVisibleFill = true;
          } else if (!markerHasVisibleFill) {
            result.fillColor = nextColor;
            result.fillOpacity = nextOpacity;
          }
        } else {
          result.fillColor = nextColor;
          result.fillOpacity = nextOpacity;
        }
        if (layer.hatch) result.hatch = layer.hatch;
      }
      if (layer.type === "stroke") {
        result.color = layer.color || result.color;
        result.weight = layer.width !== undefined ? layer.width : result.weight;
        result.opacity = layer.opacity !== undefined ? layer.opacity : result.opacity;
        if (layer.dash?.array) result.dashArray = layer.dash.array;
      }
      if (layer.type === "markerPoint" && layer.marker) {
        const size = layer.marker.size;
        result.radius = typeof size === "number" ? size / 2 : Array.isArray(size) && size[0] ? size[0] / 2 : 5;
      }
    }
    return result;
  }

  static _resolveWeightPx(bag, fallback = 1.0) {
    if (bag && bag.weight !== undefined) return bag.weight;
    if (bag && bag.strokeWidth !== undefined) {
      return bag.strokeWidth * this.PT_TO_PX;
    }
    return fallback;
  }

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
    const bag = style.defaultSymbol
      ? this._symbolIRToStyleBag(style.defaultSymbol)
      : (style.defaultStyle || {});

    return () => ({
      fillColor: bag.fillColor || "#E0E0E0",
      fillOpacity: bag.fillOpacity !== undefined ? bag.fillOpacity : 0.7,
      color: bag.color || bag.strokeColor || "#333333",
      weight: this._resolveWeightPx(bag, 0.5),
      opacity: bag.opacity !== undefined ? bag.opacity : 1.0,
      dashArray: bag.dashArray || null,
      hatch: bag.hatch || null,
    });
  }

  /**
   * Get simple style function (single style for all features).
   */
  static _getSimpleStyle(style) {
    const bag = style.defaultSymbol
      ? this._symbolIRToStyleBag(style.defaultSymbol)
      : (style.defaultStyle || {});

    return () => ({
      fillColor: bag.fillColor || "#808080",
      fillOpacity: bag.fillOpacity !== undefined ? bag.fillOpacity : 0.7,
      color: bag.color || bag.strokeColor || "#000000",
      weight: this._resolveWeightPx(bag, 1.0),
      opacity:
        bag.opacity !== undefined
          ? bag.opacity
          : bag.strokeOpacity !== undefined
            ? bag.strokeOpacity
            : 1.0,
      dashArray: bag.dashArray || null,
      hatch: bag.hatch || null,
    });
  }

  /**
   * Get unique value style function (attribute-based styling).
   */
  static _getUniqueValueStyle(style, layerConfig) {
    const uniqueValues = style.uniqueValues || {};
    const field = uniqueValues.field;
    const classes = uniqueValues.classes || [];
    const defaultBag = style.defaultSymbol
      ? this._symbolIRToStyleBag(style.defaultSymbol)
      : (style.defaultStyle || {});

    const styleMap = new Map();
    for (const cls of classes) {
      const bag = cls.symbol
        ? this._symbolIRToStyleBag(cls.symbol)
        : (cls.style || {});
      styleMap.set(String(cls.value), bag);
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
          valueStyle.weight !== undefined
            ? valueStyle.weight
            : valueStyle.strokeWidth !== undefined
              ? valueStyle.strokeWidth * this.PT_TO_PX
              : this._resolveWeightPx(defaultBag, 1.0);

        const rawRadiusPx = valueStyle.radius ?? defaultBag.radius ?? 5;
        const radiusPx = clampRadiusIfNeeded(rawRadiusPx);

        return {
          fillColor: valueStyle.fillColor ?? defaultBag.fillColor ?? "#808080",
          fillOpacity: valueStyle.fillOpacity ?? defaultBag.fillOpacity ?? 0.7,
          color: valueStyle.color ?? valueStyle.strokeColor ?? defaultBag.color ?? defaultBag.strokeColor ?? "#000000",
          weight: weightPx,
          opacity: valueStyle.opacity ?? valueStyle.strokeOpacity ?? defaultBag.opacity ?? defaultBag.strokeOpacity ?? 1.0,
          dashArray: valueStyle.dashArray ?? defaultBag.dashArray ?? null,
          hatch: valueStyle.hatch ?? defaultBag.hatch ?? null,
          radius: radiusPx,
        };
      }

      const fallbackRadiusPx = clampRadiusIfNeeded(defaultBag.radius ?? 5);

      return {
        fillColor: defaultBag.fillColor ?? "#808080",
        fillOpacity: defaultBag.fillOpacity ?? 0.7,
        color: defaultBag.color ?? defaultBag.strokeColor ?? "#000000",
        weight: this._resolveWeightPx(defaultBag, 1.0),
        opacity: defaultBag.opacity ?? defaultBag.strokeOpacity ?? 1.0,
        dashArray: defaultBag.dashArray ?? null,
        hatch: defaultBag.hatch ?? null,
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
    const bag = style.defaultSymbol
      ? this._symbolIRToStyleBag(style.defaultSymbol)
      : (style.defaultStyle || {});

    return {
      radius: bag.radius ?? 5,
      fillColor: bag.fillColor ?? "#808080",
      fillOpacity: bag.fillOpacity !== undefined ? bag.fillOpacity : 0.7,
      color: bag.color ?? bag.strokeColor ?? "#000000",
      weight: bag.weight ?? bag.strokeWidth ?? 1.0,
      opacity: bag.opacity !== undefined ? bag.opacity : 1.0,
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

if (typeof window !== "undefined") {
  window.StyleApplicator = StyleApplicator;
}

export default StyleApplicator;

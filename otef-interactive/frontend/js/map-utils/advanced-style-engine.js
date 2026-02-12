/**
 * AdvancedStyleEngine
 *
 * Resolver-agnostic. Resolves (feature, styleConfig, renderer) to symbol IR;
 * emits drawing commands from geometry + symbol. No canvas or tile awareness.
 *
 * Converts features (geometry + properties) and style IR into abstract drawing
 * commands: drawPolygon, drawLine, drawMarker, drawMarkerLine.
 */

class AdvancedStyleEngine {
  /** @type {WeakMap<Object, Map<string, Object>>} */
  static _uniqueValueSymbolMapCache = new WeakMap();

  static _getUniqueValueSymbolMap(styleConfig) {
    if (AdvancedStyleEngine._uniqueValueSymbolMapCache.has(styleConfig)) {
      return AdvancedStyleEngine._uniqueValueSymbolMapCache.get(styleConfig);
    }
    const classes = styleConfig.uniqueValues?.classes || [];
    const map = new Map();
    for (const c of classes) {
      const key = String(
        c.value !== undefined && c.value !== null ? c.value : "",
      );
      let symbol = null;
      if (c.advancedSymbol && c.advancedSymbol.symbolLayers) {
        symbol = c.advancedSymbol;
      } else if (c.style) {
        symbol = this._symbolFromSimpleStyle(c.style);
      }
      if (symbol) map.set(key, symbol);
    }
    AdvancedStyleEngine._uniqueValueSymbolMapCache.set(styleConfig, map);
    return map;
  }
  /**
   * Compute drawing commands for a set of features.
   *
   * @param {Object[]} features - GeoJSON-like features { geometry, properties }
   * @param {Object} styleConfig - Layer style from styles.json (includes renderer, defaultStyle, uniqueValues, advancedSymbol, etc.)
   * @param {Object} viewContext - { scale, pixelRatio, ... } (currently unused, reserved for future refinement)
   * @returns {Object[]} commands - array of drawing commands
   */
  static computeCommands(features, styleConfig, viewContext = {}) {
    if (!features || !Array.isArray(features) || !styleConfig) {
      return [];
    }

    const renderer = styleConfig.renderer || "simple";
    const commands = [];

    for (const feature of features) {
      const geom = feature && feature.geometry;
      if (!geom || !geom.type || !geom.coordinates) continue;

      const styleSymbol = this._resolveStyleSymbol(
        feature,
        styleConfig,
        renderer,
      );
      if (!styleSymbol) continue;

      this._emitCommandsForGeometry(commands, geom, styleSymbol);
    }

    return commands;
  }

  /**
   * Resolve the style symbol (IR) for a feature given the renderer type.
   * For now we prefer advancedSymbol when present, and fall back to simple defaultStyle.
   */
  static _resolveStyleSymbol(feature, styleConfig, renderer) {
    // Unique value renderer: O(1) lookup via pre-built Map from class value to symbol IR
    if (renderer === "uniqueValue" && styleConfig.uniqueValues) {
      const field = styleConfig.uniqueValues.field;
      const props = (feature && (feature.properties || feature.props)) || {};

      let val = props[field];
      if (val === undefined && field) {
        const lowerField = field.toLowerCase();
        const key = Object.keys(props).find(
          (k) => k.toLowerCase() === lowerField,
        );
        if (key) val = props[key];
      }

      const fieldValue = String(val !== undefined && val !== null ? val : "");
      const symbolMap = this._getUniqueValueSymbolMap(styleConfig);
      const symbol = symbolMap.get(fieldValue);
      if (symbol) return symbol;
      // Fallback to layer default below
    }

    // Simple renderer: use layer-level advancedSymbol when available
    if (styleConfig.advancedSymbol && styleConfig.advancedSymbol.symbolLayers) {
      return styleConfig.advancedSymbol;
    }

    // Fallback to simple default style
    if (styleConfig.defaultStyle) {
      return this._symbolFromSimpleStyle(styleConfig.defaultStyle);
    }

    return null;
  }

  /**
   * Build a minimal symbol IR from a simple style dict.
   * This lets the engine work even if advancedSymbol is not present.
   */
  static _symbolFromSimpleStyle(simpleStyle) {
    const layers = [];

    if (simpleStyle.fillColor) {
      layers.push({
        type: "fill",
        fillType: simpleStyle.hatch ? "hatch" : "solid",
        color: simpleStyle.fillColor,
        opacity:
          simpleStyle.fillOpacity !== undefined ? simpleStyle.fillOpacity : 1.0,
        hatch: simpleStyle.hatch || null,
      });
    }

    if (simpleStyle.strokeColor || simpleStyle.strokeWidth) {
      layers.push({
        type: "stroke",
        color: simpleStyle.strokeColor || "#000000",
        width: simpleStyle.strokeWidth || 1.0,
        opacity:
          simpleStyle.strokeOpacity !== undefined
            ? simpleStyle.strokeOpacity
            : 1.0,
        dash: simpleStyle.dashArray
          ? { array: simpleStyle.dashArray.slice() }
          : null,
      });
    }

    return { symbolLayers: layers };
  }

  /**
   * Convert a feature geometry + symbolLayers IR into drawing commands.
   */
  static _emitCommandsForGeometry(commands, geometry, symbol) {
    const type = geometry.type;
    const coords = geometry.coordinates;

    if (
      !symbol ||
      !symbol.symbolLayers ||
      !Array.isArray(symbol.symbolLayers)
    ) {
      return;
    }

    const hasMarkerLine = symbol.symbolLayers.some(
      (l) => l && l.type === "markerLine",
    );

    if (type === "Polygon" || type === "MultiPolygon") {
      commands.push({
        type: "drawPolygon",
        geometry,
        symbol,
      });
    } else if (type === "LineString" || type === "MultiLineString") {
      commands.push({
        type: "drawLine",
        geometry,
        symbol,
      });
      if (hasMarkerLine) {
        for (const layer of symbol.symbolLayers) {
          if (layer.type !== "markerLine") continue;
          commands.push({
            type: "drawMarkerLine",
            geometry,
            symbol: { symbolLayers: [layer] },
          });
        }
      }
    } else if (type === "Point" || type === "MultiPoint") {
      commands.push({
        type: "drawMarker",
        geometry,
        symbol,
      });
    }
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = AdvancedStyleEngine;
}

// Expose globally for browser consumers (projection, map)
if (typeof window !== "undefined") {
  window.AdvancedStyleEngine = AdvancedStyleEngine;
}

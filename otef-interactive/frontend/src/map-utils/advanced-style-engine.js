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
      const symbol =
        c.symbol || (c.style ? this._symbolFromSimpleStyle(c.style) : null);
      if (symbol) map.set(key, symbol);
    }
    AdvancedStyleEngine._uniqueValueSymbolMapCache.set(styleConfig, map);
    return map;
  }
  /**
   * Compute drawing commands for a set of features.
   *
   * @param {Object[]} features - GeoJSON-like features { geometry, properties }
   * @param {Object} styleConfig - Layer style from styles.json (renderer, defaultSymbol, uniqueValues with symbol)
   * @param {Object} viewContext - { scale, pixelRatio, ... } (currently unused, reserved for future refinement)
   * @param {Function} [styleFunction] - Optional per-feature simple style function
   *   (feature) => { fillColor, strokeColor, ..., _iconUrl?, _iconSize? }
   * @returns {Object[]} commands - array of drawing commands
   */
  static computeCommands(features, styleConfig, viewContext = {}, styleFunction) {
    if (!features || !Array.isArray(features) || !styleConfig) {
      return [];
    }

    const renderer = styleConfig.renderer || "simple";
    const commands = [];

    for (const feature of features) {
      const geom = feature && feature.geometry;
      if (!geom || !geom.type || !geom.coordinates) continue;

      let styleSymbol;
      if (typeof styleFunction === "function") {
        const simpleStyle = styleFunction(feature) || {};
        styleSymbol = this._symbolFromSimpleStyle(simpleStyle);
      } else {
        styleSymbol = this._resolveStyleSymbol(
          feature,
          styleConfig,
          renderer,
        );
      }
      if (!styleSymbol) continue;

      this._emitCommandsForGeometry(commands, geom, styleSymbol);
    }

    return commands;
  }

  /**
   * Resolve the style symbol (IR) for a feature given the renderer type.
   * Uses defaultSymbol/symbol only (new contract).
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

    // Simple renderer: defaultSymbol only (new contract)
    const layerSymbol = styleConfig.defaultSymbol;
    if (
      layerSymbol &&
      layerSymbol.symbolLayers &&
      layerSymbol.symbolLayers.length
    ) {
      return layerSymbol;
    }

    // Fallback only for edge cases (e.g. image layer with defaultStyle)
    if (styleConfig.defaultStyle) {
      return this._symbolFromSimpleStyle(styleConfig.defaultStyle);
    }

    return null;
  }

  /**
   * Build a minimal symbol IR from a simple style dict.
   * Used for defaultStyle fallback (e.g. image layer) and uniqueValue class.style.
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

    const strokeColor =
      simpleStyle.strokeColor ??
      simpleStyle.color ??
      null;
    const strokeWidth =
      simpleStyle.strokeWidth ??
      (typeof simpleStyle.weight === "number" ? simpleStyle.weight : null);
    const strokeOpacity =
      simpleStyle.strokeOpacity ??
      (simpleStyle.opacity !== undefined ? simpleStyle.opacity : 1.0);
    const dashArray = Array.isArray(simpleStyle.dashArray)
      ? simpleStyle.dashArray.slice()
      : null;

    if (strokeColor != null || strokeWidth != null) {
      layers.push({
        type: "stroke",
        color: strokeColor || "#000000",
        width: strokeWidth || 1.0,
        opacity:
          strokeOpacity !== undefined
            ? strokeOpacity
            : 1.0,
        dash: dashArray ? { array: dashArray } : null,
      });
    }

    // Optional icon marker support for point features. When simpleStyle comes
    // from a curated style with `_iconUrl` / `_iconSize`, emit a markerPoint
    // symbol layer so the canvas renderer can draw an image instead of a
    // circle marker.
    if (simpleStyle._iconUrl) {
      const size =
        typeof simpleStyle._iconSize === "number" && simpleStyle._iconSize > 0
          ? simpleStyle._iconSize
          : 24;
      layers.push({
        type: "markerPoint",
        marker: {
          size,
          iconUrl: simpleStyle._iconUrl,
        },
      });
    } else if (
      typeof simpleStyle.radius === "number" &&
      simpleStyle.radius > 0
    ) {
      // Circle marker support: when a radius is provided (Leaflet-style),
      // propagate it via a markerPoint layer so AdvancedStyleDrawing can
      // size the point consistently between GIS and projection.
      const size = simpleStyle.radius * 2;
      layers.push({
        type: "markerPoint",
        marker: {
          size,
        },
      });
    }

    return { symbolLayers: layers };
  }

  /** Public alias for _symbolFromSimpleStyle (canonical entry point for legend and other consumers). */
  static symbolFromSimpleStyle(simpleStyle) {
    return this._symbolFromSimpleStyle(simpleStyle);
  }

  /**
   * Convert symbol IR to Leaflet style props (for GeoJSON layers).
   * Used so map GeoJSON uses the same resolution path as PMTiles/projector.
   * @param {Object} symbol - { symbolLayers: [ { type, color, width?, opacity?, dash?, hatch? } ] }
   * @returns {Object} Leaflet style: { fillColor, fillOpacity, color, weight, opacity, dashArray, hatch, radius }
   */
  static symbolIRToLeafletProps(symbol) {
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
    if (!symbol || !symbol.symbolLayers || !Array.isArray(symbol.symbolLayers)) {
      return result;
    }
    const hasMarkerPoint = symbol.symbolLayers.some(
      (layer) => layer && layer.type === "markerPoint",
    );
    let markerHasVisibleFill = false;
    for (const layer of symbol.symbolLayers) {
      if (!layer || !layer.type) continue;
      if (layer.type === "fill") {
        const nextColor = layer.color || result.fillColor;
        const nextOpacity =
          layer.opacity !== undefined ? layer.opacity : result.fillOpacity;
        // Marker symbols can include transparent top fills. Keep the most recent
        // visible fill and ignore later fully transparent overrides.
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
        result.opacity =
          layer.opacity !== undefined ? layer.opacity : result.opacity;
        if (layer.dash && Array.isArray(layer.dash.array)) {
          result.dashArray = layer.dash.array;
        }
      }
      if (layer.type === "markerPoint" && layer.marker) {
        const size = layer.marker.size;
        if (typeof size === "number") result.radius = size / 2;
        else if (Array.isArray(size) && size[0]) result.radius = size[0] / 2;
      }
    }
    return result;
  }

  /**
   * Return a Leaflet style function for the given layer config (one path: resolve to symbol IR then to Leaflet props).
   * @param {Object} layerConfig - { style: { renderer, defaultSymbol, uniqueValues } }
   * @returns {Function} (feature) => { fillColor, fillOpacity, color, weight, opacity, dashArray, hatch, radius }
   */
  static getLeafletStyleFunction(layerConfig) {
    if (!layerConfig || !layerConfig.style) {
      return () => this.symbolIRToLeafletProps(null);
    }
    const styleConfig = layerConfig.style;
    const renderer = styleConfig.renderer || "simple";
    return (feature) => {
      const symbol = this._resolveStyleSymbol(feature, styleConfig, renderer);
      const fallback = styleConfig.defaultStyle
        ? this._symbolFromSimpleStyle(styleConfig.defaultStyle)
        : null;
      return this.symbolIRToLeafletProps(symbol || fallback);
    };
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

// Expose globally for browser consumers (projection, map)
if (typeof window !== "undefined") {
  window.AdvancedStyleEngine = AdvancedStyleEngine;
}

export default AdvancedStyleEngine;

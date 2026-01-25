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
    const renderer = style.renderer || 'simple';

    if (renderer === 'uniqueValue') {
      return this._getUniqueValueStyle(style, layerConfig);
    } else if (renderer === 'landUse') {
      return this._getLandUseStyle(style);
    } else if (renderer === 'majorRoad') {
      return this._getMajorRoadStyle(style);
    } else {
      return this._getSimpleStyle(style);
    }
  }

  /**
   * Get major road style function (uses getMajorRoadStyle from vector-styling.js).
   */
  static _getMajorRoadStyle(style) {
    const defaultStyle = style.defaultStyle || {};

    return (feature) => {
      // Use getMajorRoadStyle from vector-styling.js if available
      if (typeof getMajorRoadStyle === 'function') {
        return getMajorRoadStyle(feature);
      }

      // Fallback to default style
      return {
        color: defaultStyle.strokeColor || '#CD853F',
        weight: defaultStyle.strokeWidth || 3.0,
        opacity: defaultStyle.strokeOpacity !== undefined ? defaultStyle.strokeOpacity : 0.85,
        lineCap: 'round',
        lineJoin: 'round'
      };
    };
  }

  /**
   * Get land-use based style function (uses LAND_USE_COLORS from vector-styling.js).
   * Handles both GeoJSON features (properties) and PMTiles features (props).
   */
  static _getLandUseStyle(style) {
    const field = style.landUseField || 'TARGUMYEUD';
    const fallbackField = style.landUseFieldFallback || 'KVUZ_TRG';
    const defaultStyle = style.defaultStyle || {};

    return (feature) => {
      // Handle both GeoJSON (properties) and PMTiles (props) features
      const props = feature.properties || feature.props || {};
      const landUse = props[field] || props[fallbackField] || '';

      // Use getLandUseScheme from vector-styling.js if available
      if (typeof getLandUseScheme === 'function') {
        const scheme = getLandUseScheme(landUse);
        return {
          fillColor: scheme.fill,
          fillOpacity: defaultStyle.fillOpacity !== undefined ? defaultStyle.fillOpacity : 0.7,
          color: scheme.stroke,
          weight: defaultStyle.strokeWidth || 0.5,
          opacity: defaultStyle.strokeOpacity !== undefined ? defaultStyle.strokeOpacity : 1.0
        };
      }

      // Fallback to getLandUseColor if only that's available
      if (typeof getLandUseColor === 'function') {
        return {
          fillColor: getLandUseColor(landUse),
          fillOpacity: defaultStyle.fillOpacity !== undefined ? defaultStyle.fillOpacity : 0.7,
          color: defaultStyle.strokeColor || '#333333',
          weight: defaultStyle.strokeWidth || 0.5,
          opacity: defaultStyle.strokeOpacity !== undefined ? defaultStyle.strokeOpacity : 1.0
        };
      }

      // Final fallback to default style
      return {
        fillColor: defaultStyle.fillColor || '#E0E0E0',
        fillOpacity: defaultStyle.fillOpacity !== undefined ? defaultStyle.fillOpacity : 0.7,
        color: defaultStyle.strokeColor || '#333333',
        weight: defaultStyle.strokeWidth || 0.5,
        opacity: defaultStyle.strokeOpacity !== undefined ? defaultStyle.strokeOpacity : 1.0
      };
    };
  }

  /**
   * Get simple style function (single style for all features).
   */
  static _getSimpleStyle(style) {
    const defaultStyle = style.defaultStyle || {};

    return (feature) => {
      return {
        fillColor: defaultStyle.fillColor || '#808080',
        fillOpacity: defaultStyle.fillOpacity !== undefined ? defaultStyle.fillOpacity : 0.7,
        color: defaultStyle.strokeColor || '#000000',
        weight: defaultStyle.strokeWidth || 1.0,
        opacity: defaultStyle.strokeOpacity !== undefined ? defaultStyle.strokeOpacity : 1.0
      };
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

    return (feature) => {
      // Get field value from feature properties
      // Handle both GeoJSON (properties) and PMTiles (props) features
      const props = feature.properties || feature.props || {};
      const fieldValue = String(props[field] || '');

      // Look up style for this value
      const valueStyle = styleMap.get(fieldValue);
      if (valueStyle) {
        return {
          fillColor: valueStyle.fillColor || defaultStyle.fillColor || '#808080',
          fillOpacity: valueStyle.fillOpacity !== undefined ? valueStyle.fillOpacity : (defaultStyle.fillOpacity !== undefined ? defaultStyle.fillOpacity : 0.7),
          color: valueStyle.strokeColor || defaultStyle.strokeColor || '#000000',
          weight: valueStyle.strokeWidth !== undefined ? valueStyle.strokeWidth : (defaultStyle.strokeWidth !== undefined ? defaultStyle.strokeWidth : 1.0),
          opacity: valueStyle.strokeOpacity !== undefined ? valueStyle.strokeOpacity : (defaultStyle.strokeOpacity !== undefined ? defaultStyle.strokeOpacity : 1.0)
        };
      }

      // Fallback to default style
      return {
        fillColor: defaultStyle.fillColor || '#808080',
        fillOpacity: defaultStyle.fillOpacity !== undefined ? defaultStyle.fillOpacity : 0.7,
        color: defaultStyle.strokeColor || '#000000',
        weight: defaultStyle.strokeWidth || 1.0,
        opacity: defaultStyle.strokeOpacity !== undefined ? defaultStyle.strokeOpacity : 1.0
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
        fillColor: '#808080',
        fillOpacity: 0.7,
        color: '#000000',
        weight: 1.0
      };
    }

    const style = layerConfig.style;
    const defaultStyle = style.defaultStyle || {};

    return {
      radius: defaultStyle.radius || 5,
      fillColor: defaultStyle.fillColor || '#808080',
      fillOpacity: defaultStyle.fillOpacity !== undefined ? defaultStyle.fillOpacity : 0.7,
      color: defaultStyle.strokeColor || '#000000',
      weight: defaultStyle.strokeWidth || 1.0,
      opacity: defaultStyle.strokeOpacity !== undefined ? defaultStyle.strokeOpacity : 1.0
    };
  }

  /**
   * Default style function.
   * Used by both Leaflet and Canvas renderers.
   */
  static _defaultStyle(feature) {
    return {
      fillColor: '#808080',
      fillOpacity: 0.7,
      color: '#000000',
      weight: 1.0,
      opacity: 1.0
    };
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StyleApplicator;
}

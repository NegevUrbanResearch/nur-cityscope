(function () {
  let protomapsLRefLocal;
  let AdvancedStyleEngineRefLocal;
  let AdvancedStyleDrawingRefLocal;

  function ensureBrowserRefs() {
    if (typeof protomapsL !== "undefined") {
      protomapsLRefLocal = protomapsLRefLocal || protomapsL;
    }
    if (typeof AdvancedStyleEngine !== "undefined") {
      AdvancedStyleEngineRefLocal = AdvancedStyleEngine;
    }
    if (typeof AdvancedStyleDrawing !== "undefined") {
      AdvancedStyleDrawingRefLocal = AdvancedStyleDrawing;
    }
  }

  // CommonJS requires for Node/tests
  try {
    // eslint-disable-next-line global-require
    const protomapsLModule = require("protomaps-leaflet");
    protomapsLRefLocal = protomapsLRefLocal || protomapsLModule;
  } catch (_) {}

  try {
    // eslint-disable-next-line global-require
    const AdvancedStyleEngineModule = require("./advanced-style-engine");
    AdvancedStyleEngineRefLocal =
      AdvancedStyleEngineRefLocal || AdvancedStyleEngineModule;
  } catch (_) {}

  try {
    // eslint-disable-next-line global-require
    const AdvancedStyleDrawingModule = require("./advanced-style-drawing");
    AdvancedStyleDrawingRefLocal =
      AdvancedStyleDrawingRefLocal || AdvancedStyleDrawingModule;
  } catch (_) {}

  /**
   * Normalize a Protomaps point (Point {x,y} or [x,y]) to [x, y] numbers.
   */
  function pointToXY(pt) {
    if (pt == null) return [0, 0];
    if (Array.isArray(pt)) return [Number(pt[0] ?? 0), Number(pt[1] ?? 0)];
    return [Number(pt.x ?? 0), Number(pt.y ?? 0)];
  }

  /**
   * Normalize a single ring (array of points) to array of [x,y].
   */
  function normalizeRing(ring) {
    if (!ring || !Array.isArray(ring)) return [];
    const out = [];
    for (let i = 0; i < ring.length; i++) {
      out.push(pointToXY(ring[i]));
    }
    return out;
  }

  /**
   * True if the value looks like a single point: [x,y] or {x,y}.
   * Used to distinguish "ring = array of points" from "polygon = array of rings".
   */
  function isPointLike(val) {
    if (val == null) return false;
    if (Array.isArray(val)) {
      return (
        val.length >= 2 &&
        typeof val[0] === "number" &&
        typeof val[1] === "number"
      );
    }
    return (
      typeof val === "object" &&
      ("x" in val || "y" in val) &&
      !Array.isArray(val)
    );
  }

  /**
   * Convert Protomaps polygon geom to GeoJSON MultiPolygon coordinates.
   * Protomaps passes polygon as array of rings (one polygon: [exterior, hole, ...]);
   * each ring is an array of points with .x/.y or [x,y]. Some tiles/zooms may use
   * array of polygons (each polygon = array of rings). We detect by checking whether
   * first[0] is a point (ring) or a ring (polygon).
   */
  function geomToMultiPolygonCoords(geom) {
    if (!geom || !Array.isArray(geom) || geom.length === 0) return [];

    const first = geom[0];
    if (!first || !Array.isArray(first)) return [];

    const firstElem = first[0];
    const firstIsRing = firstElem != null && isPointLike(firstElem);

    if (firstIsRing) {
      const onePolygon = [];
      for (let i = 0; i < geom.length; i++) {
        const ring = normalizeRing(geom[i]);
        if (ring.length >= 3) onePolygon.push(ring);
      }
      return onePolygon.length ? [onePolygon] : [];
    }

    // First element is a polygon (array of rings). geom is [polygon, polygon, ...].
    const polygons = [];
    for (let p = 0; p < geom.length; p++) {
      const poly = geom[p];
      if (!poly || !Array.isArray(poly)) continue;
      const rings = [];
      for (let r = 0; r < poly.length; r++) {
        const ring = normalizeRing(poly[r]);
        if (ring.length >= 3) rings.push(ring);
      }
      if (rings.length) polygons.push(rings);
    }
    return polygons;
  }

  /**
   * Create an advanced PMTiles layer that:
   *  - Uses PMTiles / protomaps-leaflet purely as a tiled geometry + attribute
   *    source.
   *  - Resolves styles via AdvancedStyleEngine (IR-driven).
   *  - Executes drawing commands via AdvancedStyleDrawing on the tile canvas.
   *
   * @param {Object} options
   * @param {string} options.fullLayerId
   * @param {Object} options.layerConfig
   * @param {string} options.dataUrl
   * @returns {Object|null} Protomaps Leaflet layer
   */
  function createAdvancedPmtilesLayer(options) {
    const { fullLayerId, layerConfig, dataUrl } = options || {};

    ensureBrowserRefs();

    if (
      !protomapsLRefLocal ||
      !AdvancedStyleEngineRefLocal ||
      !AdvancedStyleDrawingRefLocal ||
      !layerConfig ||
      !dataUrl
    ) {
      return null;
    }

    const styleConfig = layerConfig.style || {};
    const rendererType = styleConfig.renderer || "simple";

    function getTileOrigin(ctx, gridSize = 256) {
      if (!ctx || !ctx.canvas) return { x: 0, y: 0 };
      const canvas = ctx.canvas;

      // 1. Determine Logical Tile Size (Canvas Coordinate Space)
      // This is the dimension we are drawing into.
      let logicalSize = gridSize;
      try {
        logicalSize = canvas.width;
      } catch (e) {
        logicalSize = canvas.width;
      }

      // 2. Determine Physical Size (Visual CSS Space)
      // If we are zoom-mapped (Z15 tile at Z16), CSS size might be 512px while canvas is 256px.
      // Scale = Logical / Physical.
      let physicalSize = logicalSize;

      // Try to get actual rendered size via BoundingClientRect (most accurate for transforms)
      if (canvas.getBoundingClientRect) {
          const rect = canvas.getBoundingClientRect();
          if (rect.width > 0) {
             // BCR is in viewport pixels. If there is a global map scale (e.g. browser zoom),
             // this might be affected. But usually relative to neighbors it's consistent.
             // However, `getPosition` is in local container pixels.
             // If container is scaled, this is tricky.
             // Let's rely on style.transform scale check first if possible.
          }
      }

      // Check explicit CSS size
      if (canvas.style.width) {
          physicalSize = parseInt(canvas.style.width, 10) || logicalSize;
      } else if (canvas.offsetWidth > 0) {
          physicalSize = canvas.offsetWidth;
      }

      // Check for inline scale transform which Leaflet sometimes uses for zoom animations or grid scaling
      if (canvas.style.transform) {
         const scaleMatch = canvas.style.transform.match(/scale\(([^)]+)\)/);
         if (scaleMatch) {
             // e.g. scale(2) or scale(0.5)
             const s = parseFloat(scaleMatch[1]);
             if (!isNaN(s) && s > 0) {
                 physicalSize *= s;
             }
         }
      }

      const renderScale = (physicalSize > 0) ? (logicalSize / physicalSize) : 1;

      // 3. Determine Physical Origin (CSS/Mosaic Position)
      let rawX = null;
      let rawY = null;
      let tileEl = canvas;

      // Check parent if canvas is wrapper
      if (!tileEl.style || (!tileEl.style.transform && !tileEl.style.left)) {
          if (tileEl.parentNode && tileEl.parentNode.style) {
              tileEl = tileEl.parentNode;
          }
      }

      // Strategy A: Key Parsing (PRIMARY for Stable Global Alignment)
      // Key (x:y:z): protomaps-leaflet uses a key where consecutive 256px tiles have
      // key indices that step by 4 (observed: 4x4 blocks aligned with gridSize 256).
      // So one key unit = 64px; origin = key * 64 gives correct global position per tile.
      const key = canvas.key || (canvas.dataset ? canvas.dataset.key : null);
      if (key && typeof key === "string") {
        const parts = key.split(":");
        if (parts.length >= 3) {
            const kx = parseInt(parts[0], 10);
            const ky = parseInt(parts[1], 10);
            // const kz = parseInt(parts[2], 10); // unused for now
            if (!isNaN(kx) && !isNaN(ky)) {
                // 64px per key unit so that consecutive 256px tiles (key step 4) get origin step 256.
                const keyToPixel = 64;
                return {
                    debug: { source: 'key', logicalSize, physicalSize, renderScale, rawX: kx * keyToPixel },
                    x: kx * keyToPixel,
                    y: ky * keyToPixel
                };
            }
        }
      }

      // Strategies B/C (CSS/DOM) - Fallback ONLY
      // Strategy B: Leaflet DomUtil
      if (typeof L !== "undefined" && L.DomUtil && L.DomUtil.getPosition) {
        try {
          const pos = L.DomUtil.getPosition(tileEl);
          if (pos) {
            rawX = pos.x;
            rawY = pos.y;
          }
        } catch (e) { /* ignore */ }
      }

      // Strategy C: Manual CSS Parse
      if (rawX === null) {
        const style = tileEl.style;
        if (style) {
            if (style.transform) {
              const match = style.transform.match(/translate(?:3d)?\((-?[\d.]+)px,\s*(-?[\d.]+)px/);
              if (match) {
                rawX = parseFloat(match[1]);
                rawY = parseFloat(match[2]);
              }
            } else if (style.left || style.top) {
               rawX = parseFloat(style.left || "0");
               rawY = parseFloat(style.top || "0");
            }
        }
      }

      // Strategy D: Leaflet Internal
      if (rawX === null) {
          const tilePoint = canvas._coords || canvas._tilePoint || (canvas.parentNode ? (canvas.parentNode._coords || canvas.parentNode._tilePoint) : null);
          if (tilePoint) {
             rawX = tilePoint.x * logicalSize; // Approximate
             // This path is shaky, prefer key.
          }
      }

      if (rawX !== null && rawY !== null) {
          return {
              debug: { source: 'dom', logicalSize, physicalSize, renderScale, rawX },
              x: rawX * renderScale,
              y: rawY * renderScale
          };
      }

      return { debug: { logicalSize, physicalSize, renderScale, rawX }, x: 0, y: 0 };
    }

    class AdvancedPmtilesSymbolizer {
      constructor(geometryType) {
        this._geometryType = geometryType;
        this._styleConfig = styleConfig;
        this._rendererType = rendererType;
        this._engine = AdvancedStyleEngineRefLocal;
        this._drawer = new AdvancedStyleDrawingRefLocal();
      }

      /**
       * Draw a single feature using AdvancedStyleEngine + AdvancedStyleDrawing.
       * geom is in tile pixel coordinates; we keep it that way and provide an
       * identity coordToPixel in viewContext.
       */
      draw(ctx, geom, z, feature) {
        if (!ctx || !geom || !feature) return;

        // Protomaps may expose props as .props, .properties, or .tags; merge so
        // uniqueValue resolution finds the correct field.

        const props = {
          ...(feature.properties || {}),
          ...(feature.props || {}),
          ...(feature.tags || {}),
        };

        let geometry;
        if (this._geometryType === "polygon") {
          const polygonCoords = geomToMultiPolygonCoords(geom);
          if (polygonCoords.length === 0) return;
          geometry = {
            type: "MultiPolygon",
            coordinates: polygonCoords,
          };
        } else if (this._geometryType === "line") {
          const lineCoords = [];
          for (let i = 0; i < geom.length; i++) {
            const line = geom[i];
            if (!line || !Array.isArray(line)) continue;
            const pts = [];
            for (let j = 0; j < line.length; j++) pts.push(pointToXY(line[j]));
            if (pts.length >= 2) lineCoords.push(pts);
          }
          if (lineCoords.length === 0) return;
          geometry = {
            type: "MultiLineString",
            coordinates: lineCoords,
          };
        } else {
          return;
        }

        const pseudoFeature = {
          geometry,
          properties: props,
        };

        let symbol = this._engine._resolveStyleSymbol(
          pseudoFeature,
          this._styleConfig,
          this._rendererType,
        );
        // Fallback so we never leave a tile empty when the feature exists
        if (!symbol && this._styleConfig.defaultStyle) {
          symbol = this._engine._symbolFromSimpleStyle(
            this._styleConfig.defaultStyle,
          );
        }
        if (!symbol) return;

        const commands = [];
        this._engine._emitCommandsForGeometry(commands, geometry, symbol);
        if (!commands.length) return;

        // protomaps-leaflet passes geom already in tile canvas CSS pixels; do not scale.
        const coordToPixel = (coord) => {
          if (coord == null) return { x: 0, y: 0 };
          const x = Number(coord[0] ?? coord.x ?? 0);
          const y = Number(coord[1] ?? coord.y ?? 0);
          return { x, y };
        };

        const viewportWidth =
          ctx.canvas && ctx.canvas.width ? ctx.canvas.width : 256;
        const viewportHeight =
          ctx.canvas && ctx.canvas.height ? ctx.canvas.height : 256;

        // Calculate tile origin for seamless pattern alignment
        // We use viewportWidth as the grid size hint (usually 256).
        // If ctx is scaled (Retina), viewportWidth might be 512, but CSS size 256?
        // AdvancedPmtilesLayer calculates viewportWidth from ctx.canvas.width.
        // If HighDPI, canvas.width is 512.
        // But getTileOrigin reads CSS pixels (256).
        // So we should pass the CSS size.
        // viewContext.pixelRatio is currently hardcoded to 1 in this file (line 274).
        // Let's use 256 as a safe default if viewportWidth is crazy, but usually viewportWidth/pixelRatio?

        // Actually, for Protomaps, if the canvas is 512, it's usually representing a 512 tile OR a 256 tile at 2x.
        // But the DOM position is always in CSS pixels.
        // Standard Leaflet tiles are 256x256 CSS pixels.
        // So snapping to 256 is the safest bet for Leaflet.
        // If tileSize is 512, 512 is a multiple of 256.
        // So sticking with 256 default is fine, BUT explicit is better.
        // Let's rely on standard Leaflet tile size 256.

        // Calculate tile origin for seamless pattern alignment



        const tileOrigin = getTileOrigin(ctx);

        const viewContext = {
          coordToPixel,
          pixelRatio: 1,
          viewportWidth,
          viewportHeight,
          tileOrigin,
        };

        this._drawer.drawCommands(ctx, commands, viewContext);

        // --- VISUAL DEBUG START ---
        // Draw tile info directly on the map to verify alignment logic
        if (false) { // Toggle to true to enable
           ctx.save();
           ctx.globalAlpha = 1;
           ctx.lineWidth = 2;
           ctx.strokeStyle = '#FF00FF'; // Magenta border
           ctx.strokeRect(0, 0, viewportWidth, viewportHeight);

           ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
           ctx.fillRect(0, 0, 220, 60);

           ctx.fillStyle = '#000000';
           ctx.font = '12px sans-serif';
           const key = ctx.canvas.key || (ctx.canvas.dataset ? ctx.canvas.dataset.key : 'no-key');
           const origin = viewContext.tileOrigin;

           ctx.fillText(`Key: ${key}`, 5, 15);
           const d = origin.debug || {};
           ctx.fillText(`Src: ${d.source || '?'} L: ${d.logicalSize} P: ${d.physicalSize ? d.physicalSize.toFixed(0) : '?'}`, 5, 30);
           ctx.fillText(`RawX: ${d.rawX != null ? d.rawX.toFixed(0) : 'N/A'} -> OrigX: ${origin.x.toFixed(0)}`, 5, 45);
           ctx.fillText(`OriginY: ${origin.y.toFixed(1)}`, 5, 60);
           ctx.restore();
        }
        // --- VISUAL DEBUG END ---
      }
    }

    const dataLayerName = "layer";
    const paintRules = [];

    if (layerConfig.geometryType === "polygon") {
      const symbolizer = new AdvancedPmtilesSymbolizer("polygon");
      paintRules.push({
        dataLayer: dataLayerName,
        symbolizer,
      });
      // Fallback wildcard for any stray layers in the tiles
      paintRules.push({
        dataLayer: "*",
        symbolizer,
      });
    } else if (layerConfig.geometryType === "line") {
      const symbolizer = new AdvancedPmtilesSymbolizer("line");
      paintRules.push({
        dataLayer: dataLayerName,
        symbolizer,
      });
      paintRules.push({
        dataLayer: "*",
        symbolizer,
      });
    } else {
      // Points or unknown: fall back to existing simple PMTiles path for now
      return null;
    }

    let layerPane = "overlayPolygon";
    if (layerConfig.geometryType === "line") layerPane = "overlayLine";
    if (layerConfig.geometryType === "point") layerPane = "overlayPoint";

    // Debugging: Log the URL being used
    console.log(`[AdvancedPmtilesLayer] Creating layer '${fullLayerId}' with URL:`, dataUrl);

    const pmtilesLayer = protomapsLRefLocal.leafletLayer({
      url: dataUrl,
      paintRules,
      labelRules: [],
      minZoom: 9,
      minDataZoom: 9,
      maxDataZoom: 18,
      attribution: layerConfig.name || fullLayerId,
      pane: layerPane,
      tileSize: 256,
    });

    return pmtilesLayer;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      createAdvancedPmtilesLayer,
    };
  }

  if (typeof window !== "undefined") {
    window.AdvancedPmtilesLayer = {
      createAdvancedPmtilesLayer,
    };
  }
})();


/**
 * WmtsLayerRenderer - Fetches and draws WMTS tile layers on a canvas for the projector.
 * Coordinate chain: Web Mercator tile -> WGS84 -> ITM -> display pixel.
 */

(function () {
  const EARTH_RADIUS = 6378137;
  const TILE_SIZE = 256;

  function lonLatToTileXY(lon, lat, zoom) {
    const n = 1 << zoom;
    const x = Math.floor(((lon + 180) / 360) * n);
    const latRad = (lat * Math.PI) / 180;
    const y = Math.floor(
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
        n
    );
    return {
      x: Math.max(0, Math.min(x, n - 1)),
      y: Math.max(0, Math.min(y, n - 1)),
    };
  }

  function tileBoundsWebMercator(z, x, y) {
    const worldSize = 2 * Math.PI * EARTH_RADIUS;
    const tileSizeM = worldSize / (1 << z);
    const left = -Math.PI * EARTH_RADIUS + x * tileSizeM;
    const right = left + tileSizeM;
    const top = Math.PI * EARTH_RADIUS - y * tileSizeM;
    const bottom = top - tileSizeM;
    return { left, right, top, bottom };
  }

  function webMercatorToWgs84(x, y) {
    return proj4("EPSG:3857", "EPSG:4326", [x, y]);
  }

  /**
   * ITM coord to display pixel (same logic as CanvasLayerRenderer._coordToPixel).
   */
  function itmToPixel(x, y, modelBounds, displayBounds) {
    const pctX = (x - modelBounds.west) / (modelBounds.east - modelBounds.west);
    const pctY =
      (modelBounds.north - y) / (modelBounds.north - modelBounds.south);
    return {
      x: pctX * displayBounds.width,
      y: pctY * displayBounds.height,
    };
  }

  /**
   * Transform ITM coordinate to display pixel.
   */
  function itmToPixelCoord(x, y, modelBounds, displayBounds) {
    const pctX = (x - modelBounds.west) / (modelBounds.east - modelBounds.west);
    const pctY =
      (modelBounds.north - y) / (modelBounds.north - modelBounds.south);
    return {
      x: pctX * displayBounds.width,
      y: pctY * displayBounds.height,
    };
  }

  /**
   * Extract rings from GeoJSON geometry (ITM coords) and draw path in pixel space.
   */
  function buildMaskPath(ctx, geojson, modelBounds, displayBounds) {
    if (!geojson || !modelBounds || !displayBounds) return;
    const features = geojson.features || [];
    for (let i = 0; i < features.length; i++) {
      const geom = features[i].geometry;
      if (!geom || !geom.coordinates) continue;
      const coords = geom.coordinates;
      if (geom.type === "Polygon") {
        for (let r = 0; r < coords.length; r++) {
          const ring = coords[r];
          if (!ring || ring.length < 3) continue;
          const first = itmToPixelCoord(ring[0][0], ring[0][1], modelBounds, displayBounds);
          ctx.moveTo(first.x, first.y);
          for (let j = 1; j < ring.length; j++) {
            const p = itmToPixelCoord(ring[j][0], ring[j][1], modelBounds, displayBounds);
            ctx.lineTo(p.x, p.y);
          }
          ctx.closePath();
        }
      } else if (geom.type === "MultiPolygon") {
        for (let p = 0; p < coords.length; p++) {
          const polygon = coords[p];
          for (let r = 0; r < polygon.length; r++) {
            const ring = polygon[r];
            if (!ring || ring.length < 3) continue;
            const first = itmToPixelCoord(ring[0][0], ring[0][1], modelBounds, displayBounds);
            ctx.moveTo(first.x, first.y);
            for (let j = 1; j < ring.length; j++) {
              const pt = itmToPixelCoord(ring[j][0], ring[j][1], modelBounds, displayBounds);
              ctx.lineTo(pt.x, pt.y);
            }
            ctx.closePath();
          }
        }
      }
    }
  }

  class WmtsLayerRenderer {
    constructor(containerId) {
      this.container = document.getElementById(containerId);
      if (!this.container) {
        throw new Error(`Container ${containerId} not found`);
      }
      this.canvas = null;
      this.ctx = null;
      this.modelBounds = null;
      this.displayBounds = null;
      this.dpr = 1;
      this._cache = new Map();
      this._layers = new Map();
      this._renderScheduled = false;
      this._createCanvas();
    }

    _createCanvas() {
      const existing = this.container.querySelector("#wmtsCanvas");
      if (existing) existing.remove();

      this.canvas = document.createElement("canvas");
      this.canvas.id = "wmtsCanvas";
      this.canvas.style.cssText =
        "position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 6; image-rendering: crisp-edges; image-rendering: -webkit-optimize-contrast;";

      const layersCanvas = this.container.querySelector("#layersCanvas");
      if (layersCanvas) {
        this.container.insertBefore(this.canvas, layersCanvas);
      } else {
        const highlightOverlay =
          this.container.querySelector("#highlightOverlay");
        if (highlightOverlay) {
          this.container.insertBefore(this.canvas, highlightOverlay);
        } else {
          this.container.appendChild(this.canvas);
        }
      }
      this.ctx = this.canvas.getContext("2d");
    }

    setLayer(fullLayerId, layerConfig, maskGeometry) {
      const config = layerConfig && layerConfig.wmts ? layerConfig : null;
      const mask = layerConfig && layerConfig.mask ? layerConfig.mask : null;
      const exclude = mask && mask.exclude === true;
      let entry = this._layers.get(fullLayerId);
      if (!entry) {
        entry = { visible: false };
        this._layers.set(fullLayerId, entry);
      }
      entry.config = config;
      entry.layerConfig = layerConfig;
      entry.maskGeometry = maskGeometry || null;
      entry.maskExclude = exclude;
      entry.visible = entry.visible;
    }

    setVisible(fullLayerId, visible) {
      const entry = this._layers.get(fullLayerId);
      if (!entry) return;
      if (entry.visible === visible) return;
      entry.visible = visible;
      this._scheduleRender();
    }

    removeLayer(fullLayerId) {
      this._layers.delete(fullLayerId);
      this._scheduleRender();
    }

    updatePosition(displayBounds, modelBounds) {
      if (!displayBounds || !modelBounds) return;
      this.displayBounds = displayBounds;
      this.modelBounds = modelBounds;

      this.dpr = window.devicePixelRatio || 1;
      const w = Math.round(displayBounds.width * this.dpr);
      const h = Math.round(displayBounds.height * this.dpr);

      this.canvas.style.left = displayBounds.offsetX + "px";
      this.canvas.style.top = displayBounds.offsetY + "px";
      this.canvas.style.width = displayBounds.width + "px";
      this.canvas.style.height = displayBounds.height + "px";
      this.canvas.width = w;
      this.canvas.height = h;
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this._scheduleRender();
    }

    _scheduleRender() {
      if (this._renderScheduled) return;
      this._renderScheduled = true;
      const self = this;
      requestAnimationFrame(function () {
        self._renderScheduled = false;
        self.render();
      });
    }

    _getZoom(layerConfig) {
      const cfg =
        typeof MapProjectionConfig !== "undefined" &&
        MapProjectionConfig.WMTS_PROJECTOR
          ? MapProjectionConfig.WMTS_PROJECTOR
          : {};
      if (cfg.zoomOverride != null && cfg.zoomOverride !== undefined) {
        return cfg.zoomOverride;
      }
      return layerConfig?.wmts?.zoom ?? 12;
    }

    _getUrlTemplate(layerConfig) {
      const cfg =
        typeof MapProjectionConfig !== "undefined" &&
        MapProjectionConfig.WMTS_PROJECTOR
          ? MapProjectionConfig.WMTS_PROJECTOR
          : {};
      if (cfg.urlOverride) return cfg.urlOverride;
      return layerConfig?.wmts?.urlTemplate ?? "";
    }

    render() {
      if (!this.ctx || !this.displayBounds || !this.modelBounds) return;

      const dpr = this.dpr || 1;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.ctx.clearRect(
        0,
        0,
        this.displayBounds.width,
        this.displayBounds.height
      );

      const displayBounds = this.displayBounds;
      const modelBounds = this.modelBounds;

      this._layers.forEach((entry, fullLayerId) => {
        if (!entry.visible || !entry.config) return;
        const layerConfig = entry.layerConfig || { wmts: entry.config };
        const zoom = this._getZoom(layerConfig);
        const urlTemplate = this._getUrlTemplate(layerConfig);
        if (!urlTemplate) return;

        const west = modelBounds.west;
        const east = modelBounds.east;
        const south = modelBounds.south;
        const north = modelBounds.north;

        const [lat1, lon1] = CoordUtils.transformItmToWgs84(west, north);
        const [lat2, lon2] = CoordUtils.transformItmToWgs84(east, south);
        const t0 = lonLatToTileXY(lon1, lat1, zoom);
        const t1 = lonLatToTileXY(lon2, lat2, zoom);
        const minTx = Math.min(t0.x, t1.x);
        const maxTx = Math.max(t0.x, t1.x);
        const minTy = Math.min(t0.y, t1.y);
        const maxTy = Math.max(t0.y, t1.y);

        const cachePrefix = fullLayerId + "/";
        const self = this;

        const maskGeometry = entry.maskGeometry;
        const maskExclude = entry.maskExclude;
        const hasMask =
          maskGeometry &&
          maskGeometry.features &&
          maskGeometry.features.length > 0;

        const drawTile = function (tx, ty) {
          const cacheKey = cachePrefix + zoom + "/" + ty + "/" + tx;
          const img = self._cache.get(cacheKey);
          if (img) {
            self._drawTileImage(
              img,
              zoom,
              tx,
              ty,
              modelBounds,
              displayBounds,
              hasMask ? maskGeometry : null,
              maskExclude
            );
            return;
          }
          const url = urlTemplate
            .replace("{z}", String(zoom))
            .replace("{y}", String(ty))
            .replace("{x}", String(tx));
          fetch(url)
            .then(function (r) {
              if (!r.ok) return null;
              return r.blob();
            })
            .then(function (blob) {
              if (!blob) return;
              const objectUrl = URL.createObjectURL(blob);
              const image = new Image();
              image.crossOrigin = "anonymous";
              image.onload = function () {
                self._cache.set(cacheKey, image);
                self._drawTileImage(
                  image,
                  zoom,
                  tx,
                  ty,
                  self.modelBounds,
                  self.displayBounds,
                  hasMask ? maskGeometry : null,
                  maskExclude
                );
                URL.revokeObjectURL(objectUrl);
              };
              image.onerror = function () {
                URL.revokeObjectURL(objectUrl);
              };
              image.src = objectUrl;
            })
            .catch(function () {});
        };

        for (let ty = minTy; ty <= maxTy; ty++) {
          for (let tx = minTx; tx <= maxTx; tx++) {
            drawTile(tx, ty);
          }
        }
      });
    }

    _drawTileImage(
      img,
      zoom,
      tx,
      ty,
      modelBounds,
      displayBounds,
      maskGeometry,
      maskExclude
    ) {
      if (!modelBounds || !displayBounds || !this.ctx) return;

      this.ctx.save();

      if (maskGeometry && maskGeometry.features && maskGeometry.features.length > 0) {
        this.ctx.beginPath();
        if (maskExclude) {
          this.ctx.rect(0, 0, displayBounds.width, displayBounds.height);
          buildMaskPath(this.ctx, maskGeometry, modelBounds, displayBounds);
          this.ctx.clip("evenodd");
        } else {
          buildMaskPath(this.ctx, maskGeometry, modelBounds, displayBounds);
          this.ctx.clip();
        }
      }

      const bounds = tileBoundsWebMercator(zoom, tx, ty);
      const corners = [
        [bounds.left, bounds.top],
        [bounds.right, bounds.top],
        [bounds.right, bounds.bottom],
        [bounds.left, bounds.bottom],
      ];

      const pixelCorners = corners.map(function (c) {
        const [lon, lat] = webMercatorToWgs84(c[0], c[1]);
        const itm = CoordUtils.transformWgs84ToItm(lon, lat);
        return itmToPixel(itm[0], itm[1], modelBounds, displayBounds);
      });

      const P0 = pixelCorners[0];
      const P1 = pixelCorners[1];
      const P3 = pixelCorners[3];

      const a = (P1.x - P0.x) / TILE_SIZE;
      const b = (P1.y - P0.y) / TILE_SIZE;
      const c = (P3.x - P0.x) / TILE_SIZE;
      const d = (P3.y - P0.y) / TILE_SIZE;
      const e = P0.x;
      const f = P0.y;

      this.ctx.transform(a, b, c, d, e, f);
      this.ctx.drawImage(
        img,
        0,
        0,
        TILE_SIZE,
        TILE_SIZE,
        0,
        0,
        TILE_SIZE,
        TILE_SIZE
      );
      this.ctx.restore();
    }
  }

  window.WmtsLayerRenderer = WmtsLayerRenderer;
})();

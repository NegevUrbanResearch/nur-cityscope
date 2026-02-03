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
      this._layerId = null;
      this._config = null;
      this._visible = false;
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

    setLayer(fullLayerId, layerConfig) {
      this._layerId = fullLayerId;
      this._config = layerConfig;
    }

    setVisible(visible) {
      if (this._visible === visible) return;
      this._visible = visible;
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

    _getZoom() {
      const cfg =
        typeof MapProjectionConfig !== "undefined" &&
        MapProjectionConfig.WMTS_PROJECTOR
          ? MapProjectionConfig.WMTS_PROJECTOR
          : {};
      if (cfg.zoomOverride != null && cfg.zoomOverride !== undefined) {
        return cfg.zoomOverride;
      }
      return this._config?.wmts?.zoom ?? 12;
    }

    _getUrlTemplate() {
      const cfg =
        typeof MapProjectionConfig !== "undefined" &&
        MapProjectionConfig.WMTS_PROJECTOR
          ? MapProjectionConfig.WMTS_PROJECTOR
          : {};
      if (cfg.urlOverride) return cfg.urlOverride;
      return this._config?.wmts?.urlTemplate ?? "";
    }

    render() {
      if (!this.ctx || !this.displayBounds || !this.modelBounds) return;
      this.ctx.clearRect(
        0,
        0,
        this.displayBounds.width,
        this.displayBounds.height
      );
      if (!this._visible || !this._config?.wmts) return;

      const zoom = this._getZoom();
      const urlTemplate = this._getUrlTemplate();
      if (!urlTemplate) return;

      const west = this.modelBounds.west;
      const east = this.modelBounds.east;
      const south = this.modelBounds.south;
      const north = this.modelBounds.north;

      const [lat1, lon1] = CoordUtils.transformItmToWgs84(west, north);
      const [lat2, lon2] = CoordUtils.transformItmToWgs84(east, south);
      const t0 = lonLatToTileXY(lon1, lat1, zoom);
      const t1 = lonLatToTileXY(lon2, lat2, zoom);
      const minTx = Math.min(t0.x, t1.x);
      const maxTx = Math.max(t0.x, t1.x);
      const minTy = Math.min(t0.y, t1.y);
      const maxTy = Math.max(t0.y, t1.y);

      const self = this;
      const displayBounds = this.displayBounds;
      const modelBounds = this.modelBounds;
      const drawTile = function (tx, ty) {
        const cacheKey = `${zoom}/${ty}/${tx}`;
        const img = self._cache.get(cacheKey);
        if (img) {
          self._drawTileImage(img, zoom, tx, ty, modelBounds, displayBounds);
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
                self.displayBounds
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
    }

    _drawTileImage(img, zoom, tx, ty, modelBounds, displayBounds) {
      if (!modelBounds || !displayBounds || !this.ctx) return;

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

      this.ctx.save();
      this.ctx.setTransform(a, b, c, d, e, f);
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

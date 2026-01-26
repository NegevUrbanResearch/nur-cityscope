// OTEFDataContext
// Centralized state management for OTEF viewport, layers, animations, bounds, and connection
// Phase 1: read-only mirror of server state via OTEF_API + a single OTEFWebSocketClient

class OTEFDataContextClass {
  constructor() {
    this._tableName = null;

    // Cached state
    this._viewport = null;    // { bbox, corners?, zoom }
    this._layers = null;      // { roads, parcels, model, majorRoads, smallRoads } - legacy, kept for backward compat
    this._layerGroups = null; // [{ id, enabled, layers: [{ id, enabled }] }] - new hierarchical structure
    this._animations = null;  // { parcels, ... }
    this._bounds = null;      // bounds_polygon from backend
    this._isConnected = false;

    // Subscriptions: key -> Set<callback>
    this._subscribers = {
      viewport: new Set(),
      layers: new Set(),
      layerGroups: new Set(), // New subscription for hierarchical layers
      animations: new Set(),
      bounds: new Set(),
      connection: new Set(),
    };

    this._wsClient = null;
    this._initialized = false;
    this._initializingPromise = null;

    // Interaction bookkeeping
    this._clientId = Math.random().toString(36).substring(2, 10);
    this._currentInteractionSource = null; // 'remote', 'gis', etc.
    this._velocity = { vx: 0, vy: 0 }; // units per second
    this._lastVelocityUpdate = 0;
    this._lastLocalStateTimestamp = 0;
  }

  /**
   * Initialize the DataContext for a given table.
   * Safe to call multiple times; subsequent calls will await the first.
   */
  async init(tableName = 'otef') {
    if (this._initialized && this._tableName === tableName) {
      return;
    }
    if (this._initializingPromise) {
      return this._initializingPromise;
    }

    this._initializingPromise = this._doInit(tableName);
    return this._initializingPromise;
  }

  async _doInit(tableName) {
    this._tableName = tableName;

    try {
      // Fetch initial state from API
      const state = await OTEF_API.getState(this._tableName);
      this._applyStateFromApi(state, { notify: false });

      // Set up WebSocket
      this._setupWebSocket();

      this._initialized = true;
    } finally {
      this._initializingPromise = null;
    }
  }

  _setupWebSocket() {
    if (this._wsClient) {
      return;
    }

    this._wsClient = new OTEFWebSocketClient(`/ws/${this._tableName}/`, {
      onConnect: () => {
        this._setConnection(true);
      },
      onDisconnect: () => {
        this._setConnection(false);
      },
      onError: () => {
        this._setConnection(false);
      },
    });

    // Listen for notifications and re-sync from API
    this._wsClient.on(OTEF_MESSAGE_TYPES.VIEWPORT_CHANGED, async (msg) => {
      try {
        // Feedback guard: Ignore updates from ourselves
        if (msg && msg.sourceId === this._clientId) {
          return;
        }

        // Timestamp guard: Ignore stale updates
        if (msg && msg.timestamp && msg.timestamp < this._lastLocalStateTimestamp - 200) {
          return;
        }

        // Optimization: Use viewport data directly from message if available
        if (msg && msg.viewport) {
           this._setViewport(msg.viewport);
           return;
        }

        // Fallback: full re-fetch
        const state = await OTEF_API.getState(this._tableName);
        if (state.viewport) {
          this._setViewport(state.viewport);
        }
      } catch (err) {
        console.error('[OTEFDataContext] Failed to refresh viewport after VIEWPORT_CHANGED:', err);
      }
    });

    this._wsClient.on(OTEF_MESSAGE_TYPES.VELOCITY_SYNC, (msg) => {
      this._velocity = { vx: msg.vx || 0, vy: msg.vy || 0 };
      this._lastVelocityUpdate = Date.now();
      if (this._velocity.vx !== 0 || this._velocity.vy !== 0) {
        this._startVelocityLoop();
      }
    });

    this._wsClient.on(OTEF_MESSAGE_TYPES.LAYERS_CHANGED, async () => {
      try {
        const state = await OTEF_API.getState(this._tableName);
        if (state.layers) {
          this._setLayers(state.layers);
        }
        if (state.layerGroups) {
          this._setLayerGroups(state.layerGroups);
        }
      } catch (err) {
        console.error('[OTEFDataContext] Failed to refresh layers after LAYERS_CHANGED:', err);
      }
    });

    this._wsClient.on(OTEF_MESSAGE_TYPES.ANIMATION_CHANGED, async (msg) => {
      try {
        // If server includes full animations state in DB, just re-fetch
        const state = await OTEF_API.getState(this._tableName);
        if (state.animations) {
          this._setAnimations(state.animations);
        } else if (msg && msg.layerId && typeof msg.enabled === 'boolean') {
          // Fallback: update single layer in local cache
          const next = Object.assign({}, this._animations || {});
          next[msg.layerId] = msg.enabled;
          this._setAnimations(next);
        }
      } catch (err) {
        console.error('[OTEFDataContext] Failed to refresh animations after ANIMATION_CHANGED:', err);
      }
    });

    // Bounds polygon changed (e.g. via another client or backend-side update)
    this._wsClient.on(OTEF_MESSAGE_TYPES.BOUNDS_CHANGED, async () => {
      try {
        const state = await OTEF_API.getState(this._tableName);
        if (state.bounds_polygon || state.bounds) {
          this._setBounds(state.bounds_polygon || state.bounds);
        }
      } catch (err) {
        console.error('[OTEFDataContext] Failed to refresh bounds after BOUNDS_CHANGED:', err);
      }
    });

    this._wsClient.connect();
  }

  _applyStateFromApi(state, { notify } = { notify: true }) {
    if (!state || typeof state !== 'object') return;

    if (state.viewport) {
      this._viewport = state.viewport;
      if (notify) this._notify('viewport', this._viewport);
    }
    if (state.layers) {
      this._layers = state.layers;
      if (notify) this._notify('layers', this._layers);
    }
    if (state.layerGroups) {
      this._layerGroups = state.layerGroups;
      if (notify) this._notify('layerGroups', this._layerGroups);
    }
    if (state.animations) {
      this._animations = state.animations;
      if (notify) this._notify('animations', this._animations);
    }
    if (state.bounds_polygon || state.bounds) {
      // Future: standardize on bounds_polygon from backend
      this._bounds = state.bounds_polygon || state.bounds;
      if (notify) this._notify('bounds', this._bounds);
    }
  }

  _setConnection(isConnected) {
    if (this._isConnected === isConnected) return;
    this._isConnected = isConnected;
    this._notify('connection', this._isConnected);
  }

  _setViewport(viewport) {
    this._viewport = viewport;
    this._notify('viewport', this._viewport);
  }

  _setLayers(layers) {
    this._layers = layers;
    this._notify('layers', this._layers);
  }

  _setLayerGroups(layerGroups) {
    this._layerGroups = layerGroups;
    this._notify('layerGroups', this._layerGroups);
  }

  _setAnimations(animations) {
    this._animations = animations;
    this._notify('animations', this._animations);
  }

  _setBounds(bounds) {
    this._bounds = bounds;
    this._notify('bounds', this._bounds);
  }

  _notify(key, value) {
    const subs = this._subscribers[key];
    if (!subs || subs.size === 0) return;
    subs.forEach((cb) => {
      try {
        cb(value);
      } catch (err) {
        console.error(`[OTEFDataContext] Error in ${key} subscriber:`, err);
      }
    });
  }

  // Public API: getters
  getViewport() {
    return this._viewport;
  }

  getLayers() {
    return this._layers;
  }

  getLayerGroups() {
    return this._layerGroups;
  }

  getAnimations() {
    return this._animations;
  }

  getBounds() {
    return this._bounds;
  }

  isConnected() {
    return this._isConnected;
  }

  /**
   * Persist new bounds polygon (hard-wall navigation limits).
   * Optimistically updates local state, then calls backend to:
   * - store bounds_polygon in DB
   * - mirror polygon into model-bounds.json on disk
   *
   * @param {Array<{x:number,y:number}>} polygon
   */
  async saveBounds(polygon) {
    if (!Array.isArray(polygon) || polygon.length < 3) {
      console.warn('[OTEFDataContext] saveBounds called with invalid polygon');
      return { ok: false, error: 'Invalid polygon' };
    }

    const previous = this._bounds;
    this._setBounds(polygon);

    try {
      const result = await OTEF_API.saveBounds(this._tableName, polygon);
      // Backend is source of truth; if it returns a normalized polygon, adopt it
      if (result && (result.bounds_polygon || result.polygon)) {
        this._setBounds(result.bounds_polygon || result.polygon);
      }
      return { ok: true, result };
    } catch (err) {
      console.error('[OTEFDataContext] Failed to save bounds:', err);
      // Revert on failure
      this._setBounds(previous || null);
      return { ok: false, error: err };
    }
  }

  /**
   * Pan the viewport in a given direction with optional delta.
   * Applies hard-wall bounds check before sending the command.
   *
   * @param {string} direction - 'north', 'south', 'east', 'west', 'northeast', etc.
   * @param {number} [delta=0.15] - Fraction of viewport size to pan
   */
  async pan(direction, delta = 0.15) {
    if (!this._tableName || !this._isConnected) return;
    if (!direction) return;

    const currentViewport = this._viewport;
    let candidateViewport = null;
    if (currentViewport && currentViewport.bbox && currentViewport.bbox.length === 4) {
      candidateViewport = this._computePanViewport(currentViewport, direction, delta);
    }

    const insideBounds = !candidateViewport || this._isViewportInsideBounds(candidateViewport);

    if (candidateViewport && !insideBounds) {
      console.log('[OTEFDataContext] Pan blocked by bounds polygon');
      return;
    }

    try {
      this._currentInteractionSource = 'remote';
      this._lastLocalStateTimestamp = Date.now();
      await OTEF_API.executeCommand(this._tableName, {
        action: 'pan',
        direction,
        delta,
        sourceId: this._clientId,
        timestamp: this._lastLocalStateTimestamp,
        // Pass current bbox to prevent snapback to stale DB state
        base_viewport: this._viewport
      });
    } catch (err) {
      console.error('[OTEFDataContext] Pan command failed:', err);
    } finally {
      this._currentInteractionSource = null;
    }
  }

  /**
   * Send a velocity update for continuous movement.
   *
   * @param {number} vx - X velocity (ITM units/sec)
   * @param {number} vy - Y velocity (ITM units/sec)
   */
  sendVelocity(vx, vy) {
    if (!this._tableName || !this._wsClient || !this._wsClient.getConnected()) return;

    const wasMoving = (this._velocity && (this._velocity.vx !== 0 || this._velocity.vy !== 0));
    this._velocity = { vx, vy };
    const isMoving = (vx !== 0 || vy !== 0);

    if (isMoving && !wasMoving) {
      this._lastVelocityUpdate = Date.now();
      this._startVelocityLoop();
    }
    this._lastLocalStateTimestamp = Date.now();

    try {
      this._wsClient.send({
        type: OTEF_MESSAGE_TYPES.VELOCITY_UPDATE,
        vx,
        vy,
        sourceId: this._clientId,
        timestamp: this._lastLocalStateTimestamp
      });
    } catch (err) {
      console.error('[OTEFDataContext] Velocity update failed:', err);
    }
  }

  _startVelocityLoop() {
    if (this._velocityLoopActive) return;
    this._velocityLoopActive = true;

    const step = () => {
      if (!this._velocity || (this._velocity.vx === 0 && this._velocity.vy === 0)) {
        this._velocityLoopActive = false;
        return;
      }

      const now = Date.now();
      const dt = Math.min(0.1, (now - this._lastVelocityUpdate) / 1000); // Cap dt at 100ms
      this._lastVelocityUpdate = now;

      if (this._viewport && this._viewport.bbox) {
        const [minX, minY, maxX, maxY] = this._viewport.bbox;
        const dx = this._velocity.vx * dt;
        const dy = this._velocity.vy * dt;

        // Log movement for debugging
        if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
           // console.log(`[OTEFDataContext] Moving: dx=${dx.toFixed(3)}, dy=${dy.toFixed(3)}`);
        }

        let finalDx = dx;
        let finalDy = dy;
        let canMove = false;

        // Multi-pass bounds check to allow "sliding" along edges
        // 1. Try moving on both axes
        const fullBbox = [minX + dx, minY + dy, maxX + dx, maxY + dy];
        if (this._isViewportInsideBounds({ ...this._viewport, bbox: fullBbox })) {
          canMove = true;
        } else {
          // 2. Try moving ONLY on X axis (slide along North/South bounds)
          const xOnlyBbox = [minX + dx, minY, maxX + dx, maxY];
          if (this._isViewportInsideBounds({ ...this._viewport, bbox: xOnlyBbox })) {
            finalDy = 0;
            canMove = true;
          } else {
            // 3. Try moving ONLY on Y axis (slide along East/West bounds)
            const yOnlyBbox = [minX, minY + dy, maxX, maxY + dy];
            if (this._isViewportInsideBounds({ ...this._viewport, bbox: yOnlyBbox })) {
              finalDx = 0;
              canMove = true;
            }
          }
        }

        if (canMove) {
          const finalBbox = [minX + finalDx, minY + finalDy, maxX + finalDx, maxY + finalDy];
          const finalViewport = {
            ...this._viewport,
            bbox: finalBbox,
            corners: {
              sw: { x: finalBbox[0], y: finalBbox[1] },
              se: { x: finalBbox[2], y: finalBbox[1] },
              nw: { x: finalBbox[0], y: finalBbox[3] },
              ne: { x: finalBbox[2], y: finalBbox[3] },
            }
          };
          this._setViewport(finalViewport);
        } else {
          // Both axes blocked or no movement possible
          this._velocity = { vx: 0, vy: 0 };
          this._velocityLoopActive = false;
          return;
        }
      }

      requestAnimationFrame(step);
    };

    requestAnimationFrame(step);
  }

  /**
   * Zoom the viewport to a target level.
   * Applies hard-wall bounds check before sending the command.
   *
   * @param {number} newZoom - Target zoom level
   */
  async zoom(newZoom) {
    if (!this._tableName || !this._isConnected) return;
    if (typeof newZoom !== 'number') return;

    // Clamp to reasonable range (kept in sync with remote UI)
    const clampedZoom = Math.max(10, Math.min(19, newZoom));

    const currentViewport = this._viewport;
    let candidateViewport = null;
    if (currentViewport && currentViewport.bbox && currentViewport.bbox.length === 4) {
      candidateViewport = this._computeZoomViewport(currentViewport, clampedZoom);
    }

    if (candidateViewport && !this._isViewportInsideBounds(candidateViewport)) {
      console.log('[OTEFDataContext] Zoom blocked by bounds polygon');
      return;
    }

    try {
      this._currentInteractionSource = 'remote';
      this._lastLocalStateTimestamp = Date.now();
      await OTEF_API.executeCommand(this._tableName, {
        action: 'zoom',
        level: clampedZoom,
        sourceId: this._clientId,
        timestamp: this._lastLocalStateTimestamp,
        // Pass current bbox to prevent snapback to stale DB state
        base_viewport: this._viewport
      });
    } catch (err) {
      console.error('[OTEFDataContext] Zoom command failed:', err);
    } finally {
      this._currentInteractionSource = null;
    }
  }

  /**
   * Update viewport from a UI source (e.g. GIS map).
   * This is the main entry point for continuous panning/zooming.
   * Applies hard-wall bounds check and debounces the backend write.
   *
   * @param {Object} viewport - { bbox: [minX,minY,maxX,maxY], corners?, zoom? }
   * @param {string} [source] - Optional interaction source label, e.g. 'gis'
   */
  updateViewportFromUI(viewport, source = 'gis') {
    if (!this._tableName || !viewport || !viewport.bbox || viewport.bbox.length !== 4) {
      return false;
    }

    const insideBounds = this._isViewportInsideBounds(viewport);

    // Feedback guard: Ignore GIS updates while the Remote is actively moving us via velocity
    // This stops the GIS Map (follower) from fighting the Remote (master)
    if (source === 'gis' && (this._velocityLoopActive || this._currentInteractionSource === 'remote')) {
      return { accepted: false, reason: 'interaction_guard' };
    }

    if (!insideBounds) {
      console.log('[OTEFDataContext] Viewport update blocked by bounds polygon');
      return { accepted: false, reason: 'bounds' };
    }

    this._currentInteractionSource = source;

    // For GIS updates, don't optimistically update - let backend be source of truth
    // This prevents feedback loops where GIS sends update A, but then receives
    // conflicting update B from a previous pan command, causing rubber-banding.
    // The backend will respond quickly via WebSocket, so the delay is minimal.

    // Delegate actual write/debounce behavior to API client
    try {
      const payload = { ...viewport, sourceId: this._clientId, timestamp: Date.now() };
      if (typeof OTEF_API.updateViewportDebounced === 'function') {
        OTEF_API.updateViewportDebounced(this._tableName, payload);
      } else {
        OTEF_API.updateViewport(this._tableName, payload);
      }
      return { accepted: true };
    } catch (err) {
      console.error('[OTEFDataContext] Failed to send viewport update:', err);
    } finally {
      this._currentInteractionSource = null;
    }

    return true;
  }

  /**
   * Toggle a layer's visibility with optimistic update and rollback on error.
   * Supports both legacy flat structure and new hierarchical structure.
   *
   * @param {string} layerId - Full layer ID (e.g., "map_3_future.mimushim") or legacy ID
   * @param {boolean} enabled
   */
  async toggleLayer(layerId, enabled) {
    if (!this._tableName || !layerId) return { ok: false, error: 'Missing layerId' };

    // Legacy layers (model, roads, parcels, majorRoads, smallRoads) always use legacy structure
    // even if layerGroups exist, because they're not part of the hierarchical system
    const legacyLayerIds = ['model', 'roads', 'parcels', 'majorRoads', 'smallRoads'];
    if (legacyLayerIds.includes(layerId)) {
      const previous = this._layers || {};
      const next = Object.assign({}, previous, { [layerId]: !!enabled });
      this._setLayers(next);

      try {
        await OTEF_API.updateLayers(this._tableName, next);
        return { ok: true };
      } catch (err) {
        console.error('[OTEFDataContext] Failed to update layers:', err);
        this._setLayers(previous);
        return { ok: false, error: err };
      }
    }

    // Try new hierarchical structure for registry layers
    if (this._layerGroups) {
      return this._toggleLayerInGroups(layerId, enabled);
    }

    // Fallback to legacy flat structure for unknown layers
    const previous = this._layers || {};
    const next = Object.assign({}, previous, { [layerId]: !!enabled });
    this._setLayers(next);

    try {
      await OTEF_API.updateLayers(this._tableName, next);
      return { ok: true };
    } catch (err) {
      console.error('[OTEFDataContext] Failed to update layers:', err);
      this._setLayers(previous);
      return { ok: false, error: err };
    }
  }

  /**
   * Toggle a layer within the hierarchical groups structure.
   */
  async _toggleLayerInGroups(layerId, enabled) {
    const previous = JSON.parse(JSON.stringify(this._layerGroups || []));
    const next = previous.map(group => {
      const layers = group.layers.map(layer => {
        const fullId = `${group.id}.${layer.id}`;
        if (fullId === layerId) {
          return { ...layer, enabled: !!enabled };
        }
        return layer;
      });
      return { ...group, layers };
    });

    this._setLayerGroups(next);

    try {
      await OTEF_API.updateLayerGroups(this._tableName, next);
      return { ok: true };
    } catch (err) {
      console.error('[OTEFDataContext] Failed to update layer groups:', err);
      this._setLayerGroups(previous);
      return { ok: false, error: err };
    }
  }

  /**
   * Toggle an entire group on/off.
   *
   * @param {string} groupId - Group ID (e.g., "map_3_future")
   * @param {boolean} enabled
   */
  async toggleGroup(groupId, enabled) {
    if (!this._tableName || !groupId) {
      return { ok: false, error: 'Missing groupId' };
    }

    if (!this._layerGroups) {
      return { ok: false, error: 'Layer groups not available' };
    }

    const previous = JSON.parse(JSON.stringify(this._layerGroups || []));
    const next = previous.map(group => {
      if (group.id === groupId) {
        // Toggle all layers in the group
        const layers = group.layers.map(layer => ({ ...layer, enabled: !!enabled }));
        return { ...group, enabled: !!enabled, layers };
      }
      return group;
    });

    this._setLayerGroups(next);

    try {
      await OTEF_API.updateLayerGroups(this._tableName, next);
      return { ok: true };
    } catch (err) {
      console.error('[OTEFDataContext] Failed to update layer groups:', err);
      this._setLayerGroups(previous);
      return { ok: false, error: err };
    }
  }

  /**
   * Toggle an animation flag (e.g. parcels) with optimistic update.
   *
   * @param {string} layerId
   * @param {boolean} enabled
   */
  async toggleAnimation(layerId, enabled) {
    if (!this._tableName || !layerId) return { ok: false, error: 'Missing layerId' };

    const previous = this._animations || {};
    const next = Object.assign({}, previous, { [layerId]: !!enabled });
    this._setAnimations(next);

    try {
      await OTEF_API.updateAnimations(this._tableName, next);
      return { ok: true };
    } catch (err) {
      console.error('[OTEFDataContext] Failed to update animations:', err);
      this._setAnimations(previous);
      return { ok: false, error: err };
    }
  }

  /**
   * Compute candidate viewport for a pan command, mirroring backend logic.
   *
   * @param {Object} viewport - Current viewport
   * @param {string} direction
   * @param {number} delta
   * @returns {Object} candidate viewport
   */
  _computePanViewport(viewport, direction, delta) {
    const bbox = viewport && viewport.bbox;
    if (!bbox || bbox.length !== 4) return viewport;

    const [minX, minY, maxX, maxY] = bbox;
    const width = maxX - minX;
    const height = maxY - minY;

    let dx = 0;
    let dy = 0;

    if (direction.indexOf('north') !== -1) {
      dy = height * delta;
    }
    if (direction.indexOf('south') !== -1) {
      dy = -height * delta;
    }
    if (direction.indexOf('east') !== -1) {
      dx = width * delta;
    }
    if (direction.indexOf('west') !== -1) {
      dx = -width * delta;
    }

    const newBbox = [minX + dx, minY + dy, maxX + dx, maxY + dy];

    return {
      ...viewport,
      bbox: newBbox,
      corners: {
        sw: { x: newBbox[0], y: newBbox[1] },
        se: { x: newBbox[2], y: newBbox[1] },
        nw: { x: newBbox[0], y: newBbox[3] },
        ne: { x: newBbox[2], y: newBbox[3] },
      },
    };
  }

  /**
   * Compute candidate viewport for a zoom command, mirroring backend logic.
   *
   * @param {Object} viewport - Current viewport
   * @param {number} newZoom
   * @returns {Object} candidate viewport
   */
  _computeZoomViewport(viewport, newZoom) {
    const bbox = viewport && viewport.bbox;
    const currentZoom = (viewport && viewport.zoom) || 15;

    if (!bbox || bbox.length !== 4) {
      return {
        ...viewport,
        zoom: newZoom,
      };
    }

    const [minX, minY, maxX, maxY] = bbox;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const zoomDiff = newZoom - currentZoom;
    const scaleFactor = Math.pow(2, -zoomDiff);

    const halfWidth = (maxX - minX) / 2 * scaleFactor;
    const halfHeight = (maxY - minY) / 2 * scaleFactor;

    const newBbox = [
      centerX - halfWidth,
      centerY - halfHeight,
      centerX + halfWidth,
      centerY + halfHeight,
    ];

    return {
      ...viewport,
      bbox: newBbox,
      zoom: newZoom,
      corners: {
        sw: { x: newBbox[0], y: newBbox[1] },
        se: { x: newBbox[2], y: newBbox[1] },
        nw: { x: newBbox[0], y: newBbox[3] },
        ne: { x: newBbox[2], y: newBbox[3] },
      },
    };
  }

  /**
   * Check whether a viewport is inside the current bounds polygon.
   *
   * Updated semantics (UX-driven):
   * - We only require the **viewport center** to be inside the bounds polygon.
   * - The highlight edges are allowed to extend beyond the polygon,
   *   which makes high-zoom movement much less restricted while still
   *   enforcing a hard wall on how far the user can "travel".
   *
   * If no bounds are defined, always returns true.
   *
   * @param {Object} viewport - { bbox: [minX,minY,maxX,maxY], corners? }
   * @returns {boolean}
   */
  _isViewportInsideBounds(viewport) {
    const polygon = this._bounds;
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

    return this._pointInPolygon({ x: centerX, y: centerY }, polygon);
  }

  /**
   * Standard ray-casting point-in-polygon test.
   * Treats points on the edge as inside.
   *
   * @param {{x:number,y:number}} point
   * @param {Array<{x:number,y:number}>} polygon
   * @returns {boolean}
   */
  _pointInPolygon(point, polygon) {
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

  /**
   * Subscribe to a slice of state.
   * Immediately calls the callback with the current value (if any).
   */
  subscribe(key, callback) {
    const subs = this._subscribers[key];
    if (!subs) {
      console.warn('[OTEFDataContext] Unknown subscription key:', key);
      return () => {};
    }

    subs.add(callback);

    // Replay current value
    let current = null;
    switch (key) {
      case 'viewport':
        current = this._viewport;
        break;
      case 'layers':
        current = this._layers;
        break;
      case 'layerGroups':
        current = this._layerGroups;
        break;
      case 'animations':
        current = this._animations;
        break;
      case 'bounds':
        current = this._bounds;
        break;
      case 'connection':
        current = this._isConnected;
        break;
    }
    if (current !== null && current !== undefined) {
      try {
        callback(current);
      } catch (err) {
        console.error('[OTEFDataContext] Error in initial callback for', key, err);
      }
    }

    // Return unsubscribe function
    return () => {
      subs.delete(callback);
    };
  }

  unsubscribe(key, callback) {
    const subs = this._subscribers[key];
    if (!subs) return;
    subs.delete(callback);
  }
}

// Singleton instance
const OTEFDataContext = new OTEFDataContextClass();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = OTEFDataContext;
}

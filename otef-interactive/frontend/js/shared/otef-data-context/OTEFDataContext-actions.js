// OTEFDataContext actions
// Movement, layer toggles, animations, and helpers

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

  async function pan(ctx, direction, delta = 0.15) {
    if (!ctx._tableName || !ctx._isConnected) return;
    if (!direction) return;

    const currentViewport = ctx._viewport;
    let candidateViewport = null;
    if (currentViewport && currentViewport.bbox && currentViewport.bbox.length === 4) {
      candidateViewport = computePanViewport(currentViewport, direction, delta);
    }

    const insideBounds =
      !candidateViewport || ctx._isViewportInsideBounds(candidateViewport);

    if (candidateViewport && !insideBounds) {
      return;
    }

    try {
      ctx._currentInteractionSource = "remote";
      ctx._lastLocalStateTimestamp = Date.now();
      await OTEF_API.executeCommand(ctx._tableName, {
        action: "pan",
        direction,
        delta,
        sourceId: ctx._clientId,
        timestamp: ctx._lastLocalStateTimestamp,
        // Pass current bbox to prevent snapback to stale DB state
        base_viewport: ctx._viewport,
      });
    } catch (err) {
      getLogger().error("[OTEFDataContext] Pan command failed:", err);
    } finally {
      ctx._currentInteractionSource = null;
    }
  }

  function sendVelocity(ctx, vx, vy) {
    if (!ctx._tableName || !ctx._wsClient || !ctx._wsClient.getConnected()) return;

    const wasMoving =
      ctx._velocity && (ctx._velocity.vx !== 0 || ctx._velocity.vy !== 0);
    ctx._velocity = { vx, vy };
    const isMoving = vx !== 0 || vy !== 0;

    if (isMoving && !wasMoving) {
      ctx._lastVelocityUpdate = Date.now();
      startVelocityLoop(ctx);
    }
    ctx._lastLocalStateTimestamp = Date.now();

    try {
      ctx._wsClient.send({
        type: OTEF_MESSAGE_TYPES.VELOCITY_UPDATE,
        vx,
        vy,
        sourceId: ctx._clientId,
        timestamp: ctx._lastLocalStateTimestamp,
      });
    } catch (err) {
      getLogger().error("[OTEFDataContext] Velocity update failed:", err);
    }
  }

  function startVelocityLoop(ctx) {
    if (ctx._velocityLoopActive) return;
    ctx._velocityLoopActive = true;

    const step = () => {
      if (!ctx._velocity || (ctx._velocity.vx === 0 && ctx._velocity.vy === 0)) {
        ctx._velocityLoopActive = false;
        return;
      }

      const now = Date.now();
      const dt = Math.min(0.1, (now - ctx._lastVelocityUpdate) / 1000); // Cap dt at 100ms
      ctx._lastVelocityUpdate = now;

      if (ctx._viewport && ctx._viewport.bbox) {
        const [minX, minY, maxX, maxY] = ctx._viewport.bbox;
        const dx = ctx._velocity.vx * dt;
        const dy = ctx._velocity.vy * dt;

        let finalDx = dx;
        let finalDy = dy;
        let canMove = false;

        // Multi-pass bounds check to allow "sliding" along edges
        // 1. Try moving on both axes
        const fullBbox = [minX + dx, minY + dy, maxX + dx, maxY + dy];
        if (ctx._isViewportInsideBounds({ ...ctx._viewport, bbox: fullBbox })) {
          canMove = true;
        } else {
          // 2. Try moving ONLY on X axis (slide along North/South bounds)
          const xOnlyBbox = [minX + dx, minY, maxX + dx, maxY];
          if (ctx._isViewportInsideBounds({ ...ctx._viewport, bbox: xOnlyBbox })) {
            finalDy = 0;
            canMove = true;
          } else {
            // 3. Try moving ONLY on Y axis (slide along East/West bounds)
            const yOnlyBbox = [minX, minY + dy, maxX, maxY + dy];
            if (ctx._isViewportInsideBounds({ ...ctx._viewport, bbox: yOnlyBbox })) {
              finalDx = 0;
              canMove = true;
            }
          }
        }

        if (canMove) {
          const finalBbox = [
            minX + finalDx,
            minY + finalDy,
            maxX + finalDx,
            maxY + finalDy,
          ];
          const finalViewport = {
            ...ctx._viewport,
            bbox: finalBbox,
            corners: {
              sw: { x: finalBbox[0], y: finalBbox[1] },
              se: { x: finalBbox[2], y: finalBbox[1] },
              nw: { x: finalBbox[0], y: finalBbox[3] },
              ne: { x: finalBbox[2], y: finalBbox[3] },
            },
          };
          ctx._setViewport(finalViewport);
        } else {
          // Both axes blocked or no movement possible
          ctx._velocity = { vx: 0, vy: 0 };
          ctx._velocityLoopActive = false;
          return;
        }
      }

      requestAnimationFrame(step);
    };

    requestAnimationFrame(step);
  }

  async function zoom(ctx, newZoom) {
    if (!ctx._tableName || !ctx._isConnected) return;
    if (typeof newZoom !== "number") return;

    // Clamp to reasonable range (kept in sync with remote UI)
    const clampedZoom = Math.max(10, Math.min(19, newZoom));

    const currentViewport = ctx._viewport;
    let candidateViewport = null;
    if (currentViewport && currentViewport.bbox && currentViewport.bbox.length === 4) {
      candidateViewport = computeZoomViewport(currentViewport, clampedZoom);
    }

    if (candidateViewport && !ctx._isViewportInsideBounds(candidateViewport)) {
      return;
    }

    try {
      ctx._currentInteractionSource = "remote";
      ctx._lastLocalStateTimestamp = Date.now();
      await OTEF_API.executeCommand(ctx._tableName, {
        action: "zoom",
        level: clampedZoom,
        sourceId: ctx._clientId,
        timestamp: ctx._lastLocalStateTimestamp,
        // Pass current bbox to prevent snapback to stale DB state
        base_viewport: ctx._viewport,
      });
    } catch (err) {
      getLogger().error("[OTEFDataContext] Zoom command failed:", err);
    } finally {
      ctx._currentInteractionSource = null;
    }
  }

  function updateViewportFromUI(ctx, viewport, source = "gis") {
    if (!ctx._tableName || !viewport || !viewport.bbox || viewport.bbox.length !== 4) {
      return false;
    }

    const insideBounds = ctx._isViewportInsideBounds(viewport);

    // Feedback guard: Ignore GIS updates while the Remote is actively moving us via velocity
    // This stops the GIS Map (follower) from fighting the Remote (master)
    if (
      source === "gis" &&
      (ctx._velocityLoopActive || ctx._currentInteractionSource === "remote")
    ) {
      return { accepted: false, reason: "interaction_guard" };
    }

    if (!insideBounds) {
      return { accepted: false, reason: "bounds" };
    }

    ctx._currentInteractionSource = source;

    // Delegate actual write/debounce behavior to API client
    try {
      const payload = { ...viewport, sourceId: ctx._clientId, timestamp: Date.now() };
      if (typeof OTEF_API.updateViewportDebounced === "function") {
        OTEF_API.updateViewportDebounced(ctx._tableName, payload);
      } else {
        OTEF_API.updateViewport(ctx._tableName, payload);
      }
      return { accepted: true };
    } catch (err) {
      getLogger().error("[OTEFDataContext] Failed to send viewport update:", err);
    } finally {
      ctx._currentInteractionSource = null;
    }

    return true;
  }

  async function toggleLayer(ctx, layerId, enabled) {
    if (!ctx._tableName || !layerId) {
      return { ok: false, error: "Missing layerId" };
    }

    // Legacy: model base only
    const legacyLayerIds = ["model"];
    if (legacyLayerIds.includes(layerId)) {
      const previous = ctx._layers || {};
      const next = Object.assign({}, previous, { [layerId]: !!enabled });
      ctx._setLayers(next);

      try {
        await OTEF_API.updateLayers(ctx._tableName, next);
        return { ok: true };
      } catch (err) {
        getLogger().error("[OTEFDataContext] Failed to update layers:", err);
        ctx._setLayers(previous);
        return { ok: false, error: err };
      }
    }

    // Try new hierarchical structure for registry layers
    if (ctx._layerGroups) {
      return toggleLayerInGroups(ctx, layerId, enabled);
    }

    // Fallback to legacy flat structure for unknown layers
    const previous = ctx._layers || {};
    const next = Object.assign({}, previous, { [layerId]: !!enabled });
    ctx._setLayers(next);

    try {
      await OTEF_API.updateLayers(ctx._tableName, next);
      return { ok: true };
    } catch (err) {
      getLogger().error("[OTEFDataContext] Failed to update layers:", err);
      ctx._setLayers(previous);
      return { ok: false, error: err };
    }
  }

  async function toggleLayerInGroups(ctx, layerId, enabled) {
    const previous = JSON.parse(JSON.stringify(ctx._layerGroups || []));
    const next = previous.map((group) => {
      const layers = group.layers.map((layer) => {
        const fullId = `${group.id}.${layer.id}`;
        if (fullId === layerId) {
          return { ...layer, enabled: !!enabled };
        }
        return layer;
      });
      return { ...group, layers };
    });

    ctx._setLayerGroups(next);

    try {
      await OTEF_API.updateLayerGroups(ctx._tableName, next);
      return { ok: true };
    } catch (err) {
      getLogger().error("[OTEFDataContext] Failed to update layer groups:", err);
      ctx._setLayerGroups(previous);
      return { ok: false, error: err };
    }
  }

  async function toggleGroup(ctx, groupId, enabled) {
    if (!ctx._tableName || !groupId) {
      return { ok: false, error: "Missing groupId" };
    }

    if (!ctx._layerGroups) {
      return { ok: false, error: "Layer groups not available" };
    }

    const previous = JSON.parse(JSON.stringify(ctx._layerGroups || []));
    const next = previous.map((group) => {
      if (group.id === groupId) {
        // Toggle all layers in the group
        const layers = group.layers.map((layer) => ({ ...layer, enabled: !!enabled }));
        return { ...group, enabled: !!enabled, layers };
      }
      return group;
    });

    ctx._setLayerGroups(next);

    try {
      await OTEF_API.updateLayerGroups(ctx._tableName, next);
      return { ok: true };
    } catch (err) {
      getLogger().error("[OTEFDataContext] Failed to update layer groups:", err);
      ctx._setLayerGroups(previous);
      return { ok: false, error: err };
    }
  }

  async function toggleAnimation(ctx, layerId, enabled) {
    if (!ctx._tableName || !layerId) {
      return { ok: false, error: "Missing layerId" };
    }

    const previous = ctx._animations || {};
    const next = Object.assign({}, previous, { [layerId]: !!enabled });
    ctx._setAnimations(next);

    try {
      await OTEF_API.updateAnimations(ctx._tableName, next);
      return { ok: true };
    } catch (err) {
      getLogger().error("[OTEFDataContext] Failed to update animations:", err);
      ctx._setAnimations(previous);
      return { ok: false, error: err };
    }
  }

  function understandDirection(direction, delta, width, height) {
    let dx = 0;
    let dy = 0;

    if (direction.indexOf("north") !== -1) {
      dy = height * delta;
    }
    if (direction.indexOf("south") !== -1) {
      dy = -height * delta;
    }
    if (direction.indexOf("east") !== -1) {
      dx = width * delta;
    }
    if (direction.indexOf("west") !== -1) {
      dx = -width * delta;
    }

    return { dx, dy };
  }

  function computePanViewport(viewport, direction, delta) {
    const bbox = viewport && viewport.bbox;
    if (!bbox || bbox.length !== 4) return viewport;

    const [minX, minY, maxX, maxY] = bbox;
    const width = maxX - minX;
    const height = maxY - minY;

    const { dx, dy } = understandDirection(direction, delta, width, height);
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

  function computeZoomViewport(viewport, newZoom) {
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

    const halfWidth = ((maxX - minX) / 2) * scaleFactor;
    const halfHeight = ((maxY - minY) / 2) * scaleFactor;

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

  internals.actions = {
    pan,
    sendVelocity,
    startVelocityLoop,
    zoom,
    updateViewportFromUI,
    toggleLayer,
    toggleLayerInGroups,
    toggleGroup,
    toggleAnimation,
    computePanViewport,
    computeZoomViewport,
  };
})();

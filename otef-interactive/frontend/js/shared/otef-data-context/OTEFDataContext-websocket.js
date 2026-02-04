// OTEFDataContext websocket and state sync helpers

(function () {
  const internals = window.OTEFDataContextInternals || {};
  const getLogger =
    internals.getLogger ||
    function () {
      return {
        debug: () => {},
        info: () => {},
        warn: console.warn.bind(console),
        error: console.error.bind(console),
      };
    };

  function applyStateFromApi(ctx, state, { notify } = { notify: true }) {
    if (!state || typeof state !== "object") return;

    if (state.viewport) {
      ctx._viewport = state.viewport;
      if (notify) ctx._notify("viewport", ctx._viewport);
    }
    if (state.layerGroups) {
      ctx._layerGroups = state.layerGroups;
      if (notify) ctx._notify("layerGroups", ctx._layerGroups);
    }
    if (state.animations) {
      ctx._animations = state.animations;
      if (notify) ctx._notify("animations", ctx._animations);
    }
    if (state.bounds_polygon || state.bounds) {
      ctx._bounds = state.bounds_polygon || state.bounds;
      if (notify) ctx._notify("bounds", ctx._bounds);
    }
  }

  function setupWebSocket(ctx) {
    if (ctx._wsClient) {
      return;
    }

    ctx._wsClient = new OTEFWebSocketClient(`/ws/${ctx._tableName}/`, {
      onConnect: () => {
        ctx._setConnection(true);
      },
      onDisconnect: () => {
        ctx._setConnection(false);
      },
      onError: () => {
        ctx._setConnection(false);
      },
    });

    // Listen for notifications and re-sync from API
    ctx._wsClient.on(OTEF_MESSAGE_TYPES.VIEWPORT_CHANGED, async (msg) => {
      try {
        // Feedback guard: Ignore updates from ourselves
        if (msg && msg.sourceId === ctx._clientId) {
          return;
        }

        // Timestamp guard: Ignore stale updates
        if (
          msg &&
          msg.timestamp &&
          msg.timestamp < ctx._lastLocalStateTimestamp - 200
        ) {
          return;
        }

        // Optimization: Use viewport data directly from message if available
        if (msg && msg.viewport) {
          ctx._setViewport(msg.viewport);
          return;
        }

        // Fallback: full re-fetch
        const state = await OTEF_API.getState(ctx._tableName);
        if (state.viewport) {
          ctx._setViewport(state.viewport);
        }
      } catch (err) {
        getLogger().error(
          "[OTEFDataContext] Failed to refresh viewport after VIEWPORT_CHANGED:",
          err,
        );
      }
    });

    ctx._wsClient.on(OTEF_MESSAGE_TYPES.VELOCITY_SYNC, (msg) => {
      ctx._velocity = { vx: msg.vx || 0, vy: msg.vy || 0 };
      ctx._lastVelocityUpdate = Date.now();
      if (ctx._velocity.vx !== 0 || ctx._velocity.vy !== 0) {
        ctx._startVelocityLoop();
      }
    });

    ctx._wsClient.on(OTEF_MESSAGE_TYPES.LAYERS_CHANGED, async () => {
      try {
        const state = await OTEF_API.getState(ctx._tableName);
        if (state.layerGroups) {
          ctx._setLayerGroups(state.layerGroups);
        }
      } catch (err) {
        getLogger().error(
          "[OTEFDataContext] Failed to refresh layers after LAYERS_CHANGED:",
          err,
        );
      }
    });

    ctx._wsClient.on(OTEF_MESSAGE_TYPES.ANIMATION_CHANGED, async (msg) => {
      try {
        // If server includes full animations state in DB, just re-fetch
        const state = await OTEF_API.getState(ctx._tableName);
        if (state.animations) {
          ctx._setAnimations(state.animations);
        } else if (msg && msg.layerId && typeof msg.enabled === "boolean") {
          // Fallback: update single layer in local cache
          const next = Object.assign({}, ctx._animations || {});
          next[msg.layerId] = msg.enabled;
          ctx._setAnimations(next);
        }
      } catch (err) {
        getLogger().error(
          "[OTEFDataContext] Failed to refresh animations after ANIMATION_CHANGED:",
          err,
        );
      }
    });

    // Bounds polygon changed (e.g. via another client or backend-side update)
    ctx._wsClient.on(OTEF_MESSAGE_TYPES.BOUNDS_CHANGED, async () => {
      try {
        const state = await OTEF_API.getState(ctx._tableName);
        if (state.bounds_polygon || state.bounds) {
          ctx._setBounds(state.bounds_polygon || state.bounds);
        }
      } catch (err) {
        getLogger().error(
          "[OTEFDataContext] Failed to refresh bounds after BOUNDS_CHANGED:",
          err,
        );
      }
    });

    ctx._wsClient.connect();
  }

  internals.websocket = {
    applyStateFromApi,
    setupWebSocket,
  };
})();

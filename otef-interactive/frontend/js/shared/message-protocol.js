// OTEF Shared Message Protocol
// Defines message types, validation, and factory functions for WebSocket communication

const OTEF_MESSAGE_TYPES = {
  // Commands (sent by clients)
  VIEWPORT_UPDATE: "otef_viewport_update",
  VIEWPORT_CONTROL: "otef_viewport_control",
  VELOCITY_UPDATE: "otef_velocity_update", // New: for continuous movement
  LAYER_UPDATE: "otef_layer_update",
  ANIMATION_TOGGLE: "otef_animation_toggle",

  // Notifications (broadcast by server after DB update or transient event)
  VIEWPORT_CHANGED: "otef_viewport_changed",
  LAYERS_CHANGED: "otef_layers_changed",
  ANIMATION_CHANGED: "otef_animation_changed",
  BOUNDS_CHANGED: "otef_bounds_changed",
  VELOCITY_SYNC: "otef_velocity_sync", // New: sync velocity across clients
};

// Default layer states (legacy: model base only)
const DEFAULT_LAYER_STATES = {
  model: false,
};


/**
 * Validates a message structure
 * @param {Object} msg - Message object to validate
 * @returns {boolean} True if valid
 */
function validateMessage(msg) {
  if (!msg || typeof msg !== "object") return false;
  if (!msg.type || !Object.values(OTEF_MESSAGE_TYPES).includes(msg.type))
    return false;
  return true;
}

/**
 * Validates a VIEWPORT_CONTROL message
 * @param {Object} msg - Message to validate
 * @returns {boolean} True if valid
 */
function validateViewportControl(msg) {
  if (!validateMessage(msg)) return false;
  if (msg.type !== OTEF_MESSAGE_TYPES.VIEWPORT_CONTROL) return false;

  // Must have either pan or zoom
  if (msg.pan && typeof msg.pan === "object") {
    if (
      typeof msg.pan.direction !== "string" ||
      typeof msg.pan.delta !== "number"
    ) {
      return false;
    }
  } else if (typeof msg.zoom === "number") {
    // Zoom is valid
  } else {
    return false;
  }

  return true;
}

/**
 * Validates a LAYER_UPDATE message
 * @param {Object} msg - Message to validate
 * @returns {boolean} True if valid
 */
function validateLayerUpdate(msg) {
  if (!validateMessage(msg)) return false;
  if (msg.type !== OTEF_MESSAGE_TYPES.LAYER_UPDATE) return false;
  if (!msg.layers || typeof msg.layers !== "object") return false;

  const validLayers = ["model"];
  for (const key in msg.layers) {
    if (!validLayers.includes(key)) return false;
    if (typeof msg.layers[key] !== "boolean") return false;
  }

  return true;
}

/**
 * Validates a VIEWPORT_UPDATE message
 * @param {Object} msg - Message to validate
 * @returns {boolean} True if valid
 */
function validateViewportUpdate(msg) {
  if (!validateMessage(msg)) return false;
  if (msg.type !== OTEF_MESSAGE_TYPES.VIEWPORT_UPDATE) return false;

  // Must have bbox or corners
  if (msg.bbox) {
    if (!Array.isArray(msg.bbox) || msg.bbox.length !== 4) return false;
  } else if (msg.corners) {
    if (typeof msg.corners !== "object") return false;
    // Validate corners structure (should have sw, se, nw, ne)
    const requiredCorners = ["sw", "se", "nw", "ne"];
    for (const corner of requiredCorners) {
      if (!msg.corners[corner] || typeof msg.corners[corner].x !== "number" || typeof msg.corners[corner].y !== "number") {
        return false;
      }
    }
  } else {
    return false; // Must have either bbox or corners
  }

  // Zoom is optional but should be a number if present
  if (msg.zoom !== undefined && typeof msg.zoom !== "number") return false;

  return true;
}

/**
 * Message factory: Create VIEWPORT_CONTROL message for panning
 * @param {string} direction - Pan direction: 'north', 'south', 'east', 'west', 'northeast', 'northwest', 'southeast', 'southwest'
 * @param {number} delta - Pan distance percentage (0-1, typically 0.1-0.2)
 * @returns {Object} Message object
 */
function createPanControlMessage(direction, delta = 0.15, sourceId = null) {
  return {
    type: OTEF_MESSAGE_TYPES.VIEWPORT_CONTROL,
    pan: {
      direction: direction,
      delta: delta,
    },
    sourceId: sourceId,
    timestamp: Date.now(),
  };
}

/**
 * Message factory: Create VIEWPORT_CONTROL message for zooming
 * @param {number} zoom - Target zoom level
 * @returns {Object} Message object
 */
function createZoomControlMessage(zoom) {
  return {
    type: OTEF_MESSAGE_TYPES.VIEWPORT_CONTROL,
    zoom: zoom,
    timestamp: Date.now(),
  };
}

/**
 * Message factory: Create LAYER_UPDATE message
 * @param {Object} layers - Layer states object { model: boolean }
 * @returns {Object} Message object
 */
function createLayerUpdateMessage(layers) {
  return {
    type: OTEF_MESSAGE_TYPES.LAYER_UPDATE,
    layers: { ...layers },
    timestamp: Date.now(),
  };
}

/**
 * Message factory: Create VELOCITY_UPDATE message
 * @param {Object} velocity - { vx: number, vy: number } in units/sec
 * @returns {Object} Message object
 */
function createVelocityUpdateMessage(velocity, sourceId = null) {
  return {
    type: OTEF_MESSAGE_TYPES.VELOCITY_UPDATE,
    vx: velocity.vx || 0,
    vy: velocity.vy || 0,
    sourceId: sourceId,
    timestamp: Date.now(),
  };
}

/**
 * Message factory: Create VIEWPORT_UPDATE message
 * @param {Object} viewport - Viewport state { bbox: [minX, minY, maxX, maxY], corners?: object, zoom?: number }
 * @returns {Object} Message object
 */
function createViewportUpdateMessage(viewport, sourceId = null) {
  const msg = {
    type: OTEF_MESSAGE_TYPES.VIEWPORT_UPDATE,
    viewport: { ...viewport }, // Include full viewport in payload
    sourceId: sourceId,
    timestamp: Date.now(),
  };
  return msg;
}

/**
 * Validates an ANIMATION_TOGGLE message
 * @param {Object} msg - Message to validate
 * @returns {boolean} True if valid
 */
function validateAnimationToggle(msg) {
  if (!validateMessage(msg)) return false;
  if (msg.type !== OTEF_MESSAGE_TYPES.ANIMATION_TOGGLE) return false;
  if (typeof msg.layerId !== "string") return false;
  if (typeof msg.enabled !== "boolean") return false;
  return true;
}

/**
 * Message factory: Create ANIMATION_TOGGLE message
 * @param {string} layerId - Layer to toggle animation for
 * @param {boolean} enabled - Whether animation is enabled
 * @returns {Object} Message object
 */
function createAnimationToggleMessage(layerId, enabled) {
  return {
    type: OTEF_MESSAGE_TYPES.ANIMATION_TOGGLE,
    layerId: layerId,
    enabled: enabled,
    timestamp: Date.now(),
  };
}

// Export for use in other modules
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    OTEF_MESSAGE_TYPES,
    DEFAULT_LAYER_STATES,
    validateMessage,
    validateViewportControl,
    validateViewportUpdate,
    validateLayerUpdate,
    validateAnimationToggle,
    createPanControlMessage,
    createZoomControlMessage,
    createViewportUpdateMessage,
    createLayerUpdateMessage,
    createAnimationToggleMessage,
    createVelocityUpdateMessage,
  };
}

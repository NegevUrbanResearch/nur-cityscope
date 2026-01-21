// OTEF Shared Message Protocol
// Defines message types, validation, and factory functions for WebSocket communication

const OTEF_MESSAGE_TYPES = {
  // Commands (sent by clients)
  VIEWPORT_UPDATE: "otef_viewport_update",
  VIEWPORT_CONTROL: "otef_viewport_control",
  LAYER_UPDATE: "otef_layer_update",
  ANIMATION_TOGGLE: "otef_animation_toggle",

  // Notifications (broadcast by server after DB update)
  VIEWPORT_CHANGED: "otef_viewport_changed",
  LAYERS_CHANGED: "otef_layers_changed",
  ANIMATION_CHANGED: "otef_animation_changed",
  BOUNDS_CHANGED: "otef_bounds_changed",

  // Legacy (deprecated - will be removed)
  STATE_REQUEST: "otef_state_request",
  STATE_RESPONSE: "otef_state_response",
};

// Default layer states
const DEFAULT_LAYER_STATES = {
  roads: true,
  parcels: false,
  model: false,
  majorRoads: false,
  smallRoads: false,
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

  // Check that layers object has valid boolean values
  const validLayers = ["roads", "parcels", "model", "majorRoads", "smallRoads"];
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
 * Validates a STATE_REQUEST message
 * @param {Object} msg - Message to validate
 * @returns {boolean} True if valid
 */
function validateStateRequest(msg) {
  if (!validateMessage(msg)) return false;
  if (msg.type !== OTEF_MESSAGE_TYPES.STATE_REQUEST) return false;
  return true;
}

/**
 * Validates a STATE_RESPONSE message
 * @param {Object} msg - Message to validate
 * @returns {boolean} True if valid
 */
function validateStateResponse(msg) {
  if (!validateMessage(msg)) return false;
  if (msg.type !== OTEF_MESSAGE_TYPES.STATE_RESPONSE) return false;
  if (!msg.viewport || !msg.layers) return false;

  // Validate viewport structure - bbox is required, zoom is required
  if (
    !msg.viewport.bbox ||
    !Array.isArray(msg.viewport.bbox) ||
    msg.viewport.bbox.length !== 4
  ) {
    return false;
  }
  if (typeof msg.viewport.zoom !== "number") return false;

  // Validate layers
  if (
    !validateLayerUpdate({
      type: OTEF_MESSAGE_TYPES.LAYER_UPDATE,
      layers: msg.layers,
    })
  ) {
    return false;
  }

  return true;
}

/**
 * Message factory: Create VIEWPORT_CONTROL message for panning
 * @param {string} direction - Pan direction: 'north', 'south', 'east', 'west', 'northeast', 'northwest', 'southeast', 'southwest'
 * @param {number} delta - Pan distance percentage (0-1, typically 0.1-0.2)
 * @returns {Object} Message object
 */
function createPanControlMessage(direction, delta = 0.15) {
  return {
    type: OTEF_MESSAGE_TYPES.VIEWPORT_CONTROL,
    pan: {
      direction: direction,
      delta: delta,
    },
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
 * @param {Object} layers - Layer states object { roads: boolean, parcels: boolean, model: boolean }
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
 * Message factory: Create STATE_REQUEST message
 * @returns {Object} Message object
 */
function createStateRequestMessage() {
  return {
    type: OTEF_MESSAGE_TYPES.STATE_REQUEST,
    timestamp: Date.now(),
  };
}

/**
 * Message factory: Create VIEWPORT_UPDATE message
 * @param {Object} viewport - Viewport state { bbox: [minX, minY, maxX, maxY], corners?: object, zoom?: number }
 * @returns {Object} Message object
 */
function createViewportUpdateMessage(viewport) {
  const msg = {
    type: OTEF_MESSAGE_TYPES.VIEWPORT_UPDATE,
    timestamp: Date.now(),
  };

  if (viewport.bbox) {
    msg.bbox = viewport.bbox;
  }

  if (viewport.corners) {
    msg.corners = viewport.corners;
  }

  if (typeof viewport.zoom === "number") {
    msg.zoom = viewport.zoom;
  }

  return msg;
}

/**
 * Message factory: Create STATE_RESPONSE message
 * @param {Object} viewport - Viewport state { bbox: [minX, minY, maxX, maxY], zoom: number, corners?: object }
 * @param {Object} layers - Layer states { roads: boolean, parcels: boolean, model: boolean }
 * @returns {Object} Message object
 */
function createStateResponseMessage(viewport, layers) {
  return {
    type: OTEF_MESSAGE_TYPES.STATE_RESPONSE,
    viewport: {
      bbox: viewport.bbox,
      zoom: viewport.zoom,
      corners: viewport.corners || null,
    },
    layers: { ...layers },
    timestamp: Date.now(),
  };
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
 * @param {string} layerId - Layer to toggle animation for (e.g. 'parcels')
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
    validateStateRequest,
    validateStateResponse,
    validateAnimationToggle,
    createPanControlMessage,
    createZoomControlMessage,
    createViewportUpdateMessage,
    createLayerUpdateMessage,
    createStateRequestMessage,
    createStateResponseMessage,
    createAnimationToggleMessage,
  };
}

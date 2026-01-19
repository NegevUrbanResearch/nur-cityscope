// OTEF API Client - RESTful state management
// Single source of truth for OTEF interactive state

const OTEF_API = {
  baseUrl: '/api/otef_viewport/by-table',
  defaultTable: 'otef',

  /**
   * Get current state from database
   * @param {string} tableName - Table name (default: 'otef')
   * @returns {Promise<Object>} State object {viewport, layers, animations}
   */
  async getState(tableName = this.defaultTable) {
    try {
      const response = await fetch(`${this.baseUrl}/${tableName}/`);
      if (!response.ok) {
        throw new Error(`Failed to fetch state: ${response.status}`);
      }
      const data = await response.json();
      console.log('[OTEF API] State fetched:', data);
      return data;
    } catch (error) {
      console.error('[OTEF API] Error fetching state:', error);
      throw error;
    }
  },

  /**
   * Update state partially
   * @param {string} tableName - Table name
   * @param {Object} updates - Partial state {viewport?, layers?, animations?}
   * @returns {Promise<Object>} Updated state
   */
  async updateState(tableName = this.defaultTable, updates) {
    try {
      const response = await fetch(`${this.baseUrl}/${tableName}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      if (!response.ok) {
        throw new Error(`Failed to update state: ${response.status}`);
      }
      const data = await response.json();
      console.log('[OTEF API] State updated:', updates);
      return data;
    } catch (error) {
      console.error('[OTEF API] Error updating state:', error);
      throw error;
    }
  },

  /**
   * Execute a command (pan/zoom) server-side
   * @param {string} tableName - Table name
   * @param {Object} command - Command {action: 'pan'|'zoom', ...params}
   * @returns {Promise<Object>} Result with updated viewport
   */
  async executeCommand(tableName = this.defaultTable, command) {
    try {
      const response = await fetch(`${this.baseUrl}/${tableName}/command/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command)
      });
      if (!response.ok) {
        throw new Error(`Failed to execute command: ${response.status}`);
      }
      const data = await response.json();
      console.log('[OTEF API] Command executed:', command.action);
      return data;
    } catch (error) {
      console.error('[OTEF API] Error executing command:', error);
      throw error;
    }
  },

  /**
   * Update layers visibility
   * @param {string} tableName - Table name
   * @param {Object} layers - Layer states {roads: bool, parcels: bool, ...}
   */
  async updateLayers(tableName = this.defaultTable, layers) {
    return this.updateState(tableName, { layers });
  },

  /**
   * Update animation state
   * @param {string} tableName - Table name
   * @param {Object} animations - Animation states {parcels: bool, ...}
   */
  async updateAnimations(tableName = this.defaultTable, animations) {
    return this.updateState(tableName, { animations });
  },

  /**
   * Update viewport (used by GIS map)
   * @param {string} tableName - Table name
   * @param {Object} viewport - Viewport {bbox, corners, zoom}
   */
  async updateViewport(tableName = this.defaultTable, viewport) {
    return this.updateState(tableName, { viewport });
  },

  // Debounce timers
  _viewportDebounce: null,
  _layersDebounce: null,

  /**
   * Debounced viewport update (300ms) - use for continuous updates like map movement
   * @param {string} tableName - Table name
   * @param {Object} viewport - Viewport state
   */
  updateViewportDebounced(tableName = this.defaultTable, viewport) {
    clearTimeout(this._viewportDebounce);
    this._viewportDebounce = setTimeout(() => {
      this.updateViewport(tableName, viewport);
    }, 300);
  },

  /**
   * Debounced layers update (100ms) - use for rapid toggle prevention
   * @param {string} tableName - Table name
   * @param {Object} layers - Layer states
   */
  updateLayersDebounced(tableName = this.defaultTable, layers) {
    clearTimeout(this._layersDebounce);
    this._layersDebounce = setTimeout(() => {
      this.updateLayers(tableName, layers);
    }, 100);
  }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = OTEF_API;
}

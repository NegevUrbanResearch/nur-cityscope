import { APP_CONFIG } from "../config/app-config.js";
import { getLogger } from "./logger.js";

export const OTEF_API = {
  baseUrl: APP_CONFIG.api.viewportBase,
  defaultTable: APP_CONFIG.defaultTable,
  _viewportDebounce: null,
  _stateInFlight: new Map(),
  _stateCache: new Map(),

  async getState(tableName = this.defaultTable, options = {}) {
    const forceFresh = !!(options && options.forceFresh);
    const cacheEntry = this._stateCache.get(tableName);
    const now = Date.now();
    if (!forceFresh && cacheEntry && now - cacheEntry.ts < 250) {
      return cacheEntry.value;
    }
    const inFlight = !forceFresh ? this._stateInFlight.get(tableName) : null;
    if (inFlight) {
      return inFlight;
    }
    const fetchPromise = (async () => {
      try {
        const response = await fetch(`${this.baseUrl}/${tableName}/`);
        if (!response.ok) throw new Error(`Failed to fetch state: ${response.status}`);
        const value = await response.json();
        this._stateCache.set(tableName, { ts: Date.now(), value });
        return value;
      } catch (error) {
        getLogger().error("[OTEF API] Error fetching state:", error);
        throw error;
      } finally {
        this._stateInFlight.delete(tableName);
      }
    })();
    this._stateInFlight.set(tableName, fetchPromise);
    try {
      return await fetchPromise;
    } catch (error) {
      throw error;
    }
  },

  async updateState(tableName = this.defaultTable, updates) {
    try {
      const response = await fetch(`${this.baseUrl}/${tableName}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!response.ok) throw new Error(`Failed to update state: ${response.status}`);
      const value = await response.json();
      this._stateCache.delete(tableName);
      return value;
    } catch (error) {
      getLogger().error("[OTEF API] Error updating state:", error);
      throw error;
    }
  },

  async executeCommand(tableName = this.defaultTable, command) {
    try {
      const response = await fetch(`${this.baseUrl}/${tableName}/command/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
      if (!response.ok) throw new Error(`Failed to execute command: ${response.status}`);
      const value = await response.json();
      this._stateCache.delete(tableName);
      return value;
    } catch (error) {
      getLogger().error("[OTEF API] Error executing command:", error);
      throw error;
    }
  },

  async updateLayerGroups(tableName = this.defaultTable, layerGroups) {
    return this.updateState(tableName, { layerGroups });
  },

  async updateAnimations(tableName = this.defaultTable, animations) {
    return this.updateState(tableName, { animations });
  },

  async updateViewport(tableName = this.defaultTable, viewport) {
    return this.updateState(tableName, { viewport });
  },

  updateViewportDebounced(tableName = this.defaultTable, viewport) {
    clearTimeout(this._viewportDebounce);
    this._viewportDebounce = setTimeout(() => {
      this.updateViewport(tableName, viewport);
    }, 120);
  },

  async saveBounds(tableName = this.defaultTable, polygon, viewerAngleDeg) {
    try {
      const body = { table: tableName, polygon };
      if (typeof viewerAngleDeg === "number" && !Number.isNaN(viewerAngleDeg)) {
        body.viewer_angle_deg = viewerAngleDeg;
      }

      const response = await fetch(APP_CONFIG.api.boundsApply, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) throw new Error(`Failed to save bounds: ${response.status}`);
      const value = await response.json();
      this._stateCache.delete(tableName);
      return value;
    } catch (error) {
      getLogger().error("[OTEF API] Error saving bounds:", error);
      throw error;
    }
  },
};

if (typeof window !== "undefined") {
  window.OTEF_API = OTEF_API;
}

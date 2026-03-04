import { APP_CONFIG } from "../config/app-config.js";
import { getLogger } from "./logger.js";

export const OTEF_API = {
  baseUrl: APP_CONFIG.api.viewportBase,
  defaultTable: APP_CONFIG.defaultTable,
  _viewportDebounce: null,

  async getState(tableName = this.defaultTable) {
    try {
      const response = await fetch(`${this.baseUrl}/${tableName}/`);
      if (!response.ok) throw new Error(`Failed to fetch state: ${response.status}`);
      return await response.json();
    } catch (error) {
      getLogger().error("[OTEF API] Error fetching state:", error);
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
      return await response.json();
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
      return await response.json();
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
    }, 500);
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
      return await response.json();
    } catch (error) {
      getLogger().error("[OTEF API] Error saving bounds:", error);
      throw error;
    }
  },
};

if (typeof window !== "undefined") {
  window.OTEF_API = OTEF_API;
}

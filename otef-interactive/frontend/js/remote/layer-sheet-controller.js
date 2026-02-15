/**
 * Layer Sheet Controller
 *
 * Manages the bottom sheet UI for layer group selection.
 * Handles touch gestures, group expand/collapse, and sync with OTEFDataContext.
 */

function groupLayersByNameForSheet(layers, groupId) {
  const suffixRegex =
    /^(.*?)-(\u05d0\u05d6\u05d5\u05e8|\u05e0\u05e7\u05d5\u05d3\u05d4|\u05e6\u05d9\u05e8)$/;
  const groups = new Map();
  const result = [];
  const processedIds = new Set();
  const standalones = [];

  for (const layer of layers) {
    if (processedIds.has(layer.id)) continue;
    const match = layer.name ? layer.name.match(suffixRegex) : null;
    if (match) {
      const rawBase = match[1].trim();
      const baseName = normalizeLayerBaseName(rawBase);
      let row = groups.get(baseName);
      if (!row) {
        row = {
          baseName,
          displayLabel: rawBase,
          fullLayerIds: [],
          layers: [],
        };
        groups.set(baseName, row);
        result.push(row);
      }
      row.fullLayerIds.push(`${groupId}.${layer.id}`);
      row.layers.push(layer);
      processedIds.add(layer.id);
    } else {
      const rawName = layer.name || layer.id;
      standalones.push({
        baseName: normalizeLayerBaseName(rawName),
        displayLabel: rawName,
        fullLayerIds: [`${groupId}.${layer.id}`],
        layers: [layer],
      });
      processedIds.add(layer.id);
    }
  }

  // Merge standalones whose normalized baseName matches a group's baseName
  for (const row of result) {
    const baseName = row.baseName;
    for (let i = standalones.length - 1; i >= 0; i--) {
      if (standalones[i].baseName !== baseName) continue;
      const s = standalones[i];
      row.fullLayerIds.push(...s.fullLayerIds);
      row.layers.push(...s.layers);
      standalones.splice(i, 1);
    }
  }

  for (const row of result) {
    row.enabled = row.layers.every((l) => l.enabled);
  }
  for (const row of standalones) {
    row.enabled = row.layers.every((l) => l.enabled);
  }
  return result.concat(standalones);
}

class LayerSheetController {
  constructor() {
    this.sheet = null;
    this.isOpen = false;
    this.startY = 0;
    this.currentY = 0;
    this.isDragging = false;
    this.expandedGroups = new Set(); // Track which groups are expanded

    // Initialize when DOM is ready
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        this.init().catch((err) => {
          console.error("[LayerSheetController] Initialization error:", err);
        });
      });
    } else {
      this.init().catch((err) => {
        console.error("[LayerSheetController] Initialization error:", err);
      });
    }
  }

  async init() {
    this.sheet = document.getElementById("layerSheet");
    if (!this.sheet) {
      console.warn("[LayerSheetController] Layer sheet element not found");
      return;
    }

    // Initialize layer registry if available
    if (typeof layerRegistry !== "undefined") {
      await layerRegistry.init();
    }

    this.setupEventListeners();
    this.render();

    // Subscribe to layer group changes
    if (typeof OTEFDataContext !== "undefined") {
      OTEFDataContext.subscribe("layerGroups", () => this.render());
    }
  }

  setupEventListeners() {
    const handle = this.sheet.querySelector(".sheet-handle");
    const content = this.sheet.querySelector(".sheet-content");

    if (!handle || !content) return;

    // Touch start
    handle.addEventListener(
      "touchstart",
      (e) => {
        this.startY = e.touches[0].clientY;
        this.isDragging = true;
        this.sheet.style.transition = "none";
      },
      { passive: true },
    );

    // Touch move
    handle.addEventListener(
      "touchmove",
      (e) => {
        if (!this.isDragging) return;
        this.currentY = e.touches[0].clientY;
        const deltaY = this.currentY - this.startY;

        if (deltaY > 0) {
          // Dragging down - closing
          this.sheet.style.transform = `translateY(${deltaY}px)`;
        }
      },
      { passive: true },
    );

    // Touch end
    handle.addEventListener(
      "touchend",
      () => {
        if (!this.isDragging) return;
        this.isDragging = false;
        this.sheet.style.transition = "transform 0.3s ease-out";

        const deltaY = this.currentY - this.startY;
        if (deltaY > 100) {
          // Close if dragged down more than 100px
          this.close();
        } else {
          // Snap back
          this.sheet.style.transform = "";
        }
      },
      { passive: true },
    );

    // Click handle to toggle
    handle.addEventListener("click", () => {
      if (this.isOpen) {
        this.close();
      } else {
        this.open();
      }
    });

    // Click outside to close
    this.sheet.addEventListener("click", (e) => {
      if (e.target === this.sheet) {
        this.close();
      }
    });
  }

  open() {
    this.isOpen = true;
    this.sheet.classList.add("open");
    this.render();
  }

  close() {
    this.isOpen = false;
    this.sheet.classList.remove("open");
  }

  toggleGroup(groupId) {
    if (this.expandedGroups.has(groupId)) {
      this.expandedGroups.delete(groupId);
    } else {
      this.expandedGroups.add(groupId);
    }
    this.render();
  }

  async toggleGroupEnabled(groupId, enabled) {
    if (typeof OTEFDataContext === "undefined") return;
    try {
      const result = await OTEFDataContext.toggleGroup(groupId, enabled);
      if (!result || !result.ok) {
        console.error(
          `[LayerSheet] Failed to toggle group ${groupId}:`,
          result?.error,
        );
      }
    } catch (err) {
      console.error(`[LayerSheet] Error toggling group ${groupId}:`, err);
    }
  }

  async toggleLayer(layerId, enabled) {
    if (typeof OTEFDataContext !== "undefined") {
      await OTEFDataContext.toggleLayer(layerId, enabled);
    }
  }

  async toggleLayerRow(fullLayerIds, enabled) {
    if (!Array.isArray(fullLayerIds)) return;
    if (fullLayerIds.length === 0) return;
    if (typeof OTEFDataContext !== "undefined") {
      await OTEFDataContext.setLayersEnabled(fullLayerIds, enabled);
    }
  }

  render() {
    const content = this.sheet.querySelector(".sheet-content");
    if (!content) return;

    let groups = [];
    if (
      typeof LayerStateHelper !== "undefined" &&
      typeof LayerStateHelper.getEffectiveLayerGroups === "function"
    ) {
      groups = LayerStateHelper.getEffectiveLayerGroups();
    } else if (typeof layerRegistry !== "undefined" && layerRegistry._initialized) {
      groups = layerRegistry.getGroups();
      if (typeof OTEFDataContext !== "undefined") {
        const contextGroups = OTEFDataContext.getLayerGroups();
        if (contextGroups && contextGroups.length > 0) {
          const stateMap = new Map();
          for (const group of contextGroups) {
            stateMap.set(group.id, group);
          }
          groups = groups.map((group) => {
            const state = stateMap.get(group.id);
            if (state) {
              const layers = group.layers.map((layer) => {
                const layerState = state.layers?.find((l) => l.id === layer.id);
                return {
                  ...layer,
                  name: layerState?.displayName ?? layer.name,
                  enabled: layerState ? layerState.enabled : false,
                };
              });
              const enabled =
                group.id === "_legacy"
                  ? state.enabled
                  : layers.length > 0 && layers.every((l) => l.enabled);
              return { ...group, enabled, layers };
            }
            return group;
          });
          for (const cg of contextGroups) {
            if (groups.some((g) => g.id === cg.id)) continue;
            groups.push({
              id: cg.id,
              name: cg.id === "curated" ? "Curated" : cg.id,
              enabled: cg.enabled,
              layers: (cg.layers || []).map((l) => ({
                id: l.id,
                name: l.displayName || l.id,
                enabled: l.enabled,
              })),
            });
          }
        }
      }
    }

    // Update layer count
    const layerCountEl = this.sheet.querySelector(".layer-count");
    if (layerCountEl) {
      const totalEnabled = groups.reduce((sum, group) => {
        return sum + (group.layers || []).filter((l) => l.enabled).length;
      }, 0);
      layerCountEl.textContent = `${totalEnabled} active`;
    }

    // Render groups
    if (groups.length === 0) {
      content.innerHTML =
        '<div class="sheet-empty">No layer groups available</div>';
      return;
    }

    content.innerHTML = groups
      .map((group) => {
        const isExpanded = this.expandedGroups.has(group.id);
        const enabledLayers = (group.layers || []).filter(
          (l) => l.enabled,
        ).length;
        const totalLayers = (group.layers || []).length;

        return `
        <div class="layer-group" data-group-id="${group.id}">
          <div class="group-header">
            <div class="group-title-row" onclick="layerSheetController.toggleGroup('${group.id}')">
              <span class="group-title">${escapeHtml(group.name)}</span>
              <span class="group-count">${enabledLayers}/${totalLayers}</span>
            </div>
            <div class="group-controls">
              <label class="group-toggle" onclick="event.stopPropagation()">
                <input
                  type="checkbox"
                  ${group.enabled ? "checked" : ""}
                  onchange="layerSheetController.toggleGroupEnabled('${group.id}', this.checked); event.stopPropagation();"
                />
                <span class="toggle-indicator"></span>
              </label>
              <svg class="expand-icon ${isExpanded ? "expanded" : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" onclick="layerSheetController.toggleGroup('${group.id}')">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </div>
          </div>
          <div class="group-layers ${isExpanded ? "expanded" : ""}">
            ${(group.id === "october_7th"
              ? groupLayersByNameForSheet(group.layers, group.id)
              : (group.layers || []).map((layer) => ({
                  baseName: layer.name || layer.id,
                  fullLayerIds: [`${group.id}.${layer.id}`],
                  layers: [layer],
                  enabled: layer.enabled,
                }))
            )
              .map((row) => {
                const style = this.getLayerStylePreview(row.layers[0]);
                const layerIdsAttr = JSON.stringify(row.fullLayerIds).replace(
                  /"/g,
                  "&quot;",
                );
                const label =
                  row.displayLabel ??
                  row.baseName ??
                  row.layers[0]?.name ??
                  row.layers[0]?.id ??
                  "";
                const checked =
                  row.enabled !== undefined
                    ? row.enabled
                    : row.layers.every((l) => l.enabled);
                return `
                <label class="layer-item" onclick="event.stopPropagation()">
                  <div class="layer-preview" style="background-color: ${style.fillColor}; opacity: ${style.fillOpacity}; border-color: ${style.strokeColor};"></div>
                  <input
                    type="checkbox"
                    data-layer-ids="${layerIdsAttr}"
                    ${checked ? "checked" : ""}
                    onchange="layerSheetController.toggleLayerRow(JSON.parse(this.getAttribute('data-layer-ids')), this.checked); event.stopPropagation();"
                  />
                  <span class="toggle-indicator"></span>
                  <span class="layer-label">${escapeHtml(label)}</span>
                </label>
              `;
              })
              .join("")}
          </div>
        </div>
      `;
      })
      .join("");
  }

  getLayerStylePreview(layer) {
    if (!layer) {
      return {
        fillColor: "#808080",
        fillOpacity: 0.7,
        strokeColor: "#000000",
      };
    }
    // Handle image layers with a special preview style
    if (layer.format === "image" || layer.geometryType === "image") {
      return {
        fillColor: "#4a90e2",
        fillOpacity: 0.8,
        strokeColor: "#2a5a8a",
      };
    }

    return {
      fillColor: "#808080",
      fillOpacity: 0.7,
      strokeColor: "#000000",
    };
  }

  // escapeHtml is provided by html-utils.js (loaded via script tag)
}

// Initialize singleton
const layerSheetController = new LayerSheetController();

// Export for global access
window.layerSheetController = layerSheetController;

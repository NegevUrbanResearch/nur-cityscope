/**
 * Layer Sheet Controller
 *
 * Manages the bottom sheet UI for layer group selection.
 * Handles touch gestures, group expand/collapse, and sync with OTEFDataContext.
 */

class LayerSheetController {
  constructor() {
    this.sheet = null;
    this.isOpen = false;
    this.startY = 0;
    this.currentY = 0;
    this.isDragging = false;
    this.expandedGroups = new Set(); // Track which groups are expanded

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        this.init().catch(err => {
          console.error('[LayerSheetController] Initialization error:', err);
        });
      });
    } else {
      this.init().catch(err => {
        console.error('[LayerSheetController] Initialization error:', err);
      });
    }
  }

  async init() {
    this.sheet = document.getElementById('layerSheet');
    if (!this.sheet) {
      console.warn('[LayerSheetController] Layer sheet element not found');
      return;
    }

    // Initialize layer registry if available
    if (typeof layerRegistry !== 'undefined') {
      await layerRegistry.init();
    }

    this.setupEventListeners();
    this.render();

    // Subscribe to layer group changes and legacy layers (for model base)
    if (typeof OTEFDataContext !== 'undefined') {
      OTEFDataContext.subscribe('layerGroups', () => this.render());
      OTEFDataContext.subscribe('layers', () => this.render()); // For model base state
    }
  }

  setupEventListeners() {
    const handle = this.sheet.querySelector('.sheet-handle');
    const content = this.sheet.querySelector('.sheet-content');

    if (!handle || !content) return;

    // Touch start
    handle.addEventListener('touchstart', (e) => {
      this.startY = e.touches[0].clientY;
      this.isDragging = true;
      this.sheet.style.transition = 'none';
    }, { passive: true });

    // Touch move
    handle.addEventListener('touchmove', (e) => {
      if (!this.isDragging) return;
      this.currentY = e.touches[0].clientY;
      const deltaY = this.currentY - this.startY;

      if (deltaY > 0) {
        // Dragging down - closing
        this.sheet.style.transform = `translateY(${deltaY}px)`;
      }
    }, { passive: true });

    // Touch end
    handle.addEventListener('touchend', () => {
      if (!this.isDragging) return;
      this.isDragging = false;
      this.sheet.style.transition = 'transform 0.3s ease-out';

      const deltaY = this.currentY - this.startY;
      if (deltaY > 100) {
        // Close if dragged down more than 100px
        this.close();
      } else {
        // Snap back
        this.sheet.style.transform = '';
      }
    }, { passive: true });

    // Click handle to toggle
    handle.addEventListener('click', () => {
      if (this.isOpen) {
        this.close();
      } else {
        this.open();
      }
    });

    // Click outside to close
    this.sheet.addEventListener('click', (e) => {
      if (e.target === this.sheet) {
        this.close();
      }
    });
  }

  open() {
    this.isOpen = true;
    this.sheet.classList.add('open');
    this.render();
  }

  close() {
    this.isOpen = false;
    this.sheet.classList.remove('open');
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
    if (typeof OTEFDataContext === 'undefined') return;
    try {
      if (groupId === '_legacy') {
        // Legacy group only has virtual "Model base"; sync group toggle to layers.model
        await OTEFDataContext.toggleLayer('model', enabled);
        return;
      }

      // Sync model base state when toggling projector_base group
      if (groupId === 'projector_base') {
        await OTEFDataContext.toggleLayer('model', enabled);
      }

      const result = await OTEFDataContext.toggleGroup(groupId, enabled);
      if (!result || !result.ok) {
        console.error(`[LayerSheet] Failed to toggle group ${groupId}:`, result?.error);
      }
    } catch (err) {
      console.error(`[LayerSheet] Error toggling group ${groupId}:`, err);
    }
  }

  async toggleLayer(layerId, enabled) {
    if (typeof OTEFDataContext !== 'undefined') {
      // Special handling for model base - route to legacy layers.model
      // Handle both legacy ID and new group-prefixed ID
      if (
        layerId === '_legacy.model_base' ||
        layerId === 'model_base' ||
        layerId === 'projector_base.model_base'
      ) {
        await OTEFDataContext.toggleLayer('model', enabled);
      } else {
        await OTEFDataContext.toggleLayer(layerId, enabled);
      }
    }
  }

  render() {
    const content = this.sheet.querySelector('.sheet-content');
    if (!content) return;

    // Get layer groups from registry and data context
    let groups = [];
    let layerStates = {};

    if (typeof layerRegistry !== 'undefined' && layerRegistry._initialized) {
      groups = layerRegistry.getGroups();
    }

    if (typeof OTEFDataContext !== 'undefined') {
      const contextGroups = OTEFDataContext.getLayerGroups();
      if (contextGroups) {
        // Merge registry groups with state from context
        const stateMap = new Map();
        for (const group of contextGroups) {
          stateMap.set(group.id, group);
        }

        groups = groups.map(group => {
          const state = stateMap.get(group.id);
          if (state) {
            const layers = group.layers.map(layer => {
              const layerState = state.layers.find(l => l.id === layer.id);
              return {
                ...layer,
                enabled: layerState ? layerState.enabled : false
              };
            });
            const enabled =
              group.id === '_legacy'
                ? state.enabled
                : layers.length > 0 && layers.every((l) => l.enabled);
            return { ...group, enabled, layers };
          }
          return group;
        });
      }
    }

    // Update layer count
    const layerCountEl = this.sheet.querySelector('.layer-count');
    if (layerCountEl) {
      const totalEnabled = groups.reduce((sum, group) => {
        return sum + (group.layers || []).filter(l => l.enabled).length;
      }, 0);
      layerCountEl.textContent = `${totalEnabled} active`;
    }

    // Handle projector_base group: set default enabled state for sea and רקע_שחור (but not model_base)
    const projectorBaseGroupIndex = groups.findIndex(g => g.id === 'projector_base');
    if (projectorBaseGroupIndex !== -1) {
      const projectorBaseGroup = groups[projectorBaseGroupIndex];
      const legacyLayers = typeof OTEFDataContext !== 'undefined' ? OTEFDataContext.getLayers() : null;
      const modelEnabled = legacyLayers && legacyLayers.model === true;

      // Add model_base as a virtual layer to projector_base group (moved from _legacy)
      const modelBaseLayer = {
        id: 'model_base',
        name: 'Model base',
        enabled: modelEnabled,
        virtual: true
      };

      // Set default enabled state: sea and רקע_שחור should be on by default, model_base should be off
      projectorBaseGroup.layers = (projectorBaseGroup.layers || []).map(layer => {
        // Enable sea and רקע_שחור by default if not already set
        if ((layer.id === 'sea' || layer.id === 'רקע_שחור')) {
           // If enabled is undefined (initial load), default to true.
           // If it has a value, keep it.
           if (layer.enabled === undefined) {
             return { ...layer, enabled: true };
           }
        }
        return layer;
      });

      // Add model_base to the group (but keep it disabled by default)
      projectorBaseGroup.layers = [modelBaseLayer, ...projectorBaseGroup.layers];

      // Group is enabled if any non-model_base layer is enabled
      const nonModelLayers = projectorBaseGroup.layers.filter(l => l.id !== 'model_base');
      projectorBaseGroup.enabled = nonModelLayers.some(l => l.enabled);

      groups[projectorBaseGroupIndex] = projectorBaseGroup;
    }

    // Render groups
    if (groups.length === 0) {
      content.innerHTML = '<div class="sheet-empty">No layer groups available</div>';
      return;
    }

    content.innerHTML = groups.map(group => {
      const isExpanded = this.expandedGroups.has(group.id);
      const enabledLayers = (group.layers || []).filter(l => l.enabled).length;
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
                  ${group.enabled ? 'checked' : ''}
                  onchange="layerSheetController.toggleGroupEnabled('${group.id}', this.checked); event.stopPropagation();"
                />
                <span class="toggle-indicator"></span>
              </label>
              <svg class="expand-icon ${isExpanded ? 'expanded' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" onclick="layerSheetController.toggleGroup('${group.id}')">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </div>
          </div>
          <div class="group-layers ${isExpanded ? 'expanded' : ''}">
            ${(group.layers || []).map(layer => {
              const fullLayerId = `${group.id}.${layer.id}`;
              // For virtual layers (like model base), use simplified preview or skip
              const isVirtual = layer.virtual === true;
              const style = isVirtual ? null : this.getLayerStylePreview(layer);
              return `
                <label class="layer-item" onclick="event.stopPropagation()">
                  ${isVirtual ? '<div class="layer-preview" style="background-color: #4a90e2; opacity: 0.8; border-color: #2a5a8a;"></div>' : `<div class="layer-preview" style="background-color: ${style.fillColor}; opacity: ${style.fillOpacity}; border-color: ${style.strokeColor};"></div>`}
                  <input
                    type="checkbox"
                    ${layer.enabled ? 'checked' : ''}
                    onchange="layerSheetController.toggleLayer('${fullLayerId}', this.checked); event.stopPropagation();"
                  />
                  <span class="toggle-indicator"></span>
                  <span class="layer-label">${escapeHtml(layer.name)}</span>
                </label>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }).join('');
  }

  getLayerStylePreview(layer) {
    // Get style preview from registry if available
    if (typeof layerRegistry !== 'undefined') {
      const fullId = `${layer.groupId || ''}.${layer.id}`;
      const config = layerRegistry.getLayerConfig(fullId);
      if (config && config.style && config.style.defaultStyle) {
        return config.style.defaultStyle;
      }
    }

    // Default preview
    return {
      fillColor: '#808080',
      fillOpacity: 0.7,
      strokeColor: '#000000'
    };
  }

  // escapeHtml is provided by html-utils.js (loaded via script tag)
}

// Initialize singleton
const layerSheetController = new LayerSheetController();

// Export for global access
window.layerSheetController = layerSheetController;

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
    if (typeof OTEFDataContext !== 'undefined') {
      try {
        const result = await OTEFDataContext.toggleGroup(groupId, enabled);
        if (!result || !result.ok) {
          console.error(`[LayerSheet] Failed to toggle group ${groupId}:`, result?.error);
        }
      } catch (err) {
        console.error(`[LayerSheet] Error toggling group ${groupId}:`, err);
      }
    }
  }

  async toggleLayer(layerId, enabled) {
    if (typeof OTEFDataContext !== 'undefined') {
      // Special handling for model base - route to legacy layers.model
      if (layerId === '_legacy.model_base' || layerId === 'model_base') {
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
            return {
              ...group,
              enabled: state.enabled,
              layers: group.layers.map(layer => {
                const layerState = state.layers.find(l => l.id === layer.id);
                return {
                  ...layer,
                  enabled: layerState ? layerState.enabled : false
                };
              })
            };
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

    // Inject virtual "Model base" layer into _legacy group
    const legacyGroupIndex = groups.findIndex(g => g.id === '_legacy');
    if (legacyGroupIndex !== -1) {
      const legacyGroup = groups[legacyGroupIndex];
      // Get model state from legacy layers
      const legacyLayers = typeof OTEFDataContext !== 'undefined' ? OTEFDataContext.getLayers() : null;
      const modelEnabled = legacyLayers && legacyLayers.model === true;
      
      // Add model base as first item in legacy group
      const modelBaseLayer = {
        id: 'model_base',
        name: 'Model base',
        enabled: modelEnabled,
        virtual: true // Mark as virtual so it doesn't try to load from registry
      };
      
      legacyGroup.layers = [modelBaseLayer, ...(legacyGroup.layers || [])];
      groups[legacyGroupIndex] = legacyGroup;
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
              <span class="group-title">${this.escapeHtml(group.name)}</span>
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
                  <span class="layer-label">${this.escapeHtml(layer.name)}</span>
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

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize singleton
const layerSheetController = new LayerSheetController();

// Export for global access
window.layerSheetController = layerSheetController;

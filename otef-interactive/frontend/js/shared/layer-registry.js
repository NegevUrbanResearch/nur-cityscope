/**
 * Layer Registry
 *
 * Centralized registry for layer packs, configurations, and styles.
 * Loads manifest files and provides API for accessing layer data.
 *
 * Responsibilities:
 * - Fetch and cache layers-manifest.json at startup
 * - Load layer styles from pack's styles.json
 * - Provide API: getGroups(), getLayersInGroup(groupId), getLayerConfig(layerId)
 * - Handle lazy-loading of GeoJSON/PMTiles data
 */

class LayerRegistry {
  constructor() {
    this._manifest = null;
    this._packManifests = new Map(); // packId -> manifest
    this._packStyles = new Map(); // packId -> styles.json
    this._initialized = false;
    this._initializingPromise = null;
  }

  /**
   * Initialize the registry by loading the root manifest.
   * Safe to call multiple times; subsequent calls will await the first.
   */
  async init() {
    if (this._initialized) {
      return;
    }
    if (this._initializingPromise) {
      return this._initializingPromise;
    }

    this._initializingPromise = this._doInit();
    return this._initializingPromise;
  }

  async _doInit() {
    try {
      // Load root manifest
      const manifestPath = '/otef-interactive/public/processed/layers/layers-manifest.json';
      const response = await fetch(manifestPath);

      if (!response.ok) {
        console.warn('[LayerRegistry] Root manifest not found, using empty registry');
        this._manifest = { packs: [] };
        this._initialized = true;
        return;
      }

      this._manifest = await response.json();

      // Load all pack manifests and styles in parallel
      const loadPromises = [];
      for (const packId of this._manifest.packs || []) {
        loadPromises.push(this._loadPack(packId));
      }

      await Promise.all(loadPromises);

      this._initialized = true;
      console.log(`[LayerRegistry] Initialized with ${this._manifest.packs.length} pack(s)`);
    } catch (error) {
      console.error('[LayerRegistry] Failed to initialize:', error);
      this._manifest = { packs: [] };
      this._initialized = true;
    } finally {
      this._initializingPromise = null;
    }
  }

  /**
   * Load manifest and styles for a specific pack.
   */
  async _loadPack(packId) {
    try {
      const basePath = `/otef-interactive/public/processed/layers/${packId}`;

      // Load manifest
      const manifestResponse = await fetch(`${basePath}/manifest.json`);
      if (manifestResponse.ok) {
        const manifest = await manifestResponse.json();
        this._packManifests.set(packId, manifest);
      }

      // Load styles
      const stylesResponse = await fetch(`${basePath}/styles.json`);
      if (stylesResponse.ok) {
        const styles = await stylesResponse.json();
        this._packStyles.set(packId, styles);
      }
    } catch (error) {
      console.warn(`[LayerRegistry] Failed to load pack ${packId}:`, error);
    }
  }

  /**
   * Get all layer groups (packs).
   * @returns {Array<{id: string, name: string, layers: Array}>}
   */
  getGroups() {
    if (!this._initialized) {
      console.warn('[LayerRegistry] Not initialized, call init() first');
      return [];
    }

    const groups = [];
    for (const packId of this._manifest.packs || []) {
      const manifest = this._packManifests.get(packId);
      if (manifest) {
        groups.push({
          id: packId,
          name: manifest.name || packId,
          layers: manifest.layers || []
        });
      }
    }
    return groups;
  }

  /**
   * Get all layers in a specific group.
   * @param {string} groupId - Pack ID (e.g., "map_3_future")
   * @returns {Array<{id: string, name: string, file: string, format: string, geometryType: string}>}
   */
  getLayersInGroup(groupId) {
    if (!this._initialized) {
      console.warn('[LayerRegistry] Not initialized, call init() first');
      return [];
    }

    const manifest = this._packManifests.get(groupId);
    if (!manifest) {
      return [];
    }

    return manifest.layers || [];
  }

  /**
   * Get full layer configuration including style.
   * @param {string} layerId - Full layer ID (e.g., "map_3_future.mimushim")
   * @returns {Object|null} Layer config with style, or null if not found
   */
  getLayerConfig(layerId) {
    if (!this._initialized) {
      console.warn('[LayerRegistry] Not initialized, call init() first');
      return null;
    }

    // Parse layerId: "group_id.layer_id"
    const parts = layerId.split('.');
    if (parts.length < 2) {
      return null;
    }

    const groupId = parts[0];
    const layerIdOnly = parts.slice(1).join('.');

    const manifest = this._packManifests.get(groupId);
    if (!manifest) {
      return null;
    }

    // Find layer in manifest
    const layer = manifest.layers.find(l => l.id === layerIdOnly);
    if (!layer) {
      return null;
    }

    // Get style
    const styles = this._packStyles.get(groupId);
    const style = styles ? styles[layerIdOnly] : null;

    return {
      ...layer,
      style: style || {
        type: layer.geometryType,
        renderer: 'simple',
        defaultStyle: {
          fillColor: '#808080',
          fillOpacity: 0.7,
          strokeColor: '#000000',
          strokeWidth: 1.0
        }
      },
      fullId: layerId,
      groupId: groupId
    };
  }

  /**
   * Get the URL for a layer's data file (GeoJSON).
   * @param {string} layerId - Full layer ID
   * @returns {string|null} URL to layer data file
   */
  getLayerDataUrl(layerId) {
    const config = this.getLayerConfig(layerId);
    if (!config) {
      return null;
    }

    const basePath = `/otef-interactive/public/processed/layers/${config.groupId}`;
    return `${basePath}/${config.file}`;
  }

  /**
   * Get the URL for a layer's PMTiles file (if available).
   * @param {string} layerId - Full layer ID
   * @returns {string|null} URL to PMTiles file, or null if not available
   */
  getLayerPMTilesUrl(layerId) {
    const config = this.getLayerConfig(layerId);
    if (!config || !config.pmtilesFile) {
      return null;
    }

    const basePath = `/otef-interactive/public/processed/layers/${config.groupId}`;
    return `${basePath}/${config.pmtilesFile}`;
  }

  /**
   * Check if a layer has PMTiles available.
   * @param {string} layerId - Full layer ID
   * @returns {boolean}
   */
  isPMTiles(layerId) {
    const config = this.getLayerConfig(layerId);
    return config ? !!config.pmtilesFile : false;
  }

  /**
   * Get all layer IDs across all groups.
   * @returns {Array<string>} Array of full layer IDs
   */
  getAllLayerIds() {
    const layerIds = [];
    for (const group of this.getGroups()) {
      for (const layer of group.layers) {
        layerIds.push(`${group.id}.${layer.id}`);
      }
    }
    return layerIds;
  }
}

// Singleton instance
const layerRegistry = new LayerRegistry();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = layerRegistry;
}

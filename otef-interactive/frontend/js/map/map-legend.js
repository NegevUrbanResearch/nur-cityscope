/**
 * Cartographic legend for the Leaflet GIS map.
 * Data-driven: reads visible layers from OTEFDataContext and style metadata from
 * layerRegistry. Renders pack -> layer -> items with geometry-aware symbols.
 * Hebrew labels used where available.
 */

const DEFAULT_LAND_USE_SCHEME = { fill: '#E0E0E0', stroke: '#B0B0B0' };

// escapeHtml is provided by html-utils.js (loaded via script tag)

function shapeForGeometry(geometryType) {
  const t = (geometryType || '').toLowerCase();
  if (t === 'point') return 'point';
  if (t === 'line' || t === 'polyline') return 'line';
  if (t === 'polygon' || t === 'multipolygon') return 'polygon';
  return 'polygon';
}

function itemsFromSimple(config) {
  const style = config.style?.defaultStyle || {};
  const fill = style.fillColor || '#808080';
  const stroke = style.strokeColor || '#000000';
  const geometryType = config.geometryType || 'polygon';
  const shape = shapeForGeometry(geometryType);
  return [
    {
      label: config.name || config.id || '',
      fill,
      stroke,
      shape
    }
  ];
}

function itemsFromUniqueValue(config) {
  const uv = config.style?.uniqueValues || {};
  const classes = uv.classes || [];
  const defaultStyle = config.style?.defaultStyle || {};
  const geometryType = config.geometryType || 'polygon';
  const shape = shapeForGeometry(geometryType);
  return classes.map((c) => {
    const s = c.style || defaultStyle;
    return {
      label: c.label != null ? String(c.label) : (c.value != null ? String(c.value) : ''),
      fill: s.fillColor || defaultStyle.fillColor || '#808080',
      stroke: s.strokeColor || defaultStyle.strokeColor || '#000000',
      shape
    };
  });
}

async function distinctLandUseFromGeoJSON(url, field, fallback) {
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const geojson = await res.json();
    const features = geojson.features || [];
    const set = new Set();
    for (const f of features) {
      const p = f.properties || {};
      const v = p[field] || p[fallback] || '';
      if (v) set.add(String(v).trim());
    }
    return Array.from(set);
  } catch (_) {
    return [];
  }
}

function itemsFromLandUse(config, distinctValues) {
  const geometryType = config.geometryType || 'polygon';
  const shape = shapeForGeometry(geometryType);
  const useKeys = distinctValues && distinctValues.length > 0
    ? distinctValues
    : [];
  const fill = DEFAULT_LAND_USE_SCHEME.fill;
  const stroke = DEFAULT_LAND_USE_SCHEME.stroke;
  const items = [];

  for (const raw of useKeys) {
    if (!raw) continue;
    items.push({ label: raw, fill, stroke, shape });
  }
  if (items.length === 0) {
    items.push({
      label: '\u05D0\u05D7\u05E8',
      fill,
      stroke,
      shape
    });
  }
  return items;
}

async function buildLegendModel() {
  const packs = [];
  const ctx = typeof OTEFDataContext !== 'undefined' ? OTEFDataContext : null;
  const registry = typeof layerRegistry !== 'undefined' ? layerRegistry : null;

  if (!ctx) return { packs };

  const legacy = ctx.getLayers() || {};
  const layerGroups = ctx.getLayerGroups() || [];

  if (registry && !registry._initialized) {
    try {
      await registry.init();
    } catch (e) {
      console.warn('[MapLegend] Registry init failed:', e);
    }
  }

  const legacyPack = {
    id: '_legacy',
    name: 'Legacy',
    layers: []
  };

  if (legacy.model) {
    legacyPack.layers.push({
      id: 'model',
      name: 'Model Base',
      geometryType: 'none',
      items: [
        { label: 'Physical 3D model overlay', fill: null, stroke: null, shape: 'none' }
      ]
    });
  }

  if (legacyPack.layers.length > 0) {
    packs.push(legacyPack);
  }

  for (const group of layerGroups) {
    const packLayers = [];
    for (const layer of group.layers || []) {
      if (!layer.enabled) continue;

      // Skip projector-only layers in the GIS legend, except Tkuma_Area_LIne
      if (group.id === 'projector_base' && layer.id !== 'Tkuma_Area_LIne') continue;

      const fullId = `${group.id}.${layer.id}`;
      const config = registry ? registry.getLayerConfig(fullId) : null;
      if (!config) continue;

      const style = config.style || {};
      const renderer = style.renderer || 'simple';
      const geometryType = config.geometryType || 'polygon';
      let items = [];

      if (renderer === 'simple') {
        items = itemsFromSimple(config);
      } else if (renderer === 'uniqueValue') {
        items = itemsFromUniqueValue(config);
      } else if (renderer === 'landUse') {
        const field = style.landUseField || 'TARGUMYEUD';
        const fallback = style.landUseFieldFallback || 'KVUZ_TRG';
        const url = registry?.getLayerDataUrl(fullId) || null;
        const canScanGeojson = url && config.format === 'geojson';
        const distinct = canScanGeojson
          ? await distinctLandUseFromGeoJSON(url, field, fallback)
          : [];
        items = itemsFromLandUse(config, distinct);
      } else {
        items = itemsFromSimple(config);
      }

      if (items.length === 0) continue;

      packLayers.push({
        id: layer.id,
        name: config.name || layer.id,
        geometryType,
        items
      });
    }

    if (packLayers.length === 0) continue;

    const packName = (typeof registry !== 'undefined' && registry._initialized)
      ? (registry.getGroups().find((g) => g.id === group.id)?.name || group.id)
      : group.id;
    packs.push({
      id: group.id,
      name: (packName || group.id).trim() || group.id,
      layers: packLayers
    });
  }

  return { packs };
}

function renderLegend(model) {
  const legend = document.getElementById('mapLegend');
  if (!legend) return;

  const packs = model.packs || [];
  if (packs.length === 0) {
    legend.innerHTML = '';
    legend.classList.remove('map-legend-has-content');
    return;
  }

  legend.classList.add('map-legend-has-content');
  let html = '<div class="map-legend-title has-groups">Legend</div>';

  for (const pack of packs) {
    html += '<div class="map-legend-group">';
    html += `<div class="map-legend-group-title" dir="auto">${escapeHtml(pack.name)}</div>`;

    const layers = (pack.layers || []).slice();
    const typeOrder = { line: 0, point: 1, polygon: 2 };
    layers.sort((a, b) => {
      const aKey = typeOrder[(a.geometryType || '').toLowerCase()] ?? 3;
      const bKey = typeOrder[(b.geometryType || '').toLowerCase()] ?? 3;
      return aKey - bKey;
    });

    for (const layer of layers) {
      html += '<div class="map-legend-layer">';
      const showLayerTitle = (layer.items || []).length > 1;
      if (showLayerTitle) {
        html += `<div class="map-legend-layer-title" dir="auto">${escapeHtml(layer.name)}</div>`;
      }

      for (const item of layer.items) {
        html += '<div class="map-legend-item">';
        const shape = item.shape || 'polygon';
        const symbolClass = `map-legend-symbol map-legend-symbol--${shape}`;
        if (shape === 'none' || item.fill == null) {
          html += `<span class="${symbolClass}" style="background: transparent; border: none;" aria-hidden="true"></span>`;
        } else if (shape === 'line') {
          const stroke = item.stroke || item.fill || '#000000';
          html += `<span class="${symbolClass}" style="background: ${stroke}; border: none;" aria-hidden="true"></span>`;
        } else {
          const bg = item.fill || '#808080';
          const border = item.stroke || '#000000';
          html += `<span class="${symbolClass}" style="background: ${bg}; border-color: ${border};" aria-hidden="true"></span>`;
        }
        html += `<span class="map-legend-label" dir="auto">${escapeHtml(item.label)}</span>`;
        html += '</div>';
      }

      html += '</div>';
    }

    html += '</div>';
  }

  legend.innerHTML = html;
}

/**
 * Update cartographic legend from OTEFDataContext and layerRegistry.
 * Shows only enabled layers, grouped by pack and layer, with geometry-aware symbols.
 */
async function updateMapLegend() {
  try {
    const model = await buildLegendModel();
    renderLegend(model);
  } catch (e) {
    console.warn('[MapLegend] updateMapLegend failed:', e);
    const el = document.getElementById('mapLegend');
    if (el) {
      el.innerHTML = '';
      el.classList.remove('map-legend-has-content');
    }
  }
}

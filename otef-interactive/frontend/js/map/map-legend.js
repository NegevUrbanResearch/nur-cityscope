/**
 * Cartographic legend for the Leaflet GIS map.
 * Data-driven: reads visible layers from OTEFDataContext and style metadata from
 * layerRegistry. Renders pack -> layer -> items with geometry-aware symbols.
 * Hebrew labels used where available.
 */

const MAJOR_ROAD_LEGEND_ITEMS = [
  { label: '\u05D3\u05E8\u05DA \u05E8\u05D0\u05E9\u05D9\u05EA', color: '#B22222' },
  { label: '\u05D3\u05E8\u05DA \u05D0\u05D6\u05D5\u05E8\u05D9\u05EA', color: '#CD853F' }
];

const LEGACY_TO_REGISTRY = {
  majorRoads: '_legacy.road_big',
  smallRoads: '_legacy.small_road_limited',
  parcels: '_legacy.migrashim'
};

function escapeHtml(s) {
  if (s == null || typeof s !== 'string') return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

function itemsFromMajorRoad() {
  return MAJOR_ROAD_LEGEND_ITEMS.map((it) => ({
    label: it.label,
    fill: it.color,
    stroke: it.color,
    shape: 'line'
  }));
}

function itemsFromLegacySmallRoads() {
  return [
    {
      label: '\u05D3\u05E8\u05DB\u05D9\u05DD \u05DE\u05E7\u05D5\u05DE\u05D9\u05D5\u05EA',
      fill: '#A0A0A0',
      stroke: '#707070',
      shape: 'polygon'
    }
  ];
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

function landUseMatchesKey(landUseStr, key) {
  return key !== 'default' && (landUseStr || '').includes(key);
}

function itemsFromLandUse(config, distinctValues) {
  const geometryType = config.geometryType || 'polygon';
  const shape = shapeForGeometry(geometryType);
  const useKeys = distinctValues && distinctValues.length > 0
    ? distinctValues
    : [];

  const entries = typeof LAND_USE_COLORS !== 'undefined' ? Object.entries(LAND_USE_COLORS) : [];
  const items = [];
  const added = new Set();

  for (const raw of useKeys) {
    for (const [key, scheme] of entries) {
      if (key === 'default') continue;
      if (!landUseMatchesKey(raw, key)) continue;
      if (added.has(key)) continue;
      added.add(key);
      items.push({
        label: key,
        fill: scheme.fill || '#E0E0E0',
        stroke: scheme.stroke || '#B0B0B0',
        shape
      });
    }
  }

  const defaultScheme = entries.find(([k]) => k === 'default')?.[1];
  const fallbackFill = defaultScheme?.fill || '#E0E0E0';
  const fallbackStroke = defaultScheme?.stroke || '#B0B0B0';

  for (const raw of useKeys) {
    let found = false;
    for (const [key] of entries) {
      if (key === 'default') continue;
      if (landUseMatchesKey(raw, key)) {
        found = true;
        break;
      }
    }
    if (!found && raw && !added.has(raw)) {
      added.add(raw);
      items.push({
        label: raw,
        fill: fallbackFill,
        stroke: fallbackStroke,
        shape
      });
    }
  }

  if (items.length === 0 && useKeys.length === 0) {
    items.push({
      label: '\u05D0\u05D7\u05E8',
      fill: fallbackFill,
      stroke: fallbackStroke,
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

  if (legacy.parcels) {
    let parcelItems = [];
    const regId = LEGACY_TO_REGISTRY.parcels;
    if (registry && regId) {
      const cfg = registry.getLayerConfig(regId);
      const style = cfg?.style;
      if (style?.renderer === 'landUse') {
        const field = style.landUseField || 'TARGUMYEUD';
        const fallback = style.landUseFieldFallback || 'KVUZ_TRG';
        const url = registry.getLayerDataUrl(regId);
        const canScanGeojson = url && cfg?.format === 'geojson';
        const distinct = canScanGeojson
          ? await distinctLandUseFromGeoJSON(url, field, fallback)
          : [];
        parcelItems = itemsFromLandUse(cfg || { geometryType: 'polygon' }, distinct);
      }
    }
    if (parcelItems.length === 0) {
      parcelItems = itemsFromLandUse({ geometryType: 'polygon' }, []);
    }
    legacyPack.layers.push({
      id: 'parcels',
      name: '\u05E9\u05D9\u05DE\u05D5\u05E9 \u05E7\u05E8\u05E7\u05E2\u05D5\u05EA',
      geometryType: 'polygon',
      items: parcelItems
    });
  }

  if (legacy.majorRoads) {
    legacyPack.layers.push({
      id: 'majorRoads',
      name: '\u05D3\u05E8\u05DB\u05D9\u05DD \u05E8\u05D0\u05E9\u05D9\u05D5\u05EA',
      geometryType: 'line',
      items: itemsFromMajorRoad()
    });
  }

  if (legacy.smallRoads) {
    legacyPack.layers.push({
      id: 'smallRoads',
      name: '\u05D3\u05E8\u05DB\u05D9\u05DD \u05DE\u05E7\u05D5\u05DE\u05D9\u05D5\u05EA',
      geometryType: 'polygon',
      items: itemsFromLegacySmallRoads()
    });
  }

  if (legacyPack.layers.length > 0) {
    packs.push(legacyPack);
  }

  for (const group of layerGroups) {
    const packLayers = [];
    for (const layer of group.layers || []) {
      if (!layer.enabled) continue;
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
      } else if (renderer === 'majorRoad') {
        items = itemsFromMajorRoad();
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

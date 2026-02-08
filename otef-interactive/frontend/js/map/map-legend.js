/**
 * Cartographic legend for the Leaflet GIS map.
 * Data-driven: reads visible layers from OTEFDataContext and style metadata from
 * layerRegistry. Renders pack -> layer -> items with geometry-aware symbols.
 * Hebrew labels used where available.
 */

const DEFAULT_LAND_USE_SCHEME = { fill: "#E0E0E0", stroke: "#B0B0B0" };

// escapeHtml is provided by html-utils.js (loaded via script tag)

function shapeForGeometry(geometryType) {
  const t = (geometryType || "").toLowerCase();
  if (t === "point") return "point";
  if (t === "line" || t === "polyline") return "line";
  if (t === "polygon" || t === "multipolygon") return "polygon";
  return "polygon";
}

function getCssForHatch(hatchConfig, color) {
  if (!hatchConfig) return null;
  const angle =
    hatchConfig.angle != null
      ? hatchConfig.angle
      : hatchConfig.rotation != null
        ? hatchConfig.rotation
        : 45;
  const width =
    hatchConfig.width != null
      ? hatchConfig.width
      : hatchConfig.lineWidth != null
        ? hatchConfig.lineWidth
        : 1;
  const spacing =
    hatchConfig.spacing != null
      ? hatchConfig.spacing
      : hatchConfig.separation != null
        ? hatchConfig.separation
        : 8;
  return `repeating-linear-gradient(${angle}deg, ${color}, ${color} ${width}px, transparent ${width}px, transparent ${spacing}px)`;
}

/**
 * CSS background for a dashed line using only the stroke color (no border = no black gaps).
 * dashArray e.g. [4, 4] => 4px on, 4px off. Scale to ~24px legend symbol width.
 */
function getDashBackground(dashArray, color) {
  if (!dashArray || !Array.isArray(dashArray) || dashArray.length === 0)
    return color;
  const on = Math.max(1, Math.round((dashArray[0] || 4) * 1.5));
  const off = Math.max(
    1,
    Math.round((dashArray[1] != null ? dashArray[1] : dashArray[0] || 4) * 1.5),
  );
  const total = on + off;
  return `repeating-linear-gradient(90deg, ${color} 0px, ${color} ${on}px, transparent ${on}px, transparent ${total}px)`;
}

/**
 * Build minimal symbol IR from a simple style (defaultStyle).
 * Mirrors AdvancedStyleEngine._symbolFromSimpleStyle so legend uses the same IR contract.
 */
function symbolFromSimpleStyle(simpleStyle) {
  if (!simpleStyle) return { symbolLayers: [] };
  const layers = [];
  if (simpleStyle.fillColor) {
    layers.push({
      type: "fill",
      fillType: simpleStyle.hatch ? "hatch" : "solid",
      color: simpleStyle.fillColor,
      opacity:
        simpleStyle.fillOpacity !== undefined ? simpleStyle.fillOpacity : 1.0,
      hatch: simpleStyle.hatch || null,
    });
  }
  if (simpleStyle.strokeColor || simpleStyle.strokeWidth) {
    layers.push({
      type: "stroke",
      color: simpleStyle.strokeColor || "#000000",
      width: simpleStyle.strokeWidth || 1.0,
      opacity:
        simpleStyle.strokeOpacity !== undefined
          ? simpleStyle.strokeOpacity
          : 1.0,
      dash: simpleStyle.dashArray
        ? { array: simpleStyle.dashArray.slice() }
        : null,
    });
  }
  return { symbolLayers: layers };
}

/**
 * Parse symbol IR (symbolLayers) into structured lists. Aligns with advanced-style IR spec.
 */
function parseSymbolLayers(symbol) {
  const layers =
    symbol && symbol.symbolLayers && Array.isArray(symbol.symbolLayers)
      ? symbol.symbolLayers
      : [];
  const fills = [];
  const strokes = [];
  let markerLine = null;
  let markerPoint = null;
  for (const layer of layers) {
    if (!layer) continue;
    if (layer.type === "fill") {
      fills.push({
        fillType: layer.fillType || "solid",
        color: layer.color,
        opacity: layer.opacity,
        hatch: layer.hatch,
      });
    } else if (layer.type === "stroke") {
      strokes.push({
        color: layer.color || "#000000",
        width: layer.width,
        opacity: layer.opacity,
        dash:
          layer.dash && layer.dash.array
            ? { array: layer.dash.array.slice() }
            : null,
      });
    } else if (layer.type === "markerLine") {
      markerLine = layer;
    } else if (layer.type === "markerPoint") {
      markerPoint = layer;
    }
  }
  return { fills, strokes, markerLine, markerPoint };
}

/**
 * Convert a style symbol IR to legend items. Single source of truth for all advanced (and simple) layers.
 * Aligns with AdvancedStyleEngine / AdvancedStyleDrawing: same symbolLayers semantics.
 * @param {Object} symbol - { symbolLayers: [...] } or from symbolFromSimpleStyle
 * @param {string} label - Label for the legend row(s)
 * @param {string} geometryType - "line" | "polygon" | "point"
 * @returns {{ items: Array<Object>, singleRowMultiSymbol: boolean }}
 */
function symbolIRToLegendItems(symbol, label, geometryType) {
  const parsed = parseSymbolLayers(symbol);
  const { fills, strokes, markerLine, markerPoint } = parsed;
  const geom = (geometryType || "").toLowerCase();
  const items = [];
  let singleRowMultiSymbol = false;

  if (geom === "line") {
    // Line: each stroke layer = one line swatch (IR has multi-stroke). Optionally markerLine = point swatch.
    const strokeSwatches = strokes.map((s) => ({
      color: s.color || "#000000",
      dash: s.dash,
    }));
    if (strokeSwatches.length > 0) {
      for (const sw of strokeSwatches) {
        items.push({
          label,
          shape: "line",
          stroke: sw.color,
          dash: sw.dash,
          strokeSwatches: undefined,
        });
      }
    }
    if (markerLine && markerLine.marker) {
      const m = markerLine.marker;
      const markerColor = m.fillColor || m.strokeColor || "#808080";
      items.push({
        label,
        shape: "point",
        fill: markerColor,
        stroke: m.strokeColor || markerColor,
      });
    }
    if (items.length > 1) {
      singleRowMultiSymbol = true;
      const lineItems = items.filter((i) => i.shape === "line");
      const pointItems = items.filter((i) => i.shape === "point");
      if (lineItems.length > 0 || pointItems.length > 0) {
        const merged = [];
        if (lineItems.length > 0) {
          const rawSwatches = lineItems.map((i) => ({
            color: i.stroke,
            dash: i.dash,
          }));
          const coalesced = [];
          for (const sw of rawSwatches) {
            const last = coalesced[coalesced.length - 1];
            const same =
              last &&
              last.color === sw.color &&
              (last.dash == null) === (sw.dash == null) &&
              (last.dash && sw.dash
                ? String(last.dash.array) === String(sw.dash.array)
                : true);
            if (!same) coalesced.push(sw);
          }
          merged.push({
            label,
            shape: "line",
            stroke: lineItems[0].stroke,
            dash: lineItems[0].dash,
            strokeSwatches:
              coalesced.length > 0 ? coalesced : rawSwatches.slice(0, 1),
          });
        }
        for (const pt of pointItems) merged.push(pt);
        return { items: merged, singleRowMultiSymbol: true };
      }
    }
    if (items.length === 1) items[0].strokeSwatches = undefined;
    return { items, singleRowMultiSymbol };
  }

  if (geom === "polygon" || geom === "multipolygon") {
    let fill = "transparent";
    const hatchStyles = [];
    let stroke = null;
    for (const f of fills) {
      if (f.fillType === "solid" && f.color) fill = f.color;
      if (f.fillType === "hatch" && f.hatch) {
        const css = getCssForHatch(f.hatch, f.color || "#000000");
        if (css) hatchStyles.push(css);
      }
    }
    const hatchStyle = hatchStyles[0] || null;
    const hatchStyle2 = hatchStyles.length > 1 ? hatchStyles[1] : null;
    if (strokes.length > 0) stroke = strokes[0].color;
    items.push({
      label,
      shape: "polygon",
      fill,
      stroke: stroke !== null ? stroke : undefined,
      hatchStyle,
      hatchStyle2,
    });
    return { items, singleRowMultiSymbol: false };
  }

  if (geom === "point") {
    if (markerPoint && markerPoint.marker) {
      const m = markerPoint.marker;
      items.push({
        label,
        shape: "point",
        fill: m.fillColor || m.strokeColor || "#808080",
        stroke: m.strokeColor || m.fillColor,
      });
    } else if (fills.length > 0 || strokes.length > 0) {
      items.push({
        label,
        shape: "point",
        fill: fills.length > 0 && fills[0].color ? fills[0].color : "#808080",
        stroke: strokes.length > 0 ? strokes[0].color : undefined,
      });
    }
    return { items, singleRowMultiSymbol: false };
  }

  return { items, singleRowMultiSymbol: false };
}

/**
 * Items from simple config: use IR path so legend aligns with style engine.
 */
function itemsFromSimple(config) {
  const defaultStyle = config.style?.defaultStyle || {};
  const symbol = symbolFromSimpleStyle(defaultStyle);
  const label = config.name || config.id || "";
  const geometryType = config.geometryType || "polygon";
  const { items } = symbolIRToLegendItems(symbol, label, geometryType);
  if (items.length > 0) return items;
  return [
    {
      label,
      fill: defaultStyle.fillColor || "#808080",
      stroke: defaultStyle.strokeColor || "#000000",
      shape: shapeForGeometry(geometryType),
    },
  ];
}

/**
 * Items from uniqueValue: each class resolved to symbol IR (advancedSymbol or defaultStyle), then IR -> legend.
 */
function itemsFromUniqueValue(config) {
  const uv = config.style?.uniqueValues || {};
  const classes = uv.classes || [];
  const defaultStyle = config.style?.defaultStyle || {};
  const geometryType = config.geometryType || "polygon";
  const shape = shapeForGeometry(geometryType);

  const out = [];
  for (const c of classes) {
    const classLabel =
      c.label != null
        ? String(c.label)
        : c.value != null
          ? String(c.value)
          : "";
    const symbol =
      c.advancedSymbol && c.advancedSymbol.symbolLayers
        ? c.advancedSymbol
        : symbolFromSimpleStyle(c.style || defaultStyle);
    const { items } = symbolIRToLegendItems(symbol, classLabel, geometryType);
    if (items.length > 0) {
      for (const item of items) {
        out.push({ ...item, label: classLabel, shape: item.shape || shape });
      }
    } else {
      const s = c.style || defaultStyle;
      out.push({
        label: classLabel,
        fill: s.fillColor || defaultStyle.fillColor || "#808080",
        stroke: s.strokeColor || defaultStyle.strokeColor || "#000000",
        shape,
      });
    }
  }
  return out;
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
      const v = p[field] || p[fallback] || "";
      if (v) set.add(String(v).trim());
    }
    return Array.from(set);
  } catch (_) {
    return [];
  }
}

function itemsFromLandUse(config, distinctValues) {
  const geometryType = config.geometryType || "polygon";
  const shape = shapeForGeometry(geometryType);
  const useKeys =
    distinctValues && distinctValues.length > 0 ? distinctValues : [];
  const fill = DEFAULT_LAND_USE_SCHEME.fill;
  const stroke = DEFAULT_LAND_USE_SCHEME.stroke;
  const items = [];

  for (const raw of useKeys) {
    if (!raw) continue;
    items.push({ label: raw, fill, stroke, shape });
  }
  if (items.length === 0) {
    items.push({
      label: "\u05D0\u05D7\u05E8",
      fill,
      stroke,
      shape,
    });
  }
  return items;
}

/**
 * Group layers by name suffix (e.g. "Name-אזור", "Name-נקודה")
 * Returns a new list of layers where matching layers are merged into one composite layer.
 */
function groupLayersByName(layers) {
  const groups = new Map(); // baseName -> { ...layer, items: [...] }
  const result = [];
  const processedIds = new Set();

  // Regex for Hebrew suffixes: -אזור (Area), -נקודה (Point), -ציר (Axis/Line)
  // Also include English variants just in case? No, data is Hebrew.
  const suffixRegex =
    /^(.*?)-(\u05d0\u05d6\u05d5\u05e8|\u05e0\u05e7\u05d5\u05d3\u05d4|\u05e6\u05d9\u05e8)$/;

  for (const layer of layers) {
    if (processedIds.has(layer.id)) continue;

    const match = layer.name ? layer.name.match(suffixRegex) : null;

    if (match) {
      const baseNameRaw = match[1].trim();
      const baseNameNorm = normalizeLayerBaseName(baseNameRaw);
      let group = groups.get(baseNameNorm);
      if (!group) {
        group = {
          id: `group_${baseNameNorm}`,
          name: baseNameRaw,
          geometryType: "mixed",
          items: [],
          isComposite: true,
        };
        groups.set(baseNameNorm, group);
        result.push(group);
      }

      // Add all items from this layer to the group's items
      // We want to keep them distinct symbols
      for (const item of layer.items) {
        group.items.push({
          ...item,
          // Use the original shape from the item
          // We don't overwrite label here, renderLegend will handle it
        });
      }
      processedIds.add(layer.id);
    } else {
      // No match, check if we need to add it as is
      result.push(layer);
      processedIds.add(layer.id);
    }
  }

    // Second pass: merge any standalone layer whose normalized name equals the group's normalized baseName
    for (let i = result.length - 1; i >= 0; i--) {
        const entry = result[i];
        if (!entry.isComposite) continue;
        const baseNameNorm = normalizeLayerBaseName(entry.name);
        for (let j = result.length - 1; j >= 0; j--) {
            if (i === j) continue;
            const other = result[j];
            if (other.isComposite) continue;
            if (normalizeLayerBaseName(other.name || other.id) !== baseNameNorm) continue;
      for (const item of other.items || []) {
        entry.items.push({ ...item });
      }
      result.splice(j, 1);
      if (j < i) i--;
    }
  }

  return result;
}

async function buildLegendModel() {
  const packs = [];
  const ctx = typeof OTEFDataContext !== "undefined" ? OTEFDataContext : null;
  const registry = typeof layerRegistry !== "undefined" ? layerRegistry : null;

  if (!ctx) return { packs };

  const layerGroups = ctx.getLayerGroups() || [];

  if (registry && !registry._initialized) {
    try {
      await registry.init();
    } catch (e) {
      console.warn("[MapLegend] Registry init failed:", e);
    }
  }

  // Model base entry derived from layerGroups (projector_base.model_base)
  const modelBaseEnabled = (() => {
    const projectorBase = layerGroups.find(
      (g) => g && g.id === "projector_base",
    );
    if (!projectorBase || !Array.isArray(projectorBase.layers)) return false;
    const modelLayer = projectorBase.layers.find(
      (l) => l && l.id === "model_base",
    );
    // Also check config - hideInLegend
    if (registry) {
      const config = registry.getLayerConfig("projector_base.model_base");
      if (config?.ui?.hideInLegend) return false;
    }

    return !!(modelLayer && modelLayer.enabled);
  })();

  const legacyPack = {
    id: "_legacy",
    name: "Legacy",
    layers: [],
  };

  if (modelBaseEnabled) {
    legacyPack.layers.push({
      id: "model",
      name: "Model Base",
      geometryType: "none",
      items: [
        {
          label: "Physical 3D model overlay",
          fill: null,
          stroke: null,
          shape: "none",
        },
      ],
    });
  }

  if (legacyPack.layers.length > 0) {
    packs.push(legacyPack);
  }

  for (const group of layerGroups) {
    let packLayers = [];

    for (const layer of group.layers || []) {
      if (!layer.enabled) continue;

      const fullId = `${group.id}.${layer.id}`;
      // Double check filter logic
      if (
        typeof shouldShowLayerOnGisMap === "function" &&
        !shouldShowLayerOnGisMap(group.id, layer.id)
      ) {
        continue;
      }

      const config = registry ? registry.getLayerConfig(fullId) : null;
      if (!config) continue;

      // Explicit hideInLegend check
      if (config.ui?.hideInLegend) continue;

      const style = config.style || {};
      const renderer = style.renderer || "simple";
      const geometryType = config.geometryType || "polygon";
      let items = [];
      let singleRowMultiSymbol = false;

      // All legend items derived from style IR (advancedSymbol or defaultStyle) for consistency with map/projection
      if (renderer === "uniqueValue") {
        items = itemsFromUniqueValue(config);
      } else if (renderer === "landUse") {
        const field = style.landUseField || "TARGUMYEUD";
        const fallback = style.landUseFieldFallback || "KVUZ_TRG";
        const url = registry?.getLayerDataUrl(fullId) || null;
        const canScanGeojson = url && config.format === "geojson";
        const distinct = canScanGeojson
          ? await distinctLandUseFromGeoJSON(url, field, fallback)
          : [];
        items = itemsFromLandUse(config, distinct);
      } else {
        // Use advancedSymbol when present so line+marker and multi-stroke layers get single-row merge
        const symbol =
          config.style?.advancedSymbol &&
          config.style.advancedSymbol.symbolLayers
            ? config.style.advancedSymbol
            : symbolFromSimpleStyle(config.style?.defaultStyle || {});
        const label = config.name || layer.id;
        const result = symbolIRToLegendItems(symbol, label, geometryType);
        items = result.items;
        singleRowMultiSymbol = result.singleRowMultiSymbol;
        if (items.length === 0) {
          items = itemsFromSimple(config);
        }
        // Optional verification: for line layers that should show one row, enable debug to confirm style path
        if (
          group.id === "muniplicity_transport" &&
          (layer.id === "\u05de\u05e1\u05dc\u05d5\u05dc\u05d9_\u05e8\u05db\u05d1\u05df" || layer.id === "\u05e1\u05d9\u05e0\u05d2\u05dc\u05d9\u05dd")
        ) {
          console.debug("[MapLegend]", layer.id, { renderer, hasAdvancedSymbol: !!config.style?.advancedSymbol?.symbolLayers, singleRowMultiSymbol: result.singleRowMultiSymbol });
        }
      }

      if (items.length === 0) continue;

      packLayers.push({
        id: layer.id,
        name: config.name || layer.id,
        geometryType,
        items,
        singleRowMultiSymbol,
      });
    }

    if (packLayers.length === 0) continue;

    // Apply grouping logic
    packLayers = groupLayersByName(packLayers);

    const packName =
      typeof registry !== "undefined" && registry._initialized
        ? registry.getGroups().find((g) => g.id === group.id)?.name || group.id
        : group.id;

    packs.push({
      id: group.id,
      name: (packName || group.id).trim() || group.id,
      layers: packLayers,
    });
  }

  return { packs };
}

function renderLegend(model) {
  const legend = document.getElementById("mapLegend");
  if (!legend) return;

  const packs = model.packs || [];
  if (packs.length === 0) {
    legend.innerHTML = "";
    legend.classList.remove("map-legend-has-content");
    return;
  }

  legend.classList.add("map-legend-has-content");
  let html = '<div class="map-legend-title has-groups">Legend</div>';

  for (const pack of packs) {
    html += '<div class="map-legend-group">';
    html += `<div class="map-legend-group-title" dir="auto">${escapeHtml(
      pack.name,
    )}</div>`;

    const layers = (pack.layers || []).slice();
    // Sort logic?
    // keep original order or type order?
    // If grouped, sorting by type is ambiguous (mixed).
    // Let's stick to original order which usually follows config/logic
    // The original code sorted by geometryType.
    /*
    const typeOrder = { line: 0, point: 1, polygon: 2, mixed: 3 };
    layers.sort((a, b) => {
      const aKey = typeOrder[(a.geometryType || "").toLowerCase()] ?? 3;
      const bKey = typeOrder[(b.geometryType || "").toLowerCase()] ?? 3;
      return aKey - bKey;
    });
    */

    for (const layer of layers) {
      html += '<div class="map-legend-layer">';

      const isComposite = layer.isComposite;
      const singleRow = layer.singleRowMultiSymbol === true;
      const oneRowWithMultipleSymbols = isComposite || singleRow;

      const showLayerTitle =
        !oneRowWithMultipleSymbols && (layer.items || []).length > 1;

      if (showLayerTitle) {
        html += `<div class="map-legend-layer-title" dir="auto">${escapeHtml(
          layer.name,
        )}</div>`;
      }

      if (oneRowWithMultipleSymbols) {
        html += '<div class="map-legend-item">';
        const shapePriority = { point: 0, line: 1, polygon: 2 };
        const sortedItems = (layer.items || [])
          .slice()
          .sort(
            (a, b) =>
              (shapePriority[a.shape] || 3) - (shapePriority[b.shape] || 3),
          );
        for (const item of sortedItems) {
          html += renderSymbolSpan(item);
        }
        html += `<span class="map-legend-label" dir="auto">${escapeHtml(layer.name)}</span>`;
        html += "</div>";
      } else {
        for (const item of layer.items) {
          html += '<div class="map-legend-item">';
          html += renderSymbolSpan(item);
          html += `<span class="map-legend-label" dir="auto">${escapeHtml(
            item.label,
          )}</span>`;
          html += "</div>";
        }
      }

      html += "</div>";
    }

    html += "</div>";
  }

  legend.innerHTML = html;
}

function renderSymbolSpan(item) {
  const shape = item.shape || "polygon";
  const symbolClass = `map-legend-symbol map-legend-symbol--${shape}`;
  let style = "";

  if (shape === "none") {
    style = "background: transparent; border: none;";
  } else if (shape === "line") {
    const baseStyle = "border: none; height: 2px; margin-top: 6px;";
    const swatches =
      item.strokeSwatches && item.strokeSwatches.length > 0
        ? item.strokeSwatches
        : item.stroke != null || item.strokeSecondary != null
          ? [
              { color: item.stroke || item.fill, dash: item.dash },
              ...(item.strokeSecondary != null
                ? [{ color: item.strokeSecondary, dash: null }]
                : []),
            ].filter((s) => s.color)
          : [];
    if (swatches.length === 0) {
      swatches.push({
        color: item.stroke || item.fill || "#808080",
        dash: item.dash,
      });
    }
    let span = "";
    for (const sw of swatches) {
      const dashArr =
        sw.dash && (Array.isArray(sw.dash) ? sw.dash : sw.dash.array);
      const bg =
        dashArr && dashArr.length > 0
          ? getDashBackground(dashArr, sw.color || "#808080")
          : sw.color || "#808080";
      span += `<span class="${symbolClass}" style="background: ${bg}; ${baseStyle}" aria-hidden="true"></span>`;
    }
    return span;
  } else {
    const strokeColor = item.stroke != null ? item.stroke : "#000000";
    const fillBg = item.fill || "#808080";
    if (item.hatchStyle2 && item.hatchStyle) {
      style = `background: ${item.hatchStyle2}, ${item.hatchStyle}, ${fillBg}; border-color: ${strokeColor};`;
    } else if (item.hatchStyle) {
      style = `background: ${item.hatchStyle}, ${fillBg}; border-color: ${strokeColor};`;
    } else {
      style = `background: ${fillBg}; border-color: ${strokeColor};`;
    }
  }

  return `<span class="${symbolClass}" style="${style}" aria-hidden="true"></span>`;
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
    console.warn("[MapLegend] updateMapLegend failed:", e);
    const el = document.getElementById("mapLegend");
    if (el) {
      el.innerHTML = "";
      el.classList.remove("map-legend-has-content");
    }
  }
}

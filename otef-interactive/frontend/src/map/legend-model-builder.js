/**
 * Legend model builder — data logic for the cartographic legend.
 * Reads visible layers from OTEFDataContext and style metadata from
 * layerRegistry. Produces a renderer-agnostic model consumed by
 * map-legend.js (renderLegend / renderSymbolSpan).
 *
 * Hebrew labels used where available.
 */

import { parseLayerNameWithGeometrySuffix } from "../shared/layer-name-utils.js";
import AdvancedStyleEngine from "../map-utils/advanced-style-engine.js";

const DEFAULT_LAND_USE_SCHEME = { fill: "#E0E0E0", stroke: "#B0B0B0" };

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Symbol IR parsing
// ---------------------------------------------------------------------------

/**
 * Build minimal symbol IR from a simple style.
 * Delegates to AdvancedStyleEngine (single source of truth).
 */
const symbolFromSimpleStyle = AdvancedStyleEngine.symbolFromSimpleStyle.bind(AdvancedStyleEngine);

/**
 * Parse symbol IR (symbolLayers) into structured lists.
 * Aligns with advanced-style IR spec.
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
 * Convert a style symbol IR to legend items.
 * Single source of truth for all advanced (and simple) layers.
 * Aligns with AdvancedStyleEngine / AdvancedStyleDrawing: same symbolLayers semantics.
 *
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
      const visible =
        f.opacity == null || (typeof f.opacity === "number" && f.opacity > 0);
      if (f.fillType === "solid" && f.color && visible) fill = f.color;
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

// ---------------------------------------------------------------------------
// Style-type specific item builders
// ---------------------------------------------------------------------------

/**
 * Items from simple config: use IR path so legend aligns with style engine.
 */
function itemsFromSimple(config) {
  const defaultStyle = config.style?.defaultStyle || {};
  const layerSymbol = config.style?.defaultSymbol;
  const symbol =
    layerSymbol?.symbolLayers?.length > 0
      ? layerSymbol
      : symbolFromSimpleStyle(defaultStyle);
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
 * Items from uniqueValue: each class resolved to symbol IR, then IR -> legend.
 */
function itemsFromUniqueValue(config) {
  const uv = config.style?.uniqueValues || {};
  const classes = uv.classes || [];
  const defaultStyle = config.style?.defaultStyle || {};
  const layerDefaultSymbol =
    config.style?.defaultSymbol ||
    (config.style?.defaultStyle
      ? symbolFromSimpleStyle(config.style.defaultStyle)
      : null);
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
    const classSymbol = c.symbol || (c.style ? null : layerDefaultSymbol);
    const symbol =
      classSymbol?.symbolLayers?.length > 0
        ? classSymbol
        : c.style
          ? symbolFromSimpleStyle(c.style)
          : layerDefaultSymbol || symbolFromSimpleStyle(defaultStyle);
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

// ---------------------------------------------------------------------------
// Grouping logic
// ---------------------------------------------------------------------------

/**
 * Group layers by name suffix (e.g. "Name-אזור", "Name_אזור").
 * Returns a new list of layers where matching layers are merged into one composite layer.
 * Supports both hyphen and underscore before Hebrew suffix (אזור, נקודה, ציר).
 */
function groupLayersByName(layers) {
  const groups = new Map(); // baseName -> { ...layer, items: [...] }
  const result = [];
  const processedIds = new Set();

  for (const layer of layers) {
    if (processedIds.has(layer.id)) continue;

    const parsed = parseLayerNameWithGeometrySuffix(layer.name || layer.id);

    if (parsed) {
      const baseNameRaw = parsed.baseNameRaw;
      const baseNameNorm = parsed.baseNameNorm;
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

      for (const item of layer.items) {
        group.items.push({ ...item });
      }
      processedIds.add(layer.id);
    } else {
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

// ---------------------------------------------------------------------------
// buildLegendModel
// ---------------------------------------------------------------------------

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

      if (renderer === "uniqueValue") {
        const collapseLabel = config.ui?.legendLabel;
        if (collapseLabel) {
          const uv = config.style?.uniqueValues || {};
          const firstClass = (uv.classes || [])[0];
          const layerSymbol =
            firstClass?.symbol?.symbolLayers?.length > 0
              ? firstClass.symbol
              : config.style?.defaultSymbol;
          const symbol =
            layerSymbol?.symbolLayers?.length > 0
              ? layerSymbol
              : symbolFromSimpleStyle(config.style?.defaultStyle || {});
          const result = symbolIRToLegendItems(symbol, collapseLabel, geometryType);
          items = result.items;
          singleRowMultiSymbol = result.singleRowMultiSymbol;
        } else {
          items = itemsFromUniqueValue(config);
        }
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
        const layerSymbol = config.style?.defaultSymbol;
        const symbol =
          layerSymbol?.symbolLayers?.length > 0
            ? layerSymbol
            : symbolFromSimpleStyle(config.style?.defaultStyle || {});
        const label = config.name || layer.id;
        const result = symbolIRToLegendItems(symbol, label, geometryType);
        items = result.items;
        singleRowMultiSymbol = result.singleRowMultiSymbol;
        if (items.length === 0) {
          items = itemsFromSimple(config);
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

export {
  buildLegendModel,
  symbolIRToLegendItems,
  // Also re-export helpers used by map-legend.js renderer
  getDashBackground,
};

/**
 * Legend model builder — data logic for the cartographic legend.
 * Reads visible layers from an injected data context and style metadata from
 * an injected layer registry. Produces a renderer-agnostic model consumed by
 * map-legend.js (renderLegend / renderSymbolSpan).
 *
 * Hebrew labels used where available.
 */

import {
  normalizeLayerBaseName,
  parseLayerNameWithGeometrySuffix,
} from "../shared/layer-name-utils.js";
import { shouldShowLayerOnGisMap } from "../shared/gis-layer-filter.js";
import { resolvedColorsToLegendFill } from "../shared/nli-investigation-legend.js";
import { projectionHatchRasterParams } from "../shared/hatch-projection-presentation.js";
import {
  scaleLineOpacityPaintForGis,
  scaleLineWidthPaintForProjection,
  scaleNliPeoplePointRadius,
  scalePointRadiusPaintForProjection,
} from "../shared/maplibre-style-bridge.js";
import {
  getLayerDisplayLabel,
  LAYER_DISPLAY_LABELS,
} from "../shared/layer-display-glossary.js";
import {
  getLegendCategoryCopy,
  getPackDisplayLabel,
  LEGEND_POLICY,
} from "../shared/legend-copy.js";
import AdvancedStyleEngine from "../map-utils/advanced-style-engine.js";
import { peopleLegendClassVisible } from "./nli-people-marker-filter.js";
import { NLI_VISUAL_TOKENS } from "../shared/nli-investigation-theme.js";

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

function getCssForHatch(hatchConfig, color, presentation = {}) {
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
  if (presentation.surface === "projection") {
    const raster = projectionHatchRasterParams({ separation: spacing, width });
    const ratio = raster.pixelRatio || 1;
    return `repeating-linear-gradient(${angle}deg, ${color}, ${color} ${raster.width / ratio}px, transparent ${raster.width / ratio}px, transparent ${raster.separation / ratio}px)`;
  }
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
    if (!layer || layer.enable === false || layer.enabled === false) continue;
    if (layer.type === "fill") {
      fills.push({
        fillType: layer.fillType || "solid",
        color: layer.color,
        opacity: layer.opacity,
        hatch: layer.hatch,
        resolvedColors: layer.resolvedColors,
        resolvedOpacities: layer.resolvedOpacities,
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
function symbolIRToLegendItems(symbol, label, geometryType, presentation = {}) {
  const parsed = parseSymbolLayers(symbol);
  const { fills, strokes, markerLine, markerPoint } = parsed;
  const geom = (geometryType || "").toLowerCase();
  const items = [];
  let singleRowMultiSymbol = false;

  if (geom === "line") {
    const strokeSwatches = strokes.map((s) => ({
      color: s.color || "#000000",
      dash: s.dash,
      width: s.width,
      opacity: s.opacity,
    }));
    if (strokeSwatches.length > 0) {
      for (const sw of strokeSwatches) {
        items.push({
          label,
          shape: "line",
          stroke: sw.color,
          dash: sw.dash,
          strokeWidth: sw.width,
          strokeOpacity: sw.opacity,
          strokeSwatches: undefined,
        });
      }
    }
    if (markerLine && markerLine.marker) {
      const m = markerLine.marker;
      const markerColor = m.fillColor || m.strokeColor || "#808080";
      const markerShape = String(m.shape || "").toLowerCase() === "square" ? "square" : "point";
      items.push({
        label,
        shape: markerShape,
        fill: markerColor,
        stroke: m.strokeColor || markerColor,
        pointRadius: m.size != null ? Number(m.size) / 2 : undefined,
      });
    }
    if (items.length > 1) {
      singleRowMultiSymbol = true;
      const lineItems = items.filter((i) => i.shape === "line");
      const pointItems = items.filter((i) => i.shape !== "line");
      if (lineItems.length > 0 || pointItems.length > 0) {
        const components = [];
        if (lineItems.length > 0) {
          const rawSwatches = lineItems.map((i) => ({
            color: i.stroke,
            dash: i.dash,
            width: i.strokeWidth,
            opacity: i.strokeOpacity,
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
          components.push({
            label,
            shape: "line",
            stroke: lineItems[0].stroke,
            dash: lineItems[0].dash,
            strokeWidth: lineItems[0].strokeWidth,
            strokeOpacity: lineItems[0].strokeOpacity,
            strokeSwatches:
              coalesced.length > 0 ? coalesced : rawSwatches.slice(0, 1),
          });
        }
        components.push(...pointItems);
        return { items: [{ ...components[0], components }], singleRowMultiSymbol: true };
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
        const css = getCssForHatch(f.hatch, f.color || "#000000", presentation);
        if (css) hatchStyles.push(css);
      }
    }
    const hatchStyle = hatchStyles[0] || null;
    const hatchStyle2 = hatchStyles.length > 1 ? hatchStyles[1] : null;
    const gradient = fills.find(
      (f) => f.fillType === "gradient" && Array.isArray(f.resolvedColors),
    );
    if (gradient) {
      fill = resolvedColorsToLegendFill(gradient.resolvedColors, gradient.resolvedOpacities) || fill;
    }
    if (strokes.length > 0) stroke = strokes[0].color;
    items.push({
      label,
      shape: "polygon",
      fill,
      fillOpacity: fills.find((entry) => entry.fillType === "solid")?.opacity,
      stroke: stroke !== null ? stroke : undefined,
      strokeWidth: strokes[0]?.width,
      strokeOpacity: strokes[0]?.opacity,
      strokeSwatches: strokes.map((entry) => ({
        color: entry.color,
        width: entry.width,
        opacity: entry.opacity,
        dash: entry.dash,
      })),
      hatchStyle,
      hatchStyle2,
    });
    return { items, singleRowMultiSymbol: false };
  }

  if (geom === "point") {
    if (markerPoint && markerPoint.marker) {
      const m = markerPoint.marker;
      const rawShape = String(m.shape || "").toLowerCase();
      const shape = rawShape === "square" ? "square" : rawShape === "diamond" ? "diamond" : "point";
      items.push({
        label,
        shape,
        fill: m.fillColor || m.strokeColor || "#808080",
        stroke: m.strokeColor || m.fillColor,
        strokeWidth: m.strokeWidth,
        opacity: markerPoint.opacity,
        pointRadius: m.size != null ? Number(m.size) / 2 : undefined,
      });
    } else if (fills.length > 0 || strokes.length > 0) {
      items.push({
        label,
        shape: "point",
        fill: fills.length > 0 && fills[0].color ? fills[0].color : "#808080",
        stroke: strokes.length > 0 ? strokes[0].color : undefined,
        strokeWidth: strokes.length > 0 ? strokes[0].width : undefined,
        strokeOpacity: strokes.length > 0 ? strokes[0].opacity : undefined,
        opacity: fills.length > 0 ? fills[0].opacity : undefined,
      });
    }
    return { items, singleRowMultiSymbol: false };
  }

  return { items, singleRowMultiSymbol: false };
}

function applySurfacePresentation(item, surface, fullId) {
  const projection = surface === "projection";
  const hatchPresentation = { applyProjectionHatchPresentation: projection };
  const next = { ...item };
  if (next.strokeWidth != null) {
    next.strokeWidth = scaleLineWidthPaintForProjection(next.strokeWidth, hatchPresentation, fullId);
  }
  if (next.strokeOpacity != null) {
    next.strokeOpacity = scaleLineOpacityPaintForGis(next.strokeOpacity, hatchPresentation, fullId);
  }
  if (next.pointRadius != null) {
    next.pointRadius = scaleNliPeoplePointRadius(
      scalePointRadiusPaintForProjection(next.pointRadius, hatchPresentation),
      hatchPresentation,
      fullId,
    );
  }
  if (Array.isArray(next.strokeSwatches)) {
    next.strokeSwatches = next.strokeSwatches.map((swatch) => ({
      ...swatch,
      width: swatch.width == null ? swatch.width : scaleLineWidthPaintForProjection(swatch.width, hatchPresentation, fullId),
      opacity: swatch.opacity == null ? swatch.opacity : scaleLineOpacityPaintForGis(swatch.opacity, hatchPresentation, fullId),
    }));
  }
  if (Array.isArray(next.components)) {
    next.components = next.components.map((part) => applySurfacePresentation(part, surface, fullId));
  }
  return next;
}

function investigationRouteDash() {
  const period = NLI_VISUAL_TOKENS.routeFlowPeriodPx;
  const duty = NLI_VISUAL_TOKENS.routeFlowDutyCycle;
  return { array: [period * duty, period * (1 - duty)] };
}

function applyInvestigationRouteLegendPart(part) {
  const dash = investigationRouteDash();
  const next = {
    ...part,
    carrier: NLI_VISUAL_TOKENS.incidentRed,
    stroke: NLI_VISUAL_TOKENS.routeFlowColor,
    halo: "#ffffff",
    dash,
  };
  if (Array.isArray(part?.strokeSwatches)) {
    next.strokeSwatches = part.strokeSwatches.map((swatch) => ({
      ...swatch,
      color: NLI_VISUAL_TOKENS.routeFlowColor,
      dash,
    }));
  }
  if (Array.isArray(part?.components)) {
    next.components = part.components.map((component) => (
      component?.shape === "line" ? applyInvestigationRouteLegendPart(component) : component
    ));
  }
  return next;
}

function applyInvestigationRouteLegend(items, fullId) {
  if (fullId !== "nli.lines") return items;
  return items.map((item) => applyInvestigationRouteLegendPart(item));
}

function applyAlarmShockwaveLegendPart(part) {
  const next = {
    ...part,
    fill: NLI_VISUAL_TOKENS.alarmYellow,
    fillOpacity: 0.3,
    stroke: "transparent",
    alarmShockwave: true,
    alarmShockwaveColor: NLI_VISUAL_TOKENS.alarmYellow,
  };
  if (Array.isArray(part?.components)) {
    next.components = part.components.map((component) => (
      component?.shape === "point" || component?.shape === "square" || component?.shape === "diamond"
        ? applyAlarmShockwaveLegendPart(component)
        : component
    ));
  }
  return next;
}

function applyAlarmShockwaveLegend(items, fullId) {
  if (fullId !== "nli.alarms") return items;
  return items.map((item) => applyAlarmShockwaveLegendPart(item));
}

function legendGeometryRank(layer) {
  const geom = String(layer?.geometryType || "").toLowerCase();
  if (layer?.isComposite || geom === "mixed") return 3;
  if (geom === "point") return 0;
  if (geom === "line" || geom === "polyline") return 1;
  if (geom === "polygon" || geom === "multipolygon") return 2;
  const types = new Set();
  const addShape = (shape) => {
    const kind = String(shape || "").toLowerCase();
    if (kind === "point" || kind === "square" || kind === "diamond") types.add("point");
    else if (kind === "line") types.add("line");
    else if (kind === "polygon") types.add("polygon");
  };
  for (const item of layer?.items || []) {
    addShape(item?.shape);
    for (const part of item?.components || []) addShape(part?.shape);
  }
  if (types.size > 1) return 3;
  if (types.has("point")) return 0;
  if (types.has("line")) return 1;
  if (types.has("polygon")) return 2;
  return 3;
}

function sortLegendLayersByGeometry(layers) {
  return [...(Array.isArray(layers) ? layers : [])]
    .map((layer, index) => ({ layer, index, rank: legendGeometryRank(layer) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.layer);
}

// ---------------------------------------------------------------------------
// Style-type specific item builders
// ---------------------------------------------------------------------------

/**
 * Items from simple config: use IR path so legend aligns with style engine.
 */
function itemsFromSimple(config, options = {}) {
  const defaultStyle = config.style?.defaultStyle || {};
  const layerSymbol = config.style?.defaultSymbol;
  const symbol =
    layerSymbol?.symbolLayers?.length > 0
      ? layerSymbol
      : symbolFromSimpleStyle(defaultStyle);
  const label = config.name || config.id || "";
  const geometryType = config.geometryType || "polygon";
  const { items } = symbolIRToLegendItems(symbol, label, geometryType, options.presentation);
  return items;
}

function uniqueValueClassesForLegend(config, options = {}) {
  const classes = config.style?.uniqueValues?.classes || [];
  const visible = classes.filter((entry) => entry?.legend?.hidden !== true);
  if (options.fullId !== "nli.people") return visible;
  return visible.filter((entry) => peopleLegendClassVisible(options.narrativeId, entry?.value));
}

/**
 * Items from uniqueValue: each class resolved to symbol IR, then IR -> legend.
 */
function itemsFromUniqueValue(config, options = {}) {
  const classes = uniqueValueClassesForLegend(config, options);
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
    const { items } = symbolIRToLegendItems(symbol, classLabel, geometryType, options.presentation);
    if (items.length > 0) {
      for (const item of items) {
        out.push({
          ...item,
          label: classLabel,
          shape: item.shape || shape,
          _classValue: c.value,
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Grouping logic
// ---------------------------------------------------------------------------

/**
 * Group layers by name suffix (e.g. "Name-אזור", "Name_אזור").
 * Returns a new list of layers where matching layers are merged into one composite layer.
 * Supports both hyphen and underscore before Hebrew suffix (אזור, נקודה, ציר).
 */
function familyKeyForLayer(layer) {
  if (layer.legendFamilyId) return `explicit:${String(layer.legendFamilyId)}`;
  const parsed = parseLayerNameWithGeometrySuffix(layer.rawName || "");
  return parsed ? `compat:${normalizeLayerBaseName(parsed.baseNameRaw)}` : null;
}

function familyDisplayNameForLayer(layer, options) {
  const parsed = parseLayerNameWithGeometrySuffix(layer.rawName || "");
  if (!parsed) return layer.name;
  const localized = String(layer.name || "");
  if (localeFor(options) === "en") {
    return localized.replace(/\s+—\s+(area|point|axis)$/i, "");
  }
  return localized.replace(/\s+—\s+(אזור|נקודה|ציר)$/i, "");
}

function groupLayersByFamily(layers, packId) {
  const result = [];
  const groups = new Map();
  for (const layer of layers) {
    const familyKey = familyKeyForLayer(layer);
    if (!familyKey) {
      result.push(layer);
      continue;
    }
    let group = groups.get(familyKey);
    if (!group) {
      const parsed = parseLayerNameWithGeometrySuffix(layer.rawName || "");
      group = {
        id: `${packId}.family.${familyKey}`,
        name: layer.familyDisplayName || (parsed ? parsed.baseNameRaw : layer.name),
        geometryType: "mixed",
        items: [],
        isComposite: true,
        familyId: layer.legendFamilyId || null,
        memberLayers: [],
      };
      groups.set(familyKey, group);
      result.push(group);
    }
    group.memberLayers.push(layer);
    group.items.push(...(layer.items || []).map((item) => ({ ...item })));
  }
  return result.map((layer) => {
    if (!layer.memberLayers) return layer;
    if (layer.memberLayers.length === 1) return layer.memberLayers[0];
    const next = { ...layer };
    next.isComposite = layer.memberLayers.every((member) => (member.items || []).length === 1);
    delete next.memberLayers;
    return next;
  });
}

function shouldIncludeLayerInLegend(groupId, layerId, surface = "gis") {
  switch (surface) {
    case "projection":
      return groupId !== "projector_base" && !(groupId === "gaza" && layerId === "Gaza_Roads");
    case "gis":
      if (groupId === "projector_base") return false;
      if (groupId === "gaza" && layerId === "Gaza_Roads") return false;
      return typeof shouldShowLayerOnGisMap !== "function" || shouldShowLayerOnGisMap(groupId, layerId);
    default: {
      throw new Error(`unknown legend surface: ${surface}`);
    }
  }
}

function localeFor(options) {
  return options.language === "en" ? "en" : "he";
}

function legendPackDisplayLabel(packId, locale) {
  return getPackDisplayLabel(packId === "nli" ? "october_7th" : packId, locale);
}

function translatedLabel(label, locale) {
  if (label == null) return null;
  if (typeof label === "object") {
    const value = label[locale];
    return value == null || String(value).trim() === "" ? null : String(value);
  }
  return String(label).trim() === "" ? null : String(label);
}

function layerDisplayName(config, layer, options) {
  const locale = localeFor(options);
  const inline = translatedLabel(config.legend?.label, locale);
  if (inline) return inline;
  const fullId = options.fullId || layer.fullId || layer.id;
  const policy = LEGEND_POLICY[fullId];
  const policyLabel = translatedLabel(policy?.label, locale);
  const candidateIds = [fullId, ...(layer.fullLayerIds || [])];
  const glossaryId = candidateIds.find((id) => LAYER_DISPLAY_LABELS[id]);
  const glossary = glossaryId
    ? getLayerDisplayLabel(glossaryId, locale, config.name || layer.name || layer.id)
    : null;
  return glossary
    || policyLabel
    || translatedLabel(config.ui?.legendLabel, locale)
    || config.name
    || layer.name
    || layer.id;
}

function classDisplayLabel(config, classEntry, options) {
  const locale = localeFor(options);
  const fullId = options.fullId || config.fullId || config.id;
  if (options.language == null) {
    return (
      translatedLabel(classEntry?.displayLabel, locale)
      || translatedLabel(classEntry?.label, locale)
      || (classEntry?.value == null ? "" : String(classEntry.value))
    );
  }
  return (
    translatedLabel(classEntry?.legend?.label, locale)
    || getLegendCategoryCopy(fullId, classEntry?.value, locale)
    || translatedLabel(classEntry?.displayLabel, locale)
    || translatedLabel(classEntry?.label, locale)
    || (classEntry?.value == null ? "" : String(classEntry.value))
  );
}

function symbolSignature(item) {
  const copy = { ...item };
  delete copy.id;
  delete copy.label;
  const stable = (value) => {
    if (Array.isArray(value)) return value.map(stable);
    if (!value || typeof value !== "object") return value;
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = stable(value[key]);
      return out;
    }, {});
  };
  return JSON.stringify(stable(copy));
}

function summaryLabel(config, options) {
  const fullId = options.fullId || config.fullId || config.id;
  return translatedLabel(config.legend?.summary?.label, localeFor(options))
    || translatedLabel(LEGEND_POLICY[fullId]?.summary?.label, localeFor(options));
}

function applyStableItemIds(items, fullId, classValues = null) {
  return items.map((item, index) => {
    const classValue = item._classValue ?? (classValues ? classValues[index] : null);
    const next = { ...item };
    delete next._classValue;
    return {
      ...next,
      id: item.id || `${fullId}${classValue != null ? `:${classValue}` : ""}`,
    };
  });
}

function renderableSymbolParts(item) {
  if (Array.isArray(item.components) && item.components.length > 0) {
    return item.components.flatMap(renderableSymbolParts);
  }

  const leaf = { ...item };
  delete leaf.id;
  delete leaf.label;
  delete leaf.components;
  delete leaf.strokeSwatches;

  if (Array.isArray(item.strokeSwatches) && item.strokeSwatches.length > 0) {
    return item.strokeSwatches.map((swatch) => ({
      ...leaf,
      stroke: swatch.color,
      dash: swatch.dash,
      strokeWidth: swatch.width,
      strokeOpacity: swatch.opacity,
    }));
  }

  return [leaf];
}

function summarizeItems(items, label, fullId) {
  const distinct = [];
  const seen = new Set();
  for (const item of items) {
    for (const part of renderableSymbolParts(item)) {
      const signature = symbolSignature(part);
      if (seen.has(signature)) continue;
      seen.add(signature);
      distinct.push(part);
    }
  }
  if (distinct.length === 0) return [];
  const visibleLines = distinct.filter((part) => (
    part.shape === "line"
    && (part.strokeOpacity == null || Number(part.strokeOpacity) > 0)
  ));
  const lineColors = new Set(visibleLines.map((part) => part.stroke));
  let components = distinct;
  if (visibleLines.length > 0 && lineColors.size === 1) {
    const lineWidth = (part) => (Number.isFinite(Number(part.strokeWidth)) ? Number(part.strokeWidth) : 1);
    const representative = visibleLines.reduce((thickest, part) => (
      lineWidth(part) > lineWidth(thickest) ? part : thickest
    ));
    let inserted = false;
    components = distinct.flatMap((part) => {
      if (part.shape !== "line") return [part];
      if (inserted) return [];
      inserted = true;
      return [representative];
    });
  }
  return [{
    ...components[0],
    id: `${fullId}:summary`,
    label,
    components,
  }];
}

/** Build one legend layer from style config and explicit legend metadata. */
function legendLayerFromConfig(config, layer, options = {}) {
  const fullId = options.fullId || layer.fullId || layer.id;
  if (config.legend?.hidden === true || config.ui?.hideInLegend) return null;

  const style =
    fullId === "nli.investigation_polygons" && options.rawStyle
      ? options.rawStyle
      : config.style || {};
  const effectiveConfig = style === config.style ? config : { ...config, style };
  const renderer = style.renderer || "simple";
  const geometryType = config.geometryType || "polygon";
  let items = [];
  let singleRowMultiSymbol = false;
  let classValues = null;

  if (renderer === "uniqueValue") {
    const classes = uniqueValueClassesForLegend(effectiveConfig, options);
    classValues = classes.map((entry) => entry?.value);
    items = itemsFromUniqueValue(effectiveConfig, {
      ...options,
      presentation: { surface: options.surface || "gis" },
    }).map((item) => ({
      ...item,
      label: classDisplayLabel(
        effectiveConfig,
        classes.find((entry) => String(entry?.value) === String(item._classValue)),
        options,
      ),
    }));
  } else {
    const layerSymbol = style.defaultSymbol;
    const symbol =
      layerSymbol?.symbolLayers?.length > 0
        ? layerSymbol
        : symbolFromSimpleStyle(style.defaultStyle || {});
    const label = layerDisplayName(config, layer, options);
    const result = symbolIRToLegendItems(symbol, label, geometryType, options.presentation);
    items = result.items;
    singleRowMultiSymbol = result.singleRowMultiSymbol;
    if (items.length === 0) {
      items = itemsFromSimple(effectiveConfig, options);
    }
  }

  if (items.length === 0) return null;

  items = items.map((item) => applySurfacePresentation(item, options.surface || "gis", fullId));

  items = applyStableItemIds(items, fullId, classValues);
  const authoredSummaryLabel = summaryLabel(config, options);
  const hasAuthoredSummary = !!config.legend?.summary || !!LEGEND_POLICY[fullId]?.summary;
  const canSummarize = (options.summaryRequested === true || hasAuthoredSummary)
    && !String(fullId).startsWith("nli.")
    && authoredSummaryLabel;
  if (canSummarize) {
    items = summarizeItems(items, authoredSummaryLabel, fullId);
  }

  items = applyInvestigationRouteLegend(items, fullId);
  items = applyAlarmShockwaveLegend(items, fullId);

  return {
    id: fullId,
    name: canSummarize ? authoredSummaryLabel : layerDisplayName(config, layer, options),
    geometryType,
    items,
    singleRowMultiSymbol,
    rawName: config.name || layer.name || layer.id,
    legendFamilyId: config.legend?.familyId || null,
    familyDisplayName: familyDisplayNameForLayer({
      rawName: config.name || layer.name || layer.id,
      name: layerDisplayName(config, layer, options),
    }, options),
  };
}

// ---------------------------------------------------------------------------
// buildLegendModel
// ---------------------------------------------------------------------------

async function buildLegendModel(options = {}) {
  const surface = options.surface == null ? "gis" : options.surface;
  if (surface !== "gis" && surface !== "projection") {
    throw new Error(`unknown legend surface: ${surface}`);
  }
  const packs = [];
  const ctx = options.dataContext;
  const registry = options.registry;

  if (!ctx || typeof ctx.getLayerGroups !== "function") {
    throw new Error("legend dataContext is required");
  }
  if (!registry || typeof registry.getLayerConfig !== "function") {
    throw new Error("legend registry is required");
  }

  const layerGroups = ctx.getLayerGroups() || [];

  if (registry && !registry._initialized) {
    await registry.init();
  }

  for (const group of layerGroups) {
    let packLayers = [];
    const registryGroup = (registry?.getGroups?.() || []).find((entry) => entry?.id === group.id) || null;
    const groupSummary = group.legend?.summary
      || group.summary
      || registryGroup?.legend?.summary
      || registryGroup?.summary;
    const groupSummarySelected = Array.isArray(options.summarizedGroupIds)
      && options.summarizedGroupIds.includes(group.id)
      && !!groupSummary;

    for (const layer of group.layers || []) {
      if (!layer.enabled) continue;

      const fullId = `${group.id}.${layer.id}`;
      if (!shouldIncludeLayerInLegend(group.id, layer.id, surface)) {
        continue;
      }

      const config = registry ? registry.getLayerConfig(fullId) : null;
      if (!config) continue;

      if (typeof registry.getPackStyleJsonForLayer !== "function") {
        throw new Error("legend registry raw-style accessor is required");
      }
      const rawStyle = registry.getPackStyleJsonForLayer(fullId);
      if (!rawStyle || typeof rawStyle !== "object") {
        console.warn(`[MapLegend] Skipping ${fullId}: no authored raw style`);
        continue;
      }
      const renderer = rawStyle.renderer || "simple";
      if (!["simple", "uniqueValue"].includes(renderer)) {
        console.warn(`[MapLegend] Skipping ${fullId}: unsupported renderer ${renderer}`);
        continue;
      }

      const layerConfig = { ...config, ...layer, style: rawStyle };

      const built = legendLayerFromConfig(layerConfig, layer, {
        fullId,
        language: options.language,
        summaryRequested: false,
        rawStyle,
        surface,
        narrativeId: ctx.getNarrativeState?.()?.id ?? null,
      });
      if (!built || (built.items || []).length === 0) continue;

      packLayers.push(built);
    }

    if (packLayers.length === 0) continue;

    if (groupSummarySelected && group.id !== "nli") {
      const label = translatedLabel(groupSummary.label, localeFor(options));
      if (label) {
        const items = summarizeItems(
          packLayers.flatMap((entry) => entry.items || []),
          label,
          `${group.id}:summary`,
        );
        packLayers = items.length > 0 ? [{
          id: `${group.id}:summary`,
          name: label,
          geometryType: "mixed",
          items,
          singleRowMultiSymbol: true,
        }] : [];
      }
    }

    packLayers = sortLegendLayersByGeometry(groupLayersByFamily(packLayers, group.id));

    const packName =
      translatedLabel(group.legend?.label, localeFor(options))
      || translatedLabel(registryGroup?.legend?.label, localeFor(options))
      || legendPackDisplayLabel(group.id, localeFor(options))
      || group.name
      || registryGroup?.name
      || group.id;

    packs.push({
      id: group.id,
      name: String(packName || group.id).trim() || group.id,
      layers: packLayers,
    });
  }

  const nliIndex = packs.findIndex((pack) => pack.id === "nli");
  if (nliIndex > 0) {
    packs.unshift(...packs.splice(nliIndex, 1));
  }

  return { packs };
}

export {
  buildLegendModel,
  legendLayerFromConfig,
  shouldIncludeLayerInLegend,
  symbolIRToLegendItems,
  // Also re-export helpers used by map-legend.js renderer
  getDashBackground,
};

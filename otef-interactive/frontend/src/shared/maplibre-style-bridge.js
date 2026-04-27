/**
 * Translate OTEF AdvancedStyleEngine IR (symbolLayers)
 * into MapLibre style layer definitions.
 */
import {
  projectionHatchRasterParams,
  PROJECTION_MAPLIBRE_STROKE_WIDTH_SCALE,
} from "./hatch-projection-presentation.js";
import { buildMarkerLineSquareImageSpec } from "./markerline-square-image.js";

function getNestedProp(obj, propPath) {
  if (!obj || !propPath) return undefined;
  const parts = propPath.split(".");
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

/**
 * Dirt roads used for projection calibration: processed style can add a synthetic black stroke
 * under a brown fill; fill-before-stroke sort would paint that stroke on top and wash the layer
 * out. Keep legacy line-over-fill ordering here only.
 */
const FULL_LAYER_IDS_SKIP_FILL_BEFORE_STROKE_SORT = new Set(["muniplicity_transport.דרכי_עפר"]);

function isLineGeometryType(geometryType) {
  if (!geometryType) return false;
  const g = String(geometryType).toLowerCase().replace(/_/g, "");
  return (
    g === "line" ||
    g === "multilinestring" ||
    g === "esrigeometrypolyline" ||
    g === "esrigeometryline" ||
    g === "esrigeometrymultilinestring"
  );
}

/**
 * @param {string} fullLayerId
 * @param {string|undefined} geometryType - from layer manifest / registry
 */
function shouldSortFillsBeforeStrokesForPackLayer(fullLayerId, geometryType) {
  if (FULL_LAYER_IDS_SKIP_FILL_BEFORE_STROKE_SORT.has(String(fullLayerId || "").trim())) {
    return false;
  }
  return !isLineGeometryType(geometryType);
}

function isMarkerLineSquareSymbol(symbolLayer) {
  if (!symbolLayer || symbolLayer.type !== "markerLine") return false;
  const s = symbolLayer?.marker?.shape;
  if (s == null || s === "") return false;
  return String(s).toLowerCase() === "square";
}

/**
 * Wider/solid before dashed so thinner dashed strokes are not fully covered in multi-stroke
 * line packs. Only permutes `type === "line"` entries, preserving non-line order.
 * Not applied to polygon/line+fill cartography: gated on line geometry in `irToMapLibreLayers`.
 * @param {Array<{ type?: string, paint?: object }>} layers
 * @returns {typeof layers}
 */
function sortLinePackStrokeOrderForDashedVisibility(layers) {
  if (!Array.isArray(layers) || layers.length <= 1) return layers;
  const lineIndices = [];
  for (let i = 0; i < layers.length; i += 1) {
    if (layers[i] && layers[i].type === "line") {
      lineIndices.push(i);
    }
  }
  if (lineIndices.length <= 1) return layers;

  function hasDash(paint) {
    if (!paint) return false;
    return (
      Object.prototype.hasOwnProperty.call(paint, "line-dasharray") && paint["line-dasharray"] != null
    );
  }

  function widthKey(paint) {
    if (!paint) return null;
    const w = paint["line-width"];
    if (typeof w === "number" && Number.isFinite(w)) return w;
    return null;
  }

  const lineLayers = lineIndices.map((idx) => layers[idx]);
  const sorted = lineLayers.slice().sort((a, b) => {
    const aDash = hasDash(a && a.paint);
    const bDash = hasDash(b && b.paint);
    if (aDash !== bDash) {
      if (aDash) return 1;
      if (bDash) return -1;
    }
    if (!aDash && !bDash) {
      const wa = widthKey(a && a.paint);
      const wb = widthKey(b && b.paint);
      if (wa != null && wb != null && wa !== wb) {
        return wb - wa;
      }
    }
    return 0;
  });

  const out = layers.slice();
  for (let j = 0; j < lineIndices.length; j += 1) {
    out[lineIndices[j]] = sorted[j];
  }
  return out;
}

function mapLibreLineSymbolSpacingForMarkerLine(symbolLayer, hatchPresentation) {
  const placement = symbolLayer?.placement || {};
  const n = placement.interval;
  // Processed lyrx intervals are point-like units; MapLibre expects pixel spacing.
  // Keep GIS slightly denser than the previous pass, projection a touch sparser.
  if (typeof n === "number" && n > 0) {
    const scale = hatchPresentation?.applyProjectionHatchPresentation ? 1.15 : 2.25;
    return n * scale;
  }
  return 30;
}

function markerLineSquareIconSize(hatchPresentation) {
  // GIS needs stronger separation from the rail stroke; projection remains a bit smaller.
  return hatchPresentation?.applyProjectionHatchPresentation ? 0.8 : 1.0;
}

/**
 * @param {{ applyProjectionHatchPresentation?: boolean }} hatchPresentation
 * @param {number|Array|undefined} lineWidth
 */
function scaleLineWidthPaintForProjection(lineWidth, hatchPresentation) {
  if (!hatchPresentation?.applyProjectionHatchPresentation) return lineWidth;
  const scale = Number(PROJECTION_MAPLIBRE_STROKE_WIDTH_SCALE);
  if (!Number.isFinite(scale) || scale <= 0 || scale === 1) return lineWidth;
  if (lineWidth == null) return Math.max(0, scale);
  if (typeof lineWidth === "number" && Number.isFinite(lineWidth)) {
    return Math.max(0, lineWidth * scale);
  }
  if (Array.isArray(lineWidth)) {
    return ["*", scale, lineWidth];
  }
  return lineWidth;
}

function fieldNameCaseVariants(field) {
  if (!field || typeof field !== "string") return [field];
  const out = new Set();
  out.add(field);
  out.add(field.toLowerCase());
  out.add(field.toUpperCase());
  if (field.length > 1) {
    out.add(field.charAt(0).toUpperCase() + field.slice(1).toLowerCase());
  }
  return [...out].sort();
}

function uniqueValueClassificationInputExpression(field) {
  const variants = fieldNameCaseVariants(field);
  if (variants.length === 1) {
    return ["to-string", ["get", variants[0]]];
  }
  const reads = variants.map((v) => ["get", v]);
  return ["to-string", ["coalesce", ...reads, ""]];
}

/**
 * Text label field: same case-variant + coalesce strategy as unique-value classification,
 * for GeoJSON property names that differ only by case (e.g. TextString).
 */
function labelTextFieldExpression(field) {
  return uniqueValueClassificationInputExpression(field);
}

/** Old pipeline placeholder; MapLibre should use white leaders like ArcGIS callouts. */
const LEGACY_LEADER_COLOR = /^#c86464$/i;

function resolveLeaderLineColor(labels) {
  const raw =
    labels && labels.leaderColor != null && String(labels.leaderColor).trim() !== ""
      ? String(labels.leaderColor).trim()
      : "";
  if (raw && LEGACY_LEADER_COLOR.test(raw)) return "#ffffff";
  return raw || "#ffffff";
}

function isLabelSymbolGeometry(geometryType) {
  if (!geometryType) return false;
  const g = String(geometryType).toLowerCase().replace(/_/g, "");
  return (
    g === "point" ||
    g === "multipoint" ||
    g === "esrigeometrypoint" ||
    g === "esrigeometrymultipoint" ||
    g === "polygon" ||
    g === "multipolygon" ||
    g === "esrigeometrypolygon" ||
    g === "esrigeometrymultipolygon"
  );
}

const NOTO_SANS_REGULAR = "Noto Sans Regular";

function buildLabelFontStack(labels) {
  const fallback = [NOTO_SANS_REGULAR];
  if (Array.isArray(labels?.font) && labels.font.length > 0) {
    const faces = labels.font.map((f) => String(f).trim()).filter((s) => s.length > 0);
    if (faces.some((n) => n === "Noto Sans Hebrew Regular")) {
      return fallback;
    }
    if (faces.length > 0) {
      const hasNoto = faces.some((n) => String(n).includes("Noto Sans"));
      if (hasNoto) {
        return faces;
      }
      return [...faces, NOTO_SANS_REGULAR];
    }
    return fallback;
  }
  if (typeof labels?.font === "string" && labels.font.trim() !== "") {
    const s = labels.font.trim();
    if (s.includes("Noto Sans")) {
      return [s];
    }
    return [s, NOTO_SANS_REGULAR];
  }
  return fallback;
}

/**
 * Numeric GeoJSON property by name, with the same case-variant + coalesce strategy
 * as label text / text-rotate (e.g. XOffset / xoffset).
 */
function buildLabelOffsetEmPropertyNumber(field) {
  const name = field && String(field).trim() !== "" ? String(field).trim() : "XOffset";
  const variants = fieldNameCaseVariants(name);
  if (variants.length === 1) {
    return ["to-number", ["get", variants[0]]];
  }
  return ["to-number", ["coalesce", ...variants.map((v) => ["get", v]), "0"]];
}

/**
 * MapLibre layout text-offset (ems). When offsetEmFromProperties is true, prefers
 * When offsetEmFieldX + offsetEmFieldY are set, [x/d, y/d] with case-agnostic property reads
 * (divisor: offsetEmDivisor, else labels.size, else 11).
 * We do not coalesce `otef_text_offset_em` here: some GeoJSON exports set it to a scalar,
 * which makes MapLibre expect `array<number,2>` for text-offset and throws in the worker.
 * otherwise static labels.offsetEm, then labels.offset, else [0,0].
 */
function buildLabelTextOffset(labels) {
  if (labels.offsetEmFromProperties === true) {
    const fieldX = labels.offsetEmFieldX;
    const fieldY = labels.offsetEmFieldY;
    const hasXY =
      fieldX != null &&
      String(fieldX).trim() !== "" &&
      fieldY != null &&
      String(fieldY).trim() !== "";

    const size = Number(labels.size);
    const divFromSize = size > 0 ? size : 11;
    const divExplicit = Number(labels.offsetEmDivisor);
    const divisorRaw =
      Number.isFinite(divExplicit) && divExplicit > 0 ? divExplicit : divFromSize;
    const divisor = Number.isFinite(divisorRaw) && divisorRaw > 0 ? divisorRaw : 11;

    if (hasXY) {
      const xExpr = buildLabelOffsetEmPropertyNumber(String(fieldX).trim());
      const yExpr = buildLabelOffsetEmPropertyNumber(String(fieldY).trim());
      // Style-spec: ["array", type, N, ...] — N must be a positive integer literal.
      return [
        "array",
        "number",
        2,
        ["/", xExpr, divisor],
        ["/", yExpr, divisor],
      ];
    }

    return ["literal", [0, 0]];
  }

  if (Array.isArray(labels.offsetEm) && labels.offsetEm.length >= 2) {
    return ["literal", [Number(labels.offsetEm[0]) || 0, Number(labels.offsetEm[1]) || 0]];
  }

  if (Array.isArray(labels.offset) && labels.offset.length >= 2) {
    return ["literal", [Number(labels.offset[0]) || 0, Number(labels.offset[1]) || 0]];
  }

  return ["literal", [0, 0]];
}

/**
 * Data-driven `text-rotate` (degrees) from a GeoJSON numeric property, with
 * case-agnostic property names (e.g. Angle / angle) — same as label field resolution.
 * Missing values default to 0.
 */
function buildLabelTextRotateFromProperty(propertyName) {
  const name = propertyName && String(propertyName).trim() !== "" ? String(propertyName) : "Angle";
  const variants = fieldNameCaseVariants(name);
  if (variants.length === 1) {
    return ["to-number", ["get", variants[0]]];
  }
  return ["to-number", ["coalesce", ...variants.map((v) => ["get", v]), "0"]];
}

/** @returns {number|Array|undefined} MapLibre text-rotate static number, expression, or unset */
function buildLabelTextRotateValue(labels) {
  if (labels?.angleFromProperties === true) {
    return buildLabelTextRotateFromProperty(labels.angleProperty);
  }
  if (labels?.angle != null && Number.isFinite(Number(labels.angle))) {
    return Number(labels.angle);
  }
  return undefined;
}

/** @returns {object[]} 0 or 1 MapLibre layer object(s) */
function buildLabelSymbolLayer(idBase, style, geometryType) {
  if (!isLabelSymbolGeometry(geometryType)) return [];
  const labels = style && style.labels;
  if (!labels || typeof labels !== "object") return [];

  const field = labels.field != null && labels.field !== "" ? labels.field : "TextString";
  const textField = labelTextFieldExpression(field);
  const size = Number(labels.size);
  const haloW = Number(labels.haloSize);
  const textRotate = buildLabelTextRotateValue(labels);

  const layout = {
    "text-field": textField,
    "text-size": size > 0 ? size : 12,
    "text-font": buildLabelFontStack(labels),
    "text-offset": buildLabelTextOffset(labels),
    "text-anchor": labels.textAnchor != null && Array.isArray(labels.textAnchor) ? labels.textAnchor : (labels.textAnchor != null ? String(labels.textAnchor) : "center"),
    "text-justify":
      labels.textJustify != null && String(labels.textJustify) !== ""
        ? String(labels.textJustify)
        : "auto",
    // Omit default text-writing-mode: forcing ["horizontal"] can interact badly with bidi/Hebrew;
    // MapLibre 5.x defaults are sufficient; use `labels.textWritingModeHorizontal: true` to opt in.
  };
  if (labels.forceVisible === true) {
    layout["text-allow-overlap"] = true;
    layout["text-ignore-placement"] = true;
    layout["text-optional"] = false;
  } else if (labels.leaderLine === true) {
    // Callout labels share one GeoJSON source; default collision hiding drops many names
    // while leader lines still draw, which looks like missing/misaligned text vs lines.
    layout["text-allow-overlap"] = true;
    layout["text-ignore-placement"] = true;
  }
  if (labels.textWritingModeHorizontal === true) {
    layout["text-writing-mode"] = ["literal", ["horizontal"]];
  }
  if (textRotate !== undefined) {
    layout["text-rotate"] = textRotate;
  }
  if (labels.angleFromProperties === true) {
    // ArcGIS annotation angles are in map space; keep glyphs aligned to the map (not the viewport).
    layout["text-rotation-alignment"] = "map";
    layout["text-pitch-alignment"] = "map";
  }

  const paint = {
    "text-color": labels.color != null && labels.color !== "" ? labels.color : "#000000",
    "text-halo-color": labels.haloColor != null && labels.haloColor !== "" ? labels.haloColor : "#ffffff",
    "text-halo-width": haloW > 0 ? haloW : 0,
    "text-opacity": labels.colorOpacity != null ? Number(labels.colorOpacity) : 1,
  };

  /** Leader GeoJSON mixes LineString callouts with point/polygon anchors; skip lines for symbols. */
  const labelGeometryFilter =
    labels.leaderLine === true
      ? [
          "!",
          ["in", ["geometry-type"], ["literal", ["LineString", "MultiLineString"]]],
        ]
      : undefined;

  return [
    {
      id: `${idBase}__labels`,
      type: "symbol",
      layout,
      paint,
      ...(labelGeometryFilter ? { filter: labelGeometryFilter } : {}),
      _labelSymbol: true,
    },
  ];
}

/**
 * When labels.leaderLine is true, render connector lines from processed GeoJSON features
 * with property otef_label_leader: true. Placed under symbol labels
 * in the layer list so text draws on top.
 * @returns {object[]} 0 or 1 MapLibre line layer(s)
 */
function buildLabelLeaderLineLayer(idBase, style, geometryType) {
  if (!isLabelSymbolGeometry(geometryType)) return [];
  const labels = style && style.labels;
  if (!labels || typeof labels !== "object" || !labels.leaderLine) return [];

  const color = resolveLeaderLineColor(labels);
  const w = Number(labels.leaderWidth);
  const op = labels.leaderOpacity != null ? Number(labels.leaderOpacity) : 1;
  const paint = {
    "line-color": color,
    "line-width": w > 0 ? w : 1.3333333333333333,
  };
  if (Number.isFinite(op) && op < 1) {
    paint["line-opacity"] = op;
  }

  return [
    {
      id: `${idBase}__leader`,
      type: "line",
      filter: ["==", ["get", "otef_label_leader"], true],
      layout: { "line-cap": "round", "line-join": "round" },
      paint,
      _labelLeader: true,
    },
  ];
}

function normalizeUniqueValueMatchKey(value) {
  if (value === undefined || value === null) return null;
  return String(value);
}

/**
 * Map OTEF symbol layer kinds to a coarse MapLibre family for grouping in uniqueValue.
 * `markerLine` is mapped to a line-fallback family or `markerLineSquare` when
 * `marker.shape === "square"` (MapLibre symbol along line with generated icon).
 */
function getMapLibreType(symbolLayer) {
  if (!symbolLayer || typeof symbolLayer !== "object") return null;
  if (symbolLayer.type === "fill") return "fill";
  if (symbolLayer.type === "stroke") return "line";
  if (symbolLayer.type === "markerPoint") return "circle";
  if (symbolLayer.type === "markerLine") {
    return isMarkerLineSquareSymbol(symbolLayer) ? "markerLineSquare" : "markerLineFallback";
  }
  return null;
}

function markerLineFallbackColor(symbolLayer) {
  const marker = symbolLayer?.marker || {};
  return (
    marker.stroke ??
    marker.strokeColor ??
    marker.fill ??
    marker.fillColor ??
    marker.color ??
    "#000000"
  );
}

function markerLineFallbackWidth(symbolLayer) {
  const marker = symbolLayer?.marker || {};
  if (typeof marker.strokeWidth === "number" && marker.strokeWidth > 0) return marker.strokeWidth;
  if (typeof marker.size === "number" && marker.size > 0) return Math.max(1, marker.size / 4);
  return 1;
}

/**
 * Bump only when the MapLibre hatch raster (tile size, torus math, or stroke recipe)
 * changes for the same processed hatch fields. The layer manager skips `addImage` when
 * `map.hasImage(patternId)` is true, so the id must not stay stable across incompatible
 * `createHatchImageDataFromSpec` / `computeHatchTilePixelSize` generations.
 */
const HATCH_PATTERN_RASTER_ID_REV = "v2";

/**
 * Build a stable pattern id and params from AdvancedStyleEngine hatch config.
 * Same inputs always yield the same patternId so the layer manager can dedupe
 * via map.hasImage and avoid image leaks on repeated syncs.
 *
 * @param {object} [hatchPresentation] - when `applyProjectionHatchPresentation` is true, applies
 *   projection-only density + integer pixel snap (see `projectionHatchRasterParams`); source lyrx
 *   values are unchanged.
 */
function buildHatchPatternSpec(hatchConfig, hatchPresentation = {}) {
  if (!hatchConfig) return null;
  const color = hatchConfig.color || "#808080";
  const rotation = hatchConfig.rotation ?? 0;
  let separation = hatchConfig.separation ?? 8;
  let width = hatchConfig.width ?? 1;
  let pixelRatio = 1;
  if (hatchPresentation.applyProjectionHatchPresentation) {
    const q = projectionHatchRasterParams({ separation, width });
    separation = q.separation;
    width = q.width;
    pixelRatio = q.pixelRatio ?? 1;
  }
  const patternId = `hatch_${HATCH_PATTERN_RASTER_ID_REV}_${String(color)}_${rotation}_${separation}_${width}`.replace(
    /[^a-zA-Z0-9_#]/g,
    "_",
  );
  return { patternId, color, rotation, separation, width, pixelRatio };
}

/**
 * @param {string} id
 * @param {object} symbolLayer
 * @param {object} hatchPresentation
 * @returns {object | null}
 */
function buildMarkerLineSquareMapLibreLayer(id, symbolLayer, hatchPresentation) {
  void hatchPresentation;
  const spec = buildMarkerLineSquareImageSpec(symbolLayer);
  if (!spec) return null;
  const interval = mapLibreLineSymbolSpacingForMarkerLine(symbolLayer, hatchPresentation);
  const orientation = symbolLayer.orientation || {};
  const alignToLine = Boolean(orientation.alignToLine);
  const layout = {
    "icon-image": spec.imageId,
    "icon-size": markerLineSquareIconSize(hatchPresentation),
    "icon-allow-overlap": true,
    "icon-ignore-placement": true,
    "icon-rotation-alignment": "map",
    "icon-pitch-alignment": "map",
    "icon-keep-upright": !alignToLine,
    "symbol-placement": "line",
    "symbol-spacing": interval,
  };
  const paint = {};
  if (symbolLayer.opacity != null) paint["icon-opacity"] = symbolLayer.opacity;
  return {
    id,
    type: "symbol",
    paint,
    layout,
    _markerLineSquarePattern: spec,
  };
}

function groupKeyForSymbolLayer(mapLibreType, symbolLayer, i) {
  if (mapLibreType === "fill") {
    const fillKind = symbolLayer?.fillType === "hatch" ? "hatch" : "solid";
    return `fill__${fillKind}__${i}`;
  }
  return `${mapLibreType}__${i}`;
}

function fillKindForSymbolLayer(symbolLayer) {
  if (getMapLibreType(symbolLayer) !== "fill") return null;
  return symbolLayer?.fillType === "hatch" ? "hatch" : "solid";
}

function symbolLayerToMapLibre(symbolLayer, id, hatchPresentation) {
  if (!symbolLayer || typeof symbolLayer !== "object") return null;

  if (symbolLayer.type === "fill") {
    if (symbolLayer.fillType === "hatch" && symbolLayer.hatch) {
      const hatchSpec = buildHatchPatternSpec(symbolLayer.hatch, hatchPresentation);
      if (hatchSpec) {
        const paint = { "fill-pattern": hatchSpec.patternId };
        if (symbolLayer.opacity != null) paint["fill-opacity"] = symbolLayer.opacity;
        return { id, type: "fill", paint, layout: {}, _hatchPattern: hatchSpec };
      }
    }
    const paint = {
      "fill-color": symbolLayer.color || "#808080",
    };
    if (symbolLayer.opacity != null) paint["fill-opacity"] = symbolLayer.opacity;
    return { id, type: "fill", paint, layout: {} };
  }

  if (symbolLayer.type === "stroke") {
    const paint = {
      "line-color": symbolLayer.color || "#000000",
      "line-width": scaleLineWidthPaintForProjection(
        symbolLayer.width ?? 1,
        hatchPresentation,
      ),
    };
    if (symbolLayer.opacity != null) paint["line-opacity"] = symbolLayer.opacity;
    if (Array.isArray(symbolLayer?.dash?.array)) paint["line-dasharray"] = symbolLayer.dash.array;

    const layout = {};
    if (symbolLayer.lineCap) layout["line-cap"] = symbolLayer.lineCap;
    if (symbolLayer.lineJoin) layout["line-join"] = symbolLayer.lineJoin;

    return { id, type: "line", paint, layout };
  }

  if (symbolLayer.type === "markerPoint") {
    const marker = symbolLayer.marker || {};
    const size = marker.size ?? 8;
    const fill = marker.fill ?? marker.fillColor ?? marker.color;
    const paint = {
      "circle-radius": size / 2,
      "circle-color": fill != null && fill !== "" ? fill : "#808080",
      "circle-stroke-color": marker.stroke || marker.strokeColor || "#000000",
      "circle-stroke-width": marker.strokeWidth ?? 1,
    };
    return { id, type: "circle", paint, layout: {} };
  }

  if (symbolLayer.type === "markerLine") {
    if (isMarkerLineSquareSymbol(symbolLayer)) {
      return buildMarkerLineSquareMapLibreLayer(id, symbolLayer, hatchPresentation);
    }
    const paint = {
      "line-color": markerLineFallbackColor(symbolLayer),
      "line-width": scaleLineWidthPaintForProjection(
        markerLineFallbackWidth(symbolLayer),
        hatchPresentation,
      ),
    };
    if (symbolLayer.opacity != null) paint["line-opacity"] = symbolLayer.opacity;
    return { id, type: "line", paint, layout: {}, _markerLineFallback: true };
  }

  return null;
}

/**
 * MapLibre draws later style layers above earlier ones. ArcGIS / canvas paint fill then stroke
 * on the same path, so outlines stay visible. Emit all `fill` layers before `line` / `circle`
 * (and any other types) so polygon strokes are not covered by opaque fills — Leaflet PMTiles
 * canvas parity.
 *
 * Preserves relative order within the fill group and within the non-fill group. Layer ids
 * still reflect source symbol index (`__${i}` / unique-value group keys), not array position.
 *
 * @param {Array<{ type?: string }>} layers
 * @returns {typeof layers}
 */
function sortMaplibreStyleLayersFillBeforeStroke(layers) {
  if (!Array.isArray(layers) || layers.length <= 1) return layers;
  const fills = [];
  const rest = [];
  for (const layer of layers) {
    if (layer && layer.type === "fill") fills.push(layer);
    else rest.push(layer);
  }
  if (fills.length === 0 || rest.length === 0) return layers;
  return [...fills, ...rest];
}

function buildSimpleLayers(idBase, symbol, hatchPresentation, sortFillBeforeStroke) {
  const symbolLayers = Array.isArray(symbol?.symbolLayers) ? symbol.symbolLayers : [];
  const output = [];

  for (let i = 0; i < symbolLayers.length; i += 1) {
    const mapLibreLayer = symbolLayerToMapLibre(symbolLayers[i], `${idBase}__${i}`, hatchPresentation);
    if (mapLibreLayer) output.push(mapLibreLayer);
  }

  return sortFillBeforeStroke ? sortMaplibreStyleLayersFillBeforeStroke(output) : output;
}

function buildMatchExpr(field, entries, defaultSymbolLayer, propPath, transform) {
  const toExpressionValue = (value) => {
    if (Array.isArray(value)) return ["literal", value];
    return value;
  };

  const valuesEqual = (left, right) => {
    if (Array.isArray(left) && Array.isArray(right)) {
      if (left.length !== right.length) return false;
      for (let i = 0; i < left.length; i += 1) {
        if (left[i] !== right[i]) return false;
      }
      return true;
    }
    return left === right;
  };

  const toValue = (symbolLayer) => {
    const rawValue = getNestedProp(symbolLayer, propPath);
    if (rawValue == null) return rawValue;
    return typeof transform === "function" ? transform(rawValue) : rawValue;
  };

  const fallback = toValue(defaultSymbolLayer);

  const entryRows = [];
  for (const entry of entries) {
    if (entry?.value == null) continue;
    const entryValue = toValue(entry.symbolLayer);
    if (entryValue === undefined) continue;
    entryRows.push({ value: entry.value, entryValue });
  }

  if (fallback === undefined && entryRows.length === 0) return undefined;

  let effectiveFallback;
  if (fallback != null) {
    effectiveFallback = fallback;
  } else {
    const firstUsable = entryRows.map((r) => r.entryValue).find((v) => v != null);
    effectiveFallback = firstUsable !== undefined ? firstUsable : entryRows[0]?.entryValue;
  }

  if (effectiveFallback == null) return undefined;

  const expression = ["match", uniqueValueClassificationInputExpression(field)];
  let allMatchFallback = true;

  for (const { value, entryValue } of entryRows) {
    const resolved = entryValue == null ? effectiveFallback : (entryValue ?? effectiveFallback);
    if (resolved == null) continue;
    const normalizedMatchKey = normalizeUniqueValueMatchKey(value);
    if (normalizedMatchKey == null) continue;
    if (!valuesEqual(resolved, effectiveFallback)) allMatchFallback = false;
    expression.push(normalizedMatchKey, toExpressionValue(resolved));
  }

  expression.push(toExpressionValue(effectiveFallback));

  if (expression.length <= 3 || allMatchFallback) return effectiveFallback;
  return expression;
}

function buildUniqueValueGroups(uniqueValues, defaultSymbol) {
  const classes = Array.isArray(uniqueValues?.classes) ? uniqueValues.classes : [];
  const defaultSymbolLayers = Array.isArray(defaultSymbol?.symbolLayers) ? defaultSymbol.symbolLayers : [];
  const groups = {};

  for (let i = 0; i < defaultSymbolLayers.length; i += 1) {
    const symbolLayer = defaultSymbolLayers[i];
    const mapLibreType = getMapLibreType(symbolLayer);
    if (!mapLibreType) continue;

    const key = groupKeyForSymbolLayer(mapLibreType, symbolLayer, i);
    groups[key] = {
      type: mapLibreType,
      index: i,
      entries: [],
      sampleSymbolLayer: symbolLayer,
      fillKind: fillKindForSymbolLayer(symbolLayer),
    };
  }

  for (const cls of classes) {
    const classSymbol = cls?.symbol || cls?.style || defaultSymbol || {};
    const symbolLayers = Array.isArray(classSymbol?.symbolLayers) ? classSymbol.symbolLayers : [];

    for (let i = 0; i < symbolLayers.length; i += 1) {
      const symbolLayer = symbolLayers[i];
      const mapLibreType = getMapLibreType(symbolLayer);
      if (!mapLibreType) continue;

      const key = groupKeyForSymbolLayer(mapLibreType, symbolLayer, i);
      if (!groups[key]) {
        groups[key] = {
          type: mapLibreType,
          index: i,
          entries: [],
          sampleSymbolLayer: symbolLayer,
          fillKind: fillKindForSymbolLayer(symbolLayer),
        };
      }

      if (cls?.value != null) {
        groups[key].entries.push({
          value: cls.value,
          symbolLayer,
        });
      }
    }
  }

  return groups;
}

function buildUniqueValueLayers(idBase, uniqueValues, defaultSymbol, hatchPresentation, sortFillBeforeStroke) {
  const field = uniqueValues?.field;
  if (!field) return buildSimpleLayers(idBase, defaultSymbol, hatchPresentation, sortFillBeforeStroke);

  const defaultSymbolLayers = Array.isArray(defaultSymbol?.symbolLayers) ? defaultSymbol.symbolLayers : [];
  const groups = buildUniqueValueGroups(uniqueValues, defaultSymbol);
  const output = [];

  for (const [groupKey, group] of Object.entries(groups)) {
    const atIndex = defaultSymbolLayers[group.index];
    let defaultSymbolLayer = atIndex ?? group.sampleSymbolLayer;
    if (atIndex != null && getMapLibreType(atIndex) !== group.type) {
      defaultSymbolLayer = group.sampleSymbolLayer;
    } else if (
      atIndex != null &&
      group.type === "fill" &&
      group.fillKind != null
    ) {
      const atKind = atIndex.fillType === "hatch" ? "hatch" : "solid";
      if (atKind !== group.fillKind) {
        defaultSymbolLayer = group.sampleSymbolLayer;
      }
    }
    const layer = buildMatchLayer(
      `${idBase}__${groupKey}`,
      group.type,
      field,
      group.entries,
      defaultSymbolLayer,
      hatchPresentation,
    );
    if (layer) output.push(layer);
  }

  return sortFillBeforeStroke ? sortMaplibreStyleLayersFillBeforeStroke(output) : output;
}

function buildMatchLayer(id, mapLibreType, field, entries, defaultSymbolLayer, hatchPresentation) {
  const paint = {};

  if (mapLibreType === "fill") {
    if (defaultSymbolLayer?.fillType === "hatch") {
      const defaultSpec = buildHatchPatternSpec(defaultSymbolLayer.hatch, hatchPresentation);
      if (defaultSpec) {
        const allSpecsById = new Map();
        allSpecsById.set(defaultSpec.patternId, defaultSpec);
        for (const entry of entries) {
          if (entry?.value == null) continue;
          const spec =
            buildHatchPatternSpec(
              entry.symbolLayer?.hatch || defaultSymbolLayer.hatch,
              hatchPresentation,
            ) || defaultSpec;
          allSpecsById.set(spec.patternId, spec);
        }

        const entryRows = [];
        for (const entry of entries) {
          if (entry?.value == null) continue;
          const spec =
            buildHatchPatternSpec(
              entry.symbolLayer?.hatch || defaultSymbolLayer.hatch,
              hatchPresentation,
            ) || defaultSpec;
          entryRows.push({ value: entry.value, patternId: spec.patternId });
        }

        const fallbackPattern = defaultSpec.patternId;
        if (entryRows.length === 0) {
          paint["fill-pattern"] = fallbackPattern;
        } else {
          const expression = ["match", uniqueValueClassificationInputExpression(field)];
          let allMatchFallback = true;
          for (const { value, patternId } of entryRows) {
            const normalizedMatchKey = normalizeUniqueValueMatchKey(value);
            if (normalizedMatchKey == null) continue;
            if (patternId !== fallbackPattern) allMatchFallback = false;
            expression.push(normalizedMatchKey, patternId);
          }
          expression.push(fallbackPattern);
          if (allMatchFallback) {
            paint["fill-pattern"] = fallbackPattern;
          } else {
            paint["fill-pattern"] = expression;
          }
        }

        const fillOpacity = buildMatchExpr(field, entries, defaultSymbolLayer, "opacity");
        if (fillOpacity !== undefined) paint["fill-opacity"] = fillOpacity;
        return {
          id,
          type: "fill",
          paint,
          layout: {},
          _hatchPatterns: [...allSpecsById.values()],
        };
      }
    }
    const fillColor = buildMatchExpr(field, entries, defaultSymbolLayer, "color");
    if (fillColor != null) paint["fill-color"] = fillColor;
    else paint["fill-color"] = "#808080";
    const fillOpacity = buildMatchExpr(field, entries, defaultSymbolLayer, "opacity");
    if (fillOpacity !== undefined) paint["fill-opacity"] = fillOpacity;
    return { id, type: "fill", paint, layout: {} };
  }

  if (mapLibreType === "line") {
    const lineColor = buildMatchExpr(field, entries, defaultSymbolLayer, "color");
    if (lineColor != null) paint["line-color"] = lineColor;
    else paint["line-color"] = "#000000";
    const lineWidth = buildMatchExpr(field, entries, defaultSymbolLayer, "width");
    paint["line-width"] = scaleLineWidthPaintForProjection(
      lineWidth != null ? lineWidth : 1,
      hatchPresentation,
    );
    const lineOpacity = buildMatchExpr(field, entries, defaultSymbolLayer, "opacity");
    if (lineOpacity !== undefined) paint["line-opacity"] = lineOpacity;

    const dash = buildMatchExpr(field, entries, defaultSymbolLayer, "dash.array");
    if (dash !== undefined) paint["line-dasharray"] = dash;

    const layout = {};
    const lineCap = buildMatchExpr(field, entries, defaultSymbolLayer, "lineCap");
    const lineJoin = buildMatchExpr(field, entries, defaultSymbolLayer, "lineJoin");
    if (lineCap !== undefined) layout["line-cap"] = lineCap;
    if (lineJoin !== undefined) layout["line-join"] = lineJoin;

    return { id, type: "line", paint, layout };
  }

  if (mapLibreType === "circle") {
    const fromFill = buildMatchExpr(field, entries, defaultSymbolLayer, "marker.fill");
    const fromFillColor = buildMatchExpr(field, entries, defaultSymbolLayer, "marker.fillColor");
    const fromColor = buildMatchExpr(field, entries, defaultSymbolLayer, "marker.color");
    const chosen = fromFill ?? fromFillColor ?? fromColor;
    /** Set when falling back to gray; the layer manager may log once (keeps this module free of console I/O). */
    let uniqueValuePointColorFallback = false;
    if (chosen != null) {
      paint["circle-color"] = chosen;
    } else {
      uniqueValuePointColorFallback = true;
      paint["circle-color"] = "#808080";
    }
    paint["circle-radius"] = buildMatchExpr(
      field,
      entries,
      defaultSymbolLayer,
      "marker.size",
      (size) => size / 2
    ) ?? 4;
    paint["circle-stroke-color"] = buildMatchExpr(field, entries, defaultSymbolLayer, "marker.stroke")
      ?? buildMatchExpr(field, entries, defaultSymbolLayer, "marker.strokeColor")
      ?? "#000000";
    paint["circle-stroke-width"] = buildMatchExpr(field, entries, defaultSymbolLayer, "marker.strokeWidth") ?? 1;
    return {
      id,
      type: "circle",
      paint,
      layout: {},
      ...(uniqueValuePointColorFallback && { _uniqueValuePointColorFallback: true }),
    };
  }

  if (mapLibreType === "markerLineSquare") {
    const defaultSpec = buildMarkerLineSquareImageSpec(defaultSymbolLayer);
    if (!defaultSpec) return null;

    const allSpecsById = new Map();
    allSpecsById.set(defaultSpec.imageId, defaultSpec);
    for (const entry of entries) {
      if (entry?.value == null) continue;
      const s = buildMarkerLineSquareImageSpec(entry.symbolLayer) || defaultSpec;
      allSpecsById.set(s.imageId, s);
    }

    const entryRows = [];
    for (const entry of entries) {
      if (entry?.value == null) continue;
      const s = buildMarkerLineSquareImageSpec(entry.symbolLayer) || defaultSpec;
      entryRows.push({ value: entry.value, imageId: s.imageId });
    }

    const fallbackPattern = defaultSpec.imageId;
    let iconImage;
    if (entryRows.length === 0) {
      iconImage = fallbackPattern;
    } else {
      const expression = ["match", uniqueValueClassificationInputExpression(field)];
      let allMatchFallback = true;
      for (const { value, imageId } of entryRows) {
        const normalizedMatchKey = normalizeUniqueValueMatchKey(value);
        if (normalizedMatchKey == null) continue;
        if (imageId !== fallbackPattern) allMatchFallback = false;
        expression.push(normalizedMatchKey, imageId);
      }
      expression.push(fallbackPattern);
      if (allMatchFallback) {
        iconImage = fallbackPattern;
      } else {
        iconImage = expression;
      }
    }

    const layout = {
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-rotation-alignment": "map",
      "icon-pitch-alignment": "map",
      "icon-keep-upright": !Boolean((defaultSymbolLayer?.orientation || {}).alignToLine),
      "symbol-placement": "line",
      "symbol-spacing": mapLibreLineSymbolSpacingForMarkerLine(
        defaultSymbolLayer,
        hatchPresentation,
      ),
      "icon-image": iconImage,
      "icon-size": markerLineSquareIconSize(hatchPresentation),
    };
    const paint = {};
    const op = buildMatchExpr(field, entries, defaultSymbolLayer, "opacity");
    if (op !== undefined) paint["icon-opacity"] = op;
    return {
      id,
      type: "symbol",
      paint,
      layout,
      _markerLineSquarePatterns: [...allSpecsById.values()],
    };
  }

  if (mapLibreType === "markerLineFallback") {
    const fromStroke = buildMatchExpr(field, entries, defaultSymbolLayer, "marker.stroke");
    const fromStrokeColor = buildMatchExpr(field, entries, defaultSymbolLayer, "marker.strokeColor");
    const fromFill = buildMatchExpr(field, entries, defaultSymbolLayer, "marker.fill");
    const fromFillColor = buildMatchExpr(field, entries, defaultSymbolLayer, "marker.fillColor");
    const fromColor = buildMatchExpr(field, entries, defaultSymbolLayer, "marker.color");
    const chosen = fromStroke ?? fromStrokeColor ?? fromFill ?? fromFillColor ?? fromColor;
    paint["line-color"] = chosen != null ? chosen : "#000000";

    const widthFromStroke = buildMatchExpr(field, entries, defaultSymbolLayer, "marker.strokeWidth");
    const widthFromSize = buildMatchExpr(
      field,
      entries,
      defaultSymbolLayer,
      "marker.size",
      (size) => Math.max(1, size / 4)
    );
    paint["line-width"] = scaleLineWidthPaintForProjection(
      widthFromStroke ?? widthFromSize ?? 1,
      hatchPresentation,
    );

    const lineOpacity = buildMatchExpr(field, entries, defaultSymbolLayer, "opacity");
    if (lineOpacity !== undefined) paint["line-opacity"] = lineOpacity;

    return { id, type: "line", paint, layout: {}, _markerLineFallback: true };
  }

  return null;
}

/**
 * ArcGIS-derived `style.labels` exists on many processed layers as metadata (class fields like
 * `Id`, `Shape_Length`, `Name`) and must not become MapLibre text layers by default.
 *
 * - GIS / default: no map labels from `style.labels`.
 * - Projection (`applyProjectionHatchPresentation`): only the settlement-names layer stem.
 * - Unit tests / explicit opt-in: `renderMapLabelsFromStyle: true`.
 *
 * @param {{ applyProjectionHatchPresentation?: boolean, renderMapLabelsFromStyle?: boolean }} [styleOptions]
 * @param {string} [fullLayerId] e.g. `projector_base.שמות_יישובים`
 */
function shouldRenderMapLabelsFromStyle(styleOptions, fullLayerId) {
  if (styleOptions?.renderMapLabelsFromStyle === true) return true;
  if (styleOptions?.applyProjectionHatchPresentation === true) {
    const s = String(fullLayerId || "");
    return /\.שמות_יישובים$/.test(s);
  }
  return false;
}

/**
 * @param {object} [layerConfig]
 * @param {{
 *   applyProjectionHatchPresentation?: boolean,
 *   renderMapLabelsFromStyle?: boolean,
 * }} [styleOptions] - projection sets `applyLayerGroupsToMap` with `applyProjectionHatchPresentation`
 *   for hatch density; that flag also scopes label rendering to שמות_יישובים only.
 */
export function irToMapLibreLayers(fullLayerId, sourceLayerId, layerConfig, styleOptions = {}) {
  void sourceLayerId;

  const style = layerConfig?.style || {};
  const renderer = style.renderer || "simple";
  const defaultSymbol = style.defaultSymbol || { symbolLayers: [] };
  const uniqueValues = style.uniqueValues;

  const idBase = String(fullLayerId || "layer").replace(/\./g, "__");

  const hatchPresentation = {
    applyProjectionHatchPresentation: Boolean(styleOptions.applyProjectionHatchPresentation),
  };

  const sortFillBeforeStroke = shouldSortFillsBeforeStrokesForPackLayer(
    fullLayerId,
    layerConfig?.geometryType,
  );

  const rawBaseLayers =
    renderer === "uniqueValue" && uniqueValues
      ? buildUniqueValueLayers(
          idBase,
          uniqueValues,
          defaultSymbol,
          hatchPresentation,
          sortFillBeforeStroke,
        )
      : buildSimpleLayers(idBase, defaultSymbol, hatchPresentation, sortFillBeforeStroke);

  const baseLayers = isLineGeometryType(layerConfig?.geometryType)
    ? sortLinePackStrokeOrderForDashedVisibility(rawBaseLayers)
    : rawBaseLayers;

  const passMapLabels = shouldRenderMapLabelsFromStyle(styleOptions, fullLayerId);
  const leaderLineLayers = passMapLabels
    ? buildLabelLeaderLineLayer(idBase, style, layerConfig?.geometryType)
    : [];
  const labelLayers = passMapLabels ? buildLabelSymbolLayer(idBase, style, layerConfig?.geometryType) : [];
  return [...baseLayers, ...leaderLineLayers, ...labelLayers];
}

export { buildMatchLayer };

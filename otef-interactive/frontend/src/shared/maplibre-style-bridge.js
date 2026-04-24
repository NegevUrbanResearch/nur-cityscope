/**
 * Translate OTEF AdvancedStyleEngine IR (symbolLayers)
 * into MapLibre style layer definitions.
 */

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
 * Map OTEF symbol layer kinds to a coarse MapLibre family for grouping in uniqueValue.
 * `markerLine` is mapped to a line-fallback family so advanced line styles remain visible
 * even when exact marker-placement parity is not yet implemented.
 */
function getMapLibreType(symbolLayer) {
  if (!symbolLayer || typeof symbolLayer !== "object") return null;
  if (symbolLayer.type === "fill") return "fill";
  if (symbolLayer.type === "stroke") return "line";
  if (symbolLayer.type === "markerPoint") return "circle";
  if (symbolLayer.type === "markerLine") return "markerLineFallback";
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
 * Build a stable pattern id and params from AdvancedStyleEngine hatch config.
 * Same inputs always yield the same patternId so the layer manager can dedupe
 * via map.hasImage and avoid image leaks on repeated syncs.
 */
function buildHatchPatternSpec(hatchConfig) {
  if (!hatchConfig) return null;
  const color = hatchConfig.color || "#808080";
  const rotation = hatchConfig.rotation ?? 0;
  const separation = hatchConfig.separation ?? 8;
  const width = hatchConfig.width ?? 1;
  const patternId = `hatch_${String(color)}_${rotation}_${separation}_${width}`.replace(
    /[^a-zA-Z0-9_#]/g,
    "_",
  );
  return { patternId, color, rotation, separation, width };
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

function symbolLayerToMapLibre(symbolLayer, id) {
  if (!symbolLayer || typeof symbolLayer !== "object") return null;

  if (symbolLayer.type === "fill") {
    if (symbolLayer.fillType === "hatch" && symbolLayer.hatch) {
      const hatchSpec = buildHatchPatternSpec(symbolLayer.hatch);
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
      "line-width": symbolLayer.width ?? 1,
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
    const paint = {
      "line-color": markerLineFallbackColor(symbolLayer),
      "line-width": markerLineFallbackWidth(symbolLayer),
    };
    if (symbolLayer.opacity != null) paint["line-opacity"] = symbolLayer.opacity;
    return { id, type: "line", paint, layout: {}, _markerLineFallback: true };
  }

  return null;
}

function buildSimpleLayers(idBase, symbol) {
  const symbolLayers = Array.isArray(symbol?.symbolLayers) ? symbol.symbolLayers : [];
  const output = [];

  for (let i = 0; i < symbolLayers.length; i += 1) {
    const mapLibreLayer = symbolLayerToMapLibre(symbolLayers[i], `${idBase}__${i}`);
    if (mapLibreLayer) output.push(mapLibreLayer);
  }

  return output;
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

  const expression = ["match", ["get", field]];
  let allMatchFallback = true;

  for (const { value, entryValue } of entryRows) {
    const resolved = entryValue == null ? effectiveFallback : (entryValue ?? effectiveFallback);
    if (resolved == null) continue;
    if (!valuesEqual(resolved, effectiveFallback)) allMatchFallback = false;
    expression.push(value, toExpressionValue(resolved));
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

function buildUniqueValueLayers(idBase, uniqueValues, defaultSymbol) {
  const field = uniqueValues?.field;
  if (!field) return buildSimpleLayers(idBase, defaultSymbol);

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
      defaultSymbolLayer
    );
    if (layer) output.push(layer);
  }

  return output;
}

function buildMatchLayer(id, mapLibreType, field, entries, defaultSymbolLayer) {
  const paint = {};

  if (mapLibreType === "fill") {
    if (defaultSymbolLayer?.fillType === "hatch") {
      const defaultSpec = buildHatchPatternSpec(defaultSymbolLayer.hatch);
      if (defaultSpec) {
        const allSpecsById = new Map();
        allSpecsById.set(defaultSpec.patternId, defaultSpec);
        for (const entry of entries) {
          if (entry?.value == null) continue;
          const spec =
            buildHatchPatternSpec(entry.symbolLayer?.hatch || defaultSymbolLayer.hatch) || defaultSpec;
          allSpecsById.set(spec.patternId, spec);
        }

        const entryRows = [];
        for (const entry of entries) {
          if (entry?.value == null) continue;
          const spec =
            buildHatchPatternSpec(entry.symbolLayer?.hatch || defaultSymbolLayer.hatch) || defaultSpec;
          entryRows.push({ value: entry.value, patternId: spec.patternId });
        }

        const fallbackPattern = defaultSpec.patternId;
        if (entryRows.length === 0) {
          paint["fill-pattern"] = fallbackPattern;
        } else {
          const expression = ["match", ["get", field]];
          let allMatchFallback = true;
          for (const { value, patternId } of entryRows) {
            if (patternId !== fallbackPattern) allMatchFallback = false;
            expression.push(value, patternId);
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
    paint["line-width"] = lineWidth != null ? lineWidth : 1;
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
    paint["line-width"] = widthFromStroke ?? widthFromSize ?? 1;

    const lineOpacity = buildMatchExpr(field, entries, defaultSymbolLayer, "opacity");
    if (lineOpacity !== undefined) paint["line-opacity"] = lineOpacity;

    return { id, type: "line", paint, layout: {}, _markerLineFallback: true };
  }

  return null;
}

export function irToMapLibreLayers(fullLayerId, sourceLayerId, layerConfig) {
  void sourceLayerId;

  const style = layerConfig?.style || {};
  const renderer = style.renderer || "simple";
  const defaultSymbol = style.defaultSymbol || { symbolLayers: [] };
  const uniqueValues = style.uniqueValues;

  const idBase = String(fullLayerId || "layer").replace(/\./g, "__");

  if (renderer === "uniqueValue" && uniqueValues) {
    return buildUniqueValueLayers(idBase, uniqueValues, defaultSymbol);
  }

  return buildSimpleLayers(idBase, defaultSymbol);
}

export { buildMatchLayer };

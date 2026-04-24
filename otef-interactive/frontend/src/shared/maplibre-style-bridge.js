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

function getMapLibreType(symbolLayer) {
  if (!symbolLayer || typeof symbolLayer !== "object") return null;
  if (symbolLayer.type === "fill") return "fill";
  if (symbolLayer.type === "stroke") return "line";
  if (symbolLayer.type === "markerPoint") return "circle";
  if (symbolLayer.type === "markerLine") return "symbol";
  return null;
}

function symbolLayerToMapLibre(symbolLayer, id) {
  if (!symbolLayer || typeof symbolLayer !== "object") return null;

  if (symbolLayer.type === "fill") {
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
    const paint = {
      "circle-radius": size / 2,
      "circle-color": marker.fill || marker.color || "#808080",
      "circle-stroke-color": marker.stroke || marker.strokeColor || "#000000",
      "circle-stroke-width": marker.strokeWidth ?? 1,
    };
    return { id, type: "circle", paint, layout: {} };
  }

  if (symbolLayer.type === "markerLine") {
    return null;
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

    const key = `${mapLibreType}__${i}`;
    groups[key] = {
      type: mapLibreType,
      index: i,
      entries: [],
      sampleSymbolLayer: symbolLayer,
    };
  }

  for (const cls of classes) {
    const classSymbol = cls?.symbol || cls?.style || defaultSymbol || {};
    const symbolLayers = Array.isArray(classSymbol?.symbolLayers) ? classSymbol.symbolLayers : [];

    for (let i = 0; i < symbolLayers.length; i += 1) {
      const symbolLayer = symbolLayers[i];
      const mapLibreType = getMapLibreType(symbolLayer);
      if (!mapLibreType) continue;

      const key = `${mapLibreType}__${i}`;
      if (!groups[key]) {
        groups[key] = {
          type: mapLibreType,
          index: i,
          entries: [],
          sampleSymbolLayer: symbolLayer,
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
    paint["circle-color"] = buildMatchExpr(field, entries, defaultSymbolLayer, "marker.fill")
      ?? buildMatchExpr(field, entries, defaultSymbolLayer, "marker.color")
      ?? "#808080";
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
    return { id, type: "circle", paint, layout: {} };
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

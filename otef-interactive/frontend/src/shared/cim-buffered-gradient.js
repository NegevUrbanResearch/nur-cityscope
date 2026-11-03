/** Small adapter for the processed CIM polygon style contract. */

export const BUFFERED_GRADIENT_BAND_PROPERTY = "__cim_gradient_band";
export const BUFFERED_GRADIENT_STATUSES = Object.freeze([
  "not-required",
  "loading",
  "ready",
  "failed",
]);

function classesFor(style) {
  return Array.isArray(style?.uniqueValues?.classes) ? style.uniqueValues.classes : [];
}

function symbolLayersFor(cls) {
  return Array.isArray(cls?.symbol?.symbolLayers) ? cls.symbol.symbolLayers : [];
}

function gradientFor(cls) {
  return symbolLayersFor(cls).find((layer) =>
    layer?.type === "fill" && layer?.fillType === "gradient" && layer?.enable !== false,
  ) || null;
}

function resolvedColorsFor(gradient) {
  const colors = gradient?.resolvedColors;
  if (!Array.isArray(colors) || colors.length === 0
      || colors.some((color) => typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color))) {
    throw new Error("Buffered gradient resolvedColors must contain exact #RRGGBB strings");
  }
  return colors;
}

function resolvedOpacitiesFor(gradient) {
  const colors = resolvedColorsFor(gradient);
  const interval = gradient.interval;
  if (!Number.isInteger(interval) || interval <= 0 || colors.length !== interval) {
    throw new Error("Buffered gradient resolvedOpacities and resolvedColors must match interval");
  }
  if (gradient.resolvedOpacities == null) {
    if (gradient.opacity == null) return colors.map(() => 1);
    if (typeof gradient.opacity !== "number" || !Number.isFinite(gradient.opacity)
        || gradient.opacity < 0 || gradient.opacity > 1) {
      throw new Error("Buffered gradient opacity must be a number from 0 to 1");
    }
    const opacity = gradient.opacity;
    return colors.map(() => opacity);
  }
  if (!Array.isArray(gradient.resolvedOpacities)
      || gradient.resolvedOpacities.length !== colors.length
      || gradient.resolvedOpacities.some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error("Buffered gradient resolvedOpacities must match resolvedColors and contain values from 0 to 1");
  }
  return [...gradient.resolvedOpacities];
}

function everyPresent(array, predicate) {
  if (!Array.isArray(array)) return false;
  for (let index = 0; index < array.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(array, index) || !predicate(array[index])) return false;
  }
  return true;
}

function isFiniteNumeric2DPosition(position) {
  return Array.isArray(position)
    && position.length >= 2
    && everyPresent(position, (value) => typeof value === "number" && Number.isFinite(value));
}

function isValidRing(ring) {
  return Array.isArray(ring)
    && ring.length >= 4
    && everyPresent(ring, isFiniteNumeric2DPosition);
}

function hasRenderablePolygonCoordinates(coordinates) {
  return Array.isArray(coordinates)
    && coordinates.length > 0
    && everyPresent(coordinates, isValidRing);
}

function hasRenderablePolygonGeometry(geometry) {
  if (geometry?.type === "Polygon") return hasRenderablePolygonCoordinates(geometry.coordinates);
  if (geometry?.type !== "MultiPolygon" || !Array.isArray(geometry.coordinates)
      || geometry.coordinates.length === 0) return false;
  return everyPresent(geometry.coordinates, hasRenderablePolygonCoordinates);
}

function outlineFor(cls) {
  const layer = symbolLayersFor(cls).find((entry) =>
    entry?.type === "stroke" && entry?.enable !== false,
  );
  if (!layer) return null;
  return {
    color: layer.color,
    width: Number.isFinite(Number(layer.width)) ? Number(layer.width) : 1,
    opacity: Number.isFinite(Number(layer.opacity)) ? Number(layer.opacity) : 1,
    lineCap: layer.lineCap,
    lineJoin: layer.lineJoin,
    miterLimit: layer.miterLimit,
  };
}

function solidFor(cls) {
  const layer = symbolLayersFor(cls).find((entry) =>
    entry?.type === "fill" && entry?.fillType !== "gradient" && entry?.enable !== false,
  );
  if (!layer) return null;
  return {
    color: layer.color,
    opacity: Number.isFinite(Number(layer.opacity)) ? Number(layer.opacity) : 1,
  };
}

/** Return true when processed styles.json contains a supported buffered fill. */
export function isBufferedGradientStyle(style) {
  return classesFor(style).some((cls) => !!gradientFor(cls));
}

/**
 * Extract only authored fields needed by the investigation polygon renderer.
 * Class values are object keys because the processed unique-value field is
 * already the exact source property name (Notes for the NLI polygon layer).
 */
export function buildBufferedGradientRenderPlan(style) {
  const classes = {};
  for (const cls of classesFor(style)) {
    const value = cls?.value;
    if (value == null) continue;
    const gradient = gradientFor(cls);
    const opacities = gradient ? resolvedOpacitiesFor(gradient) : [];
    const bands = gradient
      ? gradient.resolvedColors.map((color, ordinal) => ({
          ordinal,
          color,
          opacity: opacities[ordinal],
        }))
      : [];
    classes[String(value)] = {
      bands,
      outline: outlineFor(cls),
      solid: solidFor(cls),
      gradient: gradient || null,
    };
  }
  return {
    field: typeof style?.uniqueValues?.field === "string" ? style.uniqueValues.field : "Notes",
    classes,
    processed: isBufferedGradientStyle(style),
  };
}

/** Return true only when a valid banded class has matching sidecar geometry. */
export function hasUsableBufferedGradient(style, features) {
  try {
    const plan = buildBufferedGradientRenderPlan(style);
    const sidecarFeatures = Array.isArray(features)
      ? features
      : Array.isArray(features?.features) ? features.features : [];
    return sidecarFeatures.some((feature) => {
      const notes = feature?.properties?.Notes;
      const bands = plan.classes[notes]?.bands;
      const geometry = feature?.geometry;
      const band = feature?.properties?.[BUFFERED_GRADIENT_BAND_PROPERTY];
      return typeof notes === "string"
        && Array.isArray(bands)
        && bands.length > 0
        && typeof band === "number"
        && Number.isInteger(band)
        && bands.some((entry) => entry.ordinal === band)
        && hasRenderablePolygonGeometry(geometry);
    });
  } catch (_) {
    return false;
  }
}

export function bufferedGradientResource(styleConfig) {
  const resource = styleConfig?.resources?.bufferedGradient;
  return resource && typeof resource.file === "string" && resource.file.trim()
    ? resource
    : null;
}

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
    layer?.type === "fill" && layer?.fillType === "gradient" && layer?.enable !== false &&
    Array.isArray(layer?.resolvedColors) && layer.resolvedColors.length > 0,
  ) || null;
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
    const bands = gradient
      ? gradient.resolvedColors.map((color, ordinal) => ({
          ordinal,
          color,
          opacity: Number.isFinite(Number(gradient.opacity)) ? Number(gradient.opacity) : 1,
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

export function bufferedGradientResource(styleConfig) {
  const resource = styleConfig?.resources?.bufferedGradient;
  return resource && typeof resource.file === "string" && resource.file.trim()
    ? resource
    : null;
}

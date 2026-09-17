/**
 * Semantic NLI investigation visual tokens.
 *
 * This module is deliberately a leaf: it has no renderer, DOM, or data
 * dependencies. GIS and projection profiles can tune presentation scale
 * without changing the meaning of a visual state.
 */

const radiusStops = Object.freeze([
  Object.freeze([1, 4]),
  Object.freeze([7, 8]),
  Object.freeze([26, 14]),
  Object.freeze([77, 19]),
]);

export const NLI_VISUAL_TOKENS = Object.freeze({
  polygonOrange: "#f79009",
  routeFuture: "#c31f4f",
  routeRestingOpacity: 0.42,
  routeReveal: "#c31f4f",
  incidentRed: "#c31f4f",
  settlementImpactOutline: "#c31f4f",
  narrativeSettlementOutline: "#ffffff",
  alarmYellow: "#f5c542",
  annotationInk: "#fff7ed",
  annotationHalo: "#000000",
  revealDurationMs: 3200,
  alarmRippleDurationMs: 900,
  completedFlowStepMs: 66,
  routeCarrierWidth: 2.4,
  routeFlowColor: "#000000",
  routeFlowWidth: 1.35,
  routeFlowPeriodPx: 24,
  routeFlowDensity: 8,
  routeFlowDutyCycle: 0.45,
  routeFlowSpeed: 0.00072,
  alarmRadiusStops: radiusStops,
  flowPatternSteps: 4,
  completedFlowPatternSteps: 4,
  personZoom: 16,
  highlightMinZoom: 13,
  highlightOpacityTransitionMs: 400,
  highlightFillOpacity: 0.05,
  highlightLineColor: "rgba(255,255,255,0.35)",
  personGlowFillOpacity: 0.25,
  personGlowRadius: 14,
  personGlowStrokeWidth: 2.5,
  personGlowPulseMs: 2400,
  polygonCategories: Object.freeze({
    "מרחב לחימה - קרב": Object.freeze({ fill: "#3d9a8c", outline: "#2a6b62", fillOpacity: 0.55, periodMs: 4000, fillOpacityMin: 0.45, fillOpacityMax: 0.62 }),
    "מוקד חטיפה": Object.freeze({ fill: "#ffff73", outline: "#c47388", fillOpacity: 0.55, periodMs: 2800, lineWidthMin: 1.4, lineWidthMax: 2.2, fillOpacityMin: 0.5, fillOpacityMax: 0.62 }),
    "שריפה": Object.freeze({ fill: "#d85a1f", outline: "#a33d12", fillOpacity: 0.55, periodMs: 1800, fillOpacityMin: 0.42, fillOpacityMax: 0.7 }),
  }),
  polygonFallbackFill: "#9a9a9a",
});

export const NLI_DISPLAY_PROFILES = Object.freeze({
  gis: Object.freeze({
    lineWidthMultiplier: 1,
    radiusMultiplier: 1,
    routeScale: 1,
    textScaleMultiplier: 1,
    narrativeFocus: Object.freeze({
      haloRadius: 9,
      haloStrokeWidth: 2,
      textSize: 16,
      textHaloWidth: 1.5,
    }),
  }),
  projection: Object.freeze({
    lineWidthMultiplier: 1.2,
    radiusMultiplier: 1.15,
    routeScale: 1.15,
    textScaleMultiplier: 1.1,
    narrativeFocus: Object.freeze({
      haloRadius: 6,
      haloStrokeWidth: 1.5,
      textSize: 11,
      textHaloWidth: 1.1,
    }),
  }),
});

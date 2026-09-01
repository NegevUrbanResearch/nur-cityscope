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
  alarmYellow: "#f5c542",
  annotationInk: "#fff7ed",
  revealDurationMs: 3200,
  alarmRippleDurationMs: 900,
  completedFlowStepMs: 66,
  routeCarrierWidth: 2.4,
  routeFlowColor: "#000000",
  routeFlowWidth: 1.35,
  routeFlowDensity: 8,
  routeFlowDutyCycle: 0.45,
  routeFlowSpeed: 0.00072,
  alarmRadiusStops: radiusStops,
  flowPatternSteps: 4,
  completedFlowPatternSteps: 4,
});

export const NLI_DISPLAY_PROFILES = Object.freeze({
  gis: Object.freeze({
    lineWidthMultiplier: 1,
    radiusMultiplier: 1,
    routeScale: 1,
    textScaleMultiplier: 1,
  }),
  projection: Object.freeze({
    lineWidthMultiplier: 1.2,
    radiusMultiplier: 1.15,
    routeScale: 1.15,
    textScaleMultiplier: 1.1,
  }),
});

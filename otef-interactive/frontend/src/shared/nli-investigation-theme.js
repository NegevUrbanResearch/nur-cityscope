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
  routeUnconfirmedOpacity: 0.95,
  routeUnconfirmedDashPx: Object.freeze([6, 6]),
  routeUnconfirmedLatticeColor: "#1a0a10",
  routeUnconfirmedLatticeOpacity: 0.62,
  routeUnconfirmedLatticeWidthScale: 0.46,
  routeUnconfirmedLatticeDashPx: Object.freeze([2, 4]),
  polygonGradientCycleMs: 6000,
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

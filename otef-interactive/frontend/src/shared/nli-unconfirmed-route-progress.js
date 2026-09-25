/**
 * Split a confirmed infiltration route and its unconfirmed Gaza approach
 * across one beat. Progress is distance along the composite path; beat
 * duration is unchanged.
 */

import { buildLinePathMetrics, pointAtLineProgress } from "./maplibre-line-progress-primitives.js";

export const UNCONFIRMED_CONFIDENCE = "unconfirmed";

export function isUnconfirmedRoute(feature) {
  return feature?.properties?.route_confidence === UNCONFIRMED_CONFIDENCE;
}

export function isUnconfirmedConnector(feature) {
  return isUnconfirmedRoute(feature) && feature?.properties?.route_role === "connector";
}

export function isUnconfirmedApproach(feature) {
  return isUnconfirmedRoute(feature) && !isUnconfirmedConnector(feature);
}

function finiteCoordinate(coord) {
  return Array.isArray(coord) && Number.isFinite(Number(coord[0])) && Number.isFinite(Number(coord[1]));
}

function featureObjectId(feature) {
  const value = feature?.properties?.OBJECTID ?? feature?.id;
  return value == null ? null : String(value);
}

function parentObjectId(feature) {
  const value = feature?.properties?.parent_objectid;
  return value == null ? null : String(value);
}

export function unconfirmedLineCoordinates(feature) {
  const geometry = feature?.geometry;
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  if (geometry.type === "LineString") return geometry.coordinates.filter(finiteCoordinate);
  if (geometry.type !== "MultiLineString") return [];
  return geometry.coordinates
    .filter((part) => Array.isArray(part))
    .map((part) => part.filter(finiteCoordinate))
    .filter((part) => part.length > 1)
    .reduce((best, part) => {
      if (best.length === 0) return part;
      return buildLinePathMetrics(part).total > buildLinePathMetrics(best).total ? part : best;
    }, []);
}

function pathLength(feature) {
  return buildLinePathMetrics(unconfirmedLineCoordinates(feature)).total;
}

export function composeRouteProgress({ unconfirmedLength, confirmedLength, progress }) {
  const unconfirmed = Math.max(0, Number(unconfirmedLength) || 0);
  const confirmed = Math.max(0, Number(confirmedLength) || 0);
  const total = unconfirmed + confirmed;
  const fraction = Math.min(1, Math.max(0, Number(progress) || 0));
  if (total <= 0) {
    return { unconfirmedProgress: 0, confirmedProgress: 0, phase: "unconfirmed", joinFraction: 0 };
  }
  const joinFraction = unconfirmed / total;
  if (fraction < joinFraction) {
    return {
      unconfirmedProgress: joinFraction > 0 ? fraction / joinFraction : 1,
      confirmedProgress: 0,
      phase: "unconfirmed",
      joinFraction,
    };
  }
  const remain = 1 - joinFraction;
  return {
    unconfirmedProgress: 1,
    confirmedProgress: remain > 0 ? (fraction - joinFraction) / remain : 1,
    phase: fraction >= 1 ? "complete" : "confirmed",
    joinFraction,
  };
}

export function clipLineCoordinatesToProgress(coords, metrics, progress) {
  if (!Array.isArray(coords) || coords.length === 0) return [];
  const fraction = Number(progress);
  if (!(fraction > 0)) return [];
  if (fraction >= 1) return coords;
  const total = Number(metrics?.total);
  if (!Number.isFinite(total) || total <= 0) return coords;
  const cumulative = Array.isArray(metrics?.cumulative) ? metrics.cumulative : [0];
  const target = fraction * total;
  let segment = 0;
  while (segment < cumulative.length - 1 && cumulative[segment + 1] < target) segment += 1;
  const prefix = coords.slice(0, segment + 1);
  const end = pointAtLineProgress(coords, metrics, fraction);
  if (!end) return prefix;
  const last = prefix[prefix.length - 1];
  if (last && last[0] === end[0] && last[1] === end[1]) return prefix;
  return [...prefix, end];
}

function clipFeatureToProgress(feature, progress) {
  const coords = unconfirmedLineCoordinates(feature);
  if (coords.length < 2) return null;
  const clipped = clipLineCoordinatesToProgress(coords, buildLinePathMetrics(coords), progress);
  if (clipped.length < 2) return null;
  return {
    ...feature,
    geometry: { type: "LineString", coordinates: clipped },
  };
}

function headOn(feature, progress, headKind = "meteor") {
  const coords = unconfirmedLineCoordinates(feature);
  if (coords.length < 2) return null;
  const point = pointAtLineProgress(coords, buildLinePathMetrics(coords), progress);
  if (!point) return null;
  return {
    coordinates: point,
    properties: {
      OBJECTID: feature?.properties?.OBJECTID ?? feature?.id,
      headKind,
    },
  };
}

export function splitCompositeLineFrame({
  activeFeatures = [],
  completedFeatures = [],
  activeProgress = 0,
} = {}) {
  const active = Array.isArray(activeFeatures) ? activeFeatures : [];
  const completed = Array.isArray(completedFeatures) ? completedFeatures : [];
  const approaches = new Map();
  for (const feature of [...active, ...completed]) {
    if (!isUnconfirmedApproach(feature)) continue;
    const parent = parentObjectId(feature);
    if (parent == null || approaches.has(parent)) continue;
    approaches.set(parent, feature);
  }

  const handledUnconfirmed = new Set();
  const confirmedActive = [];
  const unconfirmedActive = [];
  const unconfirmedCompleted = [];
  const confirmedCompleted = [];
  const headPoints = [];

  for (const feature of completed) {
    if (isUnconfirmedRoute(feature)) continue;
    confirmedCompleted.push(feature);
    const child = approaches.get(featureObjectId(feature));
    if (!child) continue;
    unconfirmedCompleted.push(child);
    handledUnconfirmed.add(child);
  }

  for (const feature of active) {
    if (isUnconfirmedRoute(feature)) continue;
    const child = approaches.get(featureObjectId(feature));
    if (!child) {
      confirmedActive.push({ feature, progress: activeProgress, clipGeometry: false });
      const head = headOn(feature, activeProgress, "meteor");
      if (head) headPoints.push(head);
      continue;
    }
    handledUnconfirmed.add(child);
    const split = composeRouteProgress({
      unconfirmedLength: pathLength(child),
      confirmedLength: pathLength(feature),
      progress: activeProgress,
    });
    if (split.phase === "unconfirmed") {
      unconfirmedActive.push({ feature: child, progress: split.unconfirmedProgress, clipGeometry: true });
      const head = headOn(child, split.unconfirmedProgress, "comet");
      if (head) headPoints.push(head);
      continue;
    }
    unconfirmedCompleted.push(child);
    if (split.phase === "complete") {
      confirmedCompleted.push(feature);
      continue;
    }
    confirmedActive.push({ feature, progress: split.confirmedProgress, clipGeometry: true });
    const head = headOn(feature, split.confirmedProgress, "meteor");
    if (head) headPoints.push(head);
  }

  for (const feature of active) {
    if (!isUnconfirmedRoute(feature) || handledUnconfirmed.has(feature)) continue;
    unconfirmedActive.push({ feature, progress: activeProgress, clipGeometry: true });
    const head = headOn(feature, activeProgress, "comet");
    if (head) headPoints.push(head);
  }

  for (const feature of completed) {
    if (!isUnconfirmedRoute(feature) || handledUnconfirmed.has(feature)) continue;
    unconfirmedCompleted.push(feature);
  }

  return {
    confirmedActive,
    confirmedCompleted,
    unconfirmedActive,
    unconfirmedCompleted,
    headPoints,
  };
}

export { clipFeatureToProgress };

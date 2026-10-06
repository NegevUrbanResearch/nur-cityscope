export const PROJECTION_CALIBRATION_IDS = Object.freeze([
  'projector_base.שמות_יישובים', 'projector_base.ישובים', 'projector_base.Locations_Lines',
  'muniplicity_transport.דרכי_עפר', 'projector_base.Tkuma_Area_LIne', 'gaza.Gaza_Roads', 'nli.ציר_232',
]);
const canonicalBoundary = 'projector_base.Tkuma_Area_LIne';
const aliasBoundary = 'projector_base.tkuma_area_line';
const layerIds = (group, layer) => [...new Set([
  layer.fullId || `${group.id}.${layer.id}`, ...(layer.fullLayerIds || []),
])];

/** Read the raw catalog before names-wall isolation. Visibility changes remain projection-local. */
export function resolveProjectionCalibrationScene(input) {
  const groups = structuredClone(Array.isArray(input) ? input : Object.values(input || {}));
  const present = new Set(groups.flatMap(group => (group.layers || []).flatMap(layer => layerIds(group, layer))));
  const boundary = present.has(canonicalBoundary) ? canonicalBoundary : aliasBoundary;
  const wanted = new Set(PROJECTION_CALIBRATION_IDS.map(id => id === canonicalBoundary ? boundary : id));
  for (const group of groups) {
    for (const layer of group.layers || []) layer.enabled = layerIds(group, layer).some(id => wanted.has(id));
    group.enabled = (group.layers || []).some(layer => layer.enabled);
  }
  return { groups, requiredIds: [...PROJECTION_CALIBRATION_IDS],
    missingIds: PROJECTION_CALIBRATION_IDS.filter(id => !present.has(id === canonicalBoundary ? boundary : id)) };
}

/** Applied after prepared adapters are merged, on every compositor refresh. */
export function filterProjectionCalibrationScene(scene) {
  return { ...(scene.map ? { map: scene.map } : {}), ...(scene.settlements ? { settlements: scene.settlements } : {}) };
}

/** Drawn-scene identity only. Task 2 owns the effective source-frame identity. */
export function projectionCalibrationSceneIdentity(scene) {
  let hash = 2166136261;
  for (const ch of JSON.stringify(scene)) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  return `landmarks-v1:${(hash >>> 0).toString(16)}`;
}

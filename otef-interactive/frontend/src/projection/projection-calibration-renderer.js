import { projectionCalibrationSceneIdentity } from '../shared/projection-calibration-scene.js';

/** Reuses the ordinary layer refresh, camera, compositor and settlement adapter. */
export function createProjectionCalibrationRenderer({ setOverride, refreshScene, readNormalGroups, getLabels,
  draw, waitForMap, suppressOverlays, restoreOverlays = () => {} } = {}) {
  return async ({ active, groups, signal, generation, isCurrent = () => true, ...sceneData }) => {
    if (!isCurrent()) return null;
    setOverride(active ? groups : null);
    if (active) suppressOverlays();
    await refreshScene({ groupsOverride: active ? groups : readNormalGroups(), isCurrent, reopenGate: true, keepLiveRuntime: true });
    if (!isCurrent()) return null;
    const labels = getLabels(); labels?.refreshVisibility();
    if (active) {
      if (!labels) throw new Error('Settlement label runtime is unavailable');
      await labels.whenReady();
    }
    if (!isCurrent()) return null;
    await waitForMap({ signal, isCurrent, groups: active ? groups : null });
    if (!isCurrent()) return null;
    if (!active) await restoreOverlays({ isCurrent });
    if (!isCurrent()) return null;
    if (draw() !== true) throw new Error('Landmark scene draw failed');
    return { ready: true, sceneIdentity: active ? projectionCalibrationSceneIdentity({ groups, ...sceneData }) : null };
  };
}

/** Wait for actual map sources and lifecycle loading; an accepted transport message is insufficient. */
export function waitForProjectionCalibrationMap({ map, getRenderedReadiness = () => ({ ready: true, failedIds: [] }), onDiagnostic = () => {}, signal, isCurrent, groups, clock = globalThis, timeoutMs = 30000 }) {
  return new Promise((resolve, reject) => {
    let timer = null;
    const started = Date.now();
    const cleanup = () => { if (timer !== null) clock.clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const fail = error => { cleanup(); reject(error); };
    const abort = () => fail(Object.assign(new Error('Landmark scene superseded'), { name: 'AbortError' }));
    const check = () => {
      if (signal?.aborted || !isCurrent()) { abort(); return; }
      const layers = map.getStyle?.()?.layers || [];
      const expected = (groups || []).flatMap(group => (group.layers || []).filter(layer => layer.enabled).flatMap(layer => layer.fullLayerIds || [layer.fullId || `${group.id}.${layer.id}`]));
      const installed = expected.every(fullId => layers.some(layer => layer.id.startsWith(`${fullId}__`) || layer.id.startsWith(`${fullId.replace('.', '__')}__`)));
      const lifecycle = getRenderedReadiness();
      onDiagnostic({ loaded: map.loaded?.(), lifecycle, expected: expected.map(id => ({ id,
        layers: layers.filter(layer => layer.source === id || layer.id.startsWith(`${id}__`) || layer.id.startsWith(`${id.replace('.', '__')}__`)).map(layer => ({
          id: layer.id, type: layer.type, source: layer.source, visibility: layer.layout?.visibility,
          sourceLoaded: typeof layer.source === 'string' && map.isSourceLoaded?.(layer.source),
          opacity: layer.paint?.['line-opacity'] ?? layer.paint?.['fill-opacity'],
        })),
      })) });
      if (lifecycle.failedIds.length) { fail(new Error(`Landmark layers failed: ${lifecycle.failedIds.join(', ')}`)); return; }
      if ((!groups || installed) && map.loaded?.() === true && lifecycle.ready) { cleanup(); resolve(); return; }
      if (Date.now() - started >= timeoutMs) { fail(new Error('Landmark map sources did not finish drawing')); return; }
      timer = clock.setTimeout(check, 32);
    };
    signal?.addEventListener('abort', abort, { once: true }); check();
  });
}

/** Prevents map-internal overlays added by independent presentation coordinators from bypassing the scene mask. */
export function createProjectionCalibrationMapMask({ map }) {
  let groups = null;
  const hidden = new Map();
  function refresh() {
    if (!groups) return;
    const ids = groups.flatMap(group => (group.layers || []).filter(layer => layer.enabled).flatMap(layer => layer.fullLayerIds || [layer.fullId || `${group.id}.${layer.id}`]));
    for (const layer of map.getStyle?.()?.layers || []) {
      if (ids.some(id => layer.id.startsWith(`${id}__`) || layer.id.startsWith(`${id.replace('.', '__')}__`))) continue;
      const value = map.getLayoutProperty?.(layer.id, 'visibility');
      if (value === 'none') continue;
      if (!hidden.has(layer.id)) hidden.set(layer.id, value ?? null);
      map.setLayoutProperty(layer.id, 'visibility', 'none');
    }
  }
  function clear() {
    groups = null;
    for (const [id, value] of hidden) if (map.getLayer?.(id)) map.setLayoutProperty(id, 'visibility', value);
    hidden.clear();
  }
  return { apply(next) { groups = next; refresh(); }, refresh, clear };
}

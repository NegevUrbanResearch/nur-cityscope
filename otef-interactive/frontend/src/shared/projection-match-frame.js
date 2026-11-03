const TRANSIENT_KEYS = new Set(['timestamp', 'animationStartedAt', 'startedAt', 'updatedAt', 'serverNowMs', 'decodeGeneration', 'contentVersion']);

/** Canonical values for identities; never includes local animation/decode clocks. */
export function normalizeProjectionMatchValue(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Source-frame values must be finite');
    return Number(value.toFixed(8));
  }
  if (Array.isArray(value)) return value.map(normalizeProjectionMatchValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .filter(key => !TRANSIENT_KEYS.has(key) && value[key] !== undefined)
    .map(key => [key, normalizeProjectionMatchValue(value[key])]));
  return value;
}

function imageSourceIdentity(image) {
  if (!image) return null;
  const url = new URL(image.assetPathAndQuery, 'http://localhost');
  // App-served files have the same identity through localhost and the workstation's LAN address.
  const localHost = url.origin === globalThis.location?.origin || url.hostname === 'localhost' || !url.hostname.includes('.') ||
    /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname) || url.hostname.endsWith('.local');
  const local = url.pathname.startsWith('/otef-interactive/') && localHost;
  return { assetPathAndQuery: `${local ? '' : url.origin}${url.pathname}${url.search}`,
    declaredVersion: image.declaredVersion ?? null, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight };
}

function effectiveGroups(groups) {
  const options = value => Object.fromEntries(Object.entries(value).filter(([key]) => [
    'id', 'fullId', 'fullLayerIds', 'type', 'source', 'path', 'url', 'file', 'format', 'geometryType', 'mask', 'dataUrl', 'sourceVersion', 'projection',
    'projectionStyle', 'style', 'paint', 'layout', 'filter', 'minzoom', 'maxzoom', 'options', 'wmts',
    'color', 'fillColor', 'display_color', 'submission_color', 'displayColor', 'submissionColor', 'opacity',
  ].includes(key)));
  const compact = value => {
    const selected = options(value);
    if (selected.style) {
      selected.styleIdentity = sha256HexSync(new TextEncoder().encode(JSON.stringify(normalizeProjectionMatchValue(selected.style))));
      delete selected.style;
    }
    return selected;
  };
  return (Array.isArray(groups) ? groups : Object.values(groups || {})).filter(group => group.enabled !== false)
    .map(group => ({ ...compact(group), layers: (group.layers || []).filter(layer => layer.enabled !== false)
      .map(layer => ({ ...compact(layer), ...(layer.fullLayerIds ? { fullLayerIds: [...layer.fullLayerIds].sort() } : {}) }))
      .sort((a, b) => String(a.fullId || a.id).localeCompare(String(b.fullId || b.id), 'en')) }))
    .filter(group => group.layers.length).sort((a, b) => String(a.id).localeCompare(String(b.id), 'en'));
}

/** Portable identity of the effective source, independent of output mesh and decode generation. */
export function projectionMatchFrameIdentity({ output, sceneId, camera, groups, imageIdentity, datasetVersion, settlementNameIdentity }) {
  if (!['left', 'right'].includes(output) || !camera || !Array.isArray(camera.bounds) || camera.bounds.length !== 2 ||
    !camera.bounds.every(pair => Array.isArray(pair) && pair.length === 2 && pair.every(Number.isFinite)) ||
    !Number.isFinite(camera.bearing) || !Number.isFinite(camera.pitch)) throw new TypeError('Invalid source-frame output or camera');
  const identity = JSON.stringify(normalizeProjectionMatchValue({ output, sceneId, camera, groups: effectiveGroups(groups),
    imageIdentity: imageSourceIdentity(imageIdentity), datasetVersion, settlementNameIdentity }));
  if (identity.length > 4096) throw new RangeError('Source-frame identity exceeds 4096 characters');
  return identity;
}

function unstableReason(input) {
  if (input.connected === false) return 'Output disconnected; restart point capture after reconnecting.';
  if (input.cameraMoving) return 'Map camera is moving; restart point capture after it stops.';
  if (!input.sourcesReady) return 'Effective map sources are not ready; wait and restart point capture.';
  if (!input.labels?.ready || input.labels.pending || input.labels.failed) return 'Settlement labels are not committed and painted; restart point capture when ready.';
  if (input.imageParticipates && !input.imageReady) return 'Drawn model image is not ready; restart point capture after loading.';
  if (!input.datasetVersion) return 'Accepted dataset identity is unavailable; refresh the output.';
  if (!input.narrativeIdle) return 'Set the narrative to idle before restarting point capture.';
  if (input.slideshowActive) return 'Stop the slideshow before restarting point capture.';
  if (input.namesDrawn) return 'Hide the names wall before restarting point capture.';
  const geometry = input.geometry;
  if (!geometry?.configIdentity || geometry.pending || geometry.failed || geometry.suspended || geometry.stopped) return 'Output geometry is pending or unavailable; restart point capture after a successful draw.';
  return null;
}

/** Recomputed by semantic/readiness events. Cursor nudges only read the frozen cached state. */
export function createProjectionMatchFrameCache({ readInputs, onChange = () => {}, onInvalidate = () => {} }) {
  let state = Object.freeze({ sourceFrameIdentity: null, stable: false, error: 'Source frame is not initialized' });
  let imageParticipates = false;
  return {
    getState: () => state,
    refresh() {
      let next;
      try {
        const input = readInputs(); imageParticipates = input.imageParticipates === true;
        const error = unstableReason(input);
        next = { sourceFrameIdentity: projectionMatchFrameIdentity({ ...input, imageIdentity: imageParticipates ? input.imageIdentity : null }), stable: error === null, error };
      } catch (error) { next = { sourceFrameIdentity: null, stable: false, error: String(error.message || error).slice(0, 240) }; }
      if (Object.keys(next).some(key => next[key] !== state[key])) { state = Object.freeze(next); onChange(state); }
      return state;
    },
    sourceReloaded(kind) {
      if (kind === 'map' || (kind === 'image' && imageParticipates)) {
        const error = kind === 'map' ? 'Effective map source reloaded; restart point capture.' : 'Drawn model image reloaded; restart point capture.';
        state = Object.freeze({ ...state, stable: false, error }); onInvalidate(error); onChange(state);
      }
    },
  };
}
import { sha256HexSync } from './sha256-hex.js';

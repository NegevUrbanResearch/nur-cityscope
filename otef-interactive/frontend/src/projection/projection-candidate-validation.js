import { evaluateWarpMesh } from '../shared/projection-warp-geometry.js';
import { validateProjectionBaselineMesh } from '../shared/projection-warp-assets.js';
import { validateProjectionConfig } from '../shared/projection-config-schema.js';
import { migrateNamesWallToV5, migrateNamesWallToV6 } from '../shared/nli-name-wall-config.js';

const SIDES = ['left', 'right'];
const HASH = /^[a-f0-9]{64}$/i;
const clone = (value) => typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));

function abortError(reason = 'Wall preparation cancelled') {
  return Object.assign(new Error(reason), { name: 'AbortError' });
}
function checkSignal(signal) { if (signal?.aborted) throw abortError(); }
function reasonOf(error) { return String(error?.message || error || 'Wall preparation unavailable').slice(0, 240); }
function validInput(value) {
  return value && typeof value.datasetVersion === 'string' &&
    value.datasetVersion.trim() && value.datasetVersion.length <= 128;
}
function sameInputs(left, right) {
  return validInput(left) && validInput(right) && left.datasetVersion === right.datasetVersion;
}
function projectionMeshConfig(config) {
  if (config?.schemaVersion === 6) return migrateNamesWallToV6(config, config.namesWall?.rotateDeg);
  return migrateNamesWallToV5(config);
}

export async function readProjectionCandidateInputs({ fetchImpl = globalThis.fetch, signal } = {}) {
  checkSignal(signal);
  if (typeof fetchImpl !== 'function') throw new Error('Name wall release metadata unavailable');
  const response = await fetchImpl('/otef-interactive/public/processed/layers/nli/release-metadata.json', { cache: 'no-store', signal });
  checkSignal(signal);
  if (!response?.ok) throw new Error('Name wall release metadata unavailable');
  const metadata = await response.json();
  checkSignal(signal);
  const datasetVersion = metadata?.datasetVersion || metadata?.release?.datasetVersion || metadata?.version;
  if (typeof datasetVersion !== 'string' || !datasetVersion.trim() || datasetVersion.length > 128) throw new Error('Name wall dataset identity unavailable');
  return { datasetVersion };
}

export function prepareProjectionSideMesh(config, side, baseline = null) {
  if (Object.keys(validateProjectionConfig(config)).length) throw new Error('Invalid projection calibration');
  const candidate = projectionMeshConfig(config);
  const warp = candidate.outputs?.[side]?.warp;
  if (!warp) throw new Error(`Projection calibration has no ${side} warp`);
  let source = null;
  if (warp.enabled !== false && warp.baseline?.type === 'tdMesh') {
    const errors = validateProjectionBaselineMesh(baseline?.mesh, { side, manifest: baseline?.manifest, baseline: warp.baseline });
    if (Object.keys(errors).length || !baseline?.manifest) {
      throw new Error(`Projection ${side} baseline rejected: ${Object.entries(errors).map(([path, message]) => `${path} ${message}`).join('; ') || 'manifest unavailable'}`);
    }
    source = baseline.mesh;
  }
  return { config: candidate, mesh: evaluateWarpMesh(source, warp) };
}

export async function prepareProjectionPairMeshes({ config, loadBaseline, signal }) {
  if (Object.keys(validateProjectionConfig(config)).length) throw new Error('Invalid projection calibration');
  const candidate = projectionMeshConfig(config);
  const loaded = {};
  const meshes = {};
  for (const side of SIDES) {
    checkSignal(signal);
    const warp = candidate.outputs[side].warp;
    if (warp.enabled !== false && warp.baseline?.type === 'tdMesh') {
      if (typeof loadBaseline !== 'function') throw new Error(`Projection ${side} baseline unavailable`);
      loaded[side] = await loadBaseline(side, signal);
      checkSignal(signal);
      if (!loaded[side]) throw new Error(`Projection ${side} baseline unavailable`);
    }
    meshes[side] = prepareProjectionSideMesh(candidate, side, loaded[side]).mesh;
  }
  if (loaded.left && loaded.right && JSON.stringify(loaded.left.manifest) !== JSON.stringify(loaded.right.manifest)) {
    throw new Error('Projection baselines came from different manifests');
  }
  return meshes;
}

function boundedDiagnostics(value, candidate, datasetVersion) {
  if (!value || typeof value !== 'object' || !['valid', 'invalid'].includes(value.state)) return null;
  const mode = candidate.namesWall.activeMode;
  const expectedFont = candidate.namesWall.profiles[mode].requestedFontPx;
  const expected = value.expected; const placed = value.placed;
  if (!Number.isSafeInteger(expected) || expected < 1 || !Number.isSafeInteger(placed) || placed < 0 || placed > expected) return null;
  if ((value.mode != null && value.mode !== mode) || (value.activeMode != null && value.activeMode !== mode)) return null;
  if (value.datasetVersion != null && value.datasetVersion !== datasetVersion) return null;
  if (value.requestedFontPx != null && (!Number.isSafeInteger(value.requestedFontPx) || value.requestedFontPx !== expectedFont)) return null;
  if (value.effectiveFontPx != null && !Number.isSafeInteger(value.effectiveFontPx)) return null;
  const count = (key) => Number.isSafeInteger(value[key]) && value[key] >= 0 ? value[key] : null;
  const missing = count('missing'); const extra = count('extra'); const duplicate = count('duplicate');
  if ([missing, extra, duplicate].some((entry) => entry === null)) return null;
  if ((value.overlap != null && count('overlap') === null) || (value.invalidCoverage != null && count('invalidCoverage') === null)) return null;
  return { state: value.state, datasetVersion, mode, requestedFontPx: expectedFont,
    effectiveFontPx: value.effectiveFontPx ?? null, expected, placed,
    left: count('left'), right: count('right'),
    ...(typeof value.reason === 'string' ? { reason: value.reason.slice(0, 240) } : {}),
    missing, extra, duplicate, overlap: value.overlap ?? 0, invalidCoverage: value.invalidCoverage ?? 0 };
}

export function projectionCandidateResult(config, field, identity, expectedDatasetVersion = field?.datasetVersion) {
  const unavailable = (reason) => ({ identity, valid: false, reason });
  if (!field || typeof field.datasetVersion !== 'string' || !field.datasetVersion.trim() ||
    field.datasetVersion.length > 128 || field.datasetVersion !== expectedDatasetVersion) return unavailable('Name wall dataset unavailable or changed');
  const savedHeading = config?.namesWall?.rotateDeg;
  if (!Number.isFinite(field.heading) || field.heading !== savedHeading) return unavailable('Name wall heading disagrees with candidate rotation');
  if (field.mode != null && field.mode !== config.namesWall.activeMode) return unavailable('Name wall mode disagrees with candidate');
  const diagnostics = boundedDiagnostics(field.diagnostics, config, field.datasetVersion);
  if (!diagnostics) return unavailable('Name wall diagnostics unavailable or inconsistent');
  const bounded = { ...diagnostics };
  delete bounded.missing; delete bounded.extra; delete bounded.duplicate; delete bounded.overlap; delete bounded.invalidCoverage;
  if (diagnostics.state === 'invalid') return { identity, valid: false, reason: bounded.reason || 'Incomplete names wall', diagnostics: bounded };
  if (!HASH.test(field.digest || '')) return unavailable('Name wall digest unavailable or malformed');
  if (diagnostics.expected !== diagnostics.placed || diagnostics.missing !== 0 || diagnostics.extra !== 0 ||
    diagnostics.duplicate !== 0 || diagnostics.overlap !== 0 || diagnostics.invalidCoverage !== 0 ||
    diagnostics.left === null || diagnostics.right === null || diagnostics.left + diagnostics.right !== diagnostics.placed ||
    !Number.isSafeInteger(diagnostics.effectiveFontPx)) return unavailable('Name wall computation is inconsistent');
  return { identity, valid: true, wall: { datasetVersion: field.datasetVersion, mode: config.namesWall.activeMode,
    digest: field.digest, expected: diagnostics.expected, placed: diagnostics.placed }, diagnostics: bounded };
}

export function createProjectionCandidateValidator({ loadBaseline, prepareWall, readInputs, disposePreparation, timeoutMs = 75000 }) {
  let active = null;
  let disposed = false;
  let sequence = 0;
  let lastInputs = null;
  let ownsPreparation = false;
  const stop = (request, reason = 'Wall preparation cancelled') => {
    if (!request || request.stopped) return;
    request.stopped = true;
    request.stopReason = reason;
    request.controller.abort();
    if (request.startedPreparation && ownsPreparation) { disposePreparation?.(); ownsPreparation = false; }
  };
  const validateCandidate = async ({ config, generation, identity, revision }) => {
    stop(active);
    active = null;
    if (disposed) return { identity, valid: false, reason: 'Wall validator disposed' };
    if (typeof identity !== 'string' || identity !== JSON.stringify(config)) return { identity, valid: false, reason: 'Stale wall candidate' };
    if (Object.keys(validateProjectionConfig(config)).length) return { identity, valid: false, reason: 'Invalid projection calibration' };
    const candidate = clone(config);
    const controller = new AbortController();
    const request = { token: ++sequence, controller, startedPreparation: false, stopped: false, generation, revision, identity };
    active = request;
    const signal = controller.signal;
    let timer;
    const aborted = new Promise((_, reject) => signal.addEventListener('abort', () => reject(abortError(request.stopReason)), { once: true }));
    timer = setTimeout(() => { if (active === request) stop(request, 'Wall preparation timed out'); }, timeoutMs);
    try {
      const compute = async () => {
        const before = await readInputs(signal);
        checkSignal(signal);
        if (!validInput(before)) throw new Error('Name wall dataset unavailable');
        const meshes = await prepareProjectionPairMeshes({ config: candidate, loadBaseline, signal });
        checkSignal(signal);
        request.startedPreparation = true;
        ownsPreparation = true;
        const field = await prepareWall({ config: candidate, meshes, datasetVersion: before.datasetVersion, signal });
        checkSignal(signal);
        const after = await readInputs(signal);
        checkSignal(signal);
        if (!sameInputs(before, after)) throw new Error('Name wall inputs changed during preparation');
        lastInputs = { datasetVersion: after.datasetVersion };
        return projectionCandidateResult(candidate, field, identity, before.datasetVersion);
      };
      const result = await Promise.race([compute(), aborted]);
      return active === request && !disposed && !signal.aborted ? result : { identity, valid: false, reason: 'Wall preparation superseded' };
    } catch (error) {
      return { identity, valid: false, reason: request.stopReason === 'Wall preparation timed out' ? request.stopReason : reasonOf(error) };
    } finally {
      clearTimeout(timer);
      if (active === request) {
        if (signal.aborted) stop(request);
        active = null;
      }
    }
  };
  return { validateCandidate, readInputs, getLastInputs: () => lastInputs,
    dispose() { if (disposed) return; disposed = true; stop(active); active = null;
      if (ownsPreparation) { disposePreparation?.(); ownsPreparation = false; }
    } };
}

import { readNliLabelHeading } from './nli-label-heading.js';
import { runNameFieldWorker } from './nli-name-field-worker-client.js';
import { DEFAULT_PROJECTION_CONFIG } from './projection-config-schema.js';
import { sha256Hex } from './sha256-hex.js';

const MODEL_URL = '/otef-interactive/data/model-bounds.json';
const PEOPLE_URL = '/otef-interactive/public/processed/layers/nli/people_names.geojson';
const METADATA_URL = '/otef-interactive/public/processed/layers/nli/release-metadata.json';
const TKUMA_URL = '/otef-interactive/public/processed/layers/projector_base/Tkuma_Area_LIne.geojson';
const FONT = 'Guttman Hatzvi';
const MEMORIAL_STATUSES = new Set(['Murdered', 'Killed on duty', 'Murdered in captivity']);
const inputPromises = new Map(), metricCache = new Map();
let generation = 0, activeDatasetVersion = null;
let projectionPreparation = null;

async function json(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`Name field HTTP ${response.status}: ${url}`);
  return response.json();
}

/** Dataset changes invalidate pending fetches and worker results, not just a finished layout. */
export function invalidateNliNameFieldInputs() { generation++; inputPromises.clear(); disposeProjectionNameWallPreparation(); }

export function prepareMemorialNameRecords(collection) {
  if (!Array.isArray(collection?.features)) throw new Error('Missing name field features');
  const ids = new Set();
  return collection.features.filter((feature) => MEMORIAL_STATUSES.has(feature.properties?.status)).map((feature) => {
    const p = feature.properties || {};
    const pid = String(p.pid ?? feature.id ?? '').trim();
    if (!pid || ids.has(pid)) throw new Error(`Missing or duplicate name field PID: ${pid}`);
    ids.add(pid);
    const name = String(p.hebrew_name || p.name || '').trim();
    if (!name) throw new Error(`Missing name for PID ${pid}`);
    const recorded = [p.source_lon, p.source_lat];
    const sourceCoordinates = recorded.every((v) => typeof v === 'number' && Number.isFinite(v)) ? recorded : feature.geometry?.coordinates?.slice(0, 2);
    if (feature.geometry?.type !== 'Point' || sourceCoordinates?.length !== 2 || !sourceCoordinates.every(Number.isFinite)) throw new Error(`Invalid location for PID ${pid}`);
    return { pid, name, orderKey: String(p.sort_name_he || name).trim(), sourceCoordinates, location: p.location || '' };
  });
}

async function loadInputs(requestedVersion, expectedVersion = requestedVersion) {
  const key = requestedVersion || '__unversioned__';
  if (inputPromises.has(key)) {
    const entry = inputPromises.get(key), current = generation;
    const cached = await entry;
    if (current !== generation || inputPromises.get(key) !== entry) throw new Error('Stale name field dataset fetch');
    if (requestedVersion) return cached;
    const metadata = await json(METADATA_URL, { cache: 'no-store' });
    if (current !== generation || inputPromises.get(key) !== entry) throw new Error('Stale name field dataset fetch');
    const currentVersion = metadata.datasetVersion || metadata.release?.datasetVersion || metadata.version;
    if (typeof currentVersion !== 'string' || !currentVersion.trim()) throw new Error('Missing name field dataset version');
    if (currentVersion !== cached.datasetVersion) {
      invalidateNliNameFieldInputs();
      activeDatasetVersion = currentVersion;
      return loadInputs(undefined, currentVersion);
    }
    return cached;
  }
  const current = generation;
  const promise = (async () => {
    const [model, data, metadata] = await Promise.all([json(MODEL_URL), json(PEOPLE_URL, { cache: 'no-store' }), json(METADATA_URL, { cache: 'no-store' })]);
    if (current !== generation) throw new Error('Stale name field dataset fetch');
    const datasetVersion = metadata.datasetVersion || metadata.release?.datasetVersion || metadata.version;
    if (typeof datasetVersion !== 'string' || !datasetVersion.trim()) throw new Error('Missing name field dataset version');
    if (expectedVersion && expectedVersion !== datasetVersion) throw new Error(`Name field dataset version mismatch: requested ${expectedVersion}, loaded ${datasetVersion}`);
    if (typeof globalThis.proj4 !== 'function') throw new Error('Name field requires coordinate conversion');
    const convert = (x, y) => globalThis.proj4('EPSG:2039', 'EPSG:4326', [x, y]);
    const bounds = [convert(model.west, model.south), convert(model.east, model.north)];
    const footprint = (model.bounds_polygon || model.polygon)?.map((p) => convert(p.x, p.y));
    return { collection: data, records: prepareMemorialNameRecords(data), bounds, footprint, datasetVersion };
  })().catch((error) => { if (inputPromises.get(key) === promise) inputPromises.delete(key); throw error; });
  inputPromises.set(key, promise);
  return promise;
}

async function loadFont(size) {
  const fontSet = document.fonts;
  if (!fontSet?.load) throw new Error(`Projection name wall requires ${FONT}`);
  const faces = await fontSet.load(`${size}px '${FONT}'`);
  if (!Array.isArray(faces) || !faces.some((face) => face.family?.replaceAll('"', '').replaceAll("'", '').trim() === FONT && face.status === 'loaded')) {
    throw new Error(`Projection name wall requires ${FONT}`);
  }
  return faces.map((f) => `${f.family}:${f.style || ''}:${f.weight || ''}:${f.status || ''}`).sort().join('|');
}

/** Recover ink bounds from actual painted pixels when measureText omits them. */
function rasterInkBounds(name, size, advance) {
  const canvas = document.createElement('canvas');
  const width = Math.ceil(advance * 2 + size * 8 + 16);
  const height = Math.ceil(size * 8 + 16);
  if (!canvas || width > 16384 || height > 4096) throw new Error(`Cannot establish ${FONT} ink bounds`);
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext?.('2d', { willReadFrequently: true });
  if (!ctx?.fillText || !ctx?.getImageData) throw new Error(`Cannot establish ${FONT} ink bounds`);
  ctx.font = `${size}px "${FONT}"`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.direction = 'rtl';
  ctx.fillStyle = '#fff';
  const originX = Math.floor(width / 2), originY = Math.floor(height / 2);
  ctx.fillText(name, originX, originY);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  if (pixels.length !== width * height * 4) throw new Error(`Cannot establish ${FONT} ink bounds`);
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (pixels[(y * width + x) * 4 + 3] > 0) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  if (maxX < 0 || minX === 0 || maxX === width - 1 || minY === 0 || maxY === height - 1) throw new Error(`Cannot establish ${FONT} ink bounds`);
  return { width: advance, left: originX - minX, right: maxX + 1 - originX,
    ascent: originY - minY, descent: maxY + 1 - originY, fallback: true };
}

/** Match the projection adapter's text state; raster fallback fails closed if paint cannot be inspected. */
export async function measureNamesWallMetrics(records, profile) {
  const fontIdentity = await loadFont(profile.requestedFontPx);
  const ctx = document.createElement('canvas')?.getContext('2d');
  if (!ctx) throw new Error('Projection name wall requires Canvas text measurement');
  const names = [...new Set(records.map((r) => r.name))].sort();
  const result = [];
  for (let size = profile.requestedFontPx; size >= 1; size--) {
    ctx.font = `${size}px "${FONT}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction = 'rtl';
    const entries = [];
    for (const name of names) {
      const key = JSON.stringify([fontIdentity, name, size]);
      if (!metricCache.has(key)) {
        const measured = ctx.measureText(name);
        if (!Number.isFinite(measured.width) || measured.width <= 0) throw new Error(`Invalid ${FONT} width for ${name}`);
        const ink = ['actualBoundingBoxLeft', 'actualBoundingBoxRight', 'actualBoundingBoxAscent', 'actualBoundingBoxDescent'];
        const fallback = !ink.every((field) => Number.isFinite(measured[field])) || measured.actualBoundingBoxAscent < 0 || measured.actualBoundingBoxDescent < 0;
        metricCache.set(key, fallback ? rasterInkBounds(name, size, measured.width) : {
          width: measured.width, left: measured.actualBoundingBoxLeft, right: measured.actualBoundingBoxRight,
          ascent: measured.actualBoundingBoxAscent, descent: measured.actualBoundingBoxDescent, fallback: false,
        });
      }
      entries.push([name, metricCache.get(key)]);
    }
    result.push([size, entries]);
  }
  return { fontIdentity, metrics: result };
}

async function loadTkuma() {
    const data = await json(TKUMA_URL, { cache: 'no-store' });
    const crs = data?.crs?.properties?.name;
    if (crs !== 'urn:ogc:def:crs:OGC:1.3:CRS84' && crs !== 'EPSG:4326') throw new Error('Invalid Tkuma CRS');
    const features = data?.features;
    if (!Array.isArray(features) || features.length !== 1 || features[0]?.geometry?.type !== 'LineString') throw new Error('Invalid Tkuma line');
    const ring = features[0].geometry.coordinates;
    if (!Array.isArray(ring) || ring.length < 4 || !ring.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)) ||
      ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) throw new Error('Invalid Tkuma closed ring');
    const ringHash = await sha256Hex(new TextEncoder().encode(JSON.stringify(ring)));
    return { ring, ringHash };
}

function rejectAbortedLayout(signal) {
  if (signal?.aborted) throw Object.assign(new Error('Name field calculation cancelled'), { name: 'AbortError' });
}

function waitForPreparation(promise, signal) {
  rejectAbortedLayout(signal);
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const onAbort = () => { signal.removeEventListener('abort', onAbort);
      reject(Object.assign(new Error('Name field calculation cancelled'), { name: 'AbortError' })); };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then((value) => { signal.removeEventListener('abort', onAbort); if (!signal.aborted) resolve(value); },
      (error) => { signal.removeEventListener('abort', onAbort); if (!signal.aborted) reject(error); });
  });
}

export function disposeProjectionNameWallPreparation() {
  projectionPreparation?.controller.abort();
  projectionPreparation = null;
}

/** One document-local owner shares the evaluated geometry and two mode results. */
export function prepareProjectionNameWall({ config, meshes, datasetVersion, signal,
  compositorClips, cameraMappings } = {}) {
  rejectAbortedLayout(signal);
  const heading = config?.namesWall?.rotateDeg;
  if (!config?.namesWall || !meshes?.left || !meshes?.right || !Number.isFinite(heading))
    return Promise.reject(new Error('invalid projection name wall preparation'));
  const logicalPlane = { heading, planeScale: config.pre.scale * Math.min(
    config.outputs.left.post.scale, config.outputs.right.post.scale) };
  const geometryKey = JSON.stringify({ pre: config.pre, outputs: config.outputs,
    innerEdgeInsetPx: config.namesWall.innerEdgeInsetPx, meshes, datasetVersion, logicalPlane,
    compositorClips, cameraMappings });
  if (!projectionPreparation || projectionPreparation.key !== geometryKey) {
    disposeProjectionNameWallPreparation();
    projectionPreparation = { key: geometryKey, controller: new AbortController(), modes: new Map(), coverage: null };
  }
  const owner = projectionPreparation;
  const mode = config.namesWall.activeMode;
  const startMode = (selected) => {
    const key = JSON.stringify({ profile: config.namesWall.profiles[selected], datasetVersion });
    const previous = owner.modes.get(selected);
    if (previous?.key === key) return previous.promise;
    previous?.controller?.abort();
    const controller = new AbortController();
    const abortWithOwner = () => controller.abort();
    owner.controller.signal.addEventListener('abort', abortWithOwner, { once: true });
    if (owner.controller.signal.aborted) controller.abort();
    const promise = (async () => {
      const input = await loadInputs(datasetVersion);
      rejectAbortedLayout(controller.signal);
      const profile = config.namesWall.profiles[selected];
      const [{ fontIdentity, metrics }, tkuma] = await Promise.all([
        measureNamesWallMetrics(input.records, profile), selected === 'model' ? loadTkuma() : Promise.resolve(null),
      ]);
      rejectAbortedLayout(controller.signal);
      const namesWall = { ...config.namesWall, activeMode: selected };
      const field = await runNameFieldWorker({ profile: 'namesWall', records: input.records, metrics,
        fontIdentity, namesWall, config, meshes, compositorClips, cameraMappings,
        ...(owner.coverage ? { coverage: owner.coverage } : {}),
        ...(tkuma ? { ring: tkuma.ring, ringHash: tkuma.ringHash } : {}),
        geometry: { bounds: input.bounds, heading, projectionConfig: config }, logicalPlane,
        datasetVersion: input.datasetVersion }, undefined, controller.signal);
      rejectAbortedLayout(controller.signal);
      if (owner !== projectionPreparation) throw new Error('stale projection name wall preparation');
      if (field?.safeGeometry) { owner.coverage = field.safeGeometry; delete field.safeGeometry; }
      return field;
    })().catch((error) => {
      if (owner.modes.get(selected)?.promise === promise) owner.modes.delete(selected);
      throw error;
    }).finally(() => {
      owner.controller.signal.removeEventListener('abort', abortWithOwner);
    });
    owner.modes.set(selected, { key, promise, controller });
    return promise;
  };
  const active = startMode(mode);
  const inactive = mode === 'wall' ? 'model' : 'wall';
  const inactiveKey = JSON.stringify({ profile: config.namesWall.profiles[inactive], datasetVersion });
  const scheduled = owner.modes.get(inactive);
  if (!scheduled || (!scheduled.controller && (scheduled.after !== active || scheduled.key !== inactiveKey))) {
    const deferred = { key: inactiveKey, promise: null, controller: null, after: active };
    const promise = active.then(() => {
      if (owner !== projectionPreparation || owner.controller.signal.aborted) return null;
      if (owner.modes.get(inactive) !== deferred) return owner.modes.get(inactive)?.promise || null;
      owner.modes.delete(inactive);
      return startMode(inactive);
    });
    deferred.promise = promise;
    owner.modes.set(inactive, deferred);
    promise.catch(() => { if (owner.modes.get(inactive) === deferred) owner.modes.delete(inactive); });
  }
  return waitForPreparation(active, signal);
}

export async function loadNliNameField({ projectionConfig = DEFAULT_PROJECTION_CONFIG, datasetVersion, coverage, configRevision, coverageIdentity, signal } = {}) {
  rejectAbortedLayout(signal);
  if (datasetVersion && activeDatasetVersion && datasetVersion !== activeDatasetVersion) invalidateNliNameFieldInputs();
  if (datasetVersion) activeDatasetVersion = datasetVersion;
  const input = await loadInputs(datasetVersion);
  rejectAbortedLayout(signal);
  if (!datasetVersion) activeDatasetVersion = input.datasetVersion;
  const current = generation;
  if (coverage) {
    const namesWall = projectionConfig.namesWall;
    const profile = namesWall?.profiles?.[namesWall.activeMode];
    if (!profile) throw new Error('Missing projection names wall profile');
    const [{ fontIdentity, metrics }, tkuma] = await Promise.all([
      measureNamesWallMetrics(input.records, profile), namesWall.activeMode === 'model' ? loadTkuma() : Promise.resolve(null),
    ]);
    rejectAbortedLayout(signal);
    if (current !== generation) throw new Error('Stale name field dataset preparation');
    const heading = projectionConfig.namesWall?.rotateDeg;
    if (!Number.isFinite(heading)) throw new Error('invalid projection name wall rotation');
    const logicalPlane = { heading, planeScale: projectionConfig.pre.scale * Math.min(
      projectionConfig.outputs.left.post.scale, projectionConfig.outputs.right.post.scale) };
    const field = await runNameFieldWorker({ profile: 'namesWall', records: input.records, metrics, fontIdentity,
      coverage, coverageIdentity, namesWall, logicalPlane, ...(tkuma ? { ring: tkuma.ring, ringHash: tkuma.ringHash } : {}),
      geometry: { bounds: input.bounds, heading, projectionConfig }, heading, datasetVersion: input.datasetVersion, configRevision }, undefined, signal);
    rejectAbortedLayout(signal);
    if (current !== generation) throw new Error('Stale name field worker result');
    return field;
  }
  // GIS and other non-browser callers keep the stored label heading until Task 7.
  await document.fonts?.load("12px 'Guttman Hatzvi'");
  const ctx = document.createElement('canvas').getContext('2d');
  const texts = input.collection.features.map((feature) => String(feature.properties?.hebrew_name || feature.properties?.name || '').trim());
  const widths = [12, 10, 8].map((size) => { ctx.font = `${size}px 'Guttman Hatzvi', sans-serif`; return [size, new Map(texts.map((name) => [name, ctx.measureText(name).width]))]; });
  const field = await runNameFieldWorker({ collection: input.collection, geometry: { bounds: input.bounds, footprint: input.footprint,
    heading: readNliLabelHeading(globalThis.localStorage), projectionConfig }, widths, datasetVersion: input.datasetVersion });
  if (current !== generation) throw new Error('Stale name field worker result');
  return field;
}

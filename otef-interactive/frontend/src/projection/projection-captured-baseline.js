import { sha256Hex } from "../shared/sha256-hex.js";
import { validateProjectionConfig } from "../shared/projection-config-schema.js";
import { resolveProjectionBaselineAsset, validateProjectionBaselineManifest, validateProjectionBaselineMesh } from "../shared/projection-warp-assets.js";

export const PROJECTION_OUTPUT_WIDTH = 1920;
export const PROJECTION_OUTPUT_HEIGHT = 1080;
export const DEFAULT_PROJECTION_BASELINE = "/otef-interactive/public/projection-calibration/td-baselines/";

function joinAssetUrl(base, path) {
  const value = String(path || "");
  if (value.startsWith("/")) return value;
  const parts = String(base).split("/").filter(Boolean);
  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

async function readResponseBytes(response) {
  if (typeof response?.arrayBuffer === "function") return new Uint8Array(await response.arrayBuffer());
  if (typeof response?.text === "function") return new TextEncoder().encode(await response.text());
  return null;
}

function parseJson(bytes) {
  return JSON.parse(new TextDecoder().decode(bytes));
}

function abortError() {
  const error = new Error("browser projection startup was cancelled");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function validateBaselineManifest(manifest) {
  const errors = validateProjectionBaselineManifest(manifest);
  if (Object.keys(errors).length) {
    throw new Error("browser projection baseline manifest invalid: " +
      Object.entries(errors).map(([path, message]) => `${path} ${message}`).join("; "));
  }
}

function awaitWithSignal(promise, signal) {
  if (!signal) return Promise.resolve(promise);
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener?.("abort", onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(abortError());
    };
    signal.addEventListener?.("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}

function fetchOptions(signal) {
  // Calibration files have stable URLs and can be repaired or replaced locally.
  return signal ? { signal, cache: "no-store" } : { cache: "no-store" };
}

function fetchWithSignal(fetchImpl, url, signal) {
  const options = fetchOptions(signal);
  return options ? fetchImpl(url, options) : fetchImpl(url);
}

async function fetchJson(fetchImpl, url, label, signal) {
  throwIfAborted(signal);
  const response = await awaitWithSignal(fetchWithSignal(fetchImpl, url, signal), signal);
  throwIfAborted(signal);
  if (!response?.ok) throw new Error(`browser projection ${label} unavailable`);
  if (typeof response.arrayBuffer === "function" || typeof response.text === "function") {
    const bytes = await awaitWithSignal(readResponseBytes(response), signal);
    throwIfAborted(signal);
    return { value: parseJson(bytes), bytes };
  }
  if (typeof response.json === "function") {
    const value = await awaitWithSignal(response.json(), signal);
    throwIfAborted(signal);
    return { value, bytes: null };
  }
  throw new Error(`browser projection ${label} response is unreadable`);
}

async function fetchVerifiedJson(fetchImpl, url, label, expectedHash, signal) {
  throwIfAborted(signal);
  const response = await awaitWithSignal(fetchWithSignal(fetchImpl, url, signal), signal);
  throwIfAborted(signal);
  if (!response?.ok) throw new Error(`browser projection ${label} unavailable`);
  const bytes = await awaitWithSignal(readResponseBytes(response), signal);
  throwIfAborted(signal);
  if (!expectedHash) throw new Error(`browser projection ${label} digest is missing`);
  if (!bytes) throw new Error(`browser projection ${label} bytes unavailable for hash verification`);
  const actual = await awaitWithSignal(sha256Hex(bytes), signal);
  throwIfAborted(signal);
  if (actual.toLowerCase() !== String(expectedHash).toLowerCase().replace(/^sha256:/, "")) {
    throw new Error(`browser projection ${label} hash mismatch`);
  }
  return { value: parseJson(bytes), bytes };
}

export async function loadCapturedProjectionFraming({
  fetchImpl = globalThis.fetch,
  base = DEFAULT_PROJECTION_BASELINE,
  signal,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("browser projection baseline fetch is unavailable");
  throwIfAborted(signal);
  const manifestUrl = joinAssetUrl(base, "manifest.json");
  const { value: manifest, bytes: manifestBytes } = await fetchJson(fetchImpl, manifestUrl, "baseline manifest", signal);
  if (!manifest || manifest.width !== PROJECTION_OUTPUT_WIDTH || manifest.height !== PROJECTION_OUTPUT_HEIGHT) {
    throw new Error("browser projection baseline manifest dimensions are invalid");
  }
  if (!manifest.framing?.path) throw new Error("browser projection baseline framing is missing");
  validateBaselineManifest(manifest);
  const framingUrl = joinAssetUrl(base, manifest.framing.path);
  const framing = await fetchVerifiedJson(fetchImpl, framingUrl, "captured framing", manifest.framing.sha256, signal);
  if (!framing.value?.pre || !framing.value?.outputs || Object.keys(validateProjectionConfig(framing.value)).length) {
    throw new Error("browser projection captured framing is invalid");
  }
  return { manifest, framing: framing.value, framingUrl, manifestBytes };
}

export async function loadCapturedProjectionAsset({
  fetchImpl = globalThis.fetch,
  base = DEFAULT_PROJECTION_BASELINE,
  spanId = "left",
  captured = null,
  baseline = null,
  signal,
} = {}) {
  const source = captured || await loadCapturedProjectionFraming({ fetchImpl, base, signal });
  throwIfAborted(signal);
  if (!source?.manifest || source.manifest.width !== PROJECTION_OUTPUT_WIDTH || source.manifest.height !== PROJECTION_OUTPUT_HEIGHT) {
    throw new Error("browser projection baseline manifest dimensions are invalid");
  }
  if (!source.manifest.framing?.path) throw new Error("browser projection baseline framing is missing");
  validateBaselineManifest(source?.manifest);
  let asset;
  try { asset = resolveProjectionBaselineAsset(source.manifest, spanId, baseline); }
  catch (error) { throw new Error(`browser projection baseline for ${spanId} rejected: ${error.message}`); }
  const meshUrl = joinAssetUrl(base, asset.path);
  const mesh = await fetchVerifiedJson(fetchImpl, meshUrl, `${spanId} mesh`, asset.sha256, signal);
  const meshErrors = validateProjectionBaselineMesh(mesh.value, { side: spanId, manifest: source.manifest, baseline });
  if (Object.keys(meshErrors).length) {
    throw new Error(`browser projection ${spanId} mesh rejected: ${Object.entries(meshErrors).map(([path, message]) => `${path} ${message}`).join('; ')}`);
  }
  return { ...source, mesh: mesh.value, meshUrl, asset };
}

function containsAssetId(manifest, side, baseline) {
  if (!baseline || typeof baseline.assetId !== 'string') return false;
  return [manifest?.assets?.[side], ...(Array.isArray(manifest?.catalog?.[side]) ? manifest.catalog[side] : [])]
    .some((asset) => asset?.assetId === baseline.assetId);
}

/** Resolve and load a candidate pair from one catalog snapshot, refreshing once for absent IDs. */
export function createProjectionBaselineCatalogLoader({ fetchImpl = globalThis.fetch, base = DEFAULT_PROJECTION_BASELINE, initialSnapshot = null } = {}) {
  let currentSnapshot = initialSnapshot;
  const caches = new WeakMap();
  const cacheFor = (snapshot) => {
    let cache = caches.get(snapshot);
    if (!cache) { cache = new Map(); caches.set(snapshot, cache); }
    return cache;
  };
  const loadSelected = async (snapshot, side, reference, signal) => {
    const key = `${side}\0${reference.assetId}\0${String(reference.sha256).toLowerCase().replace(/^sha256:/i, '')}`;
    const cache = cacheFor(snapshot);
    if (!cache.has(key)) {
      // A shared cache entry must outlive any one preparation's abort signal.
      // Each caller races its own signal below; a canceled caller cannot abort
      // the request another candidate is already awaiting.
      const pending = loadCapturedProjectionAsset({ fetchImpl, base, spanId: side, captured: snapshot, baseline: reference });
      cache.set(key, pending);
      pending.catch(() => { if (cache.get(key) === pending) cache.delete(key); });
    }
    const result = await awaitWithSignal(cache.get(key), signal);
    return result;
  };
  const prepare = async (config, signal) => {
    throwIfAborted(signal);
    const configErrors = validateProjectionConfig(config);
    if (Object.keys(configErrors).length) throw new Error('Invalid projection calibration: ' +
      Object.entries(configErrors).map(([path, message]) => `${path} ${message}`).join('; '));
    const selected = {};
    for (const side of ['left', 'right']) {
      const warp = config?.outputs?.[side]?.warp;
      if (warp?.enabled !== false && warp?.baseline?.type === 'tdMesh') selected[side] = warp.baseline;
    }
    if (!Object.keys(selected).length) return { snapshot: currentSnapshot, loaded: {} };
    const firstSnapshot = !currentSnapshot;
    let snapshot = currentSnapshot || await loadCapturedProjectionFraming({ fetchImpl, base, signal });
    let requiresRefresh = false;
    for (const [side, reference] of Object.entries(selected)) {
      // Resolve every known record against the current trusted snapshot before
      // an absent peer can trigger a refresh that changes those records.
      if (containsAssetId(snapshot.manifest, side, reference)) resolveProjectionBaselineAsset(snapshot.manifest, side, reference);
      else requiresRefresh = true;
    }
    if (requiresRefresh && !firstSnapshot) {
      snapshot = await loadCapturedProjectionFraming({ fetchImpl, base, signal });
      if (Object.entries(selected).some(([side, reference]) => !containsAssetId(snapshot.manifest, side, reference))) {
        throw new Error('projection baseline is not present in the refreshed trusted manifest');
      }
    }
    const loaded = {};
    await Promise.all(Object.entries(selected).map(async ([side, reference]) => {
      loaded[side] = await loadSelected(snapshot, side, reference, signal);
    }));
    return { snapshot, loaded };
  };
  return {
    prepare,
    promote(snapshot) { if (snapshot?.manifest) currentSnapshot = snapshot; },
    getSnapshot() { return currentSnapshot; },
  };
}

export { joinAssetUrl };

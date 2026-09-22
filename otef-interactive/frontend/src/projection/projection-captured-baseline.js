import { sha256Hex } from "../shared/sha256-hex.js";
import { validateProjectionConfig } from "../shared/projection-config-schema.js";

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
  return signal ? { signal } : null;
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
  signal,
} = {}) {
  const source = captured || await loadCapturedProjectionFraming({ fetchImpl, base, signal });
  throwIfAborted(signal);
  const asset = source.manifest.assets?.[spanId];
  if (!asset?.path) throw new Error(`browser projection baseline asset for ${spanId} is missing`);
  const meshUrl = joinAssetUrl(base, asset.path);
  const mesh = await fetchVerifiedJson(fetchImpl, meshUrl, `${spanId} mesh`, asset.sha256, signal);
  return { ...source, mesh: mesh.value, meshUrl, asset };
}

export { joinAssetUrl };

const RUNTIME_PATH = "/otef-interactive/runtime/network.json";
const MAX_RUNTIME_AGE_MS = 60_000;
const RUNTIME_KEYS = ["version", "remoteOrigin", "generatedAt", "status"];

function asUrl(location) {
  if (location instanceof URL) return location;
  const href = location?.href || (typeof location === "string" ? location : null);
  const fallbackOrigin = location?.origin && location.origin !== "null" ? `${location.origin}/` : null;
  if (!href && !fallbackOrigin) return null;
  try {
    return new URL(href || fallbackOrigin);
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  if (host === "localhost" || host === "::1") return true;
  const mapped = host.match(/^::ffff:(?:(\d+)\.(\d+)\.(\d+)\.(\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/i);
  if (mapped) {
    const octets = mapped[1]
      ? mapped.slice(1, 5).map(Number)
      : [parseInt(mapped[5], 16) >> 8, parseInt(mapped[5], 16) & 255, parseInt(mapped[6], 16) >> 8, parseInt(mapped[6], 16) & 255];
    return octets[0] === 127 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
  }
  const octets = host.split(".");
  return octets.length === 4 && octets[0] === "127" && octets.every((part) => /^\d+$/.test(part) && Number(part) <= 255);
}

function isHttpOrigin(value) {
  if (typeof value !== "string" || !value) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(parsed.protocol) || parsed.origin !== value) return null;
  if (parsed.username || parsed.password || isLoopbackHostname(parsed.hostname)) return null;
  return parsed.origin;
}

function isLoopbackPage(location) {
  const page = asUrl(location);
  return !!page && isLoopbackHostname(page.hostname);
}

function isRuntimeShape(runtime) {
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) return false;
  if (Object.keys(runtime).length !== RUNTIME_KEYS.length || Object.keys(runtime).some((key) => !RUNTIME_KEYS.includes(key))) return false;
  return runtime.version === 1 && runtime.status === "ready" && typeof runtime.generatedAt === "string" && runtime.generatedAt.length > 0;
}

export function resolveShareOrigin(location, runtime) {
  const page = asUrl(location);
  if (!page || !/^https?:$/.test(page.protocol) || page.username || page.password) return null;
  if (!isLoopbackHostname(page.hostname)) return page.origin;
  if (!isRuntimeShape(runtime)) return null;
  return isHttpOrigin(runtime.remoteOrigin);
}

export async function loadShareOrigin({ location, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  const page = asUrl(location);
  if (!page) return null;
  const direct = resolveShareOrigin(page, null);
  if (direct) return direct;
  if (!isLoopbackPage(page) || typeof fetchImpl !== "function") return null;
  try {
    const response = await fetchImpl(RUNTIME_PATH, { cache: "no-store" });
    if (!response?.ok) return null;
    const runtime = await response.json();
    const generatedAt = Date.parse(runtime?.generatedAt);
    const current = Number(typeof now === "function" ? now() : now);
    if (!Number.isFinite(generatedAt) || !Number.isFinite(current)) return null;
    const age = current - generatedAt;
    if (age < 0 || age > MAX_RUNTIME_AGE_MS) return null;
    return resolveShareOrigin(page, runtime);
  } catch {
    return null;
  }
}

export { RUNTIME_PATH, MAX_RUNTIME_AGE_MS };

const SHARE_PATH = "/otef-interactive/runtime/share.json";

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

function isTsNetHostname(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/\.+$/, "");
  return host === "ts.net" || host.endsWith(".ts.net");
}

function allowedHttpOrigin(value) {
  if (typeof value !== "string" || !value) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" || parsed.origin !== value) return null;
  if (parsed.username || parsed.password || isLoopbackHostname(parsed.hostname) || isTsNetHostname(parsed.hostname)) {
    return null;
  }
  return parsed.origin;
}

function missingShareHosts(location) {
  const page = asUrl(location);
  if (!page || isLoopbackHostname(page.hostname)) {
    return { localOrigin: null, tailnetOrigin: null, fromShareFile: false };
  }
  return { localOrigin: allowedHttpOrigin(page.origin), tailnetOrigin: null, fromShareFile: false };
}

export function mdnsLabelFromHostname(hostname) {
  return String(hostname || "").split(".")[0].toLowerCase();
}

export function httpOrigin(hostname, port) {
  if (typeof hostname !== "string" || !hostname || !Number.isFinite(port)) return null;
  const origin = port === 80 ? `http://${hostname}` : `http://${hostname}:${port}`;
  return allowedHttpOrigin(origin);
}

export function parseShareHosts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const localOrigin = allowedHttpOrigin(value.localOrigin);
  if (!localOrigin) return null;
  if (value.tailnetOrigin === null) return { localOrigin, tailnetOrigin: null };
  const tailnetOrigin = allowedHttpOrigin(value.tailnetOrigin);
  if (!tailnetOrigin) return null;
  return { localOrigin, tailnetOrigin };
}

export async function loadShareHosts({ location, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") return missingShareHosts(location);
  try {
    const response = await fetchImpl(SHARE_PATH, { cache: "no-store" });
    if (!response?.ok) return missingShareHosts(location);
    const parsed = parseShareHosts(await response.json());
    if (!parsed) return missingShareHosts(location);
    return { ...parsed, fromShareFile: true };
  } catch {
    return missingShareHosts(location);
  }
}

export async function loadShareOrigin(options = {}) {
  const hosts = await loadShareHosts(options);
  return hosts.localOrigin;
}

export function originForMode(mode, hosts) {
  switch (mode) {
    case "local":
      return hosts.localOrigin;
    case "tailnet":
      return hosts.tailnetOrigin ?? hosts.localOrigin;
    default:
      throw new Error(`unknown share mode: ${mode}`);
  }
}

export { SHARE_PATH };

/** Optional declared sidecar: immutable resource identity and verified bytes. */
import layerRegistry from "./layer-registry.js";
export const SHELTER_PARENT_FULL_ID = "nli.ציר_232";

function identityFor(deps) {
  const config =
    typeof deps.getLayerConfig === "function"
      ? deps.getLayerConfig(SHELTER_PARENT_FULL_ID)
      : layerRegistry._initialized
        ? layerRegistry.getLayerConfig(SHELTER_PARENT_FULL_ID)
        : null;
  const r = config?.resources?.shelters232;
  if (!r) return null;
  if (
    r.schemaVersion !== 1 ||
    (r.format && r.format !== "geojson") ||
    !/^[a-f0-9]{64}$/i.test(r.sha256 || "") ||
    !r.shelterVersion ||
    !r.file ||
    /[\\/:]/.test(r.file)
  )
    throw new Error("Invalid declared shelter resource");
  const resourceURL =
    deps.getLayerResourceUrl?.(SHELTER_PARENT_FULL_ID, r) ||
    `/otef-interactive/public/processed/layers/nli/${encodeURIComponent(r.file)}`;
  return Object.freeze({
    resourceURL,
    expectedSHA256: r.sha256.toLowerCase(),
    shelterVersion: r.shelterVersion,
    schemaVersion: r.schemaVersion,
    cohortIdentity: deps.dataVersion ?? config.datasetVersion ?? null,
  });
}
function validate(doc, identity) {
  if (
    doc?.type !== "FeatureCollection" ||
    doc.schemaVersion !== identity.schemaVersion ||
    doc.shelterVersion !== identity.shelterVersion ||
    doc.features?.length !== 9
  )
    throw new Error("Shelter wrapper/version mismatch");
  const ids = new Set();
  for (const f of doc.features) {
    const p = f?.geometry?.coordinates;
    if (
      typeof f.id !== "string" ||
      !f.id.startsWith("nli-shelter-") ||
      ids.has(f.id) ||
      f.geometry.type !== "Point" ||
      !Array.isArray(p) ||
      p.length !== 2 ||
      !p.every(Number.isFinite) ||
      Math.abs(p[0]) > 180 ||
      Math.abs(p[1]) > 90
    )
      throw new Error("Invalid shelter point/ID");
    ids.add(f.id);
  }
  return doc;
}
async function fetchVerified(deps, identity) {
  let bytes;
  if (deps.fetchShelterBytes)
    bytes = await deps.fetchShelterBytes(identity.resourceURL);
  else {
    const response = await globalThis.fetch(identity.resourceURL, { cache: "no-cache" });
    if (!response.ok)
      throw new Error(`Shelter request failed: ${response.status}`);
    bytes = await response.arrayBuffer();
  }
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const crypto = deps.crypto || globalThis.crypto;
  if (!crypto?.subtle) throw new Error("Shelter hash verification unavailable");
  const digest = await crypto.subtle.digest("SHA-256", view);
  const hash = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  if (hash !== identity.expectedSHA256)
    throw new Error("Shelter resource SHA256 mismatch");
  return validate(JSON.parse(new TextDecoder().decode(view)), identity);
}

export function createShelterDataLoader() {
  let identity = null,
    key = null,
    generation = 0,
    pending = null,
    loaded = null,
    status = "unavailable",
    visible = false;
  function configure(deps, on) {
    let next = null;
    try {
      next = on ? identityFor(deps) : null;
    } catch (error) {
      deps.onShelterDiagnostic?.(error);
    }
    const nextKey = next ? JSON.stringify(next) : null;
    if (nextKey !== key || on !== visible) {
      generation++;
      identity = next;
      key = nextKey;
      pending = null;
      loaded = null;
      status = next ? "not-loaded" : "unavailable";
    }
    visible = on;
  }
  async function load(deps, isCurrent = () => true) {
    if (!visible || !identity || loaded || status === "failed") return loaded;
    const token = generation,
      captured = identity,
      capturedKey = key;
    if (!pending)
      pending = Object.freeze({
        key: capturedKey,
        promise: fetchVerified(deps, captured),
      });
    const record = pending;
    status = "loading";
    try {
      const doc = await record.promise;
      // Re-read current declaration as well as checking caller and generation.
      if (
        token !== generation ||
        key !== capturedKey ||
        !visible ||
        !isCurrent() ||
        JSON.stringify(identityFor(deps)) !== capturedKey
      )
        return null;
      loaded = doc;
      status = "ready";
      return doc;
    } catch (error) {
      if (token === generation && isCurrent()) {
        loaded = null;
        status = "failed";
        deps.onShelterDiagnostic?.(error);
      }
      return null;
    }
  }
  return {
    configure,
    load,
    get features() {
      return loaded?.features || [];
    },
    get version() {
      return loaded?.shelterVersion || null;
    },
    get novaRoutesSHA256() {
      return loaded?.novaRoutesSHA256 || null;
    },
    get status() {
      return status;
    },
    invalidate() {
      generation++;
      pending = null;
      loaded = null;
      key = null;
      identity = null;
      visible = false;
      status = "unavailable";
    },
  };
}

export const PEOPLE_SOURCE_ID = "otef-person-selection";
export const PEOPLE_HALO_LAYER_ID = "otef-person-selection-halo";
export const PEOPLE_RUNTIME_URL = "/otef-interactive/public/processed/layers/nli/people.geojson";
export const PEOPLE_INDEX_URL = "/otef-interactive/public/processed/layers/nli/people-search-index.json";
export const PEOPLE_RELEASE_METADATA_URL = "/otef-interactive/public/processed/layers/nli/release-metadata.json";

const clean = (value) => typeof value === "string" && value.trim() ? value.trim() : "";
const pidOf = (value) => value == null || value === "" ? "" : String(value).trim();
const isPoint = (feature) => feature?.geometry?.type === "Point" &&
  Array.isArray(feature.geometry.coordinates) && feature.geometry.coordinates.length >= 2 &&
  feature.geometry.coordinates.slice(0, 2).every(Number.isFinite);

function duplicate(map, key, kind) {
  if (map.has(key)) throw new Error(`Duplicate ${kind} PID: ${key}`);
}

function bestName(row, fallback) {
  const names = [...(Array.isArray(row?.nameForms) ? row.nameForms : []), ...(fallback?.names || [])]
    .map(clean).filter((value) => value && value !== "לא ידוע");
  return names.find((value) => /[\u0590-\u05ff]/.test(value)) || names[0] || "";
}

function acceptedMetadataVersion(metadata) {
  return clean(metadata?.datasetVersion) || clean(metadata?.release?.datasetVersion) || clean(metadata?.release?.version) || clean(metadata?.version);
}

function runtimeGeoJsonHash(metadata) {
  const containers = [metadata?.runtimeArtifactHashes, metadata?.runtimeFileHashes, metadata?.processedArtifactHashes];
  for (const container of containers) {
    if (!container || typeof container !== "object") continue;
    const raw = container["people.geojson"] ?? container["gis/people.geojson"];
    const value = clean(raw) || clean(raw?.sha256) || clean(raw?.hash);
    if (value) return value.toLowerCase().startsWith("sha256:") ? value.slice(7) : value;
  }
  return "";
}

function unpackArtifact(artifact) {
  if (artifact && Object.prototype.hasOwnProperty.call(artifact, "data")) {
    return { data: artifact.data, bytes: artifact.bytes };
  }
  return { data: artifact, bytes: null };
}

async function defaultHashBytes(bytes) {
  if (!globalThis.crypto?.subtle || !(bytes instanceof Uint8Array)) throw new Error("Runtime byte hashing unavailable");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

/** Validate and compact the generated people files without copying the index. */
export function normalizePeopleRuntime(geojson, index, metadata, { geometryVersion = "" } = {}) {
  if (geojson?.type !== "FeatureCollection" || !Array.isArray(geojson.features) || !geojson.features.length) {
    throw new Error("Malformed people GeoJSON collection");
  }
  const acceptedVersion = acceptedMetadataVersion(metadata);
  const version = clean(index?.datasetVersion);
  const declaredGeometryVersion = clean(geojson?.datasetVersion) || clean(geometryVersion);
  if (!acceptedVersion || !version || !declaredGeometryVersion || declaredGeometryVersion !== acceptedVersion || version !== acceptedVersion) {
    throw new Error("People runtime dataset version mismatch");
  }
  if (!Array.isArray(index.people) || !index.people.length) throw new Error("Malformed people index");
  const rows = new Map();
  for (const row of index.people) {
    const pid = pidOf(row?.pid);
    if (!pid) throw new Error("People index PID missing");
    duplicate(rows, pid, "index");
    rows.set(pid, { nameForms: (Array.isArray(row?.nameForms) ? row.nameForms : []).map(clean).filter(Boolean), location: clean(row?.location), sublocation: clean(row?.sublocation) });
  }
  const features = new Map();
  for (const feature of geojson.features) {
    const pid = pidOf(feature?.properties?.pid ?? feature?.id);
    if (!pid) throw new Error("People geometry PID missing");
    duplicate(features, pid, "geometry");
    if (!isPoint(feature)) throw new Error(`People geometry missing for PID: ${pid}`);
    const properties = feature.properties || {};
    features.set(pid, {
      coordinates: feature.geometry.coordinates.slice(0, 2),
      names: [clean(properties.hebrew_name), clean(properties.name)].filter(Boolean),
      nliUrl: clean(properties.nli_url || properties.nliUrl || properties.archive_url),
      location: clean(properties.location), sublocation: clean(properties.sublocation),
    });
  }
  if (rows.size !== features.size || [...rows.keys()].some((pid) => !features.has(pid))) {
    throw new Error("People index and geometry PIDs mismatch");
  }
  const resolve = (personId, datasetVersion) => {
    if (clean(datasetVersion) !== version) return null;
    const pid = pidOf(personId); const row = rows.get(pid); const feature = features.get(pid);
    if (!row || !feature) return null;
    const fallback = feature;
    return { pid, coordinates: fallback.coordinates.slice(), name: bestName(row, fallback), location: row.location || fallback.location || row.sublocation || fallback.sublocation, nliUrl: fallback.nliUrl };
  };
  return { datasetVersion: version, resolve };
}

function fetchJson(url) {
  if (typeof fetch !== "function") return Promise.reject(new Error("fetch unavailable"));
  return fetch(url).then(async (response) => {
    if (!response.ok) throw new Error(`Runtime request failed: ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { data: JSON.parse(new TextDecoder().decode(bytes)), bytes };
  });
}

export function loadPeopleRuntime({ fetchJson: fetcher = fetchJson, hashBytes = defaultHashBytes, peopleUrl = PEOPLE_RUNTIME_URL, indexUrl = PEOPLE_INDEX_URL, metadataUrl = PEOPLE_RELEASE_METADATA_URL } = {}) {
  return Promise.all([fetcher(peopleUrl), fetcher(indexUrl), fetcher(metadataUrl)]).then(async ([rawGeojson, rawIndex, rawMetadata]) => {
    const geometry = unpackArtifact(rawGeojson);
    const index = unpackArtifact(rawIndex).data;
    const metadata = unpackArtifact(rawMetadata).data;
    const expectedHash = runtimeGeoJsonHash(metadata);
    if (!expectedHash || !(geometry.bytes instanceof Uint8Array) || typeof hashBytes !== "function") throw new Error("Runtime GeoJSON hash proof unavailable");
    const actualHash = String(await hashBytes(geometry.bytes)).toLowerCase().replace(/^sha256:/, "");
    if (actualHash !== expectedHash.toLowerCase()) throw new Error("Runtime GeoJSON hash mismatch");
    return normalizePeopleRuntime(geometry.data, index, metadata, { geometryVersion: acceptedMetadataVersion(metadata) });
  });
}

const escapeHtml = (value) => clean(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const popupMarkup = (person) => `<div class="gis-person-bubble" dir="auto">${person.name ? `<div class="gis-person-bubble__name" dir="auto">${escapeHtml(person.name)}</div>` : ""}${person.location ? `<div class="gis-person-bubble__location" dir="auto">${escapeHtml(person.location)}</div>` : ""}</div>`;
const motionReduced = (value) => value === true || value === "reduced";

function coordinatesOf(person) {
  const coordinates = person?.coordinates || person?.geometry?.coordinates;
  return Array.isArray(coordinates) && coordinates.slice(0, 2).every(Number.isFinite) ? coordinates.slice(0, 2) : null;
}

/** Own one reusable MapLibre halo and bubble. */
export function createGisPersonSelection({ map, maplibregl, fetchJson: fetcher, hashBytes, peopleUrl, indexUrl, metadataUrl } = {}) {
  let disposed = false; let current = null; let renderToken = 0; let cameraListener = null;
  const popup = typeof maplibregl?.Popup === "function" ? new maplibregl.Popup({ className: "gis-person-bubble-popup", closeButton: false, closeOnClick: false, maxWidth: "240px", offset: 14 }) : null;
  const runtimePromise = loadPeopleRuntime({ fetchJson: fetcher, hashBytes, peopleUrl, indexUrl, metadataUrl });
  const removeVisual = () => {
    try { popup?.remove(); } catch {}
    if (map?.getLayer?.(PEOPLE_HALO_LAYER_ID)) map.removeLayer(PEOPLE_HALO_LAYER_ID);
    if (map?.getSource?.(PEOPLE_SOURCE_ID)) map.removeSource(PEOPLE_SOURCE_ID);
  };
  const cancelCamera = () => { if (cameraListener) map?.off?.("moveend", cameraListener); cameraListener = null; };
  const mount = (person) => {
    const data = { type: "FeatureCollection", features: [{ type: "Feature", properties: { pid: person.pid }, geometry: { type: "Point", coordinates: person.coordinates } }] };
    if (!map?.getSource?.(PEOPLE_SOURCE_ID)) map?.addSource?.(PEOPLE_SOURCE_ID, { type: "geojson", data });
    map?.getSource?.(PEOPLE_SOURCE_ID)?.setData?.(data);
    if (!map?.getLayer?.(PEOPLE_HALO_LAYER_ID)) map?.addLayer?.({ id: PEOPLE_HALO_LAYER_ID, type: "circle", source: PEOPLE_SOURCE_ID, paint: { "circle-radius": 12, "circle-color": "#c31f4f", "circle-opacity": 0, "circle-stroke-color": "#c31f4f", "circle-stroke-width": 2, "circle-stroke-opacity": 0.9 } });
    bringToFront();
  };
  const bringToFront = () => {
    if (map?.getLayer?.(PEOPLE_HALO_LAYER_ID) && typeof map?.moveLayer === "function") {
      try { map.moveLayer(PEOPLE_HALO_LAYER_ID); } catch {}
    }
  };
  const showBubble = (person, token) => {
    if (disposed || token !== renderToken || current !== person || !popup) return;
    popup.setLngLat(person.coordinates).setHTML(popupMarkup(person)).addTo(map);
  };
  const show = (person, { focus = false, reducedMotion = false } = {}) => {
    const coordinates = coordinatesOf(person);
    if (disposed || !coordinates) return null;
    cancelCamera(); renderToken += 1; current = { ...person, coordinates }; removeVisual(); mount(current);
    const token = renderToken;
    if (focus && typeof map?.flyTo === "function") {
      const duration = motionReduced(reducedMotion) ? 0 : 1600;
      if (duration === 0 || typeof map?.on !== "function") {
        map.flyTo({ center: current.coordinates, zoom: 15, essential: true, duration }); showBubble(current, token);
      } else {
        const listener = () => {
          map.off?.("moveend", listener);
          if (cameraListener === listener) cameraListener = null;
          showBubble(current, token);
        };
        cameraListener = listener;
        map.on("moveend", listener);
        map.flyTo({ center: current.coordinates, zoom: 15, essential: true, duration });
      }
    } else showBubble(current, token);
    return current;
  };
  const onStyleLoad = () => { if (!disposed && current) { mount(current); if (popup) showBubble(current, renderToken); } };
  map?.on?.("style.load", onStyleLoad);
  return {
    load: () => runtimePromise,
    resolve: (personId, datasetVersion) => { const token = renderToken; return runtimePromise.then((runtime) => disposed || token !== renderToken ? null : runtime.resolve(personId, datasetVersion)); },
    bringToFront,
    show, hide: () => { if (!disposed) { cancelCamera(); renderToken += 1; current = null; removeVisual(); } },
    isInsidePaddedViewport: (person, padding = 32) => { const point = coordinatesOf(person); if (!point || typeof map?.project !== "function") return false; const projected = map.project(point); const canvas = map.getCanvas?.() || {}; const width = Number(canvas.clientWidth || canvas.width) || 0; const height = Number(canvas.clientHeight || canvas.height) || 0; return projected.x >= -padding && projected.x <= width + padding && projected.y >= -padding && projected.y <= height + padding; },
    dispose: () => { if (!disposed) { disposed = true; renderToken += 1; cancelCamera(); map?.off?.("style.load", onStyleLoad); current = null; removeVisual(); } },
  };
}

export const attachGisPersonSelection = createGisPersonSelection;

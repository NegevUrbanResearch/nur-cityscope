import { NLI_DISPLAY_PROFILES } from "./nli-investigation-theme.js";
import { getLayerLifecycleRuntime } from "./layer-lifecycle-fade.js";
export const MOR_ROUTE_SCENE_ID = "nli.scene-mor";
import { resolveMotionMode } from "./reduced-motion.js";

export const MOR_ROUTE_URL = "/otef-interactive/public/processed/layers/nli/mor_levy_route.geojson";
export const MOR_ROUTE_SOURCE_ID = "nli-mor-route";
export const MOR_ROUTE_HEAD_SOURCE_ID = "nli-mor-route-head";
export const MOR_ROUTE_LAYER_ID = "nli-mor-route-line";
export const MOR_ROUTE_HEAD_LAYER_ID = "nli-mor-route-head";
const TURQUOISE = "#00FFC5";
const REVEAL_MS = 10000;

function clamp(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }
function finiteCoordinate(point) { return Array.isArray(point) && Number.isFinite(point?.[0]) && Number.isFinite(point?.[1]); }
function project([x, y]) {
  const lon = (Number(x) / 6378137) * 180 / Math.PI;
  const lat = (2 * Math.atan(Math.exp(Number(y) / 6378137)) - Math.PI / 2) * 180 / Math.PI;
  return [lon, lat];
}
function projectPart(part) { return Array.isArray(part) ? part.filter(finiteCoordinate).map(project) : []; }
function mercator([lon, lat]) {
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, Number(lat)));
  return [Number(lon) * Math.PI / 180, Math.log(Math.tan(Math.PI / 4 + clampedLat * Math.PI / 360))];
}
function inverseMercator([x, y]) {
  return [Number(x) * 180 / Math.PI, (2 * Math.atan(Math.exp(Number(y))) - Math.PI / 2) * 180 / Math.PI];
}

/** Convert the reviewed source CRS and reverse connected route parts as one path. */
export function projectAndReverseMorRoute(collection) {
  const crsName = String(collection?.crs?.properties?.name || "").toUpperCase();
  const alreadyWgs84 = !crsName || crsName.includes("4326");
  const features = Array.isArray(collection?.features) ? collection.features : [];
  return {
    type: "FeatureCollection",
    features: features.map((feature, index) => {
      const raw = feature?.geometry?.type === "MultiLineString"
        ? feature.geometry.coordinates.map(alreadyWgs84 ? (part) => part : projectPart).filter((part) => part.length > 1)
        : [(alreadyWgs84 ? feature?.geometry?.coordinates : projectPart(feature?.geometry?.coordinates))].filter((part) => part.length > 1);
      const coordinates = alreadyWgs84 ? raw : raw.reverse().map((part) => part.reverse());
      return {
        type: "Feature",
        id: feature?.id ?? `mor-route-${index}`,
        properties: { ...(feature?.properties || {}), sourceCrs: "EPSG:3857", flowDirection: "nova-outward" },
        geometry: { type: "MultiLineString", coordinates },
      };
    }).filter((feature) => feature.geometry.coordinates.length),
  };
}

function source(map, id) { try { return map?.getSource?.(id); } catch { return null; } }
function layer(map, id) { try { return map?.getLayer?.(id); } catch { return null; } }
function remove(map) {
  try { if (layer(map, MOR_ROUTE_HEAD_LAYER_ID)) map.removeLayer(MOR_ROUTE_HEAD_LAYER_ID); } catch { /* style may be gone */ }
  try { if (layer(map, MOR_ROUTE_LAYER_ID)) map.removeLayer(MOR_ROUTE_LAYER_ID); } catch { /* style may be gone */ }
  try { if (source(map, MOR_ROUTE_SOURCE_ID)) map.removeSource(MOR_ROUTE_SOURCE_ID); } catch { /* style may be gone */ }
  // Remove stale sources left by versions that used a separate head source.
  try { if (source(map, MOR_ROUTE_HEAD_SOURCE_ID)) map.removeSource(MOR_ROUTE_HEAD_SOURCE_ID); } catch { /* style may be gone */ }
}
function lineLength(parts) {
  return parts.reduce((sum, part) => sum + part.reduce((n, point, i) => {
    if (!i) return n;
    const a = mercator(part[i - 1]); const b = mercator(point);
    return n + Math.hypot(b[0] - a[0], b[1] - a[1]);
  }, 0), 0);
}
function pointAt(parts, progress) {
  const total = lineLength(parts); if (!total) return null;
  let target = total * clamp(progress);
  for (const part of parts) for (let i = 1; i < part.length; i += 1) {
    const a = mercator(part[i - 1]); const b = mercator(part[i]); const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (target <= length) {
      const t = length ? target / length : 0;
      return inverseMercator([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    target -= length;
  }
  return parts.at(-1)?.at(-1) || null;
}

function routeParts(route) {
  return route?.features?.flatMap((feature) => feature?.geometry?.type === "MultiLineString"
    ? feature.geometry.coordinates
    : feature?.geometry?.type === "LineString" ? [feature.geometry.coordinates] : []) || [];
}

function truncatedParts(parts, progress) {
  const total = lineLength(parts); if (!total) return [];
  let remaining = total * clamp(progress);
  const result = [];
  for (const part of parts) {
    if (!Array.isArray(part) || part.length < 2) continue;
    if (remaining <= 0) break;
    const truncated = [part[0]];
    for (let i = 1; i < part.length; i += 1) {
      const a = mercator(part[i - 1]); const b = mercator(part[i]);
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (remaining >= length) {
        truncated.push(part[i]); remaining -= length;
        continue;
      }
      const t = length ? remaining / length : 0;
      truncated.push(inverseMercator([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]));
      remaining = 0;
      break;
    }
    if (truncated.length > 1) result.push(truncated);
  }
  return result;
}

function routeFrame(route, progress, reduced) {
  const parts = routeParts(route);
  const coordinates = reduced ? parts : truncatedParts(parts, progress);
  const features = coordinates.length ? [{ type: "Feature", properties: { role: "line" }, geometry: { type: "MultiLineString", coordinates } }] : [];
  if (!reduced) {
    const coordinates = pointAt(parts, progress);
    if (coordinates) features.push({ type: "Feature", properties: { role: "head" }, geometry: { type: "Point", coordinates } });
  }
  return { type: "FeatureCollection", features };
}

export function createMorRouteCoordinator({ map, dataContext, profile = "gis", managedScene = false } = {}) {
  const resolvedProfile = NLI_DISPLAY_PROFILES[profile] || NLI_DISPLAY_PROFILES.gis;
  const width = 2.2 * Number(resolvedProfile.lineWidthMultiplier || 1);
  let narrative = dataContext?.getNarrativeState?.() || { id: null };
  let overlay = dataContext?.getEscapeOverlay?.() || { mor: false };
  let route = null; let loading = null; let mounted = false; let disposed = false; let startedAt = null; let raf = null; let generation = 0;
  const unsubs = [];
  let runtime = managedScene ? getLayerLifecycleRuntime(map) : null;
  let cancelDeparture = null, heldAt = null, owner = null;
  const active = () => narrative?.id === "nova" && overlay?.mor === true;
  const currentOwner = record => !!record && owner === record && !disposed && record.generation === generation &&
    (!record.runtime || record.runtime === runtime && !record.runtime.isDisposed()) &&
    record.style === map.style && source(map, MOR_ROUTE_SOURCE_ID) === record.source &&
    [...record.layers].every(([id, handle]) => layer(map, id) === handle);
  const canReveal = () => !runtime || currentOwner(owner) && owner.ready && runtime.getDesiredIds().includes(MOR_ROUTE_SCENE_ID);
  const schedule = () => {
    if (raf != null || disposed || !mounted || heldAt != null || !canReveal() || resolveMotionMode() === "reduced") return;
    const request = typeof map?.requestAnimationFrame === "function"
      ? map.requestAnimationFrame.bind(map)
      : typeof globalThis.requestAnimationFrame === "function"
        ? globalThis.requestAnimationFrame.bind(globalThis)
        : null;
    if (request) raf = request(tick);
  };
  const tick = () => {
    raf = null; if (disposed || !mounted || !route || !active() || heldAt != null || !canReveal()) return;
    if (startedAt == null) startedAt = Date.now();
    const reduced = resolveMotionMode() === "reduced";
    const progress = reduced ? 1 : (startedAt == null ? 0 : clamp((Date.now() - startedAt) / REVEAL_MS));
    const routeSource = source(map, MOR_ROUTE_SOURCE_ID);
    if (routeSource?.setData) routeSource.setData(routeFrame(route, progress, reduced));
    if (!reduced && progress < 1) schedule();
  };
  const cancelScheduled = () => {
    if (raf == null) return;
    try {
      const cancel = typeof map?.cancelAnimationFrame === "function"
        ? map.cancelAnimationFrame.bind(map)
        : typeof globalThis.cancelAnimationFrame === "function"
          ? globalThis.cancelAnimationFrame.bind(globalThis)
          : null;
      cancel?.(raf);
    } catch { /* map may be gone */ }
    raf = null;
  };
  const retireOwner = (record = owner) => {
    if (!record || owner !== record) return;
    cancelScheduled(); record.cancelReady?.();
    for (const [id, handle] of [...record.layers].reverse()) if (layer(map, id) === handle) map.removeLayer(id);
    if (source(map, MOR_ROUTE_SOURCE_ID) === record.source && !map.getStyle().layers.some(layer => layer.source === MOR_ROUTE_SOURCE_ID)) map.removeSource(MOR_ROUTE_SOURCE_ID);
    owner = null; mounted = false; startedAt = null; heldAt = null;
  };
  const addSceneLayer = layerDef => {
    const memberRuntime = runtime;
    const staged = runtime?.stageMapLayer(MOR_ROUTE_SCENE_ID, layerDef, {
      onTeardown: () => { if (owner?.runtime === memberRuntime && !memberRuntime.getDesiredIds().includes(MOR_ROUTE_SCENE_ID)) retireOwner(); },
    });
    map.addLayer(staged?.stagedLayerDef || layerDef);
  };
  const watchInitialSource = record => {
    if (!runtime || record.waiting || record.ready) return;
    record.runtime.subscribeMemberReady(MOR_ROUTE_SCENE_ID, ({ ready, failed }) => {
      record.waiting = true;
      const accept = () => {
        if (!currentOwner(record) || record.ready || !active() || !record.runtime.getDesiredIds().includes(MOR_ROUTE_SCENE_ID) || !map.isSourceLoaded?.(MOR_ROUTE_SOURCE_ID)) return;
        record.ready = true; ready();
        if (currentOwner(record) && heldAt == null && resolveMotionMode() !== "reduced") tick();
      };
      const data = event => { if (event?.sourceId === MOR_ROUTE_SOURCE_ID) accept(); };
      const error = event => { if (currentOwner(record) && (event?.sourceId || event?.error?.sourceId) === MOR_ROUTE_SOURCE_ID) failed(); };
      const detach = () => { if (!record.waiting) return; record.waiting = false; map.off?.("sourcedata", data); map.off?.("error", error); };
      record.cancelReady = detach;
      map.on?.("sourcedata", data); map.on?.("error", error); accept();
      return () => { detach(); if (!record.runtime.getDesiredIds().includes(MOR_ROUTE_SCENE_ID)) retireOwner(record); };
    });
  };
  const mount = () => {
    if (disposed || !active() || !route || typeof map?.addSource !== "function") return;
    cancelScheduled();
    remove(map);
    generation += 1;
    map.addSource(MOR_ROUTE_SOURCE_ID, { type: "geojson", lineMetrics: true, data: routeFrame(route, 0, resolveMotionMode() === "reduced") });
    addSceneLayer({ id: MOR_ROUTE_LAYER_ID, type: "line", source: MOR_ROUTE_SOURCE_ID, filter: ["==", ["get", "role"], "line"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": TURQUOISE, "line-width": width, "line-opacity": 0.6 } });
    addSceneLayer({ id: MOR_ROUTE_HEAD_LAYER_ID, type: "circle", source: MOR_ROUTE_SOURCE_ID, filter: ["==", ["get", "role"], "head"], paint: { "circle-radius": 5.5 * Number(resolvedProfile.radiusMultiplier || 1), "circle-color": "#eaffff", "circle-stroke-color": TURQUOISE, "circle-stroke-width": 2.5, "circle-opacity": 0.98 } });
    owner = { generation, runtime, style: map.style, source: source(map, MOR_ROUTE_SOURCE_ID), layers: new Map([MOR_ROUTE_LAYER_ID, MOR_ROUTE_HEAD_LAYER_ID].map(id => [id, layer(map, id)])), ready: !runtime, waiting: false };
    mounted = true;
    if (runtime) watchInitialSource(owner);
    else tick();
  };
  const sync = () => {
    if (disposed) return;
    if (!active()) { if (runtime) retireOwner(); else { mounted = false; startedAt = null; cancelScheduled(); remove(map); } return; }
    if (route && mounted && layer(map, MOR_ROUTE_LAYER_ID)) { if (runtime) watchInitialSource(owner); schedule(); return; }
    if (route) mount();
  };
  const loadAndSync = async () => {
    if (route) { sync(); return; }
    if (!loading) {
      loading = (async () => {
        const response = await fetch(MOR_ROUTE_URL);
        if (!response?.ok) throw new Error(`Mor route request failed: ${response?.status || "unknown"}`);
        route = projectAndReverseMorRoute(await response.json());
      })().finally(() => { loading = null; });
    }
    try { await loading; sync(); } catch (error) {
      if (!disposed) console.warn(`[Mor Levy route] ${error?.message || error}`);
    }
  };
  if (!managedScene) unsubs.push(dataContext?.subscribe?.("narrativeState", (value) => { narrative = value; if (!active()) cancelScheduled(); void loadAndSync(); }));
  if (!managedScene) unsubs.push(dataContext?.subscribe?.("escapeOverlay", (value) => { overlay = value; if (!active()) cancelScheduled(); void loadAndSync(); }));
  if (!managedScene && active()) void loadAndSync();
  return {
    resetStyle() { generation += 1; cancelScheduled(); owner?.cancelReady?.(); owner = null; cancelDeparture?.(); cancelDeparture = null; mounted = false; if (managedScene) runtime = getLayerLifecycleRuntime(map); },
    getSceneIds(snapshot) { return snapshot.narrativeState?.id === "nova" && snapshot.escapeOverlay?.mor ? [MOR_ROUTE_SCENE_ID] : []; },
    async prepareSnapshot(snapshot, { signal } = {}) {
      if (snapshot.narrativeState?.id !== "nova" || !snapshot.escapeOverlay?.mor || route) return;
      const response = await fetch(MOR_ROUTE_URL, { signal });
      if (!response?.ok) throw new Error("Mor route preparation failed");
      const loaded = projectAndReverseMorRoute(await response.json());
      if (disposed || signal?.aborted) throw new Error("Mor route preparation cancelled");
      route = loaded;
    },
    holdForScene() {
      cancelScheduled();
      if (heldAt == null) heldAt = Date.now();
      if (runtime && mounted) { const retained = owner; cancelDeparture?.(); cancelDeparture = runtime.onMemberHidden(MOR_ROUTE_SCENE_ID, () => retireOwner(retained)); }
    },
    resumeForScene() {
      cancelDeparture?.(); cancelDeparture = null;
      if (heldAt != null && startedAt != null) startedAt += Math.max(0, Date.now() - heldAt);
      heldAt = null;
      if (active()) schedule();
    },
    applySnapshot(snapshot) {
      cancelDeparture?.(); cancelDeparture = null;
      narrative = snapshot.narrativeState; overlay = snapshot.escapeOverlay;
      if (active() && heldAt != null) {
        if (startedAt != null) startedAt += Math.max(0, Date.now() - heldAt);
        heldAt = null;
      }
      if (!active() && runtime && mounted) {
        const retained = owner; cancelScheduled(); cancelDeparture = runtime.onMemberHidden(MOR_ROUTE_SCENE_ID, () => retireOwner(retained));
        return;
      }
      sync();
    },
    async onStyleLoad() { if (active()) await loadAndSync(); else remove(map); },
    dispose() { cancelDeparture?.(); disposed = true; generation += 1; cancelScheduled(); unsubs.forEach((unsubscribe) => unsubscribe?.()); if (managedScene) retireOwner(); else remove(map); route = null; },
  };
}

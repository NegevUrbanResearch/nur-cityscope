import { afterEach, it, expect, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import { createNovaEscapeCoordinator, NOVA_FLEEING_INDIVIDUAL_URL, NOVA_FLEEING_IMPACT_INDEX_URL } from "../../frontend/src/shared/nli-nova-escape-coordinator.js";
import { getNovaShelterDestinations } from "../../frontend/src/shared/nli-shelter-nova-state.js";
import { SHELTER_LAYER_ID } from "../../frontend/src/shared/maplibre-nli-shelters.js";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const routes = { type: "FeatureCollection", features: [19, 20].map(OBJECTID => ({
  type: "Feature", properties: { OBJECTID }, geometry: { type: "LineString", coordinates: [[34.47, 31.4], [34.45, 31.38]] },
})) };
const bytes = new TextEncoder().encode(JSON.stringify(routes));
const sha = createHash("sha256").update(bytes).digest("hex");

it.each(["gis", "projection"])("%s publishes arrival from ribbon progress even without a settlement crossing index", async surface => {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("fetch", async url => ({ ok: true,
    ...(url === NOVA_FLEEING_INDIVIDUAL_URL ? { arrayBuffer: async () => bytes.buffer } : {}),
    json: async () => url === NOVA_FLEEING_INDIVIDUAL_URL ? routes : { type: "FeatureCollection", features: [] },
  }));
  const map = createFakeMapLibreMap();
  map.addLayer({ id: SHELTER_LAYER_ID, type: "symbol" });
  map.addLayer({ id: "nli__people-circle", source: "nli.people", type: "circle" });
  const coordinator = createNovaEscapeCoordinator({ map, surface, profile: surface });
  try {
    await coordinator.sync({ id: "nova" }, { individual: true });
    const layerIds = map.getStyle().layers.map(layer => layer.id);
    const routeIds = layerIds.filter(id => id.includes("nova") && id !== SHELTER_LAYER_ID);
    expect(routeIds.length).toBeGreaterThan(0);
    expect(routeIds.every(id => layerIds.indexOf(id) < layerIds.indexOf(SHELTER_LAYER_ID))).toBe(true);
    expect(layerIds.indexOf(SHELTER_LAYER_ID)).toBeLessThan(layerIds.indexOf("nli__people-circle"));
    coordinator.setRevealProgress(0.999);
    expect(getNovaShelterDestinations(map)?.completedRouteIds || []).toEqual([]);
    coordinator.setRevealProgress(1);
    expect(getNovaShelterDestinations(map)).toEqual({ routeSHA256: sha, completedRouteIds: ["19", "20"] });
    coordinator.setRevealProgress(0);
    expect(getNovaShelterDestinations(map)?.completedRouteIds || []).toEqual([]);
    coordinator.setRevealProgress(1);
    await coordinator.sync({ id: null }, {});
    expect(getNovaShelterDestinations(map)).toBeNull();
  } finally { coordinator.dispose(); }
});

it("keeps natural destination progress running when a delayed crossing index is invalid", async () => {
  let now = 1000, resolveIndex;
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("fetch", async url => {
    if (url === NOVA_FLEEING_IMPACT_INDEX_URL) return await new Promise(resolve => resolveIndex = resolve);
    return { ok: true, ...(url === NOVA_FLEEING_INDIVIDUAL_URL ? { arrayBuffer: async () => bytes.buffer } : {}),
      json: async () => ({ type: "FeatureCollection", features: [] }) };
  });
  const map = createFakeMapLibreMap();
  const coordinator = createNovaEscapeCoordinator({ map, surface: "gis", profile: "gis" });
  try {
    await coordinator.sync({ id: "nova" }, { individual: true });
    coordinator.debugNoteRibbonDrawable();
    resolveIndex({ ok: true, json: async () => ({ schemaVersion: -1 }) });
    await vi.waitFor(() => expect(warning).toHaveBeenCalledTimes(1));
    now += 100000;
    map.driveAnimationFrame(now);
    expect(getNovaShelterDestinations(map)?.completedRouteIds).toEqual(["19", "20"]);
  } finally { coordinator.dispose(); }
});
it("holds destination progress during scene retention, resumes it and clears on replay", async () => {
  let now = 1000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("fetch", async url => ({ ok: true,
    ...(url === NOVA_FLEEING_INDIVIDUAL_URL ? { arrayBuffer: async () => bytes.buffer } : {}),
    json: async () => url === NOVA_FLEEING_IMPACT_INDEX_URL
      ? { schemaVersion: 1, routeIds: ["19", "20"], parallelCrossings: [], settlementCrossings: [] }
      : { type: "FeatureCollection", features: [] },
  }));
  const map = createFakeMapLibreMap();
  const coordinator = createNovaEscapeCoordinator({ map, surface: "gis", profile: "gis" });
  try {
    await coordinator.sync({ id: "nova" }, { individual: true });
    coordinator.debugNoteRibbonDrawable();
    coordinator.holdForScene();
    now += 100000;
    coordinator.setRevealProgress(null);
    expect(getNovaShelterDestinations(map)?.completedRouteIds || []).toEqual([]);
    coordinator.resumeForScene();
    map.driveAnimationFrame(now);
    expect(getNovaShelterDestinations(map)?.completedRouteIds || []).toEqual([]);
    now += 100000;
    map.driveAnimationFrame(now);
    expect(getNovaShelterDestinations(map)?.completedRouteIds).toEqual(["19", "20"]);
    await coordinator.sync({ id: "nova" }, {});
    await coordinator.sync({ id: "nova" }, { individual: true });
    coordinator.debugNoteRibbonDrawable();
    map.driveAnimationFrame(now);
    expect(getNovaShelterDestinations(map)?.completedRouteIds || []).toEqual([]);
  } finally { coordinator.dispose(); }
});

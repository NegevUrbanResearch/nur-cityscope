import { createUuid } from "../shared/uuid.js";
import { idleNliClock, normalizeNliClock } from "../shared/nli-investigation-clock.js";
import { HOME_CUE, TIMELINE, NARRATIVES } from "../remote/nli-staff-script.js";
import { createCueRunner } from "../remote/nli-staff-cues.js";
import layerRegistry from "../shared/layer-registry.js";

function fail(message) { throw new Error(message); }
function clone(value) { return value == null ? value : structuredClone(value); }
function meta(sourceId) { return { sourceId, timestamp: Date.now() }; }
function responseError(response, message) {
  if (!response || response.ok === false || response.stale === true || response.error) throw response?.error || new Error(message);
}

function cueForScene(sceneId) {
  if (sceneId === "home") return { cue: HOME_CUE, narrativeId: null };
  if (sceneId === "timeline") return { cue: TIMELINE.steps.at(-1)?.cue, narrativeId: null };
  if (!["segev", "nova", "sderot", "hostages", "hostages_all"].includes(sceneId)) fail("Unknown GIS exhibit scene");
  const source = NARRATIVES.find((item) => item.id === (sceneId === "hostages_all" ? "hostages" : sceneId));
  if (!source) fail(`Missing exhibit narrative: ${sceneId}`);
  const step = sceneId === "hostages_all"
    ? source.steps.at(-1)
    : source.steps.find((item) => item.cue?.clock === "idle");
  if (step?.cue?.clock !== "idle") fail(`No idle cue is available for ${sceneId}`);
  return { cue: clone(step.cue), narrativeId: step.cue.narrative || sceneId };
}

function validNarrative(value) {
  return value && typeof value === "object" && (value.id === null || typeof value.id === "string") && Number.isSafeInteger(value.revision) && value.revision >= 0;
}

function validPerson(value) {
  return value && typeof value === "object" && (value.personId == null || typeof value.personId === "string") && Number.isSafeInteger(value.revision) && value.revision >= 0;
}

function flattenEnabled(groups) {
  const result = new Map();
  for (const group of Array.isArray(groups) ? groups : []) {
    for (const layer of Array.isArray(group?.layers) ? group.layers : []) {
      result.set(`${group.id}.${String(layer.id)}`, layer.enabled === true);
    }
  }
  return result;
}

function registryLayerIds(groups) {
  const ids = [];
  for (const group of Array.isArray(groups) ? groups : []) {
    for (const layer of Array.isArray(group?.layers) ? group.layers : []) ids.push(`${group.id}.${String(layer.id)}`);
  }
  return [...new Set(ids)];
}

export function createClockExhibitCueAction({ api, tableName = "otef", sourceId = createUuid() } = {}) {
  if (!api || typeof api.getState !== "function" || typeof api.setLayerToggles !== "function") throw new Error("Clock exhibit action requires API-backed state and layer methods");
  let cancelled = false;
  let snapshot = null;
  let cueRunner = null;
  let lastError = null;
  let registryGroups = null;

  async function freshSnapshot() {
    const next = await api.getState(tableName, { forceFresh: true });
    if (!next || !Array.isArray(next.layerGroups) || !validNarrative(next.narrative_state) || !validPerson(next.person_selection)
      || !next.investigation_clock || typeof next.investigation_clock !== "object") fail("Fresh exhibit state is incomplete");
    snapshot = clone(next);
    return snapshot;
  }

  function assertLive(live) { if (cancelled || (typeof live === "function" && !live())) { const error = new Error("cancelled"); error.cancelled = true; throw error; } }
  async function captureError(operation) { try { return await operation(); } catch (error) { lastError = error; throw error; } }

  async function setEnabledLayerIds(ids, live) {
    assertLive(live);
    if (!snapshot?.layerGroups || !registryGroups) fail("Layer registry and current layer settings are unavailable");
    const enabled = new Set(Array.isArray(ids) ? ids : []);
    const current = flattenEnabled(snapshot.layerGroups);
    const registered = registryLayerIds(registryGroups);
    if (registered.some((id) => !current.has(id))) fail("Fresh layer settings do not include every registered scene layer");
    const changes = registered.filter((id) => current.has(id) && current.get(id) !== enabled.has(id))
      .map((id) => ({ full_layer_id: id, enabled: enabled.has(id) }));
    if (!changes.length) return { ok: true };
    const result = await api.setLayerToggles(tableName, changes, meta(sourceId));
    responseError(result, "Layer update was not acknowledged");
    let groups = result.layerGroups;
    if (!Array.isArray(groups)) groups = (await freshSnapshot()).layerGroups;
    const acknowledged = flattenEnabled(groups);
    if (registered.some((id) => !acknowledged.has(id) || acknowledged.get(id) !== enabled.has(id))) fail("Layer update acknowledgement did not match the requested scene");
    snapshot.layerGroups = clone(groups);
    return { ok: true };
  }

  async function setNarrative(id) {
    const current = snapshot?.narrative_state;
    if (!validNarrative(current)) fail("Narrative revision is unavailable");
    const result = await api.setNarrative(tableName, id, current.revision, meta(sourceId));
    responseError(result, "Narrative update was not acknowledged");
    const acknowledged = result.scene?.narrativeState || result.scene?.narrative_state || result.narrativeState || result.narrative_state;
    if (!validNarrative(acknowledged) || acknowledged.id !== id || acknowledged.revision <= current.revision) fail("Narrative acknowledgement is missing or stale");
    snapshot.narrative_state = clone(acknowledged);
    return result;
  }

  async function clearPerson() {
    const current = snapshot?.person_selection;
    if (!validPerson(current)) fail("Person selection revision is unavailable");
    const result = await api.clearPerson(current.revision, { tableName, ...meta(sourceId) });
    responseError(result, "Person selection clear was not acknowledged");
    const acknowledged = result.personSelection || result.person_selection;
    if (!validPerson(acknowledged) || acknowledged.personId != null || acknowledged.revision <= current.revision) fail("Person clear acknowledgement is missing or stale");
    snapshot.person_selection = clone(acknowledged);
    return result;
  }

  async function setEscapeOverlay(overlay) {
    const expected = Object.fromEntries(["individual", "overlap", "mor", "settled"].map((key) => [key, overlay?.[key] === true]));
    const result = await api.setEscapeOverlay(tableName, expected, meta(sourceId));
    responseError(result, "Escape overlay update was not acknowledged");
    const acknowledged = result.escapeOverlay || result.escape_overlay;
    if (!acknowledged || Object.keys(expected).some((key) => acknowledged[key] !== expected[key])) fail("Escape overlay acknowledgement is missing or mismatched");
    snapshot.escapeOverlay = clone(acknowledged);
    return result;
  }

  async function stopClock(live) {
    assertLive(live);
    const current = normalizeNliClock(snapshot?.investigation_clock);
    const requested = idleNliClock(current);
    const result = await api.updateInvestigationClock(tableName, requested, meta(sourceId));
    responseError(result, "Idle clock update was not acknowledged");
    const acknowledged = result.investigation_clock || result.investigationClock;
    if (!acknowledged || typeof acknowledged !== "object") fail("Idle clock acknowledgement is missing");
    const clock = normalizeNliClock(acknowledged);
    if (clock.phase !== "idle" || !Number.isSafeInteger(clock.revision) || clock.revision <= current.revision) fail("Idle clock acknowledgement is stale or invalid");
    snapshot.investigation_clock = clone(clock);
    return { ok: true };
  }

  function makeRunner() {
    const dataContext = {
      getNarrativeState: () => snapshot?.narrative_state,
      getPersonSelection: () => snapshot?.person_selection,
      clearPerson: () => captureError(clearPerson),
      setNarrative: (id) => captureError(() => setNarrative(id)),
      setEscapeOverlay: (overlay) => captureError(() => setEscapeOverlay(overlay)),
    };
    cueRunner = createCueRunner({ dataContext,
      commitLayers: (ids) => captureError(() => setEnabledLayerIds(ids, () => !cancelled)),
      stopClock: (live) => captureError(() => stopClock(live)),
      startClock: async () => fail("Clock exhibit action cannot start playback"),
      endClock: async () => fail("Clock exhibit action cannot end playback"),
    });
  }

  return {
    async show(sceneId) {
      if (cancelled) fail("Clock exhibit action was cancelled");
      lastError = null;
      try {
        const resolved = cueForScene(sceneId);
        if (resolved.cue?.clock !== "idle") fail("Only an idle exhibit cue can be shown from the layout editor");
        await layerRegistry.init();
        assertLive(() => !cancelled);
        registryGroups = clone(layerRegistry.getGroups());
        await freshSnapshot();
        assertLive(() => !cancelled);
        makeRunner();
        const result = await cueRunner.apply(resolved.cue, resolved.narrativeId);
        if (result.status !== "ready") throw lastError || new Error("Exhibit scene was not acknowledged");
        return { status: "ready", sceneId };
      } catch (error) {
        lastError = error;
        throw error;
      }
    },
    cancel() { cancelled = true; cueRunner?.cancel(); },
  };
}

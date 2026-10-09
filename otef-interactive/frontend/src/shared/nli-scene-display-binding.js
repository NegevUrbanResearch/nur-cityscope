import { createNliSceneTransition, NLI_SCENE_READY_TIMEOUT_MS, nliSceneStructuralKey, prepareNliScene } from "./nli-scene-transition.js";
import { getLayerLifecycleRuntime } from "./layer-lifecycle-fade.js";
import { getEnabledMapFullLayerIds } from "../map/maplibre-layer-manager.js";
import { pauseNliClock } from "./nli-investigation-clock.js";
import { reportNliSceneFailure } from "./nli-scene-diagnostics.js";

// Copy configuration values; immutable dataset/geometry caches remain references.
function capture(value, key = "") {
  if (!value || typeof value !== "object" || ["data", "geojson", "features"].includes(key)) return value;
  if (Array.isArray(value)) return value.map(item => capture(item));
  return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, capture(item, name)]));
}
export function captureNliDisplaySnapshot(context, filterGroups = groups => groups) {
  const rawLayerGroups = capture(context.getLayerGroups?.() || []);
  const layerGroups = capture(filterGroups(rawLayerGroups));
  return { rawLayerGroups, layerGroups, enabledIds: [...getEnabledMapFullLayerIds(layerGroups)],
    narrativeState: capture(context.getNarrativeState?.()), escapeOverlay: capture(context.getEscapeOverlay?.() || {}),
    investigationClock: capture(context.getInvestigationClock?.() || { phase: "idle" }),
    personSelection: capture(context.getPersonSelection?.()), basemapId: context.getBasemap?.(),
    gazaBorderVisible: context.getGazaBorderVisible?.() === true };
}

// Transport changes apply to a retained story; membership/beats/window changes do not.
function clockContentKey(clock = {}) {
  const transport = ["phase", "positionMs", "anchorMs", "seekKind", "revision", "serverNowMs", "presentationPendingUntilMs", "alarmOnsetOriginMs"];
  return JSON.stringify(Object.keys(clock).filter(key => !transport.includes(key)).sort().map(key => [key,
    ["membership", "hiddenDisplays"].includes(key) && Array.isArray(clock[key]) ? [...clock[key]].sort() : clock[key],
  ]));
}

/** One NLI topic route per display. Renderer callbacks receive captured inputs.
 * getRenderSnapshot exposes the exact inputs mounted at zero, including while
 * entry is running. getDisplayedSnapshot remains the coordinator's committed state.
 * Task 4 can extend prepare/apply with names/presentation inputs and membership.
 */
export async function createNliSceneDisplayBinding({ map, dataContext, filterGroups,
  runtime = getLayerLifecycleRuntime(map), runtimeForStyle = () => getLayerLifecycleRuntime(map), narrativeController, escapeCoordinator, morCoordinator,
  refreshLayers = async () => {}, syncTimeline = async () => {}, getTimelineSceneIds = () => [], getTimelineSceneContentKey = () => undefined, syncPerson = () => {},
  onSnapshotApplied = () => {}, closeArchive = () => {}, requestManualBasemap = () => {},
  prepareBasemap, applyBasemap, discardBasemap = () => {}, getDisplayedBasemap, onSceneSettled = () => {},
  isManaged = () => true, onUnmanagedSnapshot = () => {},
  getDisplaySceneIds = () => [], prepareDisplay = async () => null,
  applyDisplay = async () => {}, discardDisplay = () => {}, getPresentationCommand = () => null,
  diagnosticContext = {},
  coordinateEntry = (_snapshot, options, produce) => produce(options.signal), waitForEntry = async () => {},
  onSceneFailed = () => {},
} = {}) {
  const readSnapshot = () => {
    const command = getPresentationCommand();
    const snapshot = { ...captureNliDisplaySnapshot(dataContext, filterGroups),
      presentationCommand: command?.presentationAction === "close" ? null : capture(command) };
    return escapeCoordinator?.captureSceneInput?.(snapshot) || snapshot;
  };
  let renderSnapshot = readSnapshot();
  let coordinator, disposed = false, styleEpoch = 0, heldBasemap = false, sceneInFlight = false, requestSerial = 0;
  const subscribers = new Set();
  let mountedBasemap = null, styleController = null, suspended = false, normalResume = null, waitingNormalHold = false, normalGateCoordinator = null, normalPreparingSnapshot = null;
  const withoutBasemap = snapshot => nliSceneStructuralKey({ ...snapshot, basemapId: null });
  const sceneIds = snapshot => [...new Set([...snapshot.enabledIds,
    ...getTimelineSceneIds(snapshot), ...getDisplaySceneIds(snapshot),
    ...(narrativeController?.getSceneIds?.(snapshot) || []),
    ...(escapeCoordinator?.getSceneIds?.(snapshot) || []),
    ...(morCoordinator?.getSceneIds?.(snapshot) || []),
    ...(prepareBasemap ? [`nli.basemap.${["satellite", "satellite_bw"].includes(snapshot.basemapId) ? "esri" : snapshot.basemapId}`] : []),
  ])];
  const contentKeys = (snapshot, id) => [narrativeController?.getSceneContentKey?.(snapshot, id),
    escapeCoordinator?.getSceneContentKey?.(snapshot, id), morCoordinator?.getSceneContentKey?.(snapshot, id),
    getTimelineSceneContentKey(snapshot, id)];
  const changedContent = (previous, next, ids = sceneIds(previous)) => {
    const desired = new Set(sceneIds(next));
    return ids.filter(id => desired.has(id) && contentKeys(previous, id).some((key, index) => key !== contentKeys(next, id)[index]));
  };
  const producerChanges = (producer, previous, next) => {
    const before = producer?.getSceneIds?.(previous) || [], after = producer?.getSceneIds?.(next) || [];
    return JSON.stringify([...before].sort()) !== JSON.stringify([...after].sort()) ||
      [...new Set([...sceneIds(previous), ...sceneIds(next)])].some(id => producer?.getSceneContentKey?.(previous, id) !== producer?.getSceneContentKey?.(next, id));
  };
  const producerChangedIds = (producer, previous, next) => {
    const before = producer?.getSceneIds?.(previous) || [], after = producer?.getSceneIds?.(next) || [];
    return [...new Set([...before, ...after])].filter(id => before.includes(id) !== after.includes(id) ||
      producer?.getSceneContentKey?.(previous, id) !== producer?.getSceneContentKey?.(next, id));
  };
  const timelineChanges = (previous, next) => {
    const before = sceneIds(previous).filter(id => getTimelineSceneContentKey(previous, id) !== undefined);
    const after = sceneIds(next).filter(id => getTimelineSceneContentKey(next, id) !== undefined);
    return JSON.stringify([...before].sort()) !== JSON.stringify([...after].sort()) ||
      before.some(id => after.includes(id) && getTimelineSceneContentKey(previous, id) !== getTimelineSceneContentKey(next, id));
  };
  const sceneMembership = snapshot => sceneIds(snapshot).filter(id => !id.startsWith("nli.basemap.")).sort();
  const sceneChanges = (previous, next) => JSON.stringify(sceneMembership(previous)) !== JSON.stringify(sceneMembership(next)) ||
    changedContent(previous, next).length > 0 ||
    // Scene-bound presentations retain their existing prepared replacement contract.
    nliSceneStructuralKey({ ...previous, enabledIds: [], narrativeState: null, escapeOverlay: {}, investigationClock: {}, basemapId: null }) !==
      nliSceneStructuralKey({ ...next, enabledIds: [], narrativeState: null, escapeOverlay: {}, investigationClock: {}, basemapId: null });
  const current = (signal, epoch) => !disposed && !signal?.aborted && epoch === styleEpoch;
  async function apply(snapshot, options = {}, prepared) {
    const epoch = styleEpoch;
    if (!current(options.signal, epoch) || !isManaged()) return;
    const mounted = renderSnapshot;
    renderSnapshot = snapshot;
    const valid = () => current(options.signal, epoch) && isManaged() && !suspended && (options.isCurrent?.() ?? true);
    if (!options.semanticOnly && (!prepared?.sceneReconcile || JSON.stringify(mounted.layerGroups) !== JSON.stringify(snapshot.layerGroups) ||
        prepared.replaceIds?.some(id => snapshot.enabledIds.includes(id)))) {
      await refreshLayers({ groupsOverride: snapshot.layerGroups, syncFlow: false,
        layerStyleOptions: { lifecycle: { joinBatch: true } }, isCurrent: valid });
      if (!valid()) return;
    }
    if (narrativeController?.applySnapshot) narrativeController.applySnapshot(snapshot);
    else narrativeController?.apply?.(snapshot.narrativeState);
    if (!options.semanticOnly) {
      if (!prepared?.sceneReconcile || prepared.escapeChanged) await escapeCoordinator?.applySnapshot?.(snapshot, options);
      if (!valid()) return;
      if (!prepared?.sceneReconcile || prepared.morChanged) await morCoordinator?.applySnapshot?.(snapshot, options);
      if (!valid()) return;
      if (prepared?.basemap) { await applyBasemap?.(prepared.basemap, options); mountedBasemap = prepared.basemap; }
    } else if (snapshot.basemapId !== coordinator?.getDisplayedSnapshot().basemapId) {
      requestManualBasemap(snapshot.basemapId);
    }
    if (!valid()) return;
    await applyDisplay(prepared?.display, { ...options, snapshot, namesEntry: prepared?.namesEntry });
    if (!valid()) return;
    await syncTimeline(snapshot, { ...options, joinBatch: !options.semanticOnly, isCurrent: valid });
    if (!valid()) return;
    await syncPerson(snapshot.personSelection, snapshot);
    if (!valid()) return;
    onSnapshotApplied(snapshot);
    for (const callback of subscribers) callback(snapshot);
  }
  // Retain each producer's candidate, including when a later producer stalls.
  async function prepareResources(snapshot, controller, { renderers = true, previousSnapshot } = {}) {
    const signal = controller.signal;
    let basemap, display;
    const discard = () => {
      const resources = { basemap, display }; basemap = null; display = null;
      try { discardBasemap(resources.basemap); } finally { discardDisplay(resources.display); }
    };
    const receive = (value, cleanup) => {
      if (signal.aborted) { cleanup(value); throw new Error("Scene cancelled"); }
      return value;
    };
    try {
      return await prepareNliScene(() => coordinateEntry(snapshot, { signal, previousSnapshot }, async (preparationSignal = signal) => {
        if (renderers) await Promise.all([escapeCoordinator?.prepareSnapshot?.(snapshot, { signal: preparationSignal }), morCoordinator?.prepareSnapshot?.(snapshot, { signal: preparationSignal })]);
        if (preparationSignal.aborted) throw new Error("Scene cancelled");
        basemap = receive(await prepareBasemap?.(snapshot.basemapId, { signal: preparationSignal }), discardBasemap);
        display = receive(await prepareDisplay(snapshot, { signal: preparationSignal }), discardDisplay);
        return { basemap, display };
      }), { controller });
    } catch (error) { discard(); throw error; }
  }
  const initialIds = sceneIds(renderSnapshot);
  const initialController = new AbortController();
  let initial;
  try {
    initial = await prepareResources(renderSnapshot, initialController, { renderers: false });
    await waitForEntry(initial, { signal: initialController.signal });
    const initialBatch = runtime.setDesiredIds(initialIds, { durationMs: 0, requiredIds: initialIds,
      readinessTimeoutMs: NLI_SCENE_READY_TIMEOUT_MS });
    const completion = initial?.namesEntry ? runtime.waitForBatch(initialBatch, { signal: initialController.signal }) : null;
    await apply(renderSnapshot, { joinBatch: true, signal: initialController.signal }, initial);
    runtime.commitBatch(); mountedBasemap?.complete?.();
    if (completion) {
      if ((await completion).status !== 'ready') throw new Error('Initial paired Names scene was not drawable');
      onSceneSettled(renderSnapshot);
    }
  } catch (error) {
    onSceneFailed(error, renderSnapshot);
    initialController.abort();
    try { discardBasemap(initial?.basemap); } finally { discardDisplay(initial?.display); }
    throw error;
  }
  const discardResources = resources => {
    try { discardBasemap(resources?.basemap); } finally { discardDisplay(resources?.display); }
  };
  async function prepareTransition(snapshot, signal) {
    let basemap, display;
    try {
      const previous = coordinator.getDisplayedSnapshot();
      const desiredIds = sceneIds(snapshot);
      const mounted = renderSnapshot;
      // Departing members may remain visible after desired membership changes.
      const mountedIds = [...new Set([...runtime.getDesiredIds(), ...desiredIds.filter(id => map.getLayer?.(id))])];
      const replaceIds = changedContent(mounted, snapshot, mountedIds);
      const escapeChanged = producerChanges(escapeCoordinator, mounted, snapshot);
      const morChanged = producerChanges(morCoordinator, mounted, snapshot);
      await Promise.all([escapeChanged && escapeCoordinator?.prepareSnapshot?.(snapshot, { signal }), morChanged && morCoordinator?.prepareSnapshot?.(snapshot, { signal })]);
      if (signal.aborted) throw new Error('Scene cancelled');
      basemap = previous.basemapId !== snapshot.basemapId || getDisplayedBasemap && getDisplayedBasemap() !== snapshot.basemapId || !runtime.getDesiredIds().includes(`nli.basemap.${['satellite', 'satellite_bw'].includes(snapshot.basemapId) ? 'esri' : snapshot.basemapId}`)
        ? await prepareBasemap?.(snapshot.basemapId, { signal }) : null;
      if (signal.aborted) throw new Error('Scene cancelled');
      display = await prepareDisplay(snapshot, { signal, previousSnapshot: mounted });
      if (signal.aborted) throw new Error('Scene cancelled');
      if (timelineChanges(mounted, snapshot)) {
        const clock = pauseNliClock(renderSnapshot.investigationClock, dataContext.correctedNow?.() ?? Date.now(), { narrativeId: renderSnapshot.narrativeState?.id });
        await syncTimeline({ ...renderSnapshot, investigationClock: clock }, { semanticOnly: true });
      }
      if (signal.aborted) throw new Error('Scene cancelled');
      if (producerChanges(narrativeController, mounted, snapshot)) narrativeController?.holdForScene?.();
      if (escapeChanged) escapeCoordinator?.holdForScene?.({ changedIds: producerChangedIds(escapeCoordinator, mounted, snapshot) });
      if (morChanged) morCoordinator?.holdForScene?.();
      return { desiredIds, replaceIds: [...new Set([...replaceIds, ...(basemap?.replaceIds || []), ...(display?.replaceIds || [])])], basemap, display, escapeChanged, morChanged, sceneReconcile: true };
    } catch (error) { discardResources({ basemap, display }); throw error; }
  }
  const makeCoordinator = () => createNliSceneTransition({ runtime,
    waitForEntry,
    onFailure: diagnostic => { reportNliSceneFailure({ ...diagnosticContext, ...diagnostic }); onSceneFailed(diagnostic, readSnapshot()); },
    readSnapshot: () => initializingStyle ? renderSnapshot : readSnapshot(),
    isStructuralChange(previous, next) {
      return sceneChanges(previous, next) ||
        ((heldBasemap || sceneInFlight || !!prepareBasemap && previous.basemapId == null) && previous.basemapId !== next.basemapId);
    },
    async prepare(snapshot, { signal }) {
      return coordinateEntry(snapshot, { signal, previousSnapshot: coordinator.getDisplayedSnapshot(), discard: discardResources },
        preparationSignal => prepareTransition(snapshot, preparationSignal || signal));
    },
    applyPrepared: (prepared, options) => apply(options.snapshot, options, prepared),
    async restorePrevious(snapshot, options) {
      const basemap = await prepareBasemap?.(getDisplayedBasemap?.() || snapshot.basemapId, options);
      const display = await prepareDisplay(snapshot, options);
      await apply(snapshot, options, { basemap, display });
    },
    discardPrepared(prepared) { discardBasemap(prepared?.basemap); discardDisplay(prepared?.display); },
    async resumeRetained(snapshot, { isCurrent }) {
      const epoch = styleEpoch;
      const valid = () => !disposed && epoch === styleEpoch && !suspended && isManaged() && isCurrent();
      if (!valid()) return;
      const latest = readSnapshot();
      const sameStory = withoutBasemap({ ...snapshot, enabledIds: [] }) === withoutBasemap({ ...latest, enabledIds: [] }) &&
        clockContentKey(snapshot.investigationClock) === clockContentKey(latest.investigationClock);
      const retained = sameStory ? { ...snapshot, investigationClock: latest.investigationClock } : snapshot;
      renderSnapshot = retained;
      narrativeController?.resumeForScene?.(); escapeCoordinator?.resumeForScene?.(retained); morCoordinator?.resumeForScene?.();
      await syncTimeline(retained, { semanticOnly: true, isCurrent: valid });
    },
  });
  let initializingStyle = true;
  coordinator = makeCoordinator(); initializingStyle = false;
  let frozenForScene = false;
  const topics = ["layerGroups", "gazaBorderVisibility", "narrativeState", "escapeOverlay", "investigationClock", "personSelection", "basemap"];
  const request = () => {
    if (disposed) return Promise.resolve({ status: "cancelled" });
    if (!isManaged()) { suspend(); onUnmanagedSnapshot(readSnapshot()); return Promise.resolve({ status: "cancelled" }); }
    if (dataContext.getInvestigationClock?.()?.presentationPendingUntilMs > (dataContext.correctedNow?.() ?? Date.now())) heldBasemap = true;
    if (normalResume) {
      if (waitingNormalHold) { void coordinator.waitForHold(); return normalResume; }
      const next = readSnapshot();
      if (normalPreparingSnapshot && nliSceneStructuralKey(normalPreparingSnapshot) === nliSceneStructuralKey(next) &&
          normalPreparingSnapshot.investigationClock?.presentationPendingUntilMs === next.investigationClock?.presentationPendingUntilMs) return normalResume;
      styleController?.abort(); normalResume = null;
      return resumeNormal();
    }
    if (suspended) return resumeNormal();
    const serial = ++requestSerial;
    const next = readSnapshot();
    sceneInFlight = sceneInFlight || heldBasemap || sceneChanges(coordinator.getDisplayedSnapshot(), next);
    if (sceneInFlight && !frozenForScene && timelineChanges(renderSnapshot, next)) {
      frozenForScene = true;
      const clock = pauseNliClock(renderSnapshot.investigationClock, dataContext.correctedNow?.() ?? Date.now(), { narrativeId: renderSnapshot.narrativeState?.id });
      void syncTimeline({ ...renderSnapshot, investigationClock: clock }, { semanticOnly: true });
    }
    const completion = coordinator.request();
    void completion.then(result => {
      if (result.status === "cancelled" || serial !== requestSerial) return;
      const structural = sceneInFlight;
      sceneInFlight = false; frozenForScene = false;
      heldBasemap = false;
      if (result.status === "ready") { mountedBasemap?.complete?.(); if (structural) onSceneSettled(coordinator.getDisplayedSnapshot()); }
    });
    return completion;
  };
  function suspend() {
    if (disposed || suspended && !normalResume) return;
    suspended = true; normalGateCoordinator = null; styleEpoch += 1; requestSerial += 1;
    styleController?.abort(); coordinator.dispose();
    narrativeController?.holdForScene?.(); escapeCoordinator?.holdForScene?.(); morCoordinator?.holdForScene?.();
  }
  async function resumeNormal({ isCurrent = () => true } = {}) {
    if (disposed || !isManaged() || !isCurrent()) return { status: "cancelled" };
    if (normalResume) return normalResume;
    // The mode owner has restored current normal groups. Reinstall captured
    // normal inputs at readiness, then hand ownership back to the coordinator.
    const operation = (async () => {
      const retained = coordinator.getDisplayedSnapshot();
      styleController?.abort();
      const controller = new AbortController(); styleController = controller;
      const signal = controller.signal; const epoch = ++styleEpoch;
      let established = false, basemap, display, namesEntry;
      const reportFailure = details => reportNliSceneFailure({ ...diagnosticContext, phase: "normal-return", ...details,
        requested: { enabledIds: normalPreparingSnapshot?.enabledIds || [], narrativeId: normalPreparingSnapshot?.narrativeState?.id ?? null },
        retained: { enabledIds: retained.enabledIds, narrativeId: retained.narrativeState?.id ?? null } });
      suspended = true;
      requestSerial += 1;
      try {
        runtime = runtimeForStyle();
        if (normalGateCoordinator !== coordinator) {
          coordinator.dispose(); renderSnapshot = retained; initializingStyle = true;
          coordinator = makeCoordinator(); initializingStyle = false;
          normalGateCoordinator = coordinator;
        }
        const waitForRelease = async () => {
          waitingNormalHold = true;
          try {
            for (;;) {
              const gate = await coordinator.waitForHold();
              if (!current(signal, epoch) || !isManaged() || !isCurrent()) return null;
              if (gate.status !== "released") return null;
              const deadline = dataContext.getInvestigationClock?.()?.presentationPendingUntilMs;
              if (gate.snapshot.investigationClock?.presentationPendingUntilMs === deadline) return gate.snapshot;
            }
          } finally { if (epoch === styleEpoch) waitingNormalHold = false; }
        };
        if (!await waitForRelease()) return { status: "cancelled" };
        narrativeController?.resetStyle?.(); escapeCoordinator?.resetStyle?.(); morCoordinator?.resetStyle?.();
        for (;;) {
          let snapshot;
          for (;;) {
            snapshot = readSnapshot();
            normalPreparingSnapshot = snapshot;
            ({ basemap, display, namesEntry } = await prepareResources(snapshot, controller, { previousSnapshot: retained }));
            // A newly acknowledged hold during preparation also blocks activation.
            if (!await waitForRelease()) return { status: "cancelled" };
            const latest = readSnapshot();
            if (nliSceneStructuralKey(snapshot) === nliSceneStructuralKey(latest)) { snapshot = latest; break; }
            discardBasemap(basemap); discardDisplay(display); basemap = null; display = null;
          }
          if (!current(signal, epoch) || !isManaged() || !isCurrent()) return { status: "cancelled" };
          await waitForEntry({ namesEntry }, { signal });
          const ids = sceneIds(snapshot);
          const handle = runtime.setDesiredIds(ids, { durationMs: 0, requiredIds: ids,
            readinessTimeoutMs: NLI_SCENE_READY_TIMEOUT_MS });
          const completion = runtime.waitForBatch(handle, { signal });
          suspended = false;
          await apply(snapshot, { signal, joinBatch: true, isCurrent }, { basemap, display, namesEntry });
          if (!current(signal, epoch) || !isManaged() || !isCurrent()) return { status: "cancelled" };
          runtime.commitBatch(); const result = await completion;
          if (!current(signal, epoch) || !isManaged() || !isCurrent()) return { status: "cancelled" };
          if (result.status !== "ready") {
            if (result.status === "failed") reportFailure(handle?.failure || { reason: "Scene readiness failed" });
            return result;
          }
          heldBasemap = false; sceneInFlight = false; frozenForScene = false;
          if (!coordinator.rebaseDisplayed(snapshot)) continue;
          mountedBasemap?.complete?.(); normalGateCoordinator = null;
          onSceneSettled(snapshot);
          established = true;
          return result;
        }
      } catch (error) {
        const status = !disposed && epoch === styleEpoch && isManaged() && (error?.timedOut || !signal.aborted) ? "failed" : "cancelled";
        if (status === "failed") reportFailure({
          reason: String(error?.message || error).slice(0, 500), errorName: error?.name || "Error",
          stack: String(error?.stack || "").slice(0, 4000) });
        return { status };
      } finally {
        if (!established) {
          controller.abort();
          try { discardBasemap(basemap); discardDisplay(display); } catch { /* Candidate cleanup cannot retain false ownership. */ }
          if (!disposed && epoch === styleEpoch) {
            suspended = true;
            renderSnapshot = retained;
            // Keep the last committed inputs; only a new explicit request retries.
            console.warn("[nli-scene] normal return did not establish ownership; waiting for an explicit cue or retry");
          }
        }
      }
    })();
    normalResume = operation;
    try { return await operation; }
    finally {
      if (normalResume === operation) {
        normalResume = null; normalPreparingSnapshot = null;
        if (!disposed && isManaged() && !suspended) void request();
      }
    }
  }
  const unsubs = topics.map(topic => dataContext.subscribe?.(topic, () => {
    // Archive commands are safety/interaction actions, independent of held pixels.
    if (topic === "narrativeState") closeArchive();
    void request();
  }));
  void request();
  return {
    request, suspend, resumeNormal, isManaging: () => !disposed && !suspended && isManaged(),
    adoptManualBasemap(basemapId, adopt) {
      if (disposed || suspended || !isManaged() || sceneInFlight || heldBasemap || runtime.getPendingBatch() ||
          typeof adopt !== "function" || getDisplayedBasemap?.() !== basemapId) return false;
      const snapshot = readSnapshot();
      if (snapshot.basemapId !== basemapId || !coordinator.canRebaseDisplayed(snapshot)) return false;
      if (adopt({ runtime, snapshot }) !== true || !coordinator.rebaseDisplayed(snapshot)) return false;
      renderSnapshot = snapshot; mountedBasemap = null;
      return true;
    },
    getDisplayedSnapshot: () => coordinator.getDisplayedSnapshot(),
    getRenderSnapshot: () => renderSnapshot,
    subscribeApplied(callback) { subscribers.add(callback); return () => subscribers.delete(callback); },
    async onStyleLoad() {
      if (disposed) return { status: "cancelled" };
      styleController?.abort(); normalResume = null; waitingNormalHold = false;
      const retained = coordinator.getDisplayedSnapshot();
      normalGateCoordinator = null;
      suspended = true; styleEpoch += 1; requestSerial += 1; coordinator.dispose();
      narrativeController?.resetStyle?.(); escapeCoordinator?.resetStyle?.(); morCoordinator?.resetStyle?.();
      for (const id of new Set([...runtime.getDesiredIds(), ...sceneIds(renderSnapshot), ...sceneIds(retained)])) runtime.dropChannels(id);
      runtime.dispose(); runtime = runtimeForStyle();
      renderSnapshot = retained;
      return resumeNormal();
    },
    dispose() { if (disposed) return; disposed = true; styleController?.abort(); styleEpoch += 1; coordinator.dispose(); unsubs.forEach(unsub => unsub?.()); subscribers.clear(); },
  };
}

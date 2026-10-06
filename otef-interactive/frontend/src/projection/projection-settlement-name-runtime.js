import { visibleProjectionBrowserError } from "./projection-browser-error.js";
import { addPaintWriteObserver } from "../shared/layer-lifecycle-fade.js";
import { createSettlementNameFraming } from './settlement-name-framing.js';
import { sha256Hex } from '../shared/sha256-hex.js';
import { normalizeProjectionMatchValue } from '../shared/projection-match-frame.js';

const SETTLEMENT_LAYER = "שמות_יישובים";

function settlementVisible(groups) {
  for (const group of groups || []) {
    for (const layer of group.layers || []) {
      const id = layer.fullId || layer.id;
      if (id !== SETTLEMENT_LAYER && id !== `projector_base.${SETTLEMENT_LAYER}` && !layer.fullLayerIds?.includes(`projector_base.${SETTLEMENT_LAYER}`)) continue;
      return layer.enabled !== false && group.enabled !== false;
    }
  }
  return true;
}

export function bindProjectionSettlementNames({ dataContext, adapter, catalog, host, map, output, getConfig, getGroups, getCalibrationActive = () => false, onReadinessChange = () => {}, onReadiness = () => {}, onDraw = () => {}, onError = () => {} } = {}) {
  if (!adapter || typeof adapter.prepare !== "function") throw new Error("Settlement runtime requires an adapter");
  if (map?.project && output) adapter.setFramingProvider(createSettlementNameFraming({map,output,getConfig}));
  let disposed = false;
  let token = 0;
  let committedToken = null, paintToken = 0;
  let setupAlert = null;
  let pending = Promise.resolve();
  let readiness = { ready: false, error: null, revision: null, desiredRevision: null, committedRevision: null,
    catalogIdentity: null, settingsIdentity: null, pending: true, failed: false };
  const identity = value => sha256Hex(new TextEncoder().encode(JSON.stringify(normalizeProjectionMatchValue(value))));
  const catalogIdentity = identity({ entries: [...(catalog?.entries || [])].sort((a, b) => a.citycode.localeCompare(b.citycode)),
    referenceOffsets: [...(catalog?.referenceOffsets || [])].sort(([a], [b]) => a.localeCompare(b)),
    outlines: [...(catalog?.outlines || [])].sort(([a], [b]) => a.localeCompare(b)) });
  const report = next => { readiness = { ...readiness, ...next }; onReadinessChange({ ...readiness }); onReadiness({ ...readiness }); };
  const clearSetupError = () => {
    setupAlert?.remove?.();
    setupAlert = null;
  };
  const applyGroupVisibility = () => {
    if (getCalibrationActive()) { adapter.setVisible(true); return; }
    if (map) return;
    adapter.setVisible(settlementVisible(getGroups?.()));
  };
  const replayMapOpacity = () => {
    if (getCalibrationActive()) { adapter.applyScaledOpacity(1); adapter.setVisible(true); return; }
    if (!map || typeof map.getPaintProperty !== "function") return;
    if (typeof map.getLayer === 'function' && !map.getLayer('projector_base__שמות_יישובים__labels')) return;
    const value = map.getPaintProperty("projector_base__שמות_יישובים__labels", "text-opacity");
    if (value === undefined) return;
    adapter.applyScaledOpacity(value);
  };
  const drawAndAwaitPaint = async (current = token, { preserveError = false } = {}) => {
    const painting = ++paintToken;
    const isCurrent = () => !disposed && current === token && painting === paintToken;
    report({ ready: false, pending: true, ...(preserveError ? {} : { error: null, failed: false }) });
    try {
      await onDraw();
      if (!isCurrent()) return;
      if (preserveError) report({ pending: false });
      else if (committedToken === current) report({ ready: true, pending: false, failed: false, error: null });
    } catch (error) {
      if (!isCurrent()) return;
      onError(error);
      report({ ready: false, pending: false, failed: true, error: String(error.message || error) });
    }
  };
  const redraw = () => {
    const paint = drawAndAwaitPaint(token, { preserveError: readiness.failed && committedToken !== token });
    // Once preparation committed, only the latest paint matters; stale draws may never settle.
    pending = committedToken === token ? paint : Promise.all([pending, paint]).then(() => {});
  };
  const run = async () => {
    const current = ++token;
    const settings = structuredClone(dataContext?.getSettlementNameSettings?.() || null);
    const revision = dataContext?.getSettlementNameRevision?.();
    const reported = dataContext?.getSettlementNameError?.();
    report({ ready: false, error: null, revision, desiredRevision: revision, pending: true, failed: false });
    if (!settings) {
      if (reported || revision === 0) {
        adapter.setVisible(false);
        const error = new Error(reported || "Initialization required");
        setupAlert = visibleProjectionBrowserError(host, error);
        onError(error);
        report({ ready: false, error: error.message, revision, pending: false, failed: true });
        if (adapter.descriptor()) await drawAndAwaitPaint(current, { preserveError: true });
      }
      return;
    }
    try {
      const [catalogSignature, settingsSignature] = await Promise.all([catalogIdentity, identity(settings)]);
      if (disposed || current !== token) return;
      report({ catalogIdentity: catalogSignature, settingsIdentity: settingsSignature });
      const prepared = await adapter.prepare({ catalog, settings });
      if (disposed || current !== token || prepared?.stale) return;
      adapter.commit();
      committedToken = current;
      report({ committedRevision: revision });
      clearSetupError();
      applyGroupVisibility();
      replayMapOpacity();
      // onDraw may wait for the compositor's paint; an old descriptor does not establish readiness.
      await drawAndAwaitPaint(current);
    } catch (error) {
      if (disposed || current !== token) return;
      onError(error);
      report({ ready: false, error: error.message, revision, pending: false, failed: true });
    }
  };
  const onNames = () => { pending = run(); };
  const onGroups = () => {
    if (disposed || getCalibrationActive()) return;
    applyGroupVisibility();
    if (adapter.descriptor()) redraw();
  };
  const offNames = dataContext?.subscribe?.("settlementNames", onNames) || (() => {});
  const offGroups = dataContext?.subscribe?.("layerGroups", onGroups) || (() => {});
  const offPaint = addPaintWriteObserver(map, (event) => {
    if (disposed) return;
    if (event.property !== "text-opacity") return;
    if (event.fullId !== SETTLEMENT_LAYER && event.fullId !== `projector_base.${SETTLEMENT_LAYER}`) return;
    if (typeof event.layerId !== "string" || !event.layerId.startsWith("projector_base__שמות_יישובים")) return;
    if (getCalibrationActive()) return;
    adapter.applyScaledOpacity(event.value);
    if (adapter.descriptor()) redraw();
  });
  if (!dataContext?.subscribe) pending = run();
  const dispose = () => {
    disposed = true;
    token += 1;
    offNames();
    offGroups();
    offPaint();
  };
  dispose.getReadiness = () => ({ ...readiness });
  dispose.whenReady = async () => { await pending; if (!readiness.ready) throw new Error(readiness.error || 'Settlement labels are not prepared'); return { ...readiness }; };
  dispose.refreshVisibility = () => { applyGroupVisibility(); replayMapOpacity(); };
  return dispose;
}

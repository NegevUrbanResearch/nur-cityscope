import { visibleProjectionBrowserError } from "./projection-browser-error.js";
import { addPaintWriteObserver } from "../shared/layer-lifecycle-fade.js";
import { createSettlementNameFraming } from './settlement-name-framing.js';

const SETTLEMENT_LAYER = "שמות_יישובים";

function settlementVisible(groups) {
  for (const group of groups || []) {
    for (const layer of group.layers || []) {
      const id = layer.fullId || layer.id;
      if (id !== SETTLEMENT_LAYER && id !== `projector_base.${SETTLEMENT_LAYER}`) continue;
      return layer.enabled !== false && group.enabled !== false;
    }
  }
  return true;
}

export function bindProjectionSettlementNames({ dataContext, adapter, catalog, host, map, output, getConfig, getGroups, onDraw = () => {}, onError = () => {} } = {}) {
  if (!adapter || typeof adapter.prepare !== "function") throw new Error("Settlement runtime requires an adapter");
  if (map?.project && output) adapter.setFramingProvider(createSettlementNameFraming({map,output,getConfig}));
  let disposed = false;
  let token = 0;
  let setupAlert = null;
  const clearSetupError = () => {
    setupAlert?.remove?.();
    setupAlert = null;
  };
  const applyGroupVisibility = () => {
    if (map) return;
    adapter.setVisible(settlementVisible(getGroups?.()));
  };
  const replayMapOpacity = () => {
    if (!map || typeof map.getPaintProperty !== "function") return;
    if (typeof map.getLayer === 'function' && !map.getLayer('projector_base__שמות_יישובים__labels')) return;
    const value = map.getPaintProperty("projector_base__שמות_יישובים__labels", "text-opacity");
    if (value === undefined) return;
    adapter.applyScaledOpacity(value);
  };
  const run = async () => {
    const current = ++token;
    const settings = dataContext?.getSettlementNameSettings?.() || null;
    const revision = dataContext?.getSettlementNameRevision?.();
    const reported = dataContext?.getSettlementNameError?.();
    if (!settings) {
      if (reported || revision === 0) {
        adapter.setVisible(false);
        if (adapter.descriptor()) onDraw();
        const error = new Error(reported || "Initialization required");
        setupAlert = visibleProjectionBrowserError(host, error);
        onError(error);
      }
      return;
    }
    try {
      const prepared = await adapter.prepare({ catalog, settings });
      if (disposed || current !== token || prepared?.stale) return;
      adapter.commit();
      clearSetupError();
      applyGroupVisibility();
      replayMapOpacity();
      onDraw();
    } catch (error) {
      if (disposed || current !== token) return;
      onError(error);
    }
  };
  const onNames = () => { void run(); };
  const onGroups = () => {
    applyGroupVisibility();
    if (adapter.descriptor()) onDraw();
  };
  const offNames = dataContext?.subscribe?.("settlementNames", onNames) || (() => {});
  const offGroups = dataContext?.subscribe?.("layerGroups", onGroups) || (() => {});
  const offPaint = addPaintWriteObserver(map, (event) => {
    if (disposed) return;
    if (event.property !== "text-opacity") return;
    if (event.fullId !== SETTLEMENT_LAYER && event.fullId !== `projector_base.${SETTLEMENT_LAYER}`) return;
    if (typeof event.layerId !== "string" || !event.layerId.startsWith("projector_base__שמות_יישובים")) return;
    adapter.applyScaledOpacity(event.value);
    if (adapter.descriptor()) onDraw();
  });
  if (!dataContext?.subscribe) void run();
  return () => {
    disposed = true;
    token += 1;
    offNames();
    offGroups();
    offPaint();
  };
}

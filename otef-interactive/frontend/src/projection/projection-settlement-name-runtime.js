import { visibleProjectionBrowserError } from "./projection-browser-error.js";

const SETTLEMENT_LAYER = "שמות_יישובים";

function settlementVisible(groups) {
  for (const group of groups || []) {
    for (const layer of group.layers || []) {
      const id = layer.fullId || layer.id;
      if (id !== SETTLEMENT_LAYER && id !== `projector_base.${SETTLEMENT_LAYER}`) continue;
      return group.enabled !== false && layer.enabled !== false;
    }
  }
  return true;
}

export function bindProjectionSettlementNames({ dataContext, adapter, catalog, host, getGroups, onDraw = () => {}, onError = () => {} } = {}) {
  if (!adapter || typeof adapter.prepare !== "function") throw new Error("Settlement runtime requires an adapter");
  let disposed = false;
  let token = 0;
  let setupAlert = null;
  const clearSetupError = () => {
    setupAlert?.remove?.();
    setupAlert = null;
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
      adapter.setVisible(settlementVisible(getGroups?.()));
      onDraw();
    } catch (error) {
      if (disposed || current !== token) return;
      onError(error);
    }
  };
  const onNames = () => { void run(); };
  const onGroups = () => {
    adapter.setVisible(settlementVisible(getGroups?.()));
    if (adapter.descriptor()) onDraw();
  };
  const offNames = dataContext?.subscribe?.("settlementNames", onNames) || (() => {});
  const offGroups = dataContext?.subscribe?.("layerGroups", onGroups) || (() => {});
  if (!dataContext?.subscribe) void run();
  return () => {
    disposed = true;
    token += 1;
    offNames();
    offGroups();
  };
}

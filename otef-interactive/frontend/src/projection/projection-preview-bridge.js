import { validateProjectionConfig } from "../shared/projection-config-schema.js";

const CLOCK_LAYOUT_KEYS = ["leftPct", "topPct", "widthPct", "heightPct", "fontPx", "rotateDeg"];
const finiteLayout = (value) => value && typeof value === "object" && !Array.isArray(value) &&
  CLOCK_LAYOUT_KEYS.every((key) => Number.isFinite(value[key])) && value.widthPct > 0 && value.heightPct > 0 && value.fontPx > 0;

/** Separate child-only protocol; the ordinary warp preview keeps its existing messages. */
export function installProjectionClockPreviewBridge({ win, sessionId, renderState }) {
  if (!win?.parent || win.parent === win || !sessionId || typeof renderState !== "function") {
    throw new Error("Projection clock preview requires its parent and session");
  }
  const parent = win.parent;
  const origin = win.location.origin;
  let lastRequestId = 0;
  let disposed = false;
  let activeAbort = null;
  const reply = (payload) => parent.postMessage({ ...payload, sessionId }, origin);
  const onMessage = (event) => {
    const state = event.data;
    if (disposed || event.source !== parent || event.origin !== origin || state?.type !== "otef_clock_preview_state" ||
      state.sessionId !== sessionId || !Number.isSafeInteger(state.requestId) || state.requestId <= lastRequestId) return;
    if (state.surface !== "projection" || state.sceneId !== "home" || state.output !== "left" ||
      !["clock", "legend"].includes(state.element) || !finiteLayout(state.clockLayout) || !finiteLayout(state.legendLayout) ||
      !Number.isSafeInteger(state.pageIndex) || state.pageIndex < 0 ||
      (state.legendLayout.dwellSeconds != null && !Number.isFinite(state.legendLayout.dwellSeconds))) {
      reply({ type: "otef_clock_preview_error", requestId: state.requestId, message: "Invalid projection clock preview state" });
      return;
    }
    lastRequestId = state.requestId;
    activeAbort?.abort();
    const controller = new AbortController();
    activeAbort = controller;
    const isCurrent = () => !disposed && !controller.signal.aborted && lastRequestId === state.requestId;
    const fail = (error) => {
      if (isCurrent()) reply({ type: "otef_clock_preview_error", requestId: state.requestId, message: error?.message || "Projection preview failed" });
    };
    try {
      const local = { ...state, clockLayout: { ...state.clockLayout }, legendLayout: { ...state.legendLayout } };
      Promise.resolve(renderState(local, { signal: controller.signal, isCurrent })).then((result) => {
        if (!isCurrent()) return;
        reply({ type: "otef_clock_preview_rendered", requestId: state.requestId, surface: "projection", sceneId: "home", output: "left",
          meshIdentity: result.meshIdentity, mesh: result.mesh, pageIndex: result.pageIndex, pageCount: result.pageCount,
          ...(result.warnings == null ? {} : { warnings: result.warnings }) });
      }).catch(fail);
    } catch (error) { fail(error); }
  };
  win.addEventListener("message", onMessage);
  reply({ type: "otef_clock_preview_ready", surface: "projection", output: "left" });
  return () => { disposed = true; activeAbort?.abort(); win.removeEventListener("message", onMessage); };
}

const MAX_SETTLEMENT_LABELS = 512;

function finiteSettlementLabel(label) {
  return label && typeof label.citycode === "string" && typeof label.text === "string"
    && [label.x, label.y, label.rotateDeg].every(Number.isFinite);
}

/** Child protocol for the settlement editor. It never writes settings or changes the exhibit. */
export function installProjectionSettlementPreviewBridge({ win, sessionId, output, renderState }) {
  if (!win?.parent || win.parent === win || !sessionId || !["left", "right"].includes(output) || typeof renderState !== "function") {
    throw new Error("Settlement preview requires its parent, output, and session");
  }
  const parent = win.parent;
  const origin = win.location.origin;
  let lastRequestId = 0;
  let disposed = false;
  let activeAbort = null;
  const reply = (payload) => parent.postMessage({ ...payload, sessionId, output }, origin);
  const onMessage = (event) => {
    const state = event.data;
    if (disposed || event.source !== parent || event.origin !== origin || state?.type !== "otef_settlement_preview_state"
      || state.sessionId !== sessionId || state.output !== output || !Number.isSafeInteger(state.requestId) || state.requestId <= lastRequestId) return;
    lastRequestId = state.requestId;
    activeAbort?.abort();
    const controller = new AbortController();
    activeAbort = controller;
    const isCurrent = () => !disposed && !controller.signal.aborted && lastRequestId === state.requestId;
    const fail = (error) => { if (isCurrent()) reply({ type: "otef_settlement_preview_error", requestId: state.requestId, message: error?.message || "Settlement preview failed" }); };
    Promise.resolve(renderState(state, { signal: controller.signal, isCurrent })).then((result) => {
      if (!isCurrent() || !result) return;
      if (!Array.isArray(result.labels) || result.labels.length > MAX_SETTLEMENT_LABELS || !result.labels.every(finiteSettlementLabel)) {
        fail(new Error("Settlement preview labels are invalid"));
        return;
      }
      reply({ type: "otef_settlement_preview_rendered", requestId: state.requestId, calibrationRevision: result.calibrationRevision,
        meshIdentity: result.meshIdentity, mesh: result.mesh, labels: result.labels, warnings: result.warnings });
    }).catch(fail);
  };
  win.addEventListener("message", onMessage);
  reply({ type: "otef_settlement_preview_ready" });
  return () => { disposed = true; activeAbort?.abort(); win.removeEventListener("message", onMessage); };
}

function boundedWallDiagnostics(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !["valid", "invalid"].includes(value.state) ||
    typeof value.datasetVersion !== "string" || value.datasetVersion.length > 128 || !["wall", "model"].includes(value.mode) ||
    !Number.isSafeInteger(value.requestedFontPx) ||
    !(value.effectiveFontPx === null || Number.isSafeInteger(value.effectiveFontPx)) ||
    !Number.isSafeInteger(value.expected) || value.expected < 1 || !Number.isSafeInteger(value.placed) || value.placed < 0 || value.placed > value.expected) return null;
  return { state: value.state, datasetVersion: value.datasetVersion, mode: value.mode,
    requestedFontPx: value.requestedFontPx, effectiveFontPx: value.effectiveFontPx,
    expected: value.expected, placed: value.placed,
    left: Number.isSafeInteger(value.left) ? value.left : null,
    right: Number.isSafeInteger(value.right) ? value.right : null,
    ...(typeof value.reason === "string" ? { reason: value.reason.slice(0, 240) } : {}) };
}

export function installProjectionPreviewBridge({ win, output, map, nameFieldController, syncContextInvestigation, applyProjectionConfig, validateWall }) {
  if (!win?.parent || win.parent === win || !["left", "right"].includes(output)) return () => {};
  const origin = win.location.origin;
  const reply = (message) => win.parent.postMessage({ ...message, output }, origin);
  let validationGeneration = 0;
  let validationAbort = null;
  let applyGeneration = 0;
  let applyAbort = null;
  const onMessage = (event) => {
    const message = event.data;
    if (event.source !== win.parent || event.origin !== origin || !['otef_projection_preview_config', 'otef_projection_preview_validate'].includes(message?.type) || message.output !== output || !Number.isSafeInteger(message.requestId)) return;
    if (message.type === 'otef_projection_preview_validate') {
      const identity = message.identity;
      const requestId = message.requestId;
      validationAbort?.abort();
      validationAbort = new AbortController();
      const signal = validationAbort.signal;
      const generation = ++validationGeneration;
      const result = (valid, wall, error, diagnostics) => reply({ type: 'otef_projection_preview_validated', requestId, identity, valid,
        ...(wall ? { wall } : {}), ...(diagnostics ? { diagnostics } : {}), ...(error ? { error: String(error).slice(0, 240) } : {}) });
      if (typeof identity !== 'string' || identity !== JSON.stringify(message.config) || Object.keys(validateProjectionConfig(message.config)).length || typeof validateWall !== 'function') {
        result(false, null, 'Invalid wall preview candidate'); return;
      }
      Promise.resolve().then(() => validateWall(message.config, { generation, identity, revision: message.revision, signal })).then((wall) => {
        if (generation !== validationGeneration) return;
        const diagnostics = boundedWallDiagnostics(wall?.diagnostics || (wall?.state ? wall : null));
        const core = wall?.wall || wall;
        if (!Number.isFinite(core?.heading) || core.heading !== message.config.namesWall?.rotateDeg) {
          result(false, null, 'Name wall heading disagrees with candidate rotation');
          return;
        }
        const complete = core?.expected === core?.placed && Number.isSafeInteger(core?.expected) && core.expected > 0 && /^[a-f0-9]{64}$/i.test(core?.digest || '');
        const valid = diagnostics ? diagnostics.state === 'valid' && diagnostics.mode === message.config.namesWall.activeMode &&
          diagnostics.expected === core?.expected && diagnostics.placed === core?.placed && complete : complete;
        if (valid) {
          const { diagnostics: _diagnostics, state: _state, reason: _reason, heading: _heading, ...safeWall } = core;
          result(true, safeWall, null, diagnostics);
        } else {
          result(false, null, diagnostics?.reason || wall?.reason || 'Incomplete names wall', diagnostics);
        }
      }).catch((error) => { if (generation === validationGeneration) result(false, null, error?.message || 'Wall preview failed'); });
      return;
    }
    if (Object.keys(validateProjectionConfig(message.config)).length) {
      reply({ type: "otef_projection_preview_applied", requestId: message.requestId, success: false, error: "Invalid calibration draft" });
      return;
    }
    applyAbort?.abort();
    applyAbort = new AbortController();
    const generation = ++applyGeneration;
    const finish = (prepared) => {
      if (generation !== applyGeneration || applyAbort.signal.aborted) return;
      if (prepared === false) throw new Error("Projection output rejected draft");
      if (prepared?.committed !== true) {
        if (map.setEffectiveProjectionConfig(message.config) === false) throw new Error("Projection camera rejected draft");
        if (nameFieldController.setProjectionConfig(message.config) === false) throw new Error("Projection labels rejected draft");
      }
      syncContextInvestigation();
      reply({ type: "otef_projection_preview_applied", requestId: message.requestId, success: true });
    };
    const fail = (error) => { if (generation === applyGeneration && !applyAbort.signal.aborted)
      reply({ type: "otef_projection_preview_applied", requestId: message.requestId, success: false, error: error.message || "Preview failed" }); };
    try {
      const prepared = applyProjectionConfig?.(message.config, { generation, signal: applyAbort.signal });
      if (prepared && typeof prepared.then === 'function') Promise.resolve(prepared).then(finish).catch(fail);
      else finish(prepared);
    } catch (error) { fail(error); }
  };
  win.addEventListener("message", onMessage);
  reply({ type: "otef_projection_preview_ready" });
  return () => { validationGeneration++; validationAbort?.abort(); applyGeneration++; applyAbort?.abort(); win.removeEventListener("message", onMessage); };
}

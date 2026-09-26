import { validateProjectionConfig } from "../shared/projection-config-schema.js";

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
        const complete = core?.expected === core?.placed && Number.isSafeInteger(core?.expected) && core.expected > 0 && /^[a-f0-9]{64}$/i.test(core?.digest || '');
        const valid = diagnostics ? diagnostics.state === 'valid' && diagnostics.mode === message.config.namesWall.activeMode &&
          diagnostics.expected === core?.expected && diagnostics.placed === core?.placed && complete : complete;
        if (valid) {
          const { diagnostics: _diagnostics, state: _state, reason: _reason, ...safeWall } = core;
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

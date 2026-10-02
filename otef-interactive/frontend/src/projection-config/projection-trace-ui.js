export function createProjectionTraceUi({ document: doc = globalThis.document, trace } = {}) {
  if (!doc || !trace) throw new TypeError("A document and projection trace are required");
  const element = doc.createElement("section");
  element.className = "projection-trace-status";
  element.setAttribute("aria-label", "Projection trace");
  element.style.cssText = "display:grid;grid-template-rows:3.5rem auto;gap:.25rem;font:inherit;flex:1 0 100%;width:100%;min-width:0;";

  const status = doc.createElement("span");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  status.style.cssText = 'display:block;height:3.5rem;overflow:auto;line-height:1.15rem;font-size:.85rem;';
  element.appendChild(status);

  const stop = makeButton(doc, "Stop tracing");
  const copy = makeButton(doc, "Copy trace");
  const exportButton = makeButton(doc, "Export trace");
  let fallbackField = null;
  const actions = doc.createElement('div');
  actions.style.cssText = 'display:flex;gap:.5rem;';
  actions.append(stop, copy, exportButton); element.appendChild(actions);

  const render = (state = trace.getStatus()) => {
    const session = state.sessionId ? String(state.sessionId).slice(0, 8) : "unknown";
    const connection = state.connected ? "connected" : "disconnected";
    const lifecycle = state.recording ? "recording" : "stopped";
    const pending = Number(state.pending || 0);
    const queue = Number(state.queued || 0);
    const delivery = pending || queue ? `, ${pending} pending, ${queue} queued` : "";
    const dropped = Number(state.dropped || 0);
    status.textContent = `Trace ${session}: ${connection}, ${Number(state.acknowledged || 0)} PC acknowledged${delivery}, ${dropped} dropped, ${lifecycle}${state.deliveryError ? `, delivery issue: ${state.deliveryError}` : ""}.`;
    stop.disabled = !state.recording;
  };
  const unsubscribe = trace.subscribe(render);
  stop.addEventListener("click", () => trace.stop());
  copy.addEventListener("click", async () => {
    const value = trace.exportJson();
    const clipboard = doc.defaultView?.navigator?.clipboard;
    try {
      if (clipboard?.writeText) {
        await clipboard.writeText(value);
        status.textContent = "Trace copied.";
      } else {
        fallbackField = showFallbackCopy(element, doc, fallbackField, value);
        status.textContent = "Clipboard unavailable. Select the trace text below and copy it.";
      }
    } catch {
      fallbackField = showFallbackCopy(element, doc, fallbackField, value);
      status.textContent = "Clipboard unavailable. Select the trace text below and copy it.";
    }
  });
  exportButton.addEventListener("click", () => exportTrace(doc, trace.exportJson()));

  return {
    element,
    dispose() { unsubscribe?.(); element.remove(); },
  };
}

function makeButton(doc, label) {
  const button = doc.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.style.cssText = "font:inherit;min-height:2.25rem;";
  return button;
}

function showFallbackCopy(parent, doc, previous, value) {
  try {
    previous?.remove?.();
    const field = doc.createElement("textarea");
    field.value = value;
    field.setAttribute("aria-label", "Projection trace export text");
    field.setAttribute("readonly", "");
    field.rows = 8;
    field.style.cssText = "width:min(100%,40rem);font:inherit;";
    parent.appendChild(field);
    field.focus?.(); field.select?.();
    return field;
  } catch { return previous || null; }
}

function exportTrace(doc, value) {
  try {
    const BlobType = doc.defaultView?.Blob || globalThis.Blob;
    const URLApi = doc.defaultView?.URL || globalThis.URL;
    const url = URLApi.createObjectURL(new BlobType([value], { type: "application/json" }));
    const anchor = doc.createElement("a");
    anchor.href = url;
    anchor.download = "projection-trace.json";
    anchor.hidden = true;
    doc.body?.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URLApi.revokeObjectURL(url);
  } catch {
    // The Copy control provides the accessible text fallback when downloads are unavailable.
  }
}

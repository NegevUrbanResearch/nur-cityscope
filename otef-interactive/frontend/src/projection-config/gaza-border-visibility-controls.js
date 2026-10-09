export function createGazaBorderVisibilityControls(document, { onChange, onReload }) {
  const element = document.createElement("div");
  element.className = "content-visibility-controls";
  const label = document.createElement("label");
  label.className = "content-visibility-label";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.dataset.action = "gaza-border-visibility";
  const title = document.createElement("span");
  title.textContent = "הצגת גבול עזה";
  title.dir = "rtl";
  label.append(input, title);
  const help = document.createElement("p");
  help.className = "config-help";
  help.textContent = "GIS and both projectors. Saves automatically; scene changes keep this setting.";
  const status = document.createElement("p");
  status.className = "content-visibility-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const reload = document.createElement("button");
  reload.type = "button";
  reload.textContent = "Reload setting";
  reload.hidden = true;
  input.addEventListener("click", event => event.stopPropagation());
  input.addEventListener("change", () => onChange(input.checked));
  reload.addEventListener("click", event => { event.stopPropagation(); onReload(); });
  element.append(label, help, status, reload);
  const render = (state = {}) => {
    input.checked = state.pending ? state.requestedVisible === true : state.visible === true;
    input.disabled = state.loading !== false || state.pending === true;
    status.textContent = state.error ? "Could not save or load this setting. Try again."
      : state.loading !== false ? "Loading setting…" : state.pending ? "Saving…"
        : state.visible ? "Shown in eligible scenes." : "Hidden on all displays.";
    reload.hidden = !state.error;
  };
  render();
  return { element, render };
}

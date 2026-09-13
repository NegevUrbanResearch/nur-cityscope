import { escapeHtml } from "../shared/html-utils.js";
import { t } from "./remote-locale.js";

export const NLI_PACK_PANE_DEFAULT = "layers";

function escape(value) {
  return escapeHtml(String(value ?? ""));
}

export function normalizeNliPackPane(value) {
  return value === "timeline" ? "timeline" : "layers";
}

export function nliPackPaneSwitchHtml(selectedPack, pane) {
  if (!selectedPack || selectedPack.id !== "nli") return "";
  const current = normalizeNliPackPane(pane);
  const layersOn = current === "layers";
  const timelineOn = current === "timeline";
  return `<div class="nli-pack-panes" role="radiogroup" data-i18n-aria="nliPackPaneAria" aria-label="${escape(t("nliPackPaneAria"))}">
    <button type="button" class="nli-pack-pane${layersOn ? " is-selected" : ""}" role="radio" data-nli-pack-pane="layers" aria-checked="${layersOn ? "true" : "false"}">${escape(t("nliPackPaneLayers"))}</button>
    <button type="button" class="nli-pack-pane${timelineOn ? " is-selected" : ""}" role="radio" data-nli-pack-pane="timeline" aria-checked="${timelineOn ? "true" : "false"}">${escape(t("nliPackPaneTimeline"))}</button>
  </div>`;
}

export function consumeNliPackPaneClick(event, host) {
  const target = event?.target;
  if (!target || typeof target.closest !== "function") return false;
  const tab = target.closest("[data-nli-pack-pane]");
  if (!tab) return false;
  event.preventDefault?.();
  event.stopPropagation?.();
  const id = tab.getAttribute("data-nli-pack-pane");
  if (id === "layers" || id === "timeline") host?.setNliPackPane?.(id);
  return true;
}

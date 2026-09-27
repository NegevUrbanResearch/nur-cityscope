import { escapeHtml } from "../shared/html-utils.js";
import { getEscapeOverlay } from "../shared/nli-escape-overlay.js";
import { normalizeNarrativeState } from "../shared/nli-narratives.js";
import { t } from "./remote-locale.js";

function escape(value) {
  return escapeHtml(String(value ?? ""));
}

const STAFF_ESCAPE_KINDS = new Set(["individual", "mor"]);

function toggleButtonHtml(kind, pressed) {
  const labelKey = kind === "mor" ? "nliNovaEscapeMor" : "nliNovaEscapeIndividual";
  const activeClass = pressed ? " is-active" : "";
  return `<button type="button" class="nli-narrative-button nli-nova-escape-toggle${activeClass}" data-nli-nova-escape="${escape(kind)}" aria-pressed="${pressed ? "true" : "false"}">${escape(t(labelKey))}</button>`;
}

export function nliNovaEscapeTogglesHtml(narrativeState, overlayState, kinds) {
  const acknowledged = normalizeNarrativeState(narrativeState);
  if (acknowledged.id !== "nova") return "";
  const requested = Array.isArray(kinds)
    ? kinds.filter((kind) => STAFF_ESCAPE_KINDS.has(kind))
    : [];
  if (requested.length === 0) return "";
  const overlay = getEscapeOverlay(overlayState, acknowledged.id);
  return `<section class="nli-nova-escape-toggles" aria-label="${escape(t("nliNovaEscapeTogglesAria"))}">
    ${requested.map((kind) => toggleButtonHtml(kind, overlay[kind] === true)).join("")}
  </section>`;
}

export function consumeNliNovaEscapeClick(event, host) {
  const target = event?.target;
  if (!target || typeof target.closest !== "function") return false;
  const button = target.closest("[data-nli-nova-escape]");
  if (!button) return false;
  event.preventDefault?.();
  event.stopPropagation?.();
  const kind = button.getAttribute("data-nli-nova-escape");
  if (kind === "individual" || kind === "overlap" || kind === "mor") {
    const pressed = button.getAttribute("aria-pressed") === "true";
    void host?.setEscapeOverlay?.({ [kind]: !pressed });
  }
  return true;
}

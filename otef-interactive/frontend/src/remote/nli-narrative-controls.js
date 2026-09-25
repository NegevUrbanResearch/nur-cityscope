import { escapeHtml } from "../shared/html-utils.js";
import { normalizeNarrativeState } from "../shared/nli-narratives.js";
import { t } from "./remote-locale.js";

const NARRATIVE_BUTTON_IDS = ["segev", "nova", "sderot", "hostages"];

const NARRATIVE_COPY = Object.freeze({
  segev: { labelKey: "nliNarrativeSegev", ariaKey: "nliNarrativeSegevAria" },
  nova: { labelKey: "nliNarrativeNova", ariaKey: "nliNarrativeNovaAria" },
  sderot: { labelKey: "nliNarrativeSderot", ariaKey: "nliNarrativeSderotAria" },
  hostages: { labelKey: "nliNarrativeHostages", ariaKey: "nliNarrativeHostagesAria" },
});

function escape(value) {
  return escapeHtml(String(value ?? ""));
}

function disabledAttribute(disabled) {
  return disabled ? " disabled" : "";
}

function narrativeCopyKeys(id) {
  return NARRATIVE_COPY[id] || NARRATIVE_COPY.segev;
}

function narrativeButtonHtml(id, acknowledged, narrativeDisabled) {
  const active = acknowledged.id === id;
  const { labelKey, ariaKey } = narrativeCopyKeys(id);
  return `<button type="button" class="nli-narrative-button${active ? " is-active" : ""}" data-nli-narrative="${escape(id)}" aria-pressed="${active ? "true" : "false"}" aria-label="${escape(t(ariaKey))}"${disabledAttribute(narrativeDisabled)}>${escape(t(labelKey))}</button>`;
}

export function nliNarrativeControlsHtml(selectedPack, narrativeState, disabledReason) {
  if (!selectedPack || selectedPack.id !== "nli") return "";
  const acknowledged = normalizeNarrativeState(narrativeState);
  const transitionPending = narrativeState?.transitionPending === true;
  const narrativeDisabled = transitionPending || !!disabledReason;
  const feedback = disabledReason || narrativeState?.feedback || "";
  const narrativeButtons = NARRATIVE_BUTTON_IDS
    .map((id) => narrativeButtonHtml(id, acknowledged, narrativeDisabled))
    .join(" ");
  return `<section class="nli-narrative-sheet" aria-labelledby="nliNarrativesTitle">
    <span class="nli-narrative-title" id="nliNarrativesTitle">${escape(t("nliNarrativesTitle"))}</span>
    <div class="nli-narrative-actions">
      <div class="nli-narrative-actions-row">${narrativeButtons}</div>
    </div>
    ${feedback ? `<p class="nli-narrative-feedback" role="status">${escape(feedback)}</p>` : ""}
  </section>`;
}

export function consumeNliNarrativeButtonClick(event, host) {
  const target = event?.target;
  if (!target || typeof target.closest !== "function") return false;
  const narrative = target.closest("[data-nli-narrative]");
  if (!narrative) return false;
  event.preventDefault?.();
  event.stopPropagation?.();
  const id = narrative.getAttribute("data-nli-narrative");
  if (id) void host?.setNarrative?.(id);
  return true;
}
